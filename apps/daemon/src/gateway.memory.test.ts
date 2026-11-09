import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { type Db, openDb } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger, type Ledger } from "./ledger.js";
import { memoryPath } from "./memory.js";
import { createBot } from "./rooms.js";

const OWNER = "owner-test-token";
const h = (t: string) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });
let dir: string;
let db: Db;
let ledger: Ledger;
let app: ReturnType<typeof createGateway>;
let auth: ReturnType<typeof createAuth>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-gw-mem-"));
  db = openDb(dir);
  createBot(db, { id: "coder", runtime: "api" });
  ledger = createLedger(db);
  auth = createAuth({ db, ownerToken: OWNER });
  const vectors = { indexMemoryFile() {}, indexTurn() {}, embedPending: async () => 0, search: async () => [{ text: "x".repeat(900), source: "MEMORY.md · Coder", distance: 0.1 }] };
  app = createGateway({ db, ledger, approvals: createApprovals(db, ledger), auth, dispatch: () => undefined, deskDir: join(dir, "x"), dataDir: dir, vectors });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const put = (t: string, body: unknown) => app.request("/bots/coder/memory", { method: "PUT", headers: h(t), body: JSON.stringify(body) });

describe("memory routes", () => {
  test("owner writes MEMORY.md redacted; any device reads it; limited devices cannot write", async () => {
    const dev = auth.createDevice("phone");
    expect((await put(dev.token, { text: "x" })).status).toBe(403);
    const res = await put(OWNER, { text: `- repo: open-ag\n- token ${dev.token}\n` });
    expect(res.status).toBe(200);
    expect(readFileSync(memoryPath(dir, "coder"), "utf8")).not.toContain(dev.token);
    const got = (await (await app.request("/bots/coder/memory", { headers: h(dev.token) })).json()) as { text: string; headTokens: number };
    expect(got.text).toContain("open-ag");
    expect(got.headTokens).toBeGreaterThan(0);
    const audit = ledger.list("_system").filter((e) => (e.payload as { action?: string }).action === "memory_edited");
    expect(JSON.stringify(audit)).not.toContain("open-ag");
  });

  test("rejects oversize or non-string text and unknown bots", async () => {
    expect((await put(OWNER, { text: "a".repeat(16 * 1024 + 1) })).status).toBe(400);
    expect((await put(OWNER, { text: 5 })).status).toBe(400);
    expect((await app.request("/bots/nope/memory", { method: "PUT", headers: h(OWNER), body: JSON.stringify({ text: "x" }) })).status).toBe(404);
  });

  test("search clips results and answers 503 when embeddings are not available", async () => {
    const r = (await (await app.request("/memory/search?q=repo&bot=coder", { headers: h(OWNER) })).json()) as { results: { text: string }[] };
    expect(r.results[0]!.text.length).toBe(400);
    expect((await app.request("/memory/search?q=repo&bot=nope", { headers: h(OWNER) })).status).toBe(503);
    expect(((await (await app.request("/memory/search?q=a", { headers: h(OWNER) })).json()) as { results: unknown[] }).results).toEqual([]);
  });
});
