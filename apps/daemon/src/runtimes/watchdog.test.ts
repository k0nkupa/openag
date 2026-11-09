import { resolveReviewed } from "../approvals.testkit.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApprovals } from "../approvals.js";
import { type Db, openDb } from "../db/index.js";
import { createLedger } from "../ledger.js";
import { addMember, createBot, createRoom, getBot, getRoom } from "../rooms.js";
import { createRunner, type TurnMeta } from "./runner.js";
import { defaultTools } from "./tools.js";
import type { BotRuntime, TurnContext } from "./types.js";

let dir: string;
let db: Db;
beforeEach(() => {
  vi.useFakeTimers();
  dir = mkdtempSync(join(tmpdir(), "openag-watchdog-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
});
afterEach(() => {
  vi.useRealTimers();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

let script: (ctx: TurnContext) => Promise<void>;
const aborted: string[] = [];
const fake: BotRuntime = {
  runTurn: (ctx) => script(ctx),
  abortTurn: (ctx) => {
    aborted.push(ctx.turnId);
    return { lines: ["boom sk-abcdefghijklmnopqrstuvwxyz0123456789"], envKeys: ["PATH"] };
  },
};

function setup(watchdog = { idleMs: 60, unattendedIdleMs: 150, tickMs: 10 }) {
  const ledger = createLedger(db);
  const approvals = createApprovals(db, ledger);
  const runner = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { api: fake, acp: fake }, tools: defaultTools, watchdog });
  const run = (meta?: TurnMeta) => {
    const message = ledger.append("main", "user", "message", { text: "go" });
    return runner.run(getRoom(db, "main")!, getBot(db, "boss")!, message, undefined, meta);
  };
  return { ledger, approvals, run };
}
const hang = () => new Promise<void>(() => undefined);
const lastTurn = () => db.prepare("SELECT status FROM turns ORDER BY created_at DESC, rowid DESC LIMIT 1").get() as { status: string };

describe("turn watchdog", () => {
  beforeEach(() => void (aborted.length = 0));

  test("a hung turn ends as interrupted, the runtime is told, and the room lock is released for the next turn", async () => {
    const { run, ledger } = setup();
    script = hang;
    const stalled = run();
    await vi.advanceTimersByTimeAsync(100);
    await stalled;
    expect(lastTurn().status).toBe("interrupted");
    expect(aborted).toHaveLength(1);
    expect(ledger.list("main").some((e) => e.type === "error" && /turn stalled/.test(String((e.payload as { message: string }).message)))).toBe(true);
    const diag = ledger.list("main").find((e) => e.type === "error" && (e.payload as { message: string }).message === "stall diagnostic");
    expect(diag).toBeTruthy();
    expect(JSON.stringify(diag!.payload)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123456789"); // redacted by the ledger
    expect((diag!.payload as { diagnostic: { envKeys: string[] } }).diagnostic.envKeys).toEqual(["PATH"]);
    script = async (ctx) => void ctx.ledger.append("main", "boss", "bot_output", { turnId: ctx.turnId, text: "ok" });
    await run();
    expect(lastTurn().status).toBe("finished");
  });

  test("activity keeps a slow turn alive; a turn waiting on an approval is NOT killed", async () => {
    const { run, ledger, approvals } = setup();
    script = async (ctx) => {
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 30));
        ctx.ledger.append("main", "boss", "tool_call", { turnId: ctx.turnId, tool: "Read" });
      }
    };
    const active = run();
    await vi.advanceTimersByTimeAsync(200);
    await active;
    expect(lastTurn().status).toBe("finished");

    script = async (ctx) => {
      const auth = await ctx.authorize("Write", { file_path: "x", content: "x" });
      ctx.ledger.append("main", "boss", "bot_output", { turnId: ctx.turnId, text: auth.allowed ? "wrote" : "denied" });
    };
    const done = run();
    await vi.advanceTimersByTimeAsync(300); // 5x the idle limit, approval pending
    expect(lastTurn().status).toBe("running");
    const pending = db.prepare("SELECT id FROM approvals WHERE status = 'pending'").get() as { id: string };
    resolveReviewed(approvals, pending.id, { kind: "ignore" });
    await done;
    expect(lastTurn().status).toBe("finished");
    expect(ledger.list("main").some((e) => e.type === "error")).toBe(false);
  });

  test("unattended turns get the longer limit", async () => {
    const { run } = setup({ idleMs: 40, unattendedIdleMs: 400, tickMs: 10 });
    script = async (ctx) => {
      await new Promise((r) => setTimeout(r, 150));
      ctx.ledger.append("main", "boss", "bot_output", { turnId: ctx.turnId, text: "late" });
    };
    const unattended = run({ unattended: true });
    await vi.advanceTimersByTimeAsync(200);
    await unattended;
    expect(lastTurn().status).toBe("finished");
    script = hang;
    const stalled = run();
    await vi.advanceTimersByTimeAsync(100);
    await stalled;
    expect(lastTurn().status).toBe("interrupted");
  });
});
