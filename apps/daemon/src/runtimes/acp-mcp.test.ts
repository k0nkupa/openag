import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionOption, RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals, type Approvals } from "../approvals.js";
import { type Db, openDb } from "../db/index.js";
import { createLedger, type Ledger } from "../ledger.js";
import { createMcpAccess, type McpAccess } from "../mcpserver.js";
import { addMember, createBot, createRoom, getBot, getRoom } from "../rooms.js";
import { CLAUDE_MCP_WAIT_MS, createAcpRuntime, claudeEnv, codexEnv } from "./acp.js";
import { type FakeAdapterOptions, fakeAdapter, fakeAdapterStream } from "./fake-acp.testkit.js";
import { createRunner } from "./runner.js";
import { defaultTools } from "./tools.js";
import type { TurnContext } from "./types.js";

const BASE = "http://127.0.0.1:9"; // never bound: only a URL string for the runtime
const TOOLS: ReadonlySet<string> = new Set(["computer_click"]);
const CLAUDE_OPTIONS: PermissionOption[] = [
  { optionId: "allow-once", name: "Allow", kind: "allow_once" },
  { optionId: "allow-always", name: "Always", kind: "allow_always" },
  { optionId: "reject", name: "Reject", kind: "reject_once" },
];
const CODEX_OPTIONS: PermissionOption[] = [
  { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
  { optionId: "accept_execpolicy_amendment", name: "Always allow", kind: "allow_always" },
  { optionId: "cancel", name: "Reject", kind: "reject_once" },
];
const CODEX_MODES = ["read-only", "workspace-write", "agent", "agent-full-access"];

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-acp-mcp-"));
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

const realAccess = (): McpAccess => createMcpAccess({ runner: { activeTurn: () => undefined }, dataDir: dir, tools: () => [] });

type Log = ReturnType<typeof fakeAdapter>["log"];

function makeHarness(opts: { access?: McpAccess | null; adapter?: FakeAdapterOptions; codex?: boolean; stream?: boolean } = {}) {
  if (opts.codex) db.prepare("UPDATE bots SET config_json = '{\"adapter\":\"codex\"}' WHERE id = 'coder'").run();
  const ledger: Ledger = createLedger(db);
  const approvals: Approvals = createApprovals(db, ledger);
  let log: Log;
  let agentConn: { close(): void } | undefined;
  let hangUp: (() => void) | undefined;
  let launcher: Parameters<typeof createAcpRuntime>[0]["launcher"];
  if (opts.stream) {
    const s = fakeAdapterStream(dir, opts.adapter ?? { startMode: "default" });
    log = s.log;
    agentConn = s.agentConn;
    hangUp = s.hangUp;
    launcher = () => ({ target: s.target, close: () => void log.closed++ });
  } else {
    const f = fakeAdapter(dir, opts.adapter ?? { startMode: "default" });
    log = f.log;
    launcher = () => ({ target: f.fake, close: () => void log.closed++ });
  }
  const access = opts.access === null ? undefined : (opts.access ?? realAccess());
  const acp = createAcpRuntime({
    dataDir: dir,
    launcher,
    mcp: access ? { access, baseUrl: () => BASE, tools: TOOLS } : undefined,
  });
  const runner = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { acp }, tools: defaultTools });
  const say = (text: string, roomId = "main") => {
    const message = ledger.append(roomId, "user", "message", { text });
    return runner.run(getRoom(db, roomId)!, getBot(db, "coder")!, message);
  };
  /** A resumed turn, run straight against the runtime (the runner's resume path is not needed here). */
  const resumeTurn = (roomId: string, acpSessionId: string) => {
    // Resume only applies to a session saved with the current instruction, model and permission context, so reuse the saved turn state.
    const row = db.prepare("SELECT state_json FROM turns WHERE room_id = ? ORDER BY rowid DESC LIMIT 1").get(roomId) as { state_json: string };
    const saved = JSON.parse(row.state_json) as Record<string, unknown>;
    expect(saved.acpSessionId).toBe(acpSessionId);
    return acp.runTurn({
      room: getRoom(db, roomId)!,
      bot: getBot(db, "coder")!,
      message: undefined as never,
      prompt: "continue",
      resumed: true,
      turnId: "resumed-turn",
      ledger,
      state: saved,
      saveState() {},
      authorize: async () => ({ allowed: false, status: "denied", message: "denied in test" }),
      callTool: async () => ({ ok: false, status: "error", message: "not in test" }),
      toolCalls: 0,
    } as unknown as TurnContext);
  };
  return { ledger, approvals, acp, runner, say, resumeTurn, log: () => log, agentConn, hangUp, access };
}

const serversOf = (servers: unknown) => servers as Array<{ type: string; name: string; url: string; headers: Array<{ name: string; value: string }> }>;
const tokenOf = (servers: unknown) => serversOf(servers)[0]!.headers[0]!.value.replace(/^Bearer /, "");

async function status(access: McpAccess, token: string): Promise<number> {
  const req = new Request(`${BASE}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: "{}" });
  return (await access.handle(req)).status;
}

async function waitUntil(cond: () => Promise<boolean>, ms = 2000): Promise<void> {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error("condition not reached");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("session MCP server", () => {
  test("session/new gets exactly one http server under an unguessable per-connection name with a Bearer token; each (bot, room) gets its own", async () => {
    const h = makeHarness();
    await h.say("hello");
    await h.say("hello other", "other");
    const [first, second] = h.log().mcpServers as unknown[][];
    expect(first).toHaveLength(1);
    expect(serversOf(first)[0]).toMatchObject({ type: "http", url: `${BASE}/mcp` });
    expect(serversOf(first)[0]!.name).toMatch(/^openag-[0-9a-f]{16}$/);
    // Same connection, same name; the token is what differs per room.
    expect(serversOf(second)[0]!.name).toBe(serversOf(first)[0]!.name);
    expect(serversOf(first)[0]!.headers).toHaveLength(1);
    expect(serversOf(first)[0]!.headers[0]!.name).toBe("Authorization");
    expect(tokenOf(first)).toMatch(/^oagt_/);
    expect(tokenOf(second)).toMatch(/^oagt_/);
    expect(tokenOf(second)).not.toBe(tokenOf(first));
    // The token never reaches the ledger.
    expect(JSON.stringify(h.ledger.list("main"))).not.toContain(tokenOf(first));
    await h.acp.close();
  });

  test("session/resume gets a new token, and the old one is rejected", async () => {
    const access = realAccess();
    const first = makeHarness({ access });
    await first.say("hello");
    const oldToken = tokenOf(first.log().mcpServers[0]);
    expect(await status(access, oldToken)).not.toBe(401);

    const second = makeHarness({ access });
    await second.resumeTurn("main", "s1");
    expect(second.log().resumed).toEqual(["s1"]);
    const newToken = tokenOf(second.log().mcpServers[0]);
    expect(newToken).not.toBe(oldToken);
    expect(await status(access, oldToken)).toBe(401);
    expect(await status(access, newToken)).not.toBe(401);
    await first.acp.close();
    await second.acp.close();
  });

  test("without the mcp option, mcpServers is an empty list", async () => {
    const h = makeHarness({ access: null });
    await h.say("hello");
    expect(h.log().mcpServers).toEqual([[]]);
    await h.acp.close();
  });

  test("runtime close() revokes the tokens it issued", async () => {
    const access = realAccess();
    const h = makeHarness({ access });
    await h.say("hello");
    await h.say("hello other", "other");
    const tokens = h.log().mcpServers.map(tokenOf);
    await h.acp.close();
    for (const t of tokens) expect(await status(access, t)).toBe(401);
  });

  test("closing the agent connection revokes the tokens that connection held", async () => {
    const access = realAccess();
    const h = makeHarness({ access, stream: true });
    await h.say("hello");
    const token = tokenOf(h.log().mcpServers[0]);
    expect(await status(access, token)).not.toBe(401);
    h.agentConn!.close();
    h.hangUp!();
    await waitUntil(async () => (await status(access, token)) === 401);
    await h.acp.close();
  });
});

describe("permission handling for our MCP server", () => {
  const claudePermission = (toolName: string, mcpServer?: { name: string; source: string }) =>
    ({
      toolCall: {
        toolCallId: "t1",
        title: toolName,
        name: toolName,
        kind: "other",
        status: "pending",
        rawInput: { x: 1, y: 2 },
        _meta: { claudeCode: { toolName, ...(mcpServer ? { mcpServer } : {}) } },
      } as unknown as RequestPermissionRequest["toolCall"],
      options: CLAUDE_OPTIONS,
    }) as const;

  test("Claude call to our server in the allow-list: allow_once without an approval, never allow_always", async () => {
    const h = makeHarness({
      adapter: { startMode: "default", priorToolCalls: [], permission: (srv) => claudePermission(`mcp__${srv}__computer_click`, { name: srv, source: "dynamic" }) },
    });
    await h.say("create it");
    expect(h.approvals.listPending()).toHaveLength(0);
    expect(h.log().chosenOptionIds).toEqual(["allow-once"]);
    await h.acp.close();
  });

  test.each<[string, (srv: string) => [string, { name: string; source: string } | undefined]]>([
    ["source project", (srv) => [`mcp__${srv}__computer_click`, { name: srv, source: "project" }]],
    ["another server name", (srv) => [`mcp__${srv}__computer_click`, { name: "other", source: "dynamic" }]],
    ["a config-defined server literally named openag", () => ["mcp__openag__computer_click", { name: "openag", source: "dynamic" }]],
    ["no server meta", (srv) => [`mcp__${srv}__computer_click`, undefined]],
    ["tool not in the allow-list", (srv) => [`mcp__${srv}__computer_shell`, { name: srv, source: "dynamic" }]],
    ["name does not match the pattern", (srv) => [`mcp__${srv}__computer-click`, { name: srv, source: "dynamic" }]],
  ])("%s is refused as native execution: reject_once, no approval", async (_label, build) => {
    const h = makeHarness({
      adapter: {
        startMode: "default",
        priorToolCalls: [],
        permission: (srv) => {
          const [toolName, meta] = build(srv);
          return claudePermission(toolName, meta);
        },
      },
    });
    await h.say("create it");
    // Native execution is disabled: only the exact offered own-server tools are forwarded; everything else is rejected, never approvable.
    expect(h.approvals.listPending()).toHaveLength(0);
    expect(h.log().chosenOptionIds).toEqual(["reject"]);
    expect(h.ledger.list("main").some((e) => e.type === "tool_result" && (e.payload as { message?: string }).message === "Native execution is disabled. Use the daemon-provided tools.")).toBe(true);
    await h.acp.close();
  });

  const codexPermission = { toolCall: { toolCallId: "t1", kind: "execute", status: "pending" } as unknown as RequestPermissionRequest["toolCall"], options: CODEX_OPTIONS };
  const codexTracked = (title: string, rawInput: unknown) => [{ toolCallId: "t1", title, kind: "execute", rawInput }];
  const ownInput = (srv: string) => ({ server: srv, tool: "computer_click", arguments: {} });

  test("Codex call to our server, correlated through the earlier tool_call: allowed without an approval", async () => {
    const h = makeHarness({
      codex: true,
      adapter: { startMode: "read-only", availableModes: CODEX_MODES, permission: codexPermission, priorToolCalls: (srv) => codexTracked(`mcp.${srv}.computer_click`, ownInput(srv)) },
    });
    await h.say("create it");
    expect(h.approvals.listPending()).toHaveLength(0);
    expect(h.log().chosenOptionIds).toEqual(["allow_once"]);
    await h.acp.close();
  });

  test.each<[string, (srv: string) => Array<{ toolCallId: string; title?: string; kind?: string; rawInput?: unknown }>]>([
    ["no earlier tool_call for this id", () => []],
    ["title from another server", (srv) => codexTracked("mcp.other.computer_click", ownInput(srv))],
    ["a config-defined server literally named openag", () => codexTracked("mcp.openag.computer_click", ownInput("openag"))],
    ["rawInput.server differs", (srv) => codexTracked(`mcp.${srv}.computer_click`, { ...ownInput(srv), server: "other" })],
    ["rawInput is not an object", (srv) => codexTracked(`mcp.${srv}.computer_click`, "x")],
  ])("Codex execute request with %s is refused as native execution: cancel, no approval", async (_label, prior) => {
    const h = makeHarness({ codex: true, adapter: { startMode: "read-only", availableModes: CODEX_MODES, permission: codexPermission, priorToolCalls: prior } });
    await h.say("create it");
    expect(h.approvals.listPending()).toHaveLength(0);
    expect(h.log().chosenOptionIds).toEqual(["cancel"]);
    await h.acp.close();
  });

  test("the tracked tool-call map is capped at 500: the oldest entry is forgotten", async () => {
    const priorFor = (srv: string) =>
      Array.from({ length: 501 }, (_, i) => ({
        toolCallId: `c${i}`,
        title: `mcp.${srv}.computer_click`,
        kind: "execute",
        rawInput: ownInput(srv),
      }));
    const outcomes: string[] = [];
    const { methods } = await import("@agentclientprotocol/sdk");
    const h = makeHarness({
      codex: true,
      adapter: {
        startMode: "read-only",
        availableModes: CODEX_MODES,
        onPrompt: async ({ sessionId, server, client }) => {
          for (const call of priorFor(server)) {
            await client.notify(methods.client.session.update, {
              sessionId,
              update: { sessionUpdate: "tool_call", status: "pending", ...call } as never,
            });
          }
          for (const id of ["c500", "c0"]) {
            const res = await client.request(
              methods.client.session.requestPermission,
              { sessionId, toolCall: { toolCallId: id, kind: "execute", status: "pending" } as never, options: CODEX_OPTIONS },
            );
            outcomes.push(res.outcome.outcome === "selected" ? res.outcome.optionId : "cancelled");
          }
          return "end_turn";
        },
      },
    });
    await h.say("create it");
    expect(h.approvals.listPending()).toHaveLength(0);
    expect(outcomes).toEqual(["allow_once", "cancel"]);
    await h.acp.close();
  });
});

describe("adapter environments", () => {
  test("claudeEnv keeps the MCP tool timeout above our wait bound, whatever the daemon env says", () => {
    const floor = CLAUDE_MCP_WAIT_MS + 60_000;
    expect(claudeEnv({ PATH: "/usr/bin" }).MCP_TOOL_TIMEOUT).toBe(String(floor));
    expect(claudeEnv({ MCP_TOOL_TIMEOUT: "60000" }).MCP_TOOL_TIMEOUT).toBe(String(floor));
    expect(claudeEnv({ MCP_TOOL_TIMEOUT: "nonsense" }).MCP_TOOL_TIMEOUT).toBe(String(floor));
    expect(claudeEnv({ MCP_TOOL_TIMEOUT: "3000000" }).MCP_TOOL_TIMEOUT).toBe("3000000");
  });

  test("claudeEnv turns Claude Code's own auto-memory off, whatever the daemon env says", () => {
    expect(claudeEnv({}).CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
    expect(claudeEnv({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: "0" }).CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
  });

  test("claudeEnv never carries OPENAG_TOKEN and does not mutate its input", () => {
    const base = { OPENAG_TOKEN: "owner", PATH: "/usr/bin" };
    const env = claudeEnv(base);
    expect(env).not.toHaveProperty("OPENAG_TOKEN");
    expect(base.OPENAG_TOKEN).toBe("owner");
  });

  test("codexEnv gets no MCP timeout", () => {
    expect(codexEnv({ PATH: "/usr/bin" })).not.toHaveProperty("MCP_TOOL_TIMEOUT");
  });
});

describe("tool output kept in the ledger", () => {
  test("inline image data is replaced by a marker, ordinary output is kept", async () => {
    const { summarizeToolOutput } = await import("./acp.js");
    const b64 = "iVBORw0KGgo" + "A".repeat(150_000);
    const out = summarizeToolOutput([{ type: "image", source: { type: "base64", media_type: "image/png", data: b64 } }, { type: "text", text: "screenshot 1280x800" }])!;
    expect(out).not.toContain("AAAAAAAAAA");
    expect(out).toContain("[binary data omitted]");
    expect(out).toContain("screenshot 1280x800");
    expect(out.length).toBeLessThan(500);
    expect(summarizeToolOutput("wrote file")).toBe("wrote file");
    expect(summarizeToolOutput(undefined)).toBeUndefined();
    // a huge payload is cut before it is scanned, and still comes out short
    expect(summarizeToolOutput("A".repeat(20_000_000))!.length).toBeLessThan(3000);
    // a long non-base64 text is still just truncated
    expect(summarizeToolOutput("x ".repeat(5000))!.endsWith("…[truncated]")).toBe(true);
  });
});

describe("isolated rooms", () => {
  test("Claude sessions for isolated rooms also disallow Claude Code's built-in tools; other rooms and Codex do not", async () => {
    const { sessionMetaFor, isIsolatedRoom, CLAUDE_BUILTIN_TOOLS, profiles } = await import("./acp.js");
    const claude = profiles.claude!;
    expect(isIsolatedRoom("_reflection")).toBe(true);
    expect(isIsolatedRoom("_iso-auto_1")).toBe(true);
    expect(isIsolatedRoom("_hook-auto_1")).toBe(false);
    expect(isIsolatedRoom("main")).toBe(false);
    const iso = sessionMetaFor(claude, "_iso-auto_1") as { claudeCode: { options: { settingSources: string[]; disallowedTools: string[] } } };
    expect(iso.claudeCode.options.settingSources).toEqual([]); // the fail-closed setting stays
    expect(iso.claudeCode.options.disallowedTools).toEqual([...CLAUDE_BUILTIN_TOOLS]);
    expect(iso.claudeCode.options.disallowedTools).toEqual(expect.arrayContaining(["Read", "Glob", "Grep", "WebFetch", "Bash"]));
    expect(sessionMetaFor(claude, "main")).toBe(claude.sessionMeta);
    expect(sessionMetaFor(profiles.codex!, "_reflection")).toBeUndefined();
    // The shared constant is not mutated.
    expect((claude.sessionMeta as { claudeCode: { options: Record<string, unknown> } }).claudeCode.options.disallowedTools).toBeUndefined();
  });

  test("tool-enabled hook rooms keep read tools but lose network and write built-ins for Claude", async () => {
    const { sessionMetaFor, isOfflineHookRoom, CLAUDE_OFFLINE_DISALLOWED, profiles } = await import("./acp.js");
    expect(isOfflineHookRoom("_hook-auto_1")).toBe(true);
    expect(isOfflineHookRoom("_iso-auto_1")).toBe(false);
    const meta = sessionMetaFor(profiles.claude!, "_hook-auto_1") as { claudeCode: { options: { settingSources: string[]; disallowedTools: string[] } } };
    expect(meta.claudeCode.options.settingSources).toEqual([]);
    expect(meta.claudeCode.options.disallowedTools).toEqual([...CLAUDE_OFFLINE_DISALLOWED]);
    expect(meta.claudeCode.options.disallowedTools).toEqual(expect.arrayContaining(["WebFetch", "WebSearch", "Bash", "Write"]));
    expect(meta.claudeCode.options.disallowedTools).not.toContain("Read");
  });
});
