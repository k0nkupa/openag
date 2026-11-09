import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RequestError } from "@agentclientprotocol/sdk";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApprovals } from "../approvals.js";
import { type Db, openDb } from "../db/index.js";
import { createLedger } from "../ledger.js";
import { addMember, createBot, createRoom, getBot, getRoom } from "../rooms.js";
import { createAcpRuntime } from "./acp.js";
import { type FakeAdapterOptions, fakeAdapter } from "./fake-acp.testkit.js";
import { createRunner } from "./runner.js";
import { defaultTools } from "./tools.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-acp-"));
  db = openDb(dir);
  createBot(db, { id: "coder", runtime: "acp" });
  createRoom(db, { id: "main", leadBotId: "coder" });
  createRoom(db, { id: "other", leadBotId: "coder" });
  addMember(db, "main", "coder");
  addMember(db, "other", "coder");
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function harness(adapterOpts: FakeAdapterOptions = {}) {
  const { fake, log } = fakeAdapter(dir, adapterOpts);
  const ledger = createLedger(db);
  const approvals = createApprovals(db, ledger);
  const acp = createAcpRuntime({ dataDir: dir, launcher: () => ({ target: fake, close: () => void log.closed++ }) });
  const runner = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { acp }, tools: defaultTools });
  const say = (text: string, roomId = "main") => {
    const message = ledger.append(roomId, "user", "message", { text });
    return runner.run(getRoom(db, roomId)!, getBot(db, "coder")!, message);
  };
  return { ledger, approvals, acp, say, log };
}

const hello=()=>join(dir,"bots","coder","work","hello.txt");

test("native effects are refused without a human approval",async()=>{
  const {approvals,say,acp}=harness();
  await say("create it");
  expect(approvals.listPending()).toHaveLength(0);
  expect(existsSync(hello())).toBe(false);
  await acp.close();
});

test("one ACP session per (bot, room), reused across turns; close() shuts the adapter down", async () => {
  const { say, log, acp } = harness();
  await say("hello");
  await say("hello again");
  expect(log.newSessions).toBe(1);
  await say("hello other room", "other");
  expect(log.newSessions).toBe(2);
  await acp.close();
  expect(log.closed).toBe(1);
});

test("sessions start without CLI settings and are forced into the asking mode (fail closed)", async () => {
  const { say, log, acp } = harness({ startMode: "auto" });
  await say("hello");
  expect(log.metas[0]).toMatchObject({ claudeCode: { options: { settingSources: [], skills: [], strictMcpConfig: true, tools: [], disallowedTools: expect.arrayContaining(["Read", "Bash", "Write", "Edit", "WebFetch"]) } } });
  expect(log.modeSets).toEqual(["default"]);
  await acp.close();
});

test("a session that already asks is left alone", async () => {
  const { say, log, acp } = harness({ startMode: "default" });
  await say("hello");
  expect(log.modeSets).toEqual([]);
  await acp.close();
});

test("the turn fails, and runs nothing, if the safe mode cannot be applied", async () => {
  for (const adapterOpts of [{ failSetMode: true }, { availableModes: ["auto", "bypassPermissions"] }]) {
    const { ledger, say, log, acp } = harness(adapterOpts);
    await say("create it");
    expect(log.prompts).toHaveLength(0);
    expect(ledger.list("main").filter((e) => e.type !== "work_updated").map((e) => e.type)).toContain("error");
    expect(existsSync(hello())).toBe(false);
    await acp.close();
  }
});

test("an authRequired failure drops the adapter and its sessions; the next turn starts fresh and works", async () => {
  let failures = 1;
  const { ledger, say, log, acp } = harness({
    onPrompt: async () => {
      if (failures-- > 0) throw RequestError.authRequired();
      return "end_turn";
    },
  });
  await say("hello");
  expect(ledger.list("main").some((e) => e.type === "error")).toBe(true);
  expect(log.closed).toBe(1);
  await say("hello again");
  expect(log.newSessions).toBe(2);
  expect(log.prompts).toHaveLength(2);
  expect(ledger.list("main").filter((e) => e.type === "turn_finished").map((e) => (e.payload as { status: string }).status)).toEqual(["failed", "finished"]);
  await acp.close();
});

test("other prompt failures keep the adapter and session", async () => {
  const { say, log, acp } = harness({ onPrompt: async () => { throw new Error("boom"); } });
  await say("hello");
  await say("hello again");
  expect(log.closed).toBe(0);
  expect(log.newSessions).toBe(1);
  await acp.close();
});
