import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApprovals } from "./approvals.js";
import { type Db, openDb } from "./db/index.js";
import { DEFAULT_HEARTBEAT_PROMPT, HEARTBEAT_FORMAT_INSTRUCTION, HEARTBEAT_ROOM_ID, registerHeartbeat } from "./heartbeat.js";
import { createLedger, type Ledger } from "./ledger.js";
import { createScheduler, type Scheduler } from "./scheduler.js";
import { addMember, createBot, createRoom } from "./rooms.js";
import { setSetting, type ActiveHours, type Heartbeat } from "./settings.js";
import type { AuthorizeResult, BotRuntime, TurnContext } from "./runtimes/types.js";
import { createRunner, type Runner } from "./runtimes/runner.js";
import { defaultTools } from "./runtimes/tools.js";
import { createWakeFilter, type WakeFilter } from "./wake.js";

// 2026-10-27 is a Tuesday. All instants below are evaluated in UTC.
const T0 = new Date("2026-10-27T09:00:00Z"); // 09:00 Tuesday: inside the default 07:00-22:00 window
const HOUR = 3_600_000;
const MIN = 60_000;

let dir: string;
let db: Db;
let now: Date;
let ledger: Ledger;
let scheduler: Scheduler;
let wake: WakeFilter;
let runner: Runner;
let consoleError: ReturnType<typeof vi.spyOn>;
let turnHook: (ctx: TurnContext) => Promise<void> | void;
const contexts: TurnContext[] = [];
const authResults: AuthorizeResult[] = [];

const fake: BotRuntime = {
  async runTurn(ctx) {
    contexts.push(ctx);
    await turnHook(ctx);
  },
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-heartbeat-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createBot(db, { id: "coder", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  setSetting(db, "deliveryRoom", { roomId: "main" });
  addMember(db, "main", "boss");
  setSetting(db, "defaultBot", { botId: "boss" });
  now = new Date(T0);
  ledger = createLedger(db);
  runner = createRunner({
    db,
    ledger,
    approvals: createApprovals(db, ledger),
    dataDir: dir,
    runtimes: { api: fake, acp: fake },
    tools: defaultTools,
  });
  scheduler = createScheduler({ now: () => now });
  wake = createWakeFilter({ db, ledger, tz: "UTC", now: () => now });
  turnHook = () => undefined;
  contexts.length = 0;
  authResults.length = 0;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const enable = (patch: Partial<Heartbeat> = {}) =>
  setSetting(db, "heartbeat", { enabled: true, everyMinutes: 60, botId: null, prompt: null, ...patch });
const setHours = (patch: Partial<ActiveHours>) =>
  setSetting(db, "activeHours", { start: "07:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6], ...patch });
const register = () => registerHeartbeat({ db, ledger, runner, scheduler, tz: "UTC", wake });
const tickAt = (ms: number) => scheduler.tick(new Date(T0.getTime() + ms));
const turnCount = () => (db.prepare("SELECT COUNT(*) AS n FROM turns").get() as { n: number }).n;
const heartbeatTurns = () =>
  db.prepare("SELECT bot_id, state_json FROM turns WHERE room_id = ?").all(HEARTBEAT_ROOM_ID) as {
    bot_id: string;
    state_json: string;
  }[];

describe("heartbeat", () => {
  test("off by default: no turn after any amount of time", async () => {
    register();
    for (let h = 1; h <= 24 * 10; h++) await tickAt(h * HOUR);
    expect(turnCount()).toBe(0);
  });

  test("enabled and inside active hours: exactly one unattended turn per interval", async () => {
    enable();
    register();
    await tickAt(HOUR - MIN); // not yet due
    expect(turnCount()).toBe(0);
    await tickAt(HOUR);
    expect(turnCount()).toBe(1);
    await tickAt(HOUR + 30 * MIN);
    expect(turnCount()).toBe(1);
    await tickAt(2 * HOUR);
    expect(turnCount()).toBe(2);

    const [first] = heartbeatTurns();
    expect(first.bot_id).toBe("boss");
    expect(JSON.parse(first.state_json)).toMatchObject({ unattended: true });
    const msg = ledger.list(HEARTBEAT_ROOM_ID).find((e) => e.type === "message")!;
    expect(msg).toMatchObject({ actor: "scheduler", roomId: HEARTBEAT_ROOM_ID });
    expect(msg.payload).toEqual({ text: DEFAULT_HEARTBEAT_PROMPT, scheduled: true });
  });

  test("the configured bot and prompt are used", async () => {
    enable({ botId: "coder", prompt: "Anything urgent?" });
    register();
    await tickAt(HOUR);
    expect(heartbeatTurns()[0].bot_id).toBe("coder");
    const text = (ledger.list(HEARTBEAT_ROOM_ID).find((e) => e.type === "message")!.payload as { text: string }).text;
    expect(text).toBe(`Anything urgent?\n${HEARTBEAT_FORMAT_INSTRUCTION}`);
  });

  test("outside active hours: no turn", async () => {
    enable();
    setHours({ start: "11:00", end: "12:00" });
    register();
    await tickAt(HOUR); // 10:00: before the window
    await tickAt(3 * HOUR); // 12:00: end is exclusive
    expect(turnCount()).toBe(0);
    await tickAt(4 * HOUR); // 13:00: after the window
    expect(turnCount()).toBe(0);
  });

  test("wrong weekday: no turn", async () => {
    enable();
    setHours({ days: [0] }); // Sunday only; 2026-10-27 is Tuesday
    register();
    await tickAt(HOUR);
    expect(turnCount()).toBe(0);
  });

  test("an overlapping heartbeat is skipped while the previous one is still running", async () => {
    enable();
    let release!: () => void;
    turnHook = () => new Promise<void>((r) => (release = r));
    register();
    const first = tickAt(HOUR);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await tickAt(2 * HOUR); // previous turn still running
    expect(turnCount()).toBe(1);
    release();
    await first;
  });

  test("a missing bot logs once and does not crash", async () => {
    enable({ botId: "ghost" });
    register();
    await tickAt(HOUR);
    await tickAt(2 * HOUR);
    expect(turnCount()).toBe(0);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0][0])).toContain("ghost");
  });

  test("settings changes take effect without restart", async () => {
    enable({ everyMinutes: 60 });
    register();
    await tickAt(5 * MIN);
    expect(turnCount()).toBe(0);
    enable({ everyMinutes: 5 });
    await tickAt(5 * MIN);
    expect(turnCount()).toBe(1);
    setSetting(db, "heartbeat", { enabled: false, everyMinutes: 5, botId: null, prompt: null });
    await tickAt(10 * MIN);
    expect(turnCount()).toBe(1);
  });

  test("a heartbeat turn that tries Write is denied and leaves no approval", async () => {
    enable();
    turnHook = async (ctx) => {
      authResults.push(await ctx.authorize("Write", { path: "x" }));
    };
    register();
    await tickAt(HOUR);
    expect(authResults[0]).toMatchObject({ allowed: false, status: "denied" });
    expect((db.prepare("SELECT COUNT(*) AS n FROM approvals").get() as { n: number }).n).toBe(0);
  });

  test("the turn's verdict is recorded as a wake decision and a ping reaches room main", async () => {
    enable();
    turnHook = (ctx) => {
      ctx.ledger.append(ctx.room.id, ctx.bot.id, "bot_output", {
        turnId: ctx.turnId,
        text: '{"verdict":"ping","reason":"Deploy failed","urgency":"high","dedupe_key":"deploy"}',
      });
    };
    register();
    await tickAt(HOUR);
    const rows = db.prepare("SELECT decision, verdict, source, bot_id, turn_id FROM wake_decisions").all() as Record<string, unknown>[];
    expect(rows).toEqual([
      { decision: "ping", verdict: "ping", source: "heartbeat", bot_id: "boss", turn_id: expect.any(String) },
    ]);
    const main = ledger.list("main").filter((e) => e.type === "message");
    expect(main).toHaveLength(1);
    expect(main[0].payload).toMatchObject({ text: "Heads-up from boss: Deploy failed", wake: true });
  });

  test("a turn with no parseable verdict is recorded as silent and invalid", async () => {
    enable();
    turnHook = (ctx) => {
      ctx.ledger.append(ctx.room.id, ctx.bot.id, "bot_output", { turnId: ctx.turnId, text: "NOTHING" });
    };
    register();
    await tickAt(HOUR);
    expect(db.prepare("SELECT decision, suppressed_by FROM wake_decisions").all()).toEqual([
      { decision: "silent", suppressed_by: "invalid" },
    ]);
  });

  test("a throwing runtime records an invalid decision and the scheduler keeps running", async () => {
    enable();
    turnHook = () => {
      throw new Error("runtime exploded");
    };
    register();
    await tickAt(HOUR);
    await tickAt(2 * HOUR);
    expect(turnCount()).toBe(2);
    const rows = db.prepare("SELECT decision, suppressed_by FROM wake_decisions").all();
    expect(rows).toEqual([
      { decision: "silent", suppressed_by: "invalid" },
      { decision: "silent", suppressed_by: "invalid" },
    ]);
  });

  test("a wake filter failure is logged and does not break the heartbeat", async () => {
    enable();
    wake = { process: () => { throw new Error("db locked"); } };
    register();
    await tickAt(HOUR);
    await tickAt(2 * HOUR);
    expect(turnCount()).toBe(2);
    expect(consoleError).toHaveBeenCalledWith("wake filter failed:", "db locked");
  });
});
