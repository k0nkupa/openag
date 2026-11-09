import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db/index.js";
import type { Ledger } from "./ledger.js";
import { getDefaultRedactor } from "./redact.js";
import { getSetting, isWithinActiveHours } from "./settings.js";
import { deliveryStatus, resolveDeliveryRoom } from "./delivery.js";

export type VerdictKind = "silent" | "digest" | "ping";
export type Urgency = "low" | "normal" | "high";
export type DecisionKind = "silent" | "digest" | "ping" | "suppressed";
export type SuppressedBy = "invalid" | "active_hours" | "dedupe" | "urgency" | "budget" | "no_destination";

export interface Verdict {
  verdict: VerdictKind;
  reason: string;
  urgency: Urgency;
  dedupe_key: string;
}

const REASON_MAX = 500;
const KEY_MAX = 120;
const LOG_REASON_MAX = 200;
/** Only the tail of a turn's output is searched; a bot's verdict is its last thing. */
const SCAN_WINDOW = 20_000;
const HOUR_MS = 3_600_000;
const URGENCY_RANK: Record<Urgency, number> = { low: 0, normal: 1, high: 2 };

const RawVerdict = z.object({
  verdict: z.enum(["silent", "digest", "ping"]),
  reason: z.string(),
  urgency: z.enum(["low", "normal", "high"]),
  dedupe_key: z.string().optional(),
});

function stableHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

function toVerdict(value: unknown): Verdict | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const parsed = RawVerdict.safeParse(value);
  if (!parsed.success) return null;
  const reason = parsed.data.reason.trim().slice(0, REASON_MAX).trim();
  const key = (parsed.data.dedupe_key ?? "").trim().slice(0, KEY_MAX).trim();
  return {
    verdict: parsed.data.verdict,
    reason,
    urgency: parsed.data.urgency,
    dedupe_key: key || `reason-${stableHash(reason)}`,
  };
}

/**
 * Top-level `{...}` spans in `s`, string-aware (braces and escaped quotes inside JSON strings are ignored).
 * An object left unclosed at the end does not hide what follows it: the scan restarts just after it.
 */
function topLevelObjects(s: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (let attempt = 0; attempt < 32 && from < s.length; attempt++) {
    let depth = 0;
    let start = -1;
    let inStr = false;
    let esc = false;
    for (let i = from; i < s.length; i++) {
      const ch = s[i];
      if (depth === 0) {
        if (ch === "{") {
          depth = 1;
          start = i;
          inStr = false;
          esc = false;
        }
        continue;
      }
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) out.push(s.slice(start, i + 1));
      }
    }
    if (depth === 0) break;
    from = start + 1;
  }
  return out;
}

/** JSON.parse that returns undefined instead of throwing. */
function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/**
 * Finds the bot's verdict in turn output. Order: the whole text as JSON, fenced blocks, then top-level objects from
 * the last to the first. The first candidate that validates wins. Never throws, never evaluates code.
 */
export function parseVerdict(text: string): Verdict | null {
  if (typeof text !== "string") return null;
  const window = (text.length > SCAN_WINDOW ? text.slice(-SCAN_WINDOW) : text).trim();
  const tryJson = (s: string): Verdict | null => toVerdict(safeParse(s));

  const whole = tryJson(window);
  if (whole) return whole;
  // A whole-text JSON array is not a verdict, even if an object inside it would validate.
  if (window.startsWith("[") && Array.isArray(safeParse(window))) return null;

  for (const m of window.matchAll(/```[ \t]*(?:json)?[ \t]*\r?\n?([\s\S]*?)```/g)) {
    const v = tryJson((m[1] ?? "").trim());
    if (v) return v;
  }

  const objects = topLevelObjects(window);
  for (let i = objects.length - 1; i >= 0; i--) {
    const v = tryJson(objects[i]!);
    if (v) return v;
  }
  return null;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** YYYY-MM-DD of `date` on the local calendar of zone `tz`. */
export function localDateKey(date: Date, tz: string): string {
  let fmt = dayFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormatters.set(tz, fmt);
  }
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export interface WakeInput {
  /** Trusted daemon result identity; never read from a model verdict. */
  deliveryKey?:string;
  resultId?:string;
  source: string;
  botId: string;
  turnId: string | null;
  /** The turn's output, or null when there was none (or the run threw). */
  text: string | null;
}

export interface Decision {
  id: number;
  decision: DecisionKind;
  suppressedBy: SuppressedBy | null;
  /** What the bot asked for; null when no verdict could be parsed. */
  verdict: Verdict | null;
  /** Where a delivered ping was written; null for every other decision. */
  delivered: { roomId: string; eventId: number } | null;
}

export interface PingNotice {
  decisionId: number;
  botId: string;
  reason: string;
  urgency: Urgency;
}

export interface WakeFilter {
  process(input: WakeInput): Decision;
}

export interface WakeFilterDeps {
  db: Db;
  ledger: Ledger;
  /** IANA zone for active hours and the daily budget. */
  tz: string;
  now?: () => Date;
  onPing?: (notice: PingNotice) => void;
}

export function createWakeFilter(deps: WakeFilterDeps): WakeFilter {
  const { db, ledger, tz } = deps;
  const now = deps.now ?? (() => new Date());
  const redactor = getDefaultRedactor();
  const insertDecision = db.prepare(
    "INSERT INTO wake_decisions (ts, source, bot_id, turn_id, verdict, urgency, dedupe_key, reason, decision, suppressed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertDigest = db.prepare(
    "INSERT INTO digest_items (ts, bot_id, text, dedupe_key, decision_id, result_id) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const findDuplicate = db.prepare(
    "SELECT 1 FROM wake_decisions WHERE source = ? AND dedupe_key = ? AND decision IN ('ping', 'digest') AND ts >= ? LIMIT 1",
  );
  // Budget lookback is wider than one local day (a day is at most 25h), so the day filter below is exact.
  const recentPings = db.prepare("SELECT ts FROM wake_decisions WHERE decision = 'ping' AND ts >= ?");

  const pingsToday = (at: Date): number => {
    const day = localDateKey(at, tz);
    const rows = recentPings.all(at.getTime() - 50 * HOUR_MS) as { ts: number }[];
    return rows.filter((r) => localDateKey(new Date(r.ts), tz) === day).length;
  };

  return {
    process(input) {
      let notice:PingNotice|undefined;
      const result=ledger.atomic(()=>{
      if(input.deliveryKey){
        if(input.deliveryKey.length>200)throw new Error('Invalid delivery key');
        const prior=db.prepare('SELECT * FROM wake_decisions WHERE delivery_key=?').get(input.deliveryKey) as {id:number;decision:DecisionKind;suppressed_by:SuppressedBy|null;verdict:VerdictKind;urgency:Urgency;reason:string;dedupe_key:string}|undefined;
        if(prior){const event=db.prepare("SELECT id,room_id FROM events WHERE type='message' AND json_extract(payload_json,'$.decisionId')=? AND json_extract(payload_json,'$.wake')=1 LIMIT 1").get(prior.id) as {id:number;room_id:string}|undefined;
          return {id:prior.id,decision:prior.decision,suppressedBy:prior.suppressed_by,verdict:{verdict:prior.verdict,urgency:prior.urgency,reason:prior.reason,dedupe_key:prior.dedupe_key},delivered:event?{roomId:event.room_id,eventId:event.id}:null};}
      }
      const at = now();
      const ts = at.getTime();
      const parsed = input.text === null ? null : parseVerdict(input.text);

      const committed = db.transaction(() => {
        let stored: { verdict: VerdictKind; urgency: Urgency; dedupeKey: string; reason: string };
        let decision: DecisionKind;
        let suppressedBy: SuppressedBy | null = null;

        if (!parsed) {
          stored = { verdict: "silent", urgency: "low", dedupeKey: "invalid", reason: "no parseable verdict" };
          decision = "silent";
          suppressedBy = "invalid";
        } else {
          const settings = getSetting(db, "wake");
          const dedupeKey = redactor.redactString(parsed.dedupe_key);
          stored = {
            verdict: parsed.verdict,
            urgency: parsed.urgency,
            dedupeKey,
            reason: redactor.redactString(parsed.reason),
          };
          decision = parsed.verdict;

          if (parsed.verdict === "silent") {
            decision = "silent";
          } else if (findDuplicate.get(input.source, dedupeKey, ts - settings.dedupeHours * HOUR_MS)) {
            decision = "suppressed";
            suppressedBy = "dedupe";
          } else if (parsed.verdict === "ping") {
            if (!isWithinActiveHours(at, getSetting(db, "activeHours"), tz)) {
              decision = "digest";
              suppressedBy = "active_hours";
            } else if (URGENCY_RANK[parsed.urgency] < URGENCY_RANK[settings.urgencyThreshold]) {
              decision = "digest";
              suppressedBy = "urgency";
            } else if (pingsToday(at) >= settings.dailyPingBudget) {
              decision = "digest";
              suppressedBy = "budget";
            } else if (deliveryStatus(db).state !== "ok") {
              // Nowhere to deliver: keep it for the brief instead of writing to a missing room.
              decision = "digest";
              suppressedBy = "no_destination";
            }
          }
        }

        const info = insertDecision.run(
          ts,
          input.source,
          input.botId,
          input.turnId,
          stored.verdict,
          stored.urgency,
          stored.dedupeKey,
          stored.reason,
          decision,
          suppressedBy,
          ts,
        );
        const id = Number(info.lastInsertRowid);
        if (decision === "digest") insertDigest.run(ts, input.botId, stored.reason, stored.dedupeKey, id,input.resultId??null);
        return { id, decision, suppressedBy, stored };
      })();

      const { id, decision, suppressedBy, stored } = committed;
      if(input.deliveryKey)db.prepare('UPDATE wake_decisions SET delivery_key=? WHERE id=?').run(input.deliveryKey,id);
      const destination = decision === "ping" ? resolveDeliveryRoom(db, ledger) : null;
      let delivered: Decision["delivered"] = null;
      if (decision === "ping" && destination) {
        const event = ledger.append(destination, "primary", "message", {
          // External sources are labelled, so text derived from an outside sender never reads as the bot's own alert.
          text: input.source.startsWith("automation:")||input.source.startsWith("responsibility:")
            ? `Heads-up from ${input.botId} (via ${input.source.slice(input.source.indexOf(":")+1)}): ${stored.reason}`
            : `Heads-up from ${input.botId}: ${stored.reason}`,
          wake: true,
          decisionId: id,
          ...(input.resultId?{resultId:input.resultId}:{}),
        });
        delivered = { roomId: destination, eventId: event.id };
      }
      ledger.append("_system", "scheduler", "wake", {
        decisionId: id,
        source: input.source,
        botId: input.botId,
        verdict: stored.verdict,
        urgency: stored.urgency,
        dedupeKey: stored.dedupeKey,
        decision,
        suppressedBy,
        reason: stored.reason.slice(0, LOG_REASON_MAX),
      });
      if(decision==='ping')notice={decisionId:id,botId:input.botId,reason:stored.reason,urgency:stored.urgency};
      return { id, decision, suppressedBy, verdict: parsed, delivered };
      });
      if(notice&&deps.onPing){try{deps.onPing(notice);}catch{console.error('wake onPing failed');}}
      return result;
    },
  };
}

export interface WakeDecisionRow {
  id: number;
  ts: number;
  source: string;
  botId: string;
  verdict: string;
  urgency: string;
  dedupeKey: string;
  reason: string;
  decision: string;
  suppressedBy: string | null;
  feedback: "should_have_pinged" | null;
}

/** Records the owner's "should have pinged". False when the decision does not exist. Idempotent. */
export function setWakeFeedback(db: Db, id: number, feedback: "should_have_pinged" | null): boolean {
  return db.prepare("UPDATE wake_decisions SET feedback = ? WHERE id = ?").run(feedback, id).changes === 1;
}

export function listWakeDecisions(db: Db, limit: number): WakeDecisionRow[] {
  const rows = db
    .prepare(
      "SELECT id, ts, source, bot_id, verdict, urgency, dedupe_key, reason, decision, suppressed_by, feedback FROM wake_decisions ORDER BY id DESC LIMIT ?",
    )
    .all(limit) as {
    id: number;
    ts: number;
    source: string;
    bot_id: string;
    verdict: string;
    urgency: string;
    dedupe_key: string;
    reason: string;
    decision: string;
    suppressed_by: string | null;
    feedback: "should_have_pinged" | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    source: r.source,
    botId: r.bot_id,
    verdict: r.verdict,
    urgency: r.urgency,
    dedupeKey: r.dedupe_key,
    reason: r.reason,
    decision: r.decision,
    suppressedBy: r.suppressed_by,
    feedback: r.feedback,
  }));
}
