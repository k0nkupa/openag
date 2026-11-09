import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { methods, type RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createApprovals, type Approvals } from "../approvals.js";
import { createAuth } from "../auth.js";
import type { Computer } from "../computer.js";
import { type Db, openDb } from "../db/index.js";
import { createGateway } from "../gateway.js";
import { createLedger, type Ledger } from "../ledger.js";
import { createPermissions, type PermissionPreset } from "../permissions.js";
import { createMcpAccess, MCP_TOOL_NAMES } from "../mcpserver.js";
import { addMember, createBot, createRoom, getBot, getRoom } from "../rooms.js";
import { createComputerTools } from "../tools/computer.js";
import { toExecutors } from "../tools/registry.js";
import { createAcpRuntime } from "./acp.js";
import { fakeAdapter } from "./fake-acp.testkit.js";
import { createRunner, type Runner } from "./runner.js";

/**
 * The double-approval check: a real gateway on port 0, real approvals and runner, a stub computer, and the ACP
 * runtime driving a fake agent that behaves like the Claude adapter (permission request, then the MCP call).
 */

const SHOT = "computer/screens/e2e.png";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-body")]);
const OWNER = "owner-e2e-token";
const CLAUDE_OPTIONS = [
  { optionId: "allow-once", name: "Allow", kind: "allow_once" as const },
  { optionId: "allow-always", name: "Always", kind: "allow_always" as const },
  { optionId: "reject", name: "Reject", kind: "reject_once" as const },
];
const ownClick = (server: string) => ({
  toolCall: {
    toolCallId: "t1",
    title: `mcp__${server}__computer_click`,
    name: `mcp__${server}__computer_click`,
    kind: "other",
    status: "pending",
    rawInput: { x: 5, y: 6 },
    _meta: { claudeCode: { toolName: `mcp__${server}__computer_click`, mcpServer: { name: server, source: "dynamic" } } },
  } as unknown as RequestPermissionRequest["toolCall"],
  options: CLAUDE_OPTIONS,
});

let dir: string;
let db: Db;
const closers: Array<() => Promise<void> | void> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-acp-mcp-e2e-"));
  db = openDb(dir);
  closers.push(() => db.close());
  createBot(db, { id: "coder", runtime: "acp" });
  createRoom(db, { id: "main", leadBotId: "coder" });
  addMember(db, "main", "coder");
});
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
  rmSync(dir, { recursive: true, force: true });
});

type Result = { isError?: boolean; content: Array<Record<string, unknown>> };
const textOf = (r: Result) => r.content.map((c) => (typeof c.text === "string" ? c.text : "")).join("");

test("the ACP prompt is not a second gate: the MCP server decides once per action by permission mode, with no approval prompts", async () => {
  mkdirSync(join(dir, "computer", "screens"), { recursive: true });
  writeFileSync(join(dir, SHOT), PNG);
  let acts = 0;
  const computer = {
    name: "openag-main",
    capabilities: () => ({ shell: true, view: "proxy" as const }),
    peek: () => ({ backend: "cua", requestedBackend: null, configured: true, shell: true, state: "running" as const, observedAt: 1, busy: false, inputBlocked: false }),
    act: async () => (acts++, { message: "done" }),
    shell: async () => ({ exitCode: 0, stdout: "", stderr: "", truncated: false }),
    screenshot: async () => ({ path: SHOT, width: 1280, height: 800 }),
  };
  const defs = createComputerTools(computer as unknown as Computer);
  const ledger: Ledger = createLedger(db);
  const approvals: Approvals = createApprovals(db, ledger);

  // Runner and access refer to each other: the access finds active turns through the holder.
  const runnerRef: { current?: Runner } = {};
  const access = createMcpAccess({
    runner: { activeTurn: (b, r) => runnerRef.current?.activeTurn(b, r) },
    dataDir: dir,
    tools: () => defs.filter((d) => (MCP_TOOL_NAMES as readonly string[]).includes(d.name)),
  });
  const app = createGateway({
    db,
    ledger,
    approvals,
    auth: createAuth({ db, ownerToken: OWNER }),
    dispatch: () => {},
    deskDir: join(dir, "no-desk"),
    mcpAccess: access,
    dataDir: dir,
  });
  const server = await new Promise<Server>((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s as Server));
  });
  closers.push(() => new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Scenario per prompt word: "click" asks through MCP, "shot" takes a screenshot.
  let fakeLog!: ReturnType<typeof fakeAdapter>["log"];
  const results: Array<Result | string> = [];
  const { fake, log } = fakeAdapter(dir, {
    startMode: "default",
    onPrompt: async ({ sessionId, text, client }) => {
      const mcp = fakeLog.mcpServers.at(-1) as Array<{ name: string; url: string; headers: Array<{ value: string }> }>;
      const transport = new StreamableHTTPClientTransport(new URL(mcp[0]!.url), {
        requestInit: { headers: { authorization: mcp[0]!.headers[0]!.value } },
      });
      const mcpClient = new Client({ name: "adapter", version: "1" });
      await mcpClient.connect(transport);
      try {
        if (text.includes("shot")) {
          results.push((await mcpClient.callTool({ name: "computer_screenshot", arguments: {} })) as Result);
        } else if (text.includes("click")) {
          // Claude's adapter asks first (we auto-allow our own tools), then makes the call.
          const decision = await client.request(methods.client.session.requestPermission, { sessionId, ...ownClick(mcp[0]!.name) });
          results.push(decision.outcome.outcome === "selected" ? decision.outcome.optionId : "cancelled");
          results.push((await mcpClient.callTool({ name: "computer_click", arguments: { x: 5, y: 6 } })) as Result);
        }
      } finally {
        await mcpClient.close().catch(() => undefined);
      }
      return "end_turn";
    },
  });
  fakeLog = log;
  const acp = createAcpRuntime({
    dataDir: dir,
    launcher: () => ({ target: fake, close: () => undefined }),
    mcp: { access, baseUrl: () => base, tools: new Set(["computer_click", "computer_screenshot"]) },
  });
  closers.push(() => acp.close());
  const permissions = createPermissions(db, ledger, dir, approvals);
  /** Fresh installs run Workspace Write; remote computer input runs only in Full access. */
  const setPreset = (preset: PermissionPreset) => {
    const current = permissions.ensure("coder", "main");
    if (current.preset !== preset) permissions.select("coder", "main", preset, "fixture-owner", current.revision);
  };
  const runner = createRunner({ db, ledger, approvals, permissions, dataDir: dir, runtimes: { acp }, tools: toExecutors(defs) });
  runnerRef.current = runner;
  const say = (text: string, meta?: Parameters<Runner["run"]>[4]) => {
    const message = ledger.append("main", "user", "message", { text });
    return runner.run(getRoom(db, "main")!, getBot(db, "coder")!, message, undefined, meta);
  };
  const approvalCount = () => (db.prepare("SELECT count(*) AS n FROM approvals").get() as { n: number }).n;

  // 1. Full access: the ACP prompt auto-allows our own tool, the MCP call runs once, and no approval is ever created.
  setPreset("full-access");
  await say("click one");
  expect(approvalCount()).toBe(0);
  expect(results[0]).toBe("allow-once");
  expect((results[1] as Result).isError).toBeFalsy();
  expect(textOf(results[1] as Result)).toContain("done");
  expect(acts).toBe(1);

  // 2. Workspace Write (confined): the daemon gate refuses remote input; the MCP call returns an error, nothing runs, no approval.
  results.length = 0;
  setPreset("workspace-write");
  await say("click two");
  expect(approvalCount()).toBe(0);
  expect((results[1] as Result).isError).toBe(true);
  expect(acts).toBe(1);

  // 3. Screenshot is browse (auto): no approval, and an image block comes back.
  results.length = 0;
  await say("shot now");
  expect(approvalCount()).toBe(0);
  const shot = results[0] as Result;
  expect(shot.isError).toBeFalsy();
  expect(shot.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });

  // 4. Unattended turn: the MCP call is denied by policy, no approval.
  results.length = 0;
  setPreset("full-access");
  await say("click unattended", { unattended: true });
  expect(approvalCount()).toBe(0);
  expect((results[1] as Result).isError).toBe(true);
  expect(acts).toBe(1);

  // 5. No active turn: the same token is refused once the turn has ended.
  const token = fakeLog.mcpServers.at(-1) as Array<{ url: string; headers: Array<{ value: string }> }>;
  const late = new Client({ name: "late", version: "1" });
  await late.connect(new StreamableHTTPClientTransport(new URL(token[0]!.url), { requestInit: { headers: { authorization: token[0]!.headers[0]!.value } } }));
  closers.push(() => late.close().catch(() => undefined));
  const lateResult = (await late.callTool({ name: "computer_click", arguments: { x: 1, y: 1 } })) as Result;
  expect(lateResult.isError).toBe(true);
  expect(textOf(lateResult)).toContain("no active turn");
  expect(approvalCount()).toBe(0);
  expect(acts).toBe(1);
});
