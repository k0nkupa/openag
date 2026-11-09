import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { type Db, openDb } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger, type Ledger } from "./ledger.js";
import { createBot, createRoom } from "./rooms.js";

const OWNER = "owner-test-token";
const owner = { authorization: `Bearer ${OWNER}`, "content-type": "application/json" };

let dir: string;
let db: Db;
let ledger: Ledger;
let app: ReturnType<typeof createGateway>;
let auth: ReturnType<typeof createAuth>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-gw-botset-"));
  db = openDb(dir);
  createBot(db, { id: "coder", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "coder" });
  ledger = createLedger(db);
  auth = createAuth({ db, ownerToken: OWNER });
  app = createGateway({ db, ledger, approvals: createApprovals(db, ledger), auth, dispatch: () => undefined, deskDir: join(dir, "x"), dataDir: dir });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const put = (body: unknown, headers: Record<string, string> = owner) =>
  app.request("/bots/coder/settings", { method: "PUT", headers, body: JSON.stringify(body) });

async function deviceHeaders() {
  const r = await app.request("/devices", { method: "POST", headers: owner, body: JSON.stringify({ name: "phone" }) });
  const { token } = (await r.json()) as { token: string };
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

describe("bot settings", () => {
  test("owner edits name, description, instructions and avatar; /bots exposes avatar but never instructions", async () => {
    const res = await put({ name: "Builder", description: "Builds things", instructions: "Work from TICKETS.md", avatar: { shape: "hexagon", color: "teal" } });
    expect(res.status).toBe(200);
    const list = await (await app.request("/bots", { headers: owner })).json();
    expect(JSON.stringify(list)).not.toContain("TICKETS.md");
    expect((list as { bots: { name: string; avatar: unknown }[] }).bots[0]).toMatchObject({ name: "Builder", avatar: { shape: "hexagon", color: "teal" } });
    const settings = await (await app.request("/bots/coder/settings", { headers: owner })).json();
    expect(settings).toMatchObject({ instructions: "Work from TICKETS.md", description: "Builds things" });
  });

  test("a paired device can change the avatar but not text fields or read instructions", async () => {
    const dev = await deviceHeaders();
    expect((await put({ avatar: { shape: "pill", color: null } }, dev)).status).toBe(200);
    expect((await put({ name: "X" }, dev)).status).toBe(403);
    expect((await app.request("/bots/coder/settings", { headers: dev })).status).toBe(403);
  });

  test("rejects bad input", async () => {
    expect((await put({})).status).toBe(400);
    expect((await put({ name: "" })).status).toBe(400);
    expect((await put({ name: "a".repeat(41) })).status).toBe(400);
    expect((await put({ avatar: { shape: "unknown-shape", color: "red" } })).status).toBe(400);
    expect((await put({ avatar: { shape: "blob", color: "#fff" } })).status).toBe(400);
    expect((await put({ model: "x" })).status).toBe(400);
    expect((await app.request("/bots/nope/settings", { method: "PUT", headers: owner, body: JSON.stringify({ name: "x" }) })).status).toBe(404);
    expect((await app.request("/bots/coder/settings", { method: "PUT", body: "{}" })).status).toBe(401);
  });

  test("null resets the avatar and the audit event never contains the instructions", async () => {
    await put({ avatar: { shape: "blob", color: "red" } });
    await put({ avatar: null, instructions: "secret plan" });
    const list = (await (await app.request("/bots", { headers: owner })).json()) as { bots: { avatar?: unknown }[] };
    expect(list.bots[0]!.avatar).toBeUndefined();
    const audit = ledger.list("_system").filter((e) => (e.payload as { action?: string }).action === "bot_settings");
    expect(audit.length).toBe(2);
    expect(JSON.stringify(audit)).not.toContain("secret plan");
  });
});
