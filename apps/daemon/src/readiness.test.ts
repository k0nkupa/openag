import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { createBackups } from "./backup.js";
import { openDb, type Db } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger } from "./ledger.js";
import { createOps } from "./ops.js";
import { createReadiness } from "./readiness.js";
import { createBot, createRoom } from "./rooms.js";
import { getSetting, setSetting } from "./settings.js";

let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-ready-"));
  db = openDb(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function setup(env: NodeJS.ProcessEnv = {}) {
  const ledger = createLedger(db);
  const auth = createAuth({ db, ownerToken: "owner-ready-token" });
  const backups = createBackups({ db, dataDir: dir, ledger, env });
  const ops = createOps({ db, dataDir: dir, env });
  const readiness = createReadiness({ db, ledger, auth, backups, ops, env });
  const app = createGateway({ db, ledger, approvals: createApprovals(db, ledger), auth, dispatch: () => {}, deskDir: join(dir, "none"), readiness, backups, ops });
  return { ledger, auth, backups, readiness, app, owner: { authorization: "Bearer owner-ready-token" }, dev: { authorization: `Bearer ${auth.createDevice("phone").token}` } };
}
const item = (r: ReturnType<ReturnType<typeof createReadiness>["check"]>, id: string) => r.items.find((i) => i.id === id)!;

describe("readiness", () => {
  test("a fresh install is not ready and every item says how to fix it", () => {
    const { readiness } = setup();
    const r = readiness.check();
    expect(r.ready).toBe(false);
    for (const i of r.items.filter((x) => x.required && !x.done)) expect(i.how.length).toBeGreaterThan(10);
    expect(item(r, "heartbeat").done).toBe(false);
    expect(item(r, "brief").done).toBe(true); // on by default
    expect(item(r, "backup").done).toBe(false);
    expect(item(r, "bots").done).toBe(false);
    expect(item(r, "defaultBot").done).toBe(false); // created on the first service start
    expect(r.items.filter((i) => !i.required).map((i) => i.id)).toEqual(["keepawake", "slack", "webrtc"]);
  });

  test("items flip with the real state: bots, push topic, backup, liveness, device", async () => {
    const { readiness, backups, auth } = setup({ OPENAG_HEALTHCHECK_URL: "https://hc-ping.example/abcd-1234-secret-slug", OPENAG_KEEP_AWAKE: "1" });
    createBot(db, { id: "boss", runtime: "api" });
    expect(item(readiness.check(), "bots").done).toBe(false);
    createBot(db, { id: "coder", runtime: "api" });
    createRoom(db, { id: "main", leadBotId: "boss" });
    expect(item(readiness.check(), "bots").done).toBe(true);
    setSetting(db, "push", { enabled: true, server: "https://ntfy.sh", topic: null, publicUrl: null, includeDetail: false, maxPerHour: 20 });
    expect(item(readiness.check(), "push")).toMatchObject({ done: false, detail: "enabled but no topic" });
    setSetting(db, "push", { enabled: true, server: "https://ntfy.sh", topic: "openag-abcDEF123_-xyz789", publicUrl: null, includeDetail: false, maxPerHour: 20 });
    expect(item(readiness.check(), "push").done).toBe(true);
    await backups.run();
    expect(item(readiness.check(), "backup").done).toBe(true);
    expect(item(readiness.check(), "liveness").done).toBe(true);
    expect(item(readiness.check(), "keepawake").done).toBe(true);
    expect(item(readiness.check(), "device").done).toBe(true); // setup() paired one
    for (const d of auth.listDevices()) auth.revokeDevice(d.id);
    expect(item(readiness.check(), "device").done).toBe(false);
  });

  test("a stale backup does not count", async () => {
    const ledger = createLedger(db);
    const auth = createAuth({ db, ownerToken: "x-owner-token" });
    const backups = createBackups({ db, dataDir: dir, ledger, now: () => new Date(Date.now() - 48 * 3_600_000) });
    await backups.run();
    expect(item(createReadiness({ db, ledger, auth, backups }).check(), "backup").done).toBe(false);
  });

  test("apply enables exactly heartbeat, reflection and brief, is idempotent, audited, and touches nothing secret-bearing", () => {
    const { readiness, ledger } = setup();
    setSetting(db, "brief", { ...getSetting(db, "brief"), enabled: false });
    const first = readiness.apply();
    expect(first.changed.sort()).toEqual(["brief", "heartbeat", "reflection"]);
    expect(getSetting(db, "heartbeat").enabled).toBe(true);
    expect(getSetting(db, "reflection").enabled).toBe(true);
    expect(getSetting(db, "brief").enabled).toBe(true);
    expect(getSetting(db, "push").enabled).toBe(false);
    expect(getSetting(db, "slack").enabled).toBe(false);
    expect(getSetting(db, "rtc").enabled).toBe(false);
    expect(readiness.apply().changed).toEqual([]);
    expect(ledger.list("_system").filter((e) => (e.payload as { action?: string }).action === "readiness_applied")).toHaveLength(1);
  });

  test("routes: reading needs auth, applying is owner-only", async () => {
    const { app, owner, dev } = setup();
    expect((await app.request("/readiness")).status).toBe(401);
    expect((await app.request("/readiness", { headers: dev })).status).toBe(200);
    expect((await app.request("/readiness/apply", { method: "POST", headers: dev })).status).toBe(403);
    expect(getSetting(db, "heartbeat").enabled).toBe(false);
    const res = await app.request("/readiness/apply", { method: "POST", headers: owner });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { changed: string[] }).changed).toContain("heartbeat");
  });
});
