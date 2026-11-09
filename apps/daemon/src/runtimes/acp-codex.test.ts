import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionOption, RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApprovals } from "../approvals.js";
import { type Db, openDb } from "../db/index.js";
import { createLedger } from "../ledger.js";
import { addMember, createBot, createRoom, getBot, getRoom } from "../rooms.js";
import { type AdapterLauncher, codexEnv, codexToolName, createAcpRuntime, profiles } from "./acp.js";
import { type FakeAdapterOptions, fakeAdapter } from "./fake-acp.testkit.js";
import { createRunner } from "./runner.js";
import { defaultTools } from "./tools.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-acp-codex-"));
  db = openDb(dir);
  createBot(db, { id: "coder", runtime: "acp", config: { adapter: "codex" } });
  createRoom(db, { id: "main", leadBotId: "coder" });
  addMember(db, "main", "coder");
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const CODEX_TOOL_CALL = {
  toolCallId: "t1",
  title: "Run command",
  kind: "execute" as const,
  rawInput: { command: "touch hello.txt", cwd: "/work" },
};
const CODEX_OPTIONS: PermissionOption[] = [
  { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
  { optionId: "accept_execpolicy_amendment", name: "Always allow", kind: "allow_always" },
  { optionId: "cancel", name: "Reject", kind: "reject_once" },
];
const CODEX_PERMISSION = { toolCall: CODEX_TOOL_CALL as RequestPermissionRequest["toolCall"], options: CODEX_OPTIONS };
const CODEX_MODES = ["read-only", "workspace-write", "agent", "agent-full-access"];

function harness(adapterOpts: FakeAdapterOptions = {}, spy?: { profileIds: string[] }) {
  const { fake, log } = fakeAdapter(dir, adapterOpts);
  const ledger = createLedger(db);
  const approvals = createApprovals(db, ledger);
  const launcher: AdapterLauncher = ({ profile }) => {
    spy?.profileIds.push(profile.id);
    return { target: fake, close: () => void log.closed++ };
  };
  const acp = createAcpRuntime({ dataDir: dir, launcher });
  const runner = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { acp }, tools: defaultTools });
  const say = (text: string) => {
    const message = ledger.append("main", "user", "message", { text });
    return runner.run(getRoom(db, "main")!, getBot(db, "coder")!, message);
  };
  return { ledger, approvals, acp, say, log };
}

const hello = () => join(dir, "bots", "coder", "work", "hello.txt");

test("adapter config selects the profile: codex, default claude, unknown fails the turn", async () => {
  const spy = { profileIds: [] as string[] };
  const { ledger, say, acp } = harness({ startMode: "read-only", availableModes: CODEX_MODES }, spy);
  await say("hello");
  expect(spy.profileIds).toEqual(["codex"]);
  await acp.close();

  db.prepare("UPDATE bots SET config_json = '{}' WHERE id = 'coder'").run();
  const spy2 = { profileIds: [] as string[] };
  const second = harness({ startMode: "default" }, spy2);
  await second.say("hello");
  expect(spy2.profileIds).toEqual(["claude"]);
  await second.acp.close();

  db.prepare("UPDATE bots SET config_json = '{\"adapter\":\"bogus\"}' WHERE id = 'coder'").run();
  const third = harness({ startMode: "default" });
  await third.say("hello");
  const errors = third.ledger.list("main").filter((e) => e.type === "error");
  expect(errors.map((e) => (e.payload as { message: string }).message)).toContain('unknown ACP adapter "bogus"');
  expect(third.log.newSessions).toBe(0);
  await third.acp.close();
});

test("a codex native execute request is refused (reject_once, never allow_always) with no approval", async () => {
  const { approvals, say, log, acp, ledger } = harness({ startMode: "read-only", availableModes: CODEX_MODES, permission: CODEX_PERMISSION });
  await say("create hello.txt");
  expect(approvals.listPending()).toEqual([]);
  expect(log.chosenOptionIds).toEqual(["cancel"]);
  expect(existsSync(hello())).toBe(false);
  expect(ledger.list("main").some((e) => e.type === "tool_result" && (e.payload as { status?: string }).status === "denied")).toBe(true);
  await acp.close();
});

test("codex starts in agent mode: the runtime locks read-only, not default, before any prompt", async () => {
  const { say, log, acp } = harness({ startMode: "agent", availableModes: CODEX_MODES });
  await say("hello");
  expect(log.modeSets).toEqual(["read-only"]);
  expect(log.prompts).toEqual(["hello"]);
  await acp.close();
});

test.each<[string, FakeAdapterOptions]>([
  ["read-only not offered", { startMode: "agent", availableModes: ["agent", "agent-full-access"] }],
  ["set_mode fails", { startMode: "agent", availableModes: CODEX_MODES, failSetMode: true }],
])("codex fails closed when %s: no prompt, error event, no file", async (_name, adapterOpts) => {
  const { ledger, say, log, acp } = harness({ ...adapterOpts, permission: CODEX_PERMISSION });
  await say("create hello.txt");
  expect(log.prompts).toHaveLength(0);
  expect(ledger.list("main").map((e) => e.type)).toContain("error");
  expect(existsSync(hello())).toBe(false);
  await acp.close();
});

test("session/new carries no claudeCode meta for codex; claude keeps settingSources []", async () => {
  const codex = harness({ startMode: "read-only", availableModes: CODEX_MODES });
  await codex.say("hello");
  expect(codex.log.metas[0]).toBeUndefined();
  await codex.acp.close();

  db.prepare("UPDATE bots SET config_json = '{}' WHERE id = 'coder'").run();
  const claude = harness({ startMode: "default" });
  await claude.say("hello");
  expect(claude.log.metas[0]).toMatchObject({ claudeCode: { options: { settingSources: [], skills: [], strictMcpConfig: true, tools: [], disallowedTools: expect.arrayContaining(["Read", "Bash", "Write", "Edit", "WebFetch"]) } } });
  await claude.acp.close();
});

test("codexToolName maps every ACP kind", () => {
  const name = (kind: string | undefined) => codexToolName({ toolCallId: "x", kind } as RequestPermissionRequest["toolCall"]);
  expect(name("execute")).toBe("codex.shell");
  expect(name("edit")).toBe("codex.edit");
  expect(name("delete")).toBe("codex.edit");
  expect(name("move")).toBe("codex.edit");
  expect(name("fetch")).toBe("codex.fetch");
  expect(name("search")).toBe("codex.search");
  expect(name("read")).toBe("codex.read");
  expect(name("think")).toBe("codex.think");
  expect(name(undefined)).toBe("codex.unknown");
});

test("profiles expose the expected safe modes and meta", () => {
  expect(profiles.codex).toMatchObject({ id: "codex", safeMode: "read-only" });
  expect(profiles.codex?.sessionMeta).toBeUndefined();
  expect(profiles.claude).toMatchObject({ id: "claude", safeMode: "default" });
});

test("codexEnv strips API keys, sets read-only and no-browser, and does not mutate its input", () => {
  const base = { OPENAI_API_KEY: "sk-a", CODEX_API_KEY: "sk-b", PATH: "/usr/bin", INITIAL_AGENT_MODE: "agent" };
  const env = codexEnv(base);
  expect(env.OPENAI_API_KEY).toBeUndefined();
  expect(env.CODEX_API_KEY).toBeUndefined();
  expect(env.INITIAL_AGENT_MODE).toBe("read-only");
  expect(env.NO_BROWSER).toBe("1");
  expect(env.PATH).toBe("/usr/bin");
  expect(base.OPENAI_API_KEY).toBe("sk-a");
});
