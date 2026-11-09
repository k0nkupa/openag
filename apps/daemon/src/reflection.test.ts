import { resolveReviewed } from "./approvals.testkit.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApprovals, type Approvals } from "./approvals.js";
import { ensureDataRepo } from "./datagit.js";
import { type Db, openDb } from "./db/index.js";
import { createLedger, type Ledger } from "./ledger.js";
import { ensureMemoryFile, memoryPath } from "./memory.js";
import { createReflectionApplier } from "./reflection-apply.js";
import { extractJson, registerReflection, REFLECTION_ROOM_ID, type Reflection } from "./reflection.js";
import { addMember, createBot, createRoom } from "./rooms.js";
import { createScheduler, type Scheduler } from "./scheduler.js";
import { setSetting, type Reflection as ReflectionSetting } from "./settings.js";
import type { AuthorizeResult, BotRuntime, TurnContext, ToolOutcome } from "./runtimes/types.js";
import { createRunner, type Runner } from "./runtimes/runner.js";
import { defaultTools } from "./runtimes/tools.js";

// 2026-10-28 is a Wednesday. All instants are evaluated in UTC (tz "UTC").
const REG = new Date("2026-10-28T02:00:00Z");
const NIGHT = (hhmm: string) => new Date(`2026-10-28T${hhmm}:00Z`);

let dir: string;
let db: Db;
let ledger: Ledger;
let approvals: Approvals;
let scheduler: Scheduler;
let runner: Runner;
let consoleError: ReturnType<typeof vi.spyOn>;
let turnHook: (ctx: TurnContext) => Promise<void> | void;
const authResults: AuthorizeResult[] = [];
const callResults: ToolOutcome[] = [];

const fake: BotRuntime = {
  async runTurn(ctx) {
    await turnHook(ctx);
  },
};
const say = (ctx: TurnContext, text: string) => ctx.ledger.append(ctx.room.id, ctx.bot.id, "bot_output", { text });
const replyWith = (value: unknown) => (ctx: TurnContext) => {
  say(ctx, typeof value === "string" ? value : JSON.stringify(value));
};

const settingOf = (patch: Partial<ReflectionSetting> = {}) =>
  setSetting(db, "reflection", { enabled: true, time: "03:30", botId: null, lookbackHours: 24, maxMemoryProposals: 5, maxSkillProposals: 3, ...patch });
const memoryText = () => readFileSync(memoryPath(dir, "boss"), "utf8");
const runRows = () =>
  db.prepare("SELECT local_date, status, memory_proposals, skill_proposals FROM reflection_runs ORDER BY id").all() as {
    local_date: string;
    status: string;
    memory_proposals: number;
    skill_proposals: number;
  }[];
const pending = () => db.prepare("SELECT tool_name, payload_json, tool_class, status FROM approvals").all() as {
  tool_name: string;
  payload_json: string;
  tool_class: string;
  status: string;
}[];
const systemEvents = () => db.prepare("SELECT type, payload_json FROM events WHERE room_id = '_system' AND type LIKE 'reflection_%'").all() as { type: string; payload_json: string }[];

function register(opts: { skillsEnabled?: boolean; now?: () => Date } = {}): Reflection {
  return registerReflection({
    db,
    ledger,
    approvals,
    runner,
    scheduler,
    tz: "UTC",
    dataDir: dir,
    skillsEnabled: opts.skillsEnabled,
    now: opts.now,
  });
}
const tickAt = (at: string) => scheduler.tick(NIGHT(at));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "openag-reflection-"));
  await ensureDataRepo(dir);
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createBot(db, { id: "coder", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  setSetting(db, "defaultBot", { botId: "boss" });
  ledger = createLedger(db);
  approvals = createApprovals(db, ledger);
  runner = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { api: fake, acp: fake }, tools: defaultTools });
  scheduler = createScheduler({ now: () => REG });
  ensureMemoryFile(dir, { id: "boss", name: "Boss" });
  turnHook = replyWith({ proposals: [] });
  authResults.length = 0;
  callResults.length = 0;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("scheduling", () => {
  test("off by default: no run at any time", async () => {
    register();
    for (const t of ["03:30", "03:31", "04:00", "05:00"]) await tickAt(t);
    expect(runRows()).toHaveLength(0);
  });

  test("fires once per local night inside the window, then again the next night", async () => {
    settingOf();
    register();
    for (const t of ["03:30", "03:31", "03:45", "04:00", "05:29"]) await tickAt(t);
    expect(runRows().map((r) => r.local_date)).toEqual(["2026-10-28"]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM turns WHERE room_id = ?").get(REFLECTION_ROOM_ID)).toEqual({ n: 1 });
    await scheduler.tick(new Date("2026-10-29T03:30:00Z"));
    expect(runRows().map((r) => r.local_date)).toEqual(["2026-10-28", "2026-10-29"]);
  });

  test("no catch-up: a tick long after the window does not start the run", async () => {
    settingOf();
    register();
    await tickAt("09:00");
    expect(runRows()).toHaveLength(0);
  });

  test("a restart inside the window does not run the night twice", async () => {
    settingOf();
    register();
    await tickAt("03:30");
    scheduler = createScheduler({ now: () => REG });
    register();
    await scheduler.tick(NIGHT("03:40"));
    expect(runRows()).toHaveLength(1);
  });
});

describe("memory saves automatically and skills require approval", () => {
  test("valid memory saves without an approval, with counts-only ledger events", async () => {
    settingOf();
    register();
    turnHook = replyWith({ proposals: [{ kind: "memory_append", text: "Prefers tea over coffee" }] });
    await tickAt("03:30");
    expect(pending()).toHaveLength(0);
    expect(memoryText()).toContain("Prefers tea over coffee");
    expect(runRows()[0]).toMatchObject({ status: "finished", memory_proposals: 1, skill_proposals: 0 });
    const events = systemEvents();
    expect(events.map((e) => e.type)).toEqual(["reflection_started", "reflection_finished"]);
    expect(JSON.stringify(events)).not.toContain("Prefers tea");
  });

  test("the daemon saves validated memory after the isolated turn", async () => {
    const before = memoryText();
    settingOf();
    register();
    turnHook = replyWith({ proposals: [{ kind: "memory_append", text: "Likes cats" }] });
    await tickAt("03:30");
    expect(memoryText()).toBe(`${before}- ${new Date().toISOString().slice(0, 10)} Likes cats\n`);
  });

  test("an unattended turn that tries memory_append is denied without an approval; MEMORY byte-identical", async () => {
    const before = memoryText();
    settingOf();
    register();
    turnHook = async (ctx) => {
      authResults.push(await ctx.authorize("memory_append", { text: "sneaky" }));
      callResults.push(await ctx.callTool("memory_append", { text: "sneaky" }));
      callResults.push(await ctx.callTool("reflection_memory", { text: "sneaky" }));
      replyWith({ proposals: [] })(ctx);
    };
    await tickAt("03:30");
    expect(authResults[0]).toMatchObject({ allowed: false, status: "denied" });
    expect(callResults.every((r) => r.ok === false)).toBe(true);
    expect(pending()).toHaveLength(0);
    expect(memoryText()).toBe(before);
  });

  test("empty list creates no approval and records an empty run", async () => {
    settingOf();
    register();
    turnHook = replyWith({ proposals: [] });
    await tickAt("03:30");
    expect(pending()).toHaveLength(0);
    expect(runRows()[0]?.status).toBe("empty");
  });

  test("a stalled reflection turn (watchdog) records a FAILED run, not an empty night", async () => {
    runner = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { api: fake, acp: fake }, tools: defaultTools, watchdog: { unattendedIdleMs: 40, tickMs: 10 } });
    settingOf();
    register();
    turnHook = () => new Promise<void>(() => undefined);
    await tickAt("03:30");
    expect(runRows()[0]?.status).toBe("failed");
    expect(pending()).toHaveLength(0);
  });

  test("unparseable output and schema-invalid proposals create nothing and record invalid", async () => {
    const reflection = register();
    turnHook = replyWith("I think you should remember things.");
    await reflection.runNow(true);
    await reflection.idle();
    turnHook = replyWith({ proposals: [{ kind: "memory_append", text: "" }] });
    await reflection.runNow(true);
    await reflection.idle();
    expect(pending()).toHaveLength(0);
    expect(runRows().map((r) => r.status)).toEqual(["invalid", "invalid"]);
  });

  test("dedupes against MEMORY.md and within the batch, and applies the cap", async () => {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(memoryPath(dir, "boss"), "- 2026-10-01 Prefers tea\n");
    settingOf({ maxMemoryProposals: 1 });
    register();
    turnHook = replyWith({
      proposals: [
        { kind: "memory_append", text: "prefers tea" },
        { kind: "memory_append", text: "Likes cats" },
        { kind: "memory_append", text: "likes  cats" },
        { kind: "memory_append", text: "Lives in Auckland" },
      ],
    });
    await tickAt("03:30");
    expect(pending()).toHaveLength(0);
    expect(memoryText()).toContain("Likes cats");
    expect(memoryText()).not.toContain("Lives in Auckland");
    expect(runRows()[0]).toMatchObject({ status: "finished", memory_proposals: 1 });
  });

  test("skill proposals are dropped while skills are disabled", async () => {
    settingOf();
    register();
    turnHook = replyWith({
      proposals: [{ kind: "skill", slug: "weekly-review", name: "Weekly review", description: "Review the week", body: "Steps" }],
    });
    await tickAt("03:30");
    expect(pending()).toHaveLength(0);
    expect(runRows()[0]?.status).toBe("empty");
  });

  test("skill proposals create reflection_skill approvals when skillsEnabled, capped", async () => {
    settingOf({ maxSkillProposals: 1 });
    register({ skillsEnabled: true });
    turnHook = replyWith({
      proposals: [
        { kind: "skill", slug: "weekly-review", name: "Weekly review", description: "Review the week", body: "Steps" },
        { kind: "skill", slug: "triage", name: "Triage", description: "Triage inbox", body: "Steps" },
      ],
    });
    await tickAt("03:30");
    expect(pending().map((r) => r.tool_name)).toEqual(["reflection_skill"]);
    expect(runRows()[0]).toMatchObject({ skill_proposals: 1 });
  });

  test("the digest excludes hidden rooms and the prompt carries the MEMORY head", async () => {
    settingOf();
    register();
    createRoom(db, { id: "notes", leadBotId: "boss" });
    ledger.append("notes", "user", "message", { text: "my favourite colour is green" });
    ledger.append("_heartbeat", "user", "message", { text: "hidden heartbeat text" });
    let prompt = "";
    turnHook = (ctx) => {
      prompt = ctx.prompt;
      replyWith({ proposals: [] })(ctx);
    };
    await tickAt("03:30");
    expect(prompt).toContain("my favourite colour is green");
    expect(prompt).not.toContain("hidden heartbeat text");
    expect(prompt).toContain("Current MEMORY.md");
    expect(prompt).toContain("Reply with ONLY a JSON object");
  });
});

describe("manual runs", () => {
  test("runNow(true) ignores enabled, uses its own key, and does not block the nightly run", async () => {
    const reflection = register({ now: () => NIGHT("12:00") });
    const r = await reflection.runNow(true);
    expect(r).toEqual({ started: true });
    await reflection.idle();
    expect(runRows()[0]?.local_date).toMatch(/^2026-10-28#manual-/);
    settingOf();
    await tickAt("03:30");
    expect(runRows().map((x) => x.local_date)).toContain("2026-10-28");
  });

  test("a second run while one is in flight is refused", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    turnHook = async (ctx) => {
      await gate;
      replyWith({ proposals: [] })(ctx);
    };
    const reflection = register();
    expect((await reflection.runNow(true)).started).toBe(true);
    expect(reflection.status().running).toBe(true);
    expect(await reflection.runNow(true)).toEqual({ started: false, reason: "already running" });
    release();
    await reflection.idle();
    expect(reflection.status().running).toBe(false);
  });

  test("status lists the newest runs first with camelCase fields", async () => {
    const reflection = register();
    await reflection.runNow(true);
    await reflection.idle();
    const s = reflection.status();
    expect(s.setting.enabled).toBe(false);
    expect(s.runs[0]).toMatchObject({ status: "empty", memoryProposals: 0, skillProposals: 0 });
    expect(s.runs[0]).toHaveProperty("localDate");
    expect(s.runs[0]).toHaveProperty("startedAt");
  });
});

describe("legacy memory approvals", () => {
  test("accepting a legacy proposal applies a redacted append; ignoring leaves MEMORY untouched", async () => {
    settingOf();
    register();
    const applier = createReflectionApplier({ ledger, approvals, dataDir: dir });
    for (const text of ["Likes cats", "Likes dogs"]) {
      approvals.request({ roomId: "main", botId: "boss", toolName: "reflection_memory", toolClass: "act-local", payload: { text } });
    }
    const ids = db.prepare("SELECT id FROM approvals ORDER BY created_at, rowid").all() as { id: string }[];
    expect(ids).toHaveLength(2);
    resolveReviewed(approvals, ids[0]!.id, { kind: "accept" });
    resolveReviewed(approvals, ids[1]!.id, { kind: "ignore" });
    await applier.idle();
    const text = memoryText();
    expect(text).toContain("Likes cats");
    expect(text).not.toContain("Likes dogs");
    applier.dispose();
  });
});

describe("extractJson", () => {
  test("reads a bare object, a fenced block, or an object surrounded by prose", () => {
    expect(extractJson('{"proposals":[]}')).toEqual({ state: "ok", value: { proposals: [] } });
    expect(extractJson('Here:\n```json\n{"proposals":[]}\n```')).toEqual({ state: "ok", value: { proposals: [] } });
    expect(extractJson('Sure. {"proposals":[]} done.')).toEqual({ state: "ok", value: { proposals: [] } });
    expect(extractJson("   ")).toEqual({ state: "empty" });
    expect(extractJson("nope")).toEqual({ state: "invalid" });
  });
});


describe("review fixes", () => {
  test("the reflection turn has NO tools: even read/search/browse are denied, not just writes", async () => {
    settingOf();
    register();
    turnHook = async (ctx) => {
      for (const tool of ["WebFetch", "WebSearch", "Read", "skill_load", "brave_search"]) authResults.push(await ctx.authorize(tool, {}));
      replyWith({ proposals: [] })(ctx);
    };
    await tickAt("03:30");
    expect(authResults).toHaveLength(5);
    expect(authResults.every((r) => !r.allowed && r.message === "this turn has no tools")).toBe(true);
  });

  test("a 23:30 window that runs past midnight is ONE night, and the next night still runs at 23:30", async () => {
    settingOf({ time: "23:30" });
    register();
    await scheduler.tick(new Date("2026-10-28T23:30:00Z"));
    await scheduler.tick(new Date("2026-10-29T00:05:00Z"));
    expect(runRows().map((r) => r.local_date)).toEqual(["2026-10-28"]);
    await scheduler.tick(new Date("2026-10-29T23:30:00Z"));
    expect(runRows().map((r) => r.local_date)).toEqual(["2026-10-28", "2026-10-29"]);
  });

  test("a skill proposal for an EXISTING slug is dropped (it would silently replace a trusted skill)", async () => {
    const { saveSkill } = await import("./skills.js");
    saveSkill(dir, "boss", { slug: "deploy-prod", name: "Deploy", description: "d", body: "trusted steps" });
    settingOf();
    register({ skillsEnabled: true });
    turnHook = replyWith({
      proposals: [
        { kind: "skill", slug: "deploy-prod", name: "Note tips", description: "d", body: "evil" },
        { kind: "skill", slug: "new-one", name: "New", description: "d", body: "ok" },
      ],
    });
    await tickAt("03:30");
    const rows = pending().filter((p) => p.tool_name === "reflection_skill");
    expect(rows.map((r) => JSON.parse(r.payload_json).slug)).toEqual(["new-one"]);
  });

  test("reflection output is not written to the vector recall index, but an ordinary turn still is", async () => {
    const indexed: string[] = [];
    const vectors = {
      indexMemoryFile: () => undefined,
      indexTurn: (_b: string, _t: string, _q: string, a: string) => void indexed.push(a),
      embedPending: async () => 0,
      search: async () => [],
    };
    const r = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { api: fake, acp: fake }, tools: defaultTools, vectors });
    settingOf();
    const refl = registerReflection({ db, ledger, approvals, runner: r, scheduler, tz: "UTC", dataDir: dir });
    turnHook = (ctx) =>
      void ctx.ledger.append(ctx.room.id, ctx.bot.id, "bot_output", { turnId: ctx.turnId, text: JSON.stringify({ proposals: [{ kind: "memory_append", text: "likes tea" }] }) });
    await refl.runNow(true);
    await refl.idle();
    await r.idle();
    expect(indexed).toEqual([]);

    turnHook = (ctx) => void ctx.ledger.append(ctx.room.id, ctx.bot.id, "bot_output", { turnId: ctx.turnId, text: "an ordinary answer" });
    const message = ledger.append("main", "user", "message", { text: "hi" });
    const { getRoom, getBot } = await import("./rooms.js");
    await r.run(getRoom(db, "main")!, getBot(db, "boss")!, message);
    await r.idle();
    expect(indexed).toEqual(["an ordinary answer"]);
  });
});
