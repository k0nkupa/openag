import Database from "better-sqlite3";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as sqliteVec from "sqlite-vec";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { backupDue, createBackups } from "./backup.js";
import { openDb, type Db } from "./db/index.js";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { createGateway } from "./gateway.js";
import { createLedger } from "./ledger.js";
import { createScheduler } from "./scheduler.js";
import { registerBackups } from "./backup.js";
import { createBot, createRoom } from "./rooms.js";
import { setSetting } from "./settings.js";

let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-backup-"));
  db = openDb(dir);
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

let clock = new Date(2026, 9, 29, 4, 30, 0);
const make = (env: NodeJS.ProcessEnv = {}) => createBackups({ db, dataDir: dir, env, now: () => new Date(clock), tz: "UTC" });
const files = () => (existsSync(join(dir, "backups")) ? readdirSync(join(dir, "backups")).sort() : []);
const tick = () => void (clock = new Date(clock.getTime() + 1000));

describe("backup", () => {
  test("a backup is a valid, private copy of the live DB with the same rows", async () => {
    const b = make();
    const res = await b.run();
    expect(res).toMatchObject({ ok: true, error: null });
    const file = join(dir, "backups", res.name!);
    expect(statSync(file).mode & 0o077).toBe(0);
    const copy = new Database(file, { readonly: true });
    sqliteVec.load(copy);
    expect((copy.prepare("SELECT id FROM bots").all() as Array<{ id: string }>).map((r) => r.id)).toContain("boss");
    expect((copy.prepare("SELECT id FROM rooms").all() as Array<{ id: string }>).map((r) => r.id)).toContain("main");
    copy.close();
    expect(files().some((n) => n.startsWith("."))).toBe(false);
  });

  test("only the newest `keep` backups are kept", async () => {
    setSetting(db, "backup", { enabled: true, time: "04:00", keep: 2 });
    const b = make();
    for (let i = 0; i < 4; i++) {
      await b.run();
      tick();
    }
    expect(files()).toHaveLength(2);
    expect(b.status().backups).toHaveLength(2);
  });

  test("a failing backup records a fixed error, leaves older backups alone and leaves no partial file", async () => {
    const b = make();
    await b.run();
    tick();
    const before = files();
    chmodSync(join(dir, "backups"), 0o500); // not writable
    const res = await b.run();
    chmodSync(join(dir, "backups"), 0o700);
    expect(res).toMatchObject({ ok: false, error: "backup failed" });
    expect(files()).toEqual(before);
    expect(b.status().last).toMatchObject({ ok: false, error: "backup failed" });
  });

  test("a mirror copy goes only into an existing absolute directory that is not the data dir", async () => {
    const mirror = mkdtempSync(join(tmpdir(), "openag-mirror-"));
    const res = await make({ OPENAG_BACKUP_DIR: mirror }).run();
    expect(readdirSync(mirror)).toEqual([res.name]);
    expect(statSync(join(mirror, res.name!)).mode & 0o077).toBe(0);
    rmSync(mirror, { recursive: true, force: true });
    for (const bad of ["relative/dir", join(tmpdir(), "does-not-exist-openag"), dir, join(dir, "backups")]) {
      expect(make({ OPENAG_BACKUP_DIR: bad }).status().mirror, bad).toBe(false);
    }
  });

  test("concurrent runs share one backup", async () => {
    const b = make();
    const [x, y] = await Promise.all([b.run(), b.run()]);
    expect(x.name).toBe(y.name);
    expect(files()).toHaveLength(1);
  });

  test("due only after the configured time, once per local day, and not when disabled", async () => {
    expect(backupDue(db, dir, new Date(Date.UTC(2026, 9, 29, 3, 59)), "UTC")).toBe(false);
    expect(backupDue(db, dir, new Date(Date.UTC(2026, 9, 29, 4, 0)), "UTC")).toBe(true);
    mkdirSync(join(dir, "backups"), { recursive: true });
    writeFileSync(join(dir, "backups", "openag-20261029-040001.db"), "x");
    expect(backupDue(db, dir, new Date(Date.UTC(2026, 9, 29, 9, 0)), "UTC")).toBe(false);
    expect(backupDue(db, dir, new Date(Date.UTC(2026, 9, 30, 4, 0)), "UTC")).toBe(true);
    setSetting(db, "backup", { enabled: false, time: "04:00", keep: 7 });
    expect(backupDue(db, dir, new Date(Date.UTC(2026, 9, 30, 9, 0)), "UTC")).toBe(false);
  });

  test("the scheduler job runs it when due and retries a failure no faster than 30 minutes", async () => {
    const t0 = new Date(Date.UTC(2026, 9, 29, 5, 0));
    const scheduler = createScheduler({ now: () => t0 });
    const b = make();
    let runs = 0;
    registerBackups({ db, dataDir: dir, scheduler, tz: "UTC", backups: { run: async () => (runs++, b.run()), status: b.status } });
    await scheduler.tick(new Date(t0.getTime() + 6 * 60_000));
    expect(runs).toBe(1);
    expect(files().length).toBe(1);
  });
});

describe("backup routes", () => {
  test("only the owner takes a backup on demand; listing needs auth", async () => {
    const ledger = createLedger(db);
    const auth = createAuth({ db, ownerToken: "owner-backup-token" });
    const app = createGateway({ db, ledger, approvals: createApprovals(db, ledger), auth, dispatch: () => {}, deskDir: join(dir, "none"), backups: createBackups({ db, dataDir: dir, ledger }) });
    const dev = auth.createDevice("phone").token;
    const owner = { authorization: "Bearer owner-backup-token" };
    expect((await app.request("/backups")).status).toBe(401);
    expect((await app.request("/backups/run", { method: "POST", headers: { authorization: `Bearer ${dev}` } })).status).toBe(403);
    const run = await app.request("/backups/run", { method: "POST", headers: owner });
    expect(run.status).toBe(200);
    const list = (await (await app.request("/backups", { headers: { authorization: `Bearer ${dev}` } })).json()) as { backups: Array<{ name: string }>; last: { ok: boolean } };
    expect(list.backups).toHaveLength(1);
    expect(list.last.ok).toBe(true);
    expect(JSON.stringify(ledger.list("_system"))).toContain('"action":"backup"');
  });
});
