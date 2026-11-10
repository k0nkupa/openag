import {createPermissions} from '../permissions.js';
import { resolveReviewed } from "../approvals.testkit.js";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApprovals } from "../approvals.js";
import { type Db, openDb } from "../db/index.js";
import { createLedger } from "../ledger.js";
import { addMember, createBot, createRoom, getBot, getRoom } from "../rooms.js";
import { createApiRuntime } from "./api.js";
import { pregrantMatches } from "./pregrant.js";
import { createRunner } from "./runner.js";
import { botWorkDir, defaultTools } from "./tools.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-restart-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createBot(db, { id: "coder", runtime: "acp" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  addMember(db, "main", "coder");
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
// ai's MockLanguageModelV3 is a valid LanguageModelV3 at runtime (Mastra resolves it), but its doGenerate typing does not
// line up with Mastra's MastraLanguageModelV3 structural type, so it is cast once here.
const asRuntimeModel = (m: MockLanguageModelV3) => m as unknown as NonNullable<Parameters<typeof createApiRuntime>[0]>["model"];
function scriptedModel(args: unknown) {
  let calls = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      calls++;
      if (calls === 1) {
        return {
          content: [{ type: "tool-call" as const, toolCallId: "c1", toolName: "write_file", input: JSON.stringify(args) }],
          finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
          usage,
          warnings: [],
        };
      }
      return {
        content: [{ type: "text" as const, text: "done" }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage,
        warnings: [],
      };
    },
  });
}

/** One "daemon process": its own ledger emitter, in-memory approval waiters and runner, over the shared DB file. */
function processWith(runtimes: Parameters<typeof createRunner>[0]["runtimes"]) {
  const ledger = createLedger(db);
  const approvals = createApprovals(db, ledger);
  const permissions=createPermissions(db,ledger,dir,approvals),current=permissions.ensure('boss','main');if(current.preset!=='read-only')permissions.select('boss','main','read-only','fixture-owner',current.revision);
  const runner = createRunner({ db, ledger, approvals,permissions,dataDir: dir, runtimes, tools: defaultTools });
  return { ledger, approvals, runner };
}

async function pendingApproval(approvals: ReturnType<typeof createApprovals>) {
  for (let i = 0; i < 300; i++) {
    const [first] = approvals.listPending();
    if (first) return first;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no approval appeared");
}

const say = (p: ReturnType<typeof processWith>, botId: string, text: string) => {
  const message = p.ledger.append("main", "user", "message", { text });
  return p.runner.run(getRoom(db, "main")!, getBot(db, botId)!, message);
};
const turnStatuses = () => (db.prepare("SELECT status FROM turns ORDER BY created_at, rowid").all() as { status: string }[]).map((r) => r.status);

test("recover() marks running turns interrupted and leaves pending approvals pending", async () => {
  const a = processWith({ api: createApiRuntime({ model: asRuntimeModel(scriptedModel({ path: "a.txt", content: "x" })) }) });
  void say(a, "boss", "write a.txt");
  const pending = await pendingApproval(a.approvals);

  const b = processWith({});
  expect(b.runner.recover()).toBe(1);
  expect(turnStatuses()).toEqual(["interrupted"]);
  expect(b.approvals.listPending().map((x) => x.id)).toEqual([pending.id]);
  expect(b.ledger.list("main").some((e) => e.type === "error")).toBe(true);
  expect(b.runner.recover()).toBe(0);
});

test("API turn: restart while waiting -> accept resumes the turn with a pregrant, no second approval", async () => {
  const a = processWith({ api: createApiRuntime({ model: asRuntimeModel(scriptedModel({ path: "hello.txt", content: "hi" })) }) });
  void say(a, "boss", "write hello.txt");
  const pending = await pendingApproval(a.approvals);

  // "Restart": a fresh process over the same DB. Process A's in-memory turn is gone as far as B is concerned.
  const b = processWith({ api: createApiRuntime({ model: asRuntimeModel(scriptedModel({ path: "hello.txt", content: "hi" })) }) });
  b.runner.recover();
  expect(b.approvals.listPending().map((x) => x.id)).toEqual([pending.id]);
  expect(existsSync(join(botWorkDir(dir, "boss"), "hello.txt"))).toBe(false);

  resolveReviewed(b.approvals, pending.id, { kind: "accept" });
  await b.runner.idle();

  expect(readFileSync(join(botWorkDir(dir, "boss"), "hello.txt"), "utf8")).toBe("hi");
  expect(db.prepare("SELECT COUNT(*) AS n FROM approvals").get()).toEqual({ n: 1 });
  expect(turnStatuses()).toEqual(["finished"]);
  const types = b.ledger.list("main").filter((e) => e.type !== "work_updated").map((e) => e.type);
  expect(types.indexOf("approval_requested")).toBeLessThan(types.indexOf("approval_decided"));
  expect(types.at(-1)).toBe("turn_finished");
  expect(b.ledger.list("main").filter((e) => e.type === "turn_started").map((e) => (e.payload as { resumed: boolean }).resumed)).toEqual([false, true]);
  // The grant was consumed: nothing left over in state.
  expect(JSON.parse((db.prepare("SELECT state_json FROM turns").get() as { state_json: string }).state_json).pregrant).toBeUndefined();
});

test("ignore on an interrupted turn abandons it; nothing runs", async () => {
  const a = processWith({ api: createApiRuntime({ model: asRuntimeModel(scriptedModel({ path: "x.txt", content: "x" })) }) });
  void say(a, "boss", "write x.txt");
  const pending = await pendingApproval(a.approvals);
  const b = processWith({ api: createApiRuntime({ model: asRuntimeModel(scriptedModel({ path: "x.txt", content: "x" })) }) });
  b.runner.recover();
  resolveReviewed(b.approvals, pending.id, { kind: "ignore" });
  await b.runner.idle();
  expect(turnStatuses()).toEqual(["abandoned"]);
  expect(existsSync(join(botWorkDir(dir, "boss"), "x.txt"))).toBe(false);
  expect(b.ledger.list("main").at(-1)).toMatchObject({ type: "turn_finished", payload: { status: "abandoned" } });
});

test("a decision on a normal (running) turn does not trigger a resume", async () => {
  const a = processWith({ api: createApiRuntime({ model: asRuntimeModel(scriptedModel({ path: "n.txt", content: "n" })) }) });
  const turn = say(a, "boss", "write n.txt");
  resolveReviewed(a.approvals, (await pendingApproval(a.approvals)).id, { kind: "accept" });
  await turn;
  await a.runner.idle();
  expect(a.ledger.list("main").filter((e) => e.type === "turn_started")).toHaveLength(1);
});

test("pregrantMatches: same tool and exact payload; changed content, target or tool does not match", () => {
  const grant = { toolName: "Write", args: { file_path: "/w/hello.txt", content: "hi" } };
  expect(pregrantMatches(grant, "Write", grant.args)).toBe(true);
  expect(pregrantMatches(grant, "Write", { file_path: "/w/hello.txt", content: "different" })).toBe(false);
  expect(pregrantMatches(grant, "Write", { file_path: "/w/other.txt", content: "hi" })).toBe(false);
  expect(pregrantMatches(grant, "Edit", { file_path: "/w/hello.txt" })).toBe(false);
  const bash = { toolName: "Bash", args: { command: "ls" } };
  expect(pregrantMatches(bash, "Bash", { command: "ls" })).toBe(true);
  expect(pregrantMatches(bash, "Bash", { command: "rm -rf /" })).toBe(false);
  // No identifying target: needs deep equality.
  expect(pregrantMatches({ toolName: "X", args: { a: 1 } }, "X", { a: 1 })).toBe(true);
  expect(pregrantMatches({ toolName: "X", args: { a: 1 } }, "X", { a: 2 })).toBe(false);
});

test("a turn that ends gracefully (e.g. the agent replies 'cancelled') during shutdown stays interrupted", async () => {
  let release!: () => void;
  const hanging = { runTurn: () => new Promise<void>((resolve) => (release = resolve)) };
  const p = processWith({ api: hanging });
  const turn = say(p, "boss", "anything");
  for (let i = 0; i < 100 && turnStatuses()[0] !== "running"; i++) await new Promise((r) => setTimeout(r, 5));
  expect(p.runner.shutdown()).toBe(1);
  release(); // teardown makes runTurn return normally rather than throw
  await turn;
  expect(turnStatuses()).toEqual(["interrupted"]);
  expect(p.ledger.list("main").some((e) => e.type === "turn_finished")).toBe(false);
});
