import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { type Db, MIGRATIONS_DIR, openDb } from "./index.js";
import { migrate } from "./migrate.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-db-"));
  db = openDb(dir);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("journal_mode is wal", () => {
  expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
});

test("running migrations twice is a no-op", () => {
  const count = () => (db.prepare("SELECT COUNT(*) AS n FROM schema_version").get() as { n: number }).n;
  const before = count();
  expect(before).toBeGreaterThan(0);
  migrate(db, MIGRATIONS_DIR);
  expect(count()).toBe(before);
});

test("vec_version() returns a non-empty string", () => {
  const row = db.prepare("SELECT vec_version() AS v").get() as { v: string };
  expect(row.v).toBeTruthy();
});

test("migration 003 creates the devices and pairing_codes tables", () => {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
    (r) => r.name,
  );
  expect(tables).toEqual(expect.arrayContaining(["devices", "pairing_codes"]));
  const v = db.prepare("SELECT name FROM schema_version WHERE version = 3").get() as { name: string } | undefined;
  expect(v?.name).toBe("003_devices.sql");
});
