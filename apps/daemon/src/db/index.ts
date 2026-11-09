import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as sqliteVec from "sqlite-vec";
import { migrate } from "./migrate.js";

export type Db = Database.Database;

export const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

export function resolveDataDir(dataDir?: string): string {
  const dir = dataDir ?? process.env.OPENAG_DATA ?? "~/openag-data";
  return dir === "~" || dir.startsWith("~/") ? join(homedir(), dir.slice(1)) : dir;
}

export function openDb(dataDir?: string): Db {
  const dir = resolveDataDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, "openag.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  sqliteVec.load(db);
  migrate(db, MIGRATIONS_DIR);
  return db;
}
