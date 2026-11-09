import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { type Db, openDb } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger } from "./ledger.js";
import { createBot, createRoom } from "./rooms.js";

const OWNER = "owner-test-token";
const json = { "content-type": "application/json" };
const bearer = (t: string) => ({ authorization: `Bearer ${t}`, ...json });

let dir: string;
let db: Db;
let app: ReturnType<typeof createGateway>;
let auth: ReturnType<typeof createAuth>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-gw-access-"));
  db = openDb(dir);
  createBot(db, { id: "coder", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "coder" });
  const ledger = createLedger(db);
  auth = createAuth({ db, ownerToken: OWNER });
  app = createGateway({ db, ledger, approvals: createApprovals(db, ledger), auth, dispatch: () => undefined, deskDir: join(dir, "x"), dataDir: dir });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, token: string, body: unknown = {}) => app.request(path, { method: "POST", headers: bearer(token), body: JSON.stringify(body) });
const rename = (token: string) => app.request("/bots/coder/settings", { method: "PUT", headers: bearer(token), body: JSON.stringify({ name: "X" }) });

describe("device access levels", () => {
  test("devices are limited by default; a full device acts as owner and whoami still says device", async () => {
    const limited = auth.createDevice("phone");
    const full = auth.createDevice("mac", "owner", "full");
    expect((await rename(limited.token)).status).toBe(403);
    expect((await rename(full.token)).status).toBe(200);
    const who = await (await app.request("/whoami", { headers: bearer(full.token) })).json();
    expect(who).toMatchObject({ kind: "device", access: "full" });
  });

  test("the desk's owner-token login can mint a full device; no access means limited", async () => {
    const a = (await (await post("/devices", OWNER, { name: "mac", access: "full" })).json()) as { token: string };
    expect((await rename(a.token)).status).toBe(200);
    const b = (await (await post("/devices", OWNER, { name: "p" })).json()) as { token: string };
    expect((await rename(b.token)).status).toBe(403);
  });

  test("full pairing codes need the owner; the code decides the new device's access", async () => {
    const limited = auth.createDevice("phone");
    expect((await post("/devices/pairing-codes", limited.token, { access: "full" })).status).toBe(403);
    const lim = (await (await post("/devices/pairing-codes", limited.token)).json()) as { code: string };
    const fullCode = (await (await post("/devices/pairing-codes", OWNER, { access: "full" })).json()) as { code: string };
    const redeem = async (code: string) => ((await (await app.request("/pair", { method: "POST", headers: json, body: JSON.stringify({ code, name: "new" }) })).json()) as { token: string }).token;
    expect((await rename(await redeem(lim.code))).status).toBe(403);
    expect((await rename(await redeem(fullCode.code))).status).toBe(200);
  });

  test("only the owner changes access, and the change takes effect and is revocable", async () => {
    const limited = auth.createDevice("phone");
    const other = auth.createDevice("tablet");
    expect((await app.request(`/devices/${other.device.id}`, { method: "PATCH", headers: bearer(limited.token), body: JSON.stringify({ access: "full" }) })).status).toBe(403);
    expect((await app.request(`/devices/${other.device.id}`, { method: "PATCH", headers: bearer(OWNER), body: JSON.stringify({ access: "root" }) })).status).toBe(400);
    expect((await app.request(`/devices/${other.device.id}`, { method: "PATCH", headers: bearer(OWNER), body: JSON.stringify({ access: "full" }) })).status).toBe(200);
    expect((await rename(other.token)).status).toBe(200);
    await app.request(`/devices/${other.device.id}`, { method: "PATCH", headers: bearer(OWNER), body: JSON.stringify({ access: "limited" }) });
    expect((await rename(other.token)).status).toBe(403);
    const list = (await (await app.request("/devices", { headers: bearer(OWNER) })).json()) as { devices: { id: string; access: string }[] };
    expect(list.devices.find((d) => d.id === other.device.id)?.access).toBe("limited");
  });
});
