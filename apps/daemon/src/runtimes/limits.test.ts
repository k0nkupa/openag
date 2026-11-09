import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "../approvals.js";
import { type Db, openDb } from "../db/index.js";
import { createLedger } from "../ledger.js";
import { addMember, createBot, createRoom, getBot, getRoom } from "../rooms.js";
import { setSetting } from "../settings.js";
import { createRunner, type TurnMeta } from "./runner.js";
import { defaultTools } from "./tools.js";
import type { BotRuntime } from "./types.js";

let dir: string;
let db: Db;
let ran = 0;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-limits-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createBot(db, { id: "coder", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  addMember(db, "main", "coder");
  ran = 0;
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const fake: BotRuntime = { async runTurn() { ran++; } };
function setup() {
  const ledger = createLedger(db);
  const runner = createRunner({ db, ledger, approvals: createApprovals(db, ledger), dataDir: dir, runtimes: { api: fake, acp: fake }, tools: defaultTools });
  const run = (botId: string, meta?: TurnMeta) => {
    const message = ledger.append("main", "user", "message", { text: "go" });
    return runner.run(getRoom(db, "main")!, getBot(db, botId)!, message, undefined, meta);
  };
  return { ledger, run };
}
const limits = (v: Partial<{ maxTurnsPerBotPerDay: number; maxUnattendedPerDay: number }>) => setSetting(db, "limits", { maxTurnsPerBotPerDay: 0, maxUnattendedPerDay: 0, ...v });

describe("turn budget", () => {
  test("off by default: nothing is blocked", async () => {
    const { run } = setup();
    for (let i = 0; i < 5; i++) await run("boss");
    expect(ran).toBe(5);
  });

  test("a per-bot daily cap blocks the next turn with a fixed error and a failed turn_finished, without touching other bots", async () => {
    limits({ maxTurnsPerBotPerDay: 2 });
    const { run, ledger } = setup();
    await run("boss");
    await run("boss");
    await run("boss");
    expect(ran).toBe(2);
    const tail = ledger.list("main").filter(event => event.type !== "work_updated").slice(-2);
    expect(tail[0]).toMatchObject({ type: "error", payload: { message: "daily turn limit reached" } });
    expect(tail[1]).toMatchObject({ type: "turn_finished", payload: { status: "failed" } });
    await run("coder");
    expect(ran).toBe(3);
  });

  test("the unattended cap counts only unattended turns across bots; interactive turns still run", async () => {
    limits({ maxUnattendedPerDay: 2 });
    const { run } = setup();
    await run("boss", { unattended: true });
    await run("coder", { unattended: true });
    await run("boss", { unattended: true });
    expect(ran).toBe(2);
    await run("boss");
    expect(ran).toBe(3);
  });

  test("the window rolls: turns older than 24 h no longer count", async () => {
    limits({ maxTurnsPerBotPerDay: 1 });
    const { run } = setup();
    await run("boss");
    db.prepare("UPDATE turns SET created_at = created_at - ?").run(25 * 3_600_000);
    await run("boss");
    expect(ran).toBe(2);
  });

  test("the setting is validated", () => {
    expect(() => setSetting(db, "limits", { maxTurnsPerBotPerDay: -1, maxUnattendedPerDay: 0 })).toThrow();
    expect(() => setSetting(db, "limits", { maxTurnsPerBotPerDay: 1.5, maxUnattendedPerDay: 0 })).toThrow();
  });
});
