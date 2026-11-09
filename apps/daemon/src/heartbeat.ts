import type { Db } from "./db/index.js";
import type { Ledger } from "./ledger.js";
import { getDefaultBotId } from "./defaultbot.js";
import { addMember, getBot, getRoom } from "./rooms.js";
import { getSetting, isWithinActiveHours } from "./settings.js";
import type { Scheduler } from "./scheduler.js";
import type { Runner } from "./runtimes/runner.js";
import type { WakeFilter } from "./wake.js";

export const HEARTBEAT_ROOM_ID = "_heartbeat";
/** Appended to every heartbeat prompt, custom ones included, so the reply is always parseable as a verdict. */
export const HEARTBEAT_FORMAT_INSTRUCTION =
  'Reply with ONLY a JSON object, no other text: {"verdict":"silent|digest|ping","reason":"one short sentence","urgency":"low|normal|high","dedupe_key":"short-stable-key-for-this-topic"}. Use silent when nothing needs attention, digest for things worth including in the morning brief, and ping ONLY when it is worth interrupting the user right now.';
export const DEFAULT_HEARTBEAT_PROMPT = `Heartbeat check. Decide whether anything needs the user's attention. ${HEARTBEAT_FORMAT_INSTRUCTION}`;

/** Creates the hidden heartbeat room, or re-points it at `botId`. Members are exactly that bot. */
export function ensureHeartbeatRoom(db: Db, botId: string): void {
  if (!getRoom(db, HEARTBEAT_ROOM_ID)) {
    db.prepare("INSERT INTO rooms (id, name, lead_bot_id, created_at) VALUES (?, ?, ?, ?)").run(
      HEARTBEAT_ROOM_ID,
      "heartbeat",
      botId,
      Date.now(),
    );
  } else {
    db.prepare("UPDATE rooms SET lead_bot_id = ? WHERE id = ?").run(botId, HEARTBEAT_ROOM_ID);
    db.prepare("DELETE FROM room_members WHERE room_id = ? AND bot_id <> ?").run(HEARTBEAT_ROOM_ID, botId);
  }
  addMember(db, HEARTBEAT_ROOM_ID, botId);
}

export interface HeartbeatDeps {
  db: Db;
  ledger: Ledger;
  runner: Runner;
  scheduler: Scheduler;
  /** IANA zone for the active-hours check (see resolveTimezone). */
  tz: string;
  wake: WakeFilter;
}

/**
 * Registers the heartbeat job. Off by default. When enabled, one unattended turn per interval, only inside active hours.
 * Settings are read on every tick, so changes apply without a restart.
 */
export function registerHeartbeat({ db, ledger, runner, scheduler, tz, wake }: HeartbeatDeps): void {
  let lastWarning: string | undefined;
  const warnOnce = (msg: string) => {
    if (msg === lastWarning) return;
    lastWarning = msg;
    console.error(`heartbeat skipped: ${msg}`);
  };

  scheduler.register({
    id: "heartbeat",
    schedule: { everyMs: () => getSetting(db, "heartbeat").everyMinutes * 60_000 },
    shouldRun: (now) => {
      const hb = getSetting(db, "heartbeat");
      return hb.enabled && isWithinActiveHours(now, getSetting(db, "activeHours"), tz);
    },
    run: async () => {
      const hb = getSetting(db, "heartbeat");
      const botId = hb.botId ?? getDefaultBotId(db);
      if (!botId) return warnOnce("no bot chosen and no default bot");
      const bot = getBot(db, botId);
      if (!bot) return warnOnce(`bot ${botId} not found`);

      ensureHeartbeatRoom(db, bot.id);
      const room = getRoom(db, HEARTBEAT_ROOM_ID);
      if (!room) return;
      const busy = db
        .prepare("SELECT 1 FROM turns WHERE room_id = ? AND status = 'running' LIMIT 1")
        .get(HEARTBEAT_ROOM_ID);
      if (busy) return;

      const text = hb.prompt?.trim() ? `${hb.prompt}\n${HEARTBEAT_FORMAT_INSTRUCTION}` : DEFAULT_HEARTBEAT_PROMPT;
      const message = ledger.append(HEARTBEAT_ROOM_ID, "scheduler", "message", { text, scheduled: true });

      const outputs: string[] = [];
      const unsubscribe = ledger.subscribe(HEARTBEAT_ROOM_ID, (event) => {
        const p = event.payload as { text?: unknown };
        if (event.type === "bot_output" && typeof p.text === "string") outputs.push(p.text);
      });
      let runError: unknown;
      let failed = false;
      try {
        await runner.run(room, bot, message, undefined, { unattended: true });
      } catch (err) {
        failed = true;
        runError = err;
      } finally {
        unsubscribe();
      }
      recordWake(db, wake, bot.id, failed ? null : outputs.length > 0 ? outputs.join("\n") : null);
      if (failed) throw runError;
    },
  });
}

/** A wake failure must never break the scheduler loop: it is logged (message only) and dropped. */
function recordWake(db: Db, wake: WakeFilter, botId: string, text: string | null): void {
  try {
    const turn = db
      .prepare("SELECT id FROM turns WHERE room_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(HEARTBEAT_ROOM_ID) as { id: string } | undefined;
    wake.process({ source: "heartbeat", botId, turnId: turn?.id ?? null, text });
  } catch (err) {
    console.error("wake filter failed:", err instanceof Error ? err.message : String(err));
  }
}
