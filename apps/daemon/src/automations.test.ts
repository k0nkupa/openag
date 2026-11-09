import { resolveReviewed } from "./approvals.testkit.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApprovals, type Approvals } from "./approvals.js";
import {
  automationJobId,
  createAutomation,
  createAutomationManager,
  listAutomations,
  MAX_AUTOMATIONS,
  type AutomationManager,
  updateAutomation,
} from "./automations.js";
import { type Db, openDb } from "./db/index.js";
import { createLedger, type Ledger } from "./ledger.js";
import { addMember, createBot, createRoom } from "./rooms.js";
import { createScheduler, type Scheduler } from "./scheduler.js";
import type { AuthorizeResult, BotRuntime, TurnContext } from "./runtimes/types.js";
import { createRunner, type Runner } from "./runtimes/runner.js";
import { createWakeFilter, type WakeFilter } from "./wake.js";
import { defaultTools } from "./runtimes/tools.js";

// 2026-10-27 is a Tuesday. Daemon zone is UTC in these tests.
const T0 = new Date("2026-10-27T09:00:00Z");
const DAILY_10 = "0 10 * * *";

let dir: string;
let db: Db;
let now: Date;
let ledger: Ledger;
let approvals: Approvals;
let runner: Runner;
let scheduler: Scheduler;
let wake: WakeFilter;
let manager: AutomationManager;
let turnHook: (ctx: TurnContext) => Promise<void> | void;
const contexts: TurnContext[] = [];

const fake: BotRuntime = {
  async runTurn(ctx) {
    contexts.push(ctx);
    await turnHook(ctx);
  },
};

const base = {
  name: "Digest",
  scheduleCron: DAILY_10,
  botId: "boss",
  roomId: "main",
  prompt: "Summarise the inbox",
};

function build(sched: Scheduler = scheduler) {
  return createAutomationManager({ db, ledger, runner, scheduler: sched, wake, tz: "UTC", now: () => now.getTime() });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-automations-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createBot(db, { id: "coder", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  addMember(db, "main", "coder");
  createRoom(db, { id: "side", leadBotId: "boss" });
  addMember(db, "side", "boss");
  now = new Date(T0);
  ledger = createLedger(db);
  approvals = createApprovals(db, ledger);
  runner = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { api: fake, acp: fake }, tools: defaultTools });
  scheduler = createScheduler({ now: () => now });
  wake = createWakeFilter({ db, ledger, tz: "UTC", now: () => now });
  manager = build();
  turnHook = () => undefined;
  contexts.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);
const turnRows = () => db.prepare("SELECT * FROM turns ORDER BY created_at, rowid").all() as {
  room_id: string;
  bot_id: string;
  status: string;
  state_json: string;
}[];

describe("validation", () => {
  const reject = (input: Record<string, unknown>, pattern: RegExp) =>
    expect(() => createAutomation(db, "UTC", { ...base, ...input }, () => now.getTime())).toThrow(pattern);

  test("accepts a valid automation with defaults", () => {
    const a = createAutomation(db, "UTC", base, () => now.getTime()).automation;
    expect(a).toMatchObject({ name: "Digest", tz: null, enabled: true, allowApprovals: false, lastStatus: null });
    expect(a.id).toMatch(/^auto_[0-9a-f]{8}$/);
  });

  test("accepts exactly five-minute spacing", () => {
    expect(() => createAutomation(db, "UTC", { ...base, scheduleCron: "*/5 * * * *" }, () => now.getTime())).not.toThrow();
  });

  test("rejects schedules more often than every five minutes", () => {
    reject({ scheduleCron: "* * * * *" }, /schedule runs more often than every 5 minutes/);
    reject({ scheduleCron: "*/4 * * * *" }, /schedule runs more often than every 5 minutes/);
    reject({ scheduleCron: "0,2 * * * *" }, /schedule runs more often than every 5 minutes/);
  });

  test("rejects anything but five fields", () => {
    reject({ scheduleCron: "0 0 10 * * *" }, /exactly 5 fields/);
    reject({ scheduleCron: "0 10 *" }, /exactly 5 fields/);
  });

  test("rejects an invalid cron expression", () => {
    reject({ scheduleCron: "99 * * * *" }, /invalid schedule/);
  });

  test("rejects a bad timezone", () => {
    reject({ tz: "Mars/Olympus" }, /valid IANA zone/);
  });

  test("rejects an unknown bot and an unknown room", () => {
    reject({ botId: "ghost" }, /bot not found/);
    reject({ roomId: "ghost" }, /room not found/);
  });

  test("rejects a bot that is not a member of the room", () => {
    reject({ roomId: "side", botId: "coder" }, /not a member/);
  });

  test("rejects a hidden room", () => {
    createRoom(db, { id: "_heartbeat", leadBotId: "boss" });
    addMember(db, "_heartbeat", "boss");
    reject({ roomId: "_heartbeat" }, /internal/);
  });

  test("rejects empty and oversize prompts, and bad names", () => {
    reject({ prompt: "   " }, /prompt is required/);
    reject({ prompt: "x".repeat(4001) }, /at most 4000/);
    reject({ name: "   " }, /name/);
    reject({ name: "n".repeat(81) }, /at most 80/);
  });

  test("the 51st automation is refused", () => {
    for (let i = 0; i < MAX_AUTOMATIONS; i++) createAutomation(db, "UTC", base, () => now.getTime());
    reject({}, /too many automations/);
  });

  test("update re-validates the merged automation", () => {
    const a = createAutomation(db, "UTC", base, () => now.getTime()).automation;
    expect(() => updateAutomation(db, "UTC", a.id, { scheduleCron: "* * * * *" })).toThrow(/every 5 minutes/);
    expect(() => updateAutomation(db, "UTC", a.id, { roomId: "side", botId: "coder" })).toThrow(/not a member/);
    // A toggle still works even if the bot has since left the room.
    const b = createAutomation(db, "UTC", { ...base, botId: "coder" }, () => now.getTime()).automation;
    db.prepare("DELETE FROM room_members WHERE bot_id = 'coder' AND room_id = 'main'").run();
    expect(updateAutomation(db, "UTC", b.id, { enabled: false })).toMatchObject({ enabled: false });
  });
});

describe("CRUD and sync", () => {
  test("create registers one job, update re-registers on cron change, disable and delete unregister", () => {
    const sched = createScheduler({ now: () => now });
    const reg = vi.spyOn(sched, "register");
    const unreg = vi.spyOn(sched, "unregister");
    const m = build(sched);

    const a = m.create(base, "owner").automation;
    expect(reg).toHaveBeenCalledTimes(1);
    expect(reg.mock.calls[0]![0]).toMatchObject({
      id: automationJobId(a.id),
      schedule: { cron: DAILY_10, tz: "UTC" },
    });

    m.update(a.id, { scheduleCron: "30 10 * * *" }, "owner");
    expect(reg).toHaveBeenLastCalledWith(expect.objectContaining({ schedule: { cron: "30 10 * * *", tz: "UTC" } }));

    m.update(a.id, { enabled: false }, "owner");
    expect(unreg).toHaveBeenLastCalledWith(automationJobId(a.id));

    m.update(a.id, { enabled: true }, "owner");
    expect(reg).toHaveBeenCalledTimes(3);

    m.remove(a.id, "owner");
    expect(unreg).toHaveBeenLastCalledWith(automationJobId(a.id));
    expect(m.get(a.id)).toBeUndefined();
  });

  test("startup sync registers only enabled automations", () => {
    manager.create(base, "owner");
    manager.create({ ...base, name: "Off", enabled: false }, "owner");
    const sched = createScheduler({ now: () => now });
    const reg = vi.spyOn(sched, "register");
    build(sched).sync();
    expect(reg).toHaveBeenCalledTimes(1);
    expect(reg.mock.calls[0]![0].id).toBe(automationJobId(listAutomations(db).find((a) => a.enabled)!.id));
  });

  test("each CRUD action writes an audit event without the prompt text", () => {
    const a = manager.create({ ...base, prompt: "SECRET-PROMPT-TEXT" }, "owner").automation;
    manager.update(a.id, { name: "Renamed" }, "device-1");
    manager.remove(a.id, "owner");
    const actions = ledger
      .list("_system")
      .filter((e) => e.type === "config")
      .map((e) => e.payload as { action: string; by: string; automationId: string; name: string });
    expect(actions.map((p) => p.action)).toEqual(["automation_created", "automation_updated", "automation_deleted"]);
    expect(actions[1]).toMatchObject({ by: "device-1", automationId: a.id, name: "Renamed" });
    expect(JSON.stringify(ledger.list("_system"))).not.toContain("SECRET-PROMPT-TEXT");
  });
});

describe("firing", () => {
  test("a due automation runs once per fire, with the right actor, room and unattended state", async () => {
    const a = manager.create(base, "owner").automation;
    await scheduler.tick(at("2026-10-27T10:00:00Z"));
    expect(contexts).toHaveLength(1);
    await scheduler.tick(at("2026-10-27T10:01:00Z"));
    expect(contexts).toHaveLength(1);
    await scheduler.tick(at("2026-10-28T10:00:00Z"));
    expect(contexts).toHaveLength(2);

    const messages = ledger.list("main").filter((e) => e.type === "message");
    expect(messages[0]).toMatchObject({
      actor: "automation:Digest",
      payload: { text: "Summarise the inbox", automationId: a.id, scheduled: true },
    });
    const turn = turnRows()[0]!;
    expect(turn).toMatchObject({ room_id: "main", bot_id: "boss", status: "finished" });
    expect(JSON.parse(turn.state_json)).toMatchObject({ unattended: true, allowApprovals: false });
    expect(manager.get(a.id)).toMatchObject({ lastStatus: "completed", lastTurnId: contexts[1]!.turnId });
  });

  test("allowApprovals is passed into the turn state", async () => {
    manager.create({ ...base, allowApprovals: true }, "owner");
    await scheduler.tick(at("2026-10-27T10:00:00Z"));
    expect(JSON.parse(turnRows()[0]!.state_json)).toMatchObject({ unattended: true, allowApprovals: true });
  });

  test("two automations fire independently; a disabled one never runs", async () => {
    manager.create(base, "owner");
    manager.create({ ...base, name: "Second", scheduleCron: "30 10 * * *" }, "owner");
    manager.create({ ...base, name: "Off", enabled: false, scheduleCron: "45 10 * * *" }, "owner");
    await scheduler.tick(at("2026-10-27T10:00:00Z"));
    await scheduler.tick(at("2026-10-27T10:30:00Z"));
    await scheduler.tick(at("2026-10-27T10:45:00Z"));
    const actors = ledger.list("main").filter((e) => e.type === "message").map((e) => e.actor);
    expect(actors).toEqual(["automation:Digest", "automation:Second"]);
  });
});

describe("safety", () => {
  test("with allowApprovals=false a write is denied and creates no approval", async () => {
    const results: AuthorizeResult[] = [];
    turnHook = async (ctx) => {
      results.push(await ctx.authorize("Write", { path: "x", content: "x" }));
    };
    manager.create(base, "owner");
    await scheduler.tick(at("2026-10-27T10:00:00Z"));
    expect(results).toEqual([
      expect.objectContaining({ allowed: false, status: "denied" }),
    ]);
    expect(approvals.listPending()).toHaveLength(0);
  });

  test("with allowApprovals=true the same write becomes a pending approval instead", async () => {
    let pending: Promise<AuthorizeResult> | undefined;
    // The turn stays open while the approval is pending: an approval left behind by a finished turn is expired.
    let endTurn!: () => void;
    turnHook = (ctx) => {
      pending = ctx.authorize("Write", { path: "x", content: "x" });
      return new Promise<void>((r) => (endTurn = r));
    };
    manager.create({ ...base, allowApprovals: true }, "owner");
    const ticking = scheduler.tick(at("2026-10-27T10:00:00Z"));
    for (let i = 0; i < 300 && approvals.listPending().length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    const rows = approvals.listPending();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ toolName: "Write", botId: "boss", roomId: "main" });
    resolveReviewed(approvals, rows[0]!.id, { kind: "ignore" });
    await pending;
    endTurn();
    await ticking;
  });
});

describe("runNow and failures", () => {
  test("runNow while the bot is busy in that room is skipped", async () => {
    let release!: () => void;
    turnHook = () => new Promise<void>((r) => (release = r));
    const a = manager.create(base, "owner").automation;
    const first = manager.runNow(a.id, "owner");
    await vi.waitFor(() => expect(turnRows().some((t) => t.status === "running")).toBe(true));
    expect(manager.runNow(a.id,"owner")).toMatchObject({started:false,reason:"busy"});
    expect(manager.get(a.id)?.lastStatus).toBe("running");
    release();
    expect(first.started).toBe(true);
    await manager.idle();
    expect(contexts).toHaveLength(1);
  });

  test("a deleted bot records an error status and nothing else", async () => {
    const a = manager.create({ ...base, botId: "coder" }, "owner").automation;
    db.prepare("DELETE FROM room_members WHERE bot_id = 'coder'").run();
    db.prepare("DELETE FROM bots WHERE id = 'coder'").run();
    expect(manager.runNow(a.id,"owner")).toMatchObject({started:false,reason:"bot unavailable"});
    expect(manager.get(a.id)?.lastStatus).toBeNull();
    expect(contexts).toHaveLength(0);
  });

  test("a failing automation does not stop the others", async () => {
    const broken = manager.create({ ...base, name: "Broken", botId: "coder", scheduleCron: "0 10 * * *" }, "owner").automation;
    manager.create({ ...base, name: "Fine", scheduleCron: "0 10 * * *" }, "owner");
    db.prepare("DELETE FROM room_members WHERE bot_id = 'coder'").run();
    db.prepare("DELETE FROM bots WHERE id = 'coder'").run();
    await expect(scheduler.tick(at("2026-10-27T10:00:00Z"))).resolves.toBeUndefined();
    expect(manager.get(broken.id)?.runtime?.reason).toBe("bot unavailable");
    expect(ledger.list("main").some((e) => e.actor === "automation:Fine")).toBe(true);
  });
});
