import { closeSync, existsSync, fstatSync, openSync, readSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "./db/index.js";
import { getDefaultRedactor, type Redactor } from "./redact.js";
import type { Scheduler } from "./scheduler.js";

/**
 * Always-on housekeeping:
 * - a dead-man's switch: while a self-check passes (the DB answers; this job itself proves the scheduler runs) the daemon
 *   sends one GET to `OPENAG_HEALTHCHECK_URL` every 5 minutes, so an OUTSIDE service (healthchecks.io, Uptime Kuma) can alert
 *   when the pings stop. The URL is a secret (https only, registered with the redactor, never returned or logged);
 * - bounded service logs: launchd keeps appending to openagd.out.log / openagd.err.log forever, so an hourly job keeps
 *   them small (copy the newest part to `<name>.1`, truncate in place).
 */

const MINUTE_MS = 60_000;
const PING_TIMEOUT_MS = 10_000;
export const LOG_MAX_BYTES = 20 * 1024 * 1024;
export const LOG_KEEP_BYTES = 2 * 1024 * 1024;
export const SERVICE_LOGS = ["openagd.out.log", "openagd.err.log"] as const;

export interface OpsStatus {
  startedAt: number;
  healthcheck: { configured: boolean; lastOkAt: number | null; lastError: string | null };
  logs: { lastRotatedAt: number | null; rotated: number };
}

export interface Ops {
  status(): OpsStatus;
  /** One ping now (tests). Returns whether it was sent and accepted. */
  ping(): Promise<boolean>;
  rotateLogs(): number;
}

export interface OpsDeps {
  db: Db;
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
  redactor?: Redactor;
  maxBytes?: number;
  keepBytes?: number;
}

/**
 * https only, no credentials in the userinfo. The path and query are the secret (a monitor's ping slug), so they must be
 * long enough for the redactor to protect (a URL itself is never registered: the redactor skips values that look like
 * URLs, so the slug is what gets registered).
 */
export function parseHealthcheckUrl(raw: string | undefined): { url: string; secret: string } | null {
  if (!raw || raw.length > 500) return null;
  try {
    const u = new URL(raw);
    const secret = `${u.pathname.replace(/^\/+/, "")}${u.search}`;
    return u.protocol === "https:" && u.username === "" && u.password === "" && secret.length >= 12 && !/\s/.test(secret) ? { url: u.toString(), secret } : null;
  } catch {
    return null;
  }
}

/** Copies the newest `keep` bytes of `file` to `<file>.1` and truncates `file` in place. Returns true when it rotated. */
export function rotateFile(file: string, maxBytes: number, keepBytes: number): boolean {
  try {
    if (!existsSync(file) || statSync(file).size <= maxBytes) return false;
    const fd = openSync(file, "r");
    try {
      const size = fstatSync(fd).size;
      const len = Math.min(keepBytes, size);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      writeFileSync(`${file}.1`, buf, { mode: 0o600 });
    } finally {
      closeSync(fd);
    }
    truncateSync(file, 0);
    return true;
  } catch {
    return false;
  }
}

export function createOps(deps: OpsDeps): Ops {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());
  const doFetch = deps.fetch ?? ((i, o) => fetch(i, o));
  const redactor = deps.redactor ?? getDefaultRedactor();
  const parsed = parseHealthcheckUrl(env.OPENAG_HEALTHCHECK_URL);
  const url = parsed?.url ?? null;
  if (parsed) redactor.addSecret(parsed.secret);
  const startedAt = now();
  let lastOkAt: number | null = null;
  let lastError: string | null = env.OPENAG_HEALTHCHECK_URL && !url ? "OPENAG_HEALTHCHECK_URL must be an https URL with a path of 12+ characters" : null;
  let lastRotatedAt: number | null = null;
  let rotated = 0;

  return {
    async ping() {
      if (!url) return false;
      try {
        deps.db.prepare("SELECT 1").get(); // the self-check: no ping when the DB is not answering
      } catch {
        lastError = "self-check failed";
        return false;
      }
      try {
        const res = await doFetch(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
        if (!res.ok) {
          lastError = `monitor answered ${res.status}`;
          return false;
        }
        lastOkAt = now();
        lastError = null;
        return true;
      } catch {
        lastError = "could not reach the monitor";
        return false;
      }
    },
    rotateLogs() {
      let n = 0;
      for (const name of SERVICE_LOGS) if (rotateFile(join(deps.dataDir, "logs", name), deps.maxBytes ?? LOG_MAX_BYTES, deps.keepBytes ?? LOG_KEEP_BYTES)) n++;
      if (n > 0) {
        rotated += n;
        lastRotatedAt = now();
      }
      return n;
    },
    status() {
      return { startedAt, healthcheck: { configured: url !== null, lastOkAt, lastError }, logs: { lastRotatedAt, rotated } };
    },
  };
}

export function registerOps(deps: { scheduler: Scheduler; ops: Ops }): void {
  deps.scheduler.register({ id: "healthping", schedule: { everyMs: () => 5 * MINUTE_MS }, run: async () => void (await deps.ops.ping()) });
  deps.scheduler.register({ id: "logrotate", schedule: { everyMs: () => 60 * MINUTE_MS }, run: async () => void deps.ops.rotateLogs() });
}
