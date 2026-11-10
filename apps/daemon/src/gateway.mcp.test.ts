import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { type Db, openDb } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger } from "./ledger.js";
import { createMcpManager, type McpManager } from "./mcp.js";
import { createRedactor } from "./redact.js";
import { createBot, createRoom, addMember } from "./rooms.js";

const TOKEN = "test-token";
const auth = { authorization: `Bearer ${TOKEN}` };
const RESOLVED_HEADER_VALUE = "tok-resolved-value-123456";

let dir: string;
let db: Db;
let mcp: McpManager;
let app: ReturnType<typeof createGateway>;
let authn: ReturnType<typeof createAuth>;
let configText: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "openag-gw-mcp-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  const ledger = createLedger(db);
  configText = JSON.stringify({
    servers: [
      { id: "brave", transport: "stdio", command: "npx", args: ["-y", "x"], env: { BRAVE_API_KEY: "${BRAVE_API_KEY_NOT_SET_IN_TESTS}" } },
      { id: "remote", transport: "http", url: "https://example.com/mcp?k=abc", headers: { Authorization: "Bearer ${MCP_GW_TEST_TOKEN}" } },
      { id: "bad", transport: "http", url: "https://user:pw@example.com/mcp" },
    ],
  });
  writeFileSync(join(dir, "mcp.json"), configText);
  chmodSync(join(dir, "mcp.json"), 0o600);
  mcp = createMcpManager({
    dataDir: dir,
    env: { MCP_GW_TEST_TOKEN: RESOLVED_HEADER_VALUE },
    redactor: createRedactor({ env: {} }),
    connector: async () => {
      throw new Error("no network in tests");
    },
  });
  await mcp.load();
  app = createGateway({
    db,
    ledger,
    approvals: createApprovals(db, ledger),
    auth: (authn = createAuth({ db, ownerToken: TOKEN })),
    dispatch: () => undefined,
    deskDir: join(dir, "no-desk"),
    mcp,
  });
});
afterEach(async () => {
  await mcp.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("MCP API", () => {
  test("requires the bearer token", async () => {
    expect((await app.request("/mcp/servers")).status).toBe(401);
    expect((await app.request("/mcp/reload", { method: "POST" })).status).toBe(401);
  });

  test("GET /mcp/servers returns status only, with no secrets or URLs", async () => {
    const res = await app.request("/mcp/servers", { headers: auth });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { servers: Array<Record<string, unknown>>; configPath: string; entries: { servers: Array<{ id: string; url?: string }> } };
    expect(body.configPath).toBe(join(dir, "mcp.json"));
    expect(body.servers.map((s) => s.id)).toEqual(["brave", "remote", "bad"]);
    expect(body.servers[0]).toEqual({ id: "brave", transport: "stdio", origin: "custom", enabled: true, offerToAgents: true, state: "skipped", detail: "missing env BRAVE_API_KEY_NOT_SET_IN_TESTS", toolCount: 0, tools: [], requirements: ["BRAVE_API_KEY_NOT_SET_IN_TESTS"] });
    for (const s of body.servers) {
      expect(Object.keys(s).sort().every((k) => ["id", "transport", "origin", "enabled", "offerToAgents", "state", "detail", "toolCount", "tools", "requirements"].includes(k))).toBe(true);
    }
    // The status rows never carry URLs or secrets; the owner-only `entries` block holds the editable config, with templates only.
    const text = JSON.stringify(body.servers);
    expect(text).not.toContain("example.com");
    expect(text).not.toContain("abc");
    expect(text).not.toContain("user:pw");
    const full = JSON.stringify(body);
    expect(full).not.toContain(RESOLVED_HEADER_VALUE);
    expect(full).not.toContain(TOKEN);
    expect(full).toContain("Bearer ${MCP_GW_TEST_TOKEN}");
    // Credentials written into a URL by hand are never echoed, even to the owner.
    expect(full).not.toContain("user:pw");
    expect(body.entries.servers.find((s) => s.id === "bad")!.url).toBe("https://example.com/mcp");
  });

  test("a limited device gets status only: no editable entries, URLs or templates", async () => {
    const limited = authn.createDevice("phone");
    const res = await app.request("/mcp/servers", { headers: { authorization: `Bearer ${limited.token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("entries");
    const text = JSON.stringify(body);
    for (const leak of ["example.com", "abc", "user:pw", "${MCP_GW_TEST_TOKEN}", RESOLVED_HEADER_VALUE, TOKEN]) expect(text).not.toContain(leak);
  });

  test("POST /mcp/reload re-reads the file and returns the same body", async () => {
    writeFileSync(join(dir, "mcp.json"), JSON.stringify({ servers: [] }));
    chmodSync(join(dir, "mcp.json"), 0o600);
    const res = await app.request("/mcp/reload", { method: "POST", headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ servers: [], configPath: join(dir, "mcp.json") });
  });

  test("no route creates or modifies servers", async () => {
    const before = readFileSync(join(dir, "mcp.json"), "utf8");
    for (const method of ["PUT", "POST", "PATCH", "DELETE"]) {
      const res = await app.request("/mcp/servers", {
        method,
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ id: "evil", transport: "stdio", command: "sh" }),
      });
      // Owner write routes exist but answer 503 when no writer is wired (as here); no variant may succeed.
      expect([404, 405, 503]).toContain(res.status);
    }
    expect(readFileSync(join(dir, "mcp.json"), "utf8")).toBe(before);
    const body = (await (await app.request("/mcp/servers", { headers: auth })).json()) as { servers: Array<{ id: string }> };
    expect(body.servers.some((s) => s.id === "evil")).toBe(false);
  });
});
