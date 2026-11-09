import Database from "better-sqlite3";
import { chmodSync, copyFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import * as sqliteVec from "sqlite-vec";
import type { Db } from "./db/index.js";
import type { Ledger } from "./ledger.js";
import type { Scheduler } from "./scheduler.js";
import { getSetting, localParts } from "./settings.js";
import { localDateKey } from "./wake.js";

/**
 * Online SQLite backups. A scheduled job copies the live DB with SQLite's backup API (consistent while the daemon runs),
 * verifies the copy, keeps the newest N and optionally mirrors the newest one into `OPENAG_BACKUP_DIR`. The DB already
 * holds only redacted data. Failures are recorded and never reach a turn. Restore is manual (docs/backup.md).
 */

const NAME_RE = /^openag-(\d{8})-(\d{6})\.db$/;
const MINUTE_MS = 60_000;

export interface BackupInfo {
  name: string;
  bytes: number;
  createdAt: number;
}

export interface BackupStatus {
  enabled: boolean;
  dir: string;
  mirror: boolean;
  last: { at: number; ok: boolean; name: string | null; error: string | null } | null;
  backups: BackupInfo[];
}

export interface Backups {
  /** Takes a backup now (also used by the owner-only API). Never throws: the outcome is in the result. */
  run(): Promise<{ ok: boolean; name: string | null; error: string | null }>;
  status(): BackupStatus;
}

export interface BackupDeps {
  db: Db;
  dataDir: string;
  ledger?: Ledger;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  tz?: string;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const stamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

export function createBackups(deps: BackupDeps): Backups {
  const { db } = deps;
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const dir = join(deps.dataDir, "backups");
  let last: BackupStatus["last"] = null;
  const previous = db.prepare("SELECT ts, payload_json FROM events WHERE room_id = '_system' AND actor = 'daemon' AND type = 'config' AND json_extract(payload_json, '$.action') = 'backup' ORDER BY id DESC LIMIT 1").get() as { ts: number; payload_json: string } | undefined;
  if (previous) {
    const payload = JSON.parse(previous.payload_json) as { ok?: unknown; name?: unknown; error?: unknown };
    if (typeof payload.ok === "boolean") last = { at: previous.ts, ok: payload.ok, name: typeof payload.name === "string" && NAME_RE.test(payload.name) ? payload.name : null, error: typeof payload.error === "string" ? payload.error : null };
  }

  let running: Promise<{ ok: boolean; name: string | null; error: string | null }> | null = null;

  /** Existing directory only; never created for the user, and never the data dir itself. */
  function mirrorDir(): string | null {
    const raw = env.OPENAG_BACKUP_DIR;
    if (!raw || !raw.startsWith("/")) return null;
    const abs = resolve(raw);
    try {
      return statSync(abs).isDirectory() && abs !== resolve(deps.dataDir) && abs !== dir ? abs : null;
    } catch {
      return null;
    }
  }

  function list(): BackupInfo[] {
    try {
      return readdirSync(dir)
        .filter((n) => NAME_RE.test(n))
        .map((name) => {
          const st = statSync(join(dir, name));
          return { name, bytes: st.size, createdAt: st.mtimeMs };
        })
        .sort((a, b) => (a.name < b.name ? 1 : -1));
    } catch {
      return [];
    }
  }

  function verify(file: string): void {
    // Writable only so the copy can leave WAL mode: a backup must be ONE self-contained file (no -wal/-shm sidecars).
    const copy = new Database(file);
    try {
      copy.pragma("journal_mode = DELETE");
      sqliteVec.load(copy); // the schema has vec0 tables
      const rows = copy.pragma("integrity_check") as Array<{ integrity_check: string }>;
      if (rows.length !== 1 || rows[0]!.integrity_check !== "ok") throw new Error("integrity check failed");
      const v = copy.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null };
      if (!v.v) throw new Error("backup has no schema");
    } finally {
      copy.close();
    }
  }

  async function runOnce(): Promise<{ ok: boolean; name: string | null; error: string | null }> {
    const t = now();
    let name: string | null = null;
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      name = `openag-${stamp(t)}.db`;
      const tmp = join(dir, `.${name}.partial`);
      rmSync(tmp, { force: true });
      await db.backup(tmp);
      verify(tmp);
      chmodSync(tmp, 0o600);
      for (const sidecar of ["-wal", "-shm"]) rmSync(tmp + sidecar, { force: true });
      renameSync(tmp, join(dir, name)); // only a verified file ever carries a final name
      const keep = getSetting(db, "backup").keep;
      for (const old of list().slice(keep)) rmSync(join(dir, old.name), { force: true });
      const mirror = mirrorDir();
      if (mirror) {
        copyFileSync(join(dir, name), join(mirror, name));
        chmodSync(join(mirror, name), 0o600);
        for (const old of readdirSync(mirror).filter((n) => NAME_RE.test(n)).sort().reverse().slice(keep)) rmSync(join(mirror, old), { force: true });
      }
      last = { at: t.getTime(), ok: true, name, error: null };
    } catch (err) {
      // A fixed vocabulary: never file contents. The partial file is removed so it cannot be mistaken for a backup.
      if (name) for (const suffix of ["", "-wal", "-shm"]) rmSync(join(dir, `.${name}.partial${suffix}`), { force: true });
      const message = err instanceof Error && /integrity|schema/.test(err.message) ? err.message : "backup failed";
      last = { at: t.getTime(), ok: false, name: null, error: message };
    }
    try {
      deps.ledger?.append("_system", "daemon", "config", { action: "backup", ok: last.ok, ...(last.name ? { name: last.name } : {}), ...(last.error ? { error: last.error } : {}) });
    } catch {
      // auditing must never fail a backup
    }
    return { ok: last.ok, name: last.name, error: last.error };
  }

  return {
    run() {
      return (running ??= runOnce().finally(() => void (running = null)));
    },
    status() {
      return { enabled: getSetting(db, "backup").enabled, dir, mirror: mirrorDir() !== null, last, backups: list() };
    },
  };
}

/** True when a backup is due: enabled, past the configured local time, and none exists for this local day yet. */
export function backupDue(db: Db, dataDir: string, at: Date, tz: string): boolean {
  const cfg = getSetting(db, "backup");
  if (!cfg.enabled) return false;
  if (localParts(at, tz).minutes < Number(cfg.time.slice(0, 2)) * 60 + Number(cfg.time.slice(3, 5))) return false;
  const today = localDateKey(at, tz).replace(/-/g, "");
  try {
    return !readdirSync(join(dataDir, "backups")).some((n) => NAME_RE.exec(n)?.[1] === today);
  } catch {
    return true;
  }
}

export function registerBackups(deps: { db: Db; dataDir: string; scheduler: Scheduler; backups: Backups; tz: string }): void {
  let lastAttempt = Number.NEGATIVE_INFINITY;
  deps.scheduler.register({
    id: "backup",
    schedule: { everyMs: () => 5 * MINUTE_MS },
    // A failing backup is retried every 30 minutes, not every tick.
    shouldRun: (at) => at.getTime() - lastAttempt >= 30 * MINUTE_MS && backupDue(deps.db, deps.dataDir, at, deps.tz),
    run: async (at) => {
      lastAttempt = at.getTime();
      await deps.backups.run();
    },
  });
}

