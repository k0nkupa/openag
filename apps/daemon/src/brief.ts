import {readableResultIdsSQL,type ReadableScope} from "./results.js";
import type { Db } from "./db/index.js";
import type { Ledger } from "./ledger.js";
import type { Scheduler } from "./scheduler.js";
import { resolveDeliveryRoom } from "./delivery.js";
import { getDefaultRedactor } from "./redact.js";
import { getSetting, localParts } from "./settings.js";
import { localDateKey } from "./wake.js";

const MINUTE_MS = 60_000;
/** The brief is due from its time for this long; a later tick never sends it (no catch-up beyond this window). */
export const BRIEF_WINDOW_MINUTES = 180;
const MAX_ITEMS = 15;
const MAX_APPROVALS = 5;
const ITEM_CLIP = 300;

export interface BuiltBrief {
  text: string;
  /** Digest items shown in the brief; only these are marked delivered. */
  digestIds: number[];
  approvals: number;
  resultIds:string[];
}

export type BriefSkipReason = "empty" | "disabled" | "already_sent" | "not_due" | "off_day" | "no_destination";

export interface BriefResult {
  sent: boolean;
  reason?: BriefSkipReason;
}

interface BriefState {
  lastSentDate: string | null;
}

/** Deterministic brief text from the digest queue and pending approvals. Null when there is nothing to say. */
export function buildBrief(args: { db: Db; now?: Date; tz?: string;readableScopes?:()=>ReadableScope[] }): BuiltBrief | null {
  const { db } = args;
  const pending = db
    .prepare("SELECT coalesce((SELECT origin_room_id FROM agent_requests WHERE execution_room_id=a.room_id),a.room_id) room_id,bot_id,tool_name,tool_class FROM approvals a WHERE status = 'pending' ORDER BY created_at, id")
    .all() as {room_id:string; bot_id: string; tool_name: string; tool_class: string }[];
  const scopes=JSON.stringify(args.readableScopes?.()??[]),eligibleSQL=`FROM digest_items WHERE delivered_at IS NULL AND (result_id IS NULL OR result_id IN (${readableResultIdsSQL}))`;
  const queued=(db.prepare(`SELECT count(*) n ${eligibleSQL}`).get(scopes) as {n:number}).n;
  if(!queued&&!pending.length)return null;
  const items=db.prepare(`SELECT id,bot_id,text,result_id ${eligibleSQL} ORDER BY ts,id LIMIT ?`).all(scopes,MAX_ITEMS) as {id:number;bot_id:string;text:string;result_id:string|null}[];

  const sections: string[] = [];
  if (pending.length > 0) {
    const n = pending.length;
    const lines = [`${n} ${n === 1 ? "approval" : "approvals"} waiting for you`];
    for (const a of pending.slice(0, MAX_APPROVALS)) lines.push(`- ${a.bot_id} wants ${a.tool_name} (${a.tool_class}) — [Open conversation](#/room/${encodeURIComponent(a.room_id)})`);
    sections.push(lines.join("\n"));
  }
  if (queued > 0) {
    const lines = [`Overnight notes (${queued}):`];
    for (const item of items) lines.push(`- [${item.bot_id}] ${oneLine(item.text)}`);
    if (queued > items.length) lines.push(`...and ${queued - items.length} more`);
    sections.push(lines.join("\n"));
  }

  const text = getDefaultRedactor().redactString(["Good morning. Here is what is waiting:", ...sections].join("\n\n"));
  return { text, digestIds: items.map((i) => i.id), approvals: pending.length,resultIds:items.flatMap(item=>item.result_id?[item.result_id]:[]) };
}

/** Newlines become spaces, then the text is clipped. Stored text is already redacted. */
function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim().slice(0, ITEM_CLIP);
}

function readState(db: Db): BriefState {
  const row = db.prepare("SELECT value_json FROM settings WHERE key = 'briefState'").get() as
    | { value_json: string }
    | undefined;
  if (!row) return { lastSentDate: null };
  try {
    const parsed = JSON.parse(row.value_json) as { lastSentDate?: unknown };
    return { lastSentDate: typeof parsed.lastSentDate === "string" ? parsed.lastSentDate : null };
  } catch {
    return { lastSentDate: null };
  }
}

function writeState(db: Db, state: BriefState): void {
  db.prepare(
    "INSERT INTO settings (key, value_json, updated_at) VALUES ('briefState', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
  ).run(JSON.stringify(state), Date.now());
}

function previousDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

function weekdayOf(key: string): number {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export interface DeliverBriefArgs {
  db: Db;
  ledger: Ledger;
  now: Date;
  tz: string;
  /** Ignores enabled, days, the due window and lastSentDate. An empty brief is still never sent. */
  force?: boolean;
  readableScopes?:()=>ReadableScope[];
  onBrief?: (info: { items: number; approvals: number }) => void;
}

/**
 * Sends the morning brief as one Primary message in the delivery room (delivery.ts) if it is due. The brief's date is the local date on
 * which its window started, so a window that crosses midnight is keyed to the earlier day.
 */
export function deliverBrief(args: DeliverBriefArgs): BriefResult {
  const { db, ledger, now, tz, force = false, onBrief } = args;
  const brief = getSetting(db, "brief");

  const today = localDateKey(now, tz);
  const { minutes: nowMinutes } = localParts(now, tz);
  const targetMinutes = toMinutes(brief.time);
  const elapsed = (nowMinutes - targetMinutes + 24 * 60) % (24 * 60);
  const windowDate = nowMinutes >= targetMinutes ? today : previousDay(today);

  if (!force) {
    if (!brief.enabled) return { sent: false, reason: "disabled" };
    if (!brief.days.includes(weekdayOf(windowDate))) return { sent: false, reason: "off_day" };
    if (elapsed >= BRIEF_WINDOW_MINUTES) return { sent: false, reason: "not_due" };
    if (readState(db).lastSentDate === windowDate) return { sent: false, reason: "already_sent" };
  }

  // Check first and resolve BEFORE anything is consumed: with nowhere to deliver, the digest items stay undelivered and
  // briefState is untouched, so the brief is retried inside its window once a destination exists.
  if (!buildBrief({ db,readableScopes:args.readableScopes })) return { sent: false, reason: "empty" };
  const roomId = resolveDeliveryRoom(db, ledger);
  if (!roomId) return { sent: false, reason: "no_destination" };

  const built = db.transaction((): BuiltBrief | null => {
    const b = buildBrief({ db,readableScopes:args.readableScopes });
    if (!b) return null;
    if (b.digestIds.length > 0) {
      const placeholders = b.digestIds.map(() => "?").join(", ");
      db.prepare(`UPDATE digest_items SET delivered_at = ? WHERE id IN (${placeholders})`).run(
        now.getTime(),
        ...b.digestIds,
      );
    }
    writeState(db, { lastSentDate: windowDate });
    return b;
  })();

  if (!built) return { sent: false, reason: "empty" };

  ledger.append(roomId, "primary", "message", { text: built.text, brief: true,...(built.resultIds.length?{resultIds:built.resultIds}:{}) });
  ledger.append("_system", "scheduler", "wake", {
    action: "brief_sent",
    items: built.digestIds.length,
    approvals: built.approvals,
  });
  if (onBrief) {
    try {
      onBrief({ items: built.digestIds.length, approvals: built.approvals });
    } catch (err) {
      console.error("brief onBrief failed:", err instanceof Error ? err.message : String(err));
    }
  }
  return { sent: true };
}

/** Checks once a minute; deliverBrief decides whether anything is due. */
export function registerBrief(deps: { db: Db; ledger: Ledger; scheduler: Scheduler; tz: string;readableScopes?:()=>ReadableScope[] }): void {
  const { db, ledger, scheduler, tz } = deps;
  scheduler.register({
    id: "brief",
    schedule: { everyMs: () => MINUTE_MS },
    shouldRun: () => true,
    run: async (now) => {
      deliverBrief({ db, ledger, now, tz,readableScopes:deps.readableScopes });
    },
  });
}
