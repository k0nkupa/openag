import { resolveReviewed } from "./approvals.testkit.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAuth, hashToken } from "./auth.js";
import { createApprovals, type Approvals } from "./approvals.js";
import type { Computer } from "./computer.js";
import { openDb, type Db } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger, type Ledger } from "./ledger.js";
import { createMcpAccess, type McpAccess } from "./mcpserver.js";
import { createPusher } from "./push.js";
import { createRedactor } from "./redact.js";
import { addMember, createBot, createRoom, getBot, getRoom } from "./rooms.js";
import { createRunner, type Runner } from "./runtimes/runner.js";
import type { BotRuntime, TurnContext } from "./runtimes/types.js";
import { setSetting } from "./settings.js";
import { createBraveTool } from "./tools/brave.js";
import { createComputerTools } from "./tools/computer.js";
import { createNotifyTool } from "./tools/notify.js";
import { toExecutors, type ToolDef } from "./tools/registry.js";

const OWNER = "owner-test-token";
const SHOT = "computer/screens/20260101-000000-000.png";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-body-bytes")]);
const PNG_B64 = PNG.toString("base64");
const ALLOW = new Set(["brave_search", "notify_user", "computer_screenshot", "computer_click", "computer_type", "computer_key", "computer_scroll", "computer_open", "computer_shell"]);
const COMPUTER_NAMES = ["computer_click", "computer_key", "computer_open", "computer_screenshot", "computer_scroll", "computer_shell", "computer_type"];

type Result = { isError?: boolean; content: Array<Record<string, unknown>> };
const textOf = (r: Result) => r.content.map((c) => (typeof c.text === "string" ? c.text : "")).join("");

let dir: string;
let savedBrave: string | undefined;
const closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-mcpserver-"));
  savedBrave = process.env.BRAVE_API_KEY;
  delete process.env.BRAVE_API_KEY;
});
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
  if (savedBrave === undefined) delete process.env.BRAVE_API_KEY;
  else process.env.BRAVE_API_KEY = savedBrave;
  rmSync(dir, { recursive: true, force: true });
});

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function setup(opts: { maxWaitMs?: number; maxCallsPerTurn?: number } = {}) {
  const db: Db = openDb(dir);
  closers.push(async () => db.close());
  createBot(db, { id: "boss", runtime: "api" });
  createBot(db, { id: "coder", runtime: "acp" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  createRoom(db, { id: "other", leadBotId: "coder" });
  addMember(db, "main", "boss");
  addMember(db, "other", "coder");

  mkdirSync(join(dir, "computer", "screens"), { recursive: true });
  writeFileSync(join(dir, SHOT), PNG);
  const computer = {
    name: "openag-main",
    capabilities: () => ({ shell: true, view: "proxy" as const }),
    peek: () => ({ backend: "cua", requestedBackend: null, configured: true, shell: true, state: "running" as const, observedAt: 1, busy: false, inputBlocked: false }),
    act: vi.fn(async (_argv: string[]) => ({ message: "done" })),
    shell: vi.fn(async (_c: string, _t: number) => ({ exitCode: 0, stdout: "out", stderr: "", truncated: false })),
    screenshot: vi.fn(async () => ({ path: SHOT, width: 1280, height: 800 })),
  };
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  const pusher = createPusher({ db, fetch: fetchMock as unknown as typeof fetch, redactor: createRedactor({ env: {} }) });
  const defs: ToolDef[] = [
    // Harmless stub contract for token/turn review tests; execution-world acceptance lives in verify-permission-worlds.
    ...createComputerTools(computer as unknown as Computer).map(def=>def.name==='computer_click'?{...def,permission:()=>({approval:'review' as const})}:def),
    createNotifyTool(pusher),
    createBraveTool(),
  ];

  // Each turn stays open until the test releases it, so the test can call MCP while the turn is active.
  const gates = new Map<string, { promise: Promise<void>; release: () => void }>();
  const runtime: BotRuntime = {
    async runTurn(ctx: TurnContext) {
      await gates.get(`${ctx.bot.id}:${ctx.room.id}`)?.promise;
    },
  };
  const ledger: Ledger = createLedger(db);
  const approvals: Approvals = createApprovals(db, ledger);
  const runner: Runner = createRunner({
    db,
    ledger,
    approvals,
    dataDir: dir,
    runtimes: { api: runtime, acp: runtime },
    tools: toExecutors(defs),
  });
  const access: McpAccess = createMcpAccess({
    runner,
    dataDir: dir,
    tools: () => defs.filter((d) => ALLOW.has(d.name)),
    maxWaitMs: opts.maxWaitMs,
    maxCallsPerTurn: opts.maxCallsPerTurn,
  });
  const auth = createAuth({ db, ownerToken: OWNER });
  const app = createGateway({
    db,
    ledger,
    approvals,
    auth,
    dispatch: () => {},
    deskDir: join(dir, "no-desk"),
    mcpAccess: access,
    dataDir: dir,
  });
  const server = await new Promise<Server>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s as Server));
  });
  closers.push(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  /** Starts a turn for (bot, room) and resolves once it is the active turn. `finish` lets it end. */
  async function startTurn(bot: string, room: string, meta?: Parameters<Runner["run"]>[4]) {
    let release!: () => void;
    gates.set(`${bot}:${room}`, { promise: new Promise<void>((r) => (release = r)), release: () => release() });
    const message = ledger.append(room, "user", "message", { text: "go" });
    const done = runner.run(getRoom(db, room)!, getBot(db, bot)!, message, undefined, meta);
    await waitFor(() => runner.activeTurn(bot, room) !== undefined);
    return { turnId: runner.activeTurn(bot, room)!.turnId, finish: async () => { release(); await done; } };
  }

  async function connect(token: string, fetchImpl?: typeof fetch): Promise<Client> {
    const client = new Client({ name: "test", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: fetchImpl,
    });
    await client.connect(transport);
    closers.push(() => client.close().catch(() => undefined));
    return client;
  }

  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as Result;

  const pendingOne = () => approvals.listPending()[0];
  const api = (path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>) } });

  return { db, ledger, approvals, runner, access, auth, computer, fetchMock, pusher, base, startTurn, connect, call, pendingOne, api };
}

type H = Awaited<ReturnType<typeof setup>>;
const mcpPost = (base: string, headers: Record<string, string>) =>
  fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });

function dbDump(db: Db): string {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  return tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t.name}"`).all())).join("\n");
}

describe("POST /mcp authentication", () => {
  test("missing, owner, device, garbage and revoked tokens get 401", async () => {
    const h = await setup();
    expect((await mcpPost(h.base, {})).status).toBe(401);
    expect(await (await mcpPost(h.base, {})).json()).toEqual({ error: "unauthorized" });
    expect((await mcpPost(h.base, { authorization: `Bearer ${OWNER}` })).status).toBe(401);
    const device = h.auth.createDevice("phone");
    expect((await mcpPost(h.base, { authorization: `Bearer ${device.token}` })).status).toBe(401);
    expect((await mcpPost(h.base, { authorization: "Bearer oagt_garbage" })).status).toBe(401);
    const { token } = h.access.issue("boss", "main");
    h.access.revoke("boss", "main");
    expect((await mcpPost(h.base, { authorization: `Bearer ${token}` })).status).toBe(401);
  });

  test("a scoped token is refused by the normal API", async () => {
    const h = await setup();
    const { token } = h.access.issue("boss", "main");
    for (const path of ["/rooms", "/approvals"]) {
      expect((await h.api(path, { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    }
    expect((await h.api("/whoami", { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  test("GET and DELETE /mcp are 405, even with a valid token", async () => {
    const h = await setup();
    const { token } = h.access.issue("boss", "main");
    for (const method of ["GET", "DELETE"]) {
      const res = await fetch(`${h.base}/mcp`, { method, headers: { authorization: `Bearer ${token}` } });
      expect(res.status).toBe(405);
    }
  });

  test("the token and its hash are never stored in the DB or the ledger", async () => {
    const h = await setup();
    const { token } = h.access.issue("boss", "main");
    const turn = await h.startTurn("boss", "main");
    const client = await h.connect(token);
    await client.listTools();
    await turn.finish();
    const dump = dbDump(h.db) + JSON.stringify(h.ledger.list("main", { limit: 500 }));
    expect(dump).not.toContain(token);
    expect(dump).not.toContain(hashToken(token));
  });
});

describe("tool listing and turn binding", () => {
  test("no active turn: tool calls answer isError", async () => {
    const h = await setup();
    const { token } = h.access.issue("boss", "main");
    const client = await h.connect(token);
    const res = await h.call(client, "computer_screenshot");
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe("no active turn for this session");
  });

  test("with an active turn, tools/list shows exactly the enabled allow-listed tools", async () => {
    const h = await setup();
    const { token } = h.access.issue("boss", "main");
    const turn = await h.startTurn("boss", "main");
    const client = await h.connect(token);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(COMPUTER_NAMES);
    setSetting(h.db, "push", { enabled: true, server: "https://ntfy.sh", topic: "openag-abcDEF123_-xyz789", publicUrl: null, includeDetail: false, maxPerHour: 20 });
    const withPush = (await client.listTools()).tools.map((t) => t.name);
    expect(withPush).toContain("notify_user");
    await turn.finish();
  });

  test("a token for one bot cannot use another bot's active turn; bots and rooms stay isolated", async () => {
    const h = await setup();
    const boss = h.access.issue("boss", "main");
    const coder = h.access.issue("coder", "other");
    const bossTurn = await h.startTurn("boss", "main");
    const coderTurn = await h.startTurn("coder", "other");
    const bossClient = await h.connect(boss.token);
    const coderClient = await h.connect(coder.token);

    // Boss has no active turn in "other", and coder none in "main": those pairs must not reach the other's turn.
    const bossInOther = await h.connect(h.access.issue("boss", "other").token);
    const coderInMain = await h.connect(h.access.issue("coder", "main").token);
    expect(textOf(await h.call(bossInOther, "computer_screenshot"))).toBe("no active turn for this session");
    expect(textOf(await h.call(coderInMain, "computer_screenshot"))).toBe("no active turn for this session");
    expect(textOf(await h.call(bossClient, "computer_screenshot"))).toContain("screenshot 1280x800");

    const click = h.call(coderClient, "computer_click", { x: 5, y: 6 });
    await waitFor(() => h.approvals.listPending().length === 1);
    const pending = h.pendingOne()!;
    expect(pending).toMatchObject({ botId: "coder", roomId: "other", turnId: coderTurn.turnId });
    resolveReviewed(h.approvals, pending.id, { kind: "accept" });
    expect(textOf(await click)).toContain("done");
    await bossTurn.finish();
    await coderTurn.finish();
  });

  test("issuing again replaces the old token; revoke and revokeAll invalidate", async () => {
    const h = await setup();
    const first = h.access.issue("boss", "main").token;
    const second = h.access.issue("boss", "main").token;
    expect((await mcpPost(h.base, { authorization: `Bearer ${first}` })).status).toBe(401);
    expect((await mcpPost(h.base, { authorization: `Bearer ${second}` })).status).toBe(200);
    h.access.revokeAll();
    expect((await mcpPost(h.base, { authorization: `Bearer ${second}` })).status).toBe(401);
  });
});

describe("per-turn cap and turn lifecycle", () => {
  test("maxCallsPerTurn stops further calls in the same turn", async () => {
    const h = await setup({ maxCallsPerTurn: 3 });
    const { token } = h.access.issue("boss", "main");
    const turn = await h.startTurn("boss", "main");
    const client = await h.connect(token);
    for (let i = 0; i < 3; i++) expect((await h.call(client, "computer_screenshot")).isError).toBeFalsy();
    const capped = await h.call(client, "computer_screenshot");
    expect(capped.isError).toBe(true);
    expect(textOf(capped)).toBe("tool call limit reached for this turn");
    await turn.finish();
  });

  test("a second turn gets a fresh counter and its own turn id; after the turn, calls are refused", async () => {
    const h = await setup({ maxCallsPerTurn: 3 });
    const { token } = h.access.issue("boss", "main");
    const first = await h.startTurn("boss", "main");
    const client = await h.connect(token);
    for (let i = 0; i < 3; i++) await h.call(client, "computer_screenshot");
    await first.finish();
    expect(textOf(await h.call(client, "computer_screenshot"))).toBe("no active turn for this session");

    const second = await h.startTurn("boss", "main");
    expect(second.turnId).not.toBe(first.turnId);
    expect((await h.call(client, "computer_screenshot")).isError).toBeFalsy();
    const click = h.call(client, "computer_click", { x: 2, y: 2 });
    await waitFor(() => h.approvals.listPending().length === 1);
    expect(h.pendingOne()!.turnId).toBe(second.turnId);
    resolveReviewed(h.approvals, h.pendingOne()!.id, { kind: "accept" });
    await click;
    await second.finish();
  });
});
