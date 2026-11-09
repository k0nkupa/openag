import { appendFileSync, closeSync, constants, existsSync, fstatSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { managedPath } from "./package-files.js";
import { MCP_CONFIG_MAX, readMcpConfig } from "./mcp-config.js";

/** The one writer of `mcp.json`, shared by the local setup command and the daemon so both obey the same lock, digest and backup rules. */

export type McpConfigRead = ReturnType<typeof readMcpConfig>;
export type McpConfigValue = McpConfigRead["value"];

/** Another writer holds the lock (or a crashed one left it behind: it is never removed automatically). */
export class McpConfigBusyError extends Error {}
/** The file changed since the caller reviewed it. */
export class McpConfigConflictError extends Error {}
/** The audit file is unsafe or full. Raised BEFORE any change, so a refused audit never leaves a half-applied write. */
export class McpAuditError extends Error {}

export const SETUP_LOCK = ".integration-setup.lock";

export function ensureDirectory(root: string, relative: string) {
  const path = managedPath(root, relative); mkdirSync(path, { recursive: true, mode: 0o700 }); managedPath(root, relative); return path;
}

export function audit(root: string, event: Record<string, unknown>) {
  const path = managedPath(root, "setup-audit.jsonl"), fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size > 256 * 1024 || (st.mode & 0o077) || (typeof process.getuid === "function" && st.uid !== process.getuid())) throw new McpAuditError("setup audit file is unsafe or full; archive it locally before retrying");
    const line = JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n";
    if (st.size + Buffer.byteLength(line) > 256 * 1024) throw new McpAuditError("setup audit file is full; archive it locally before retrying");
    appendFileSync(fd, line);
  } finally { closeSync(fd); }
}

/** The exact bytes written for a config value, shared so a caller can digest what it wrote without re-reading the file. */
export const serializeConfig = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value, null, 2) + "\n");

/** Replaces `mcp.json` only if it still has the reviewed digest: backup first, staged file, a second digest check, then rename. */
export function writeConfig(root: string, expectedDigest: string | undefined, value: Record<string, unknown>, before: McpConfigRead) {
  const bytes = serializeConfig(value);
  if (bytes.length > MCP_CONFIG_MAX) throw Error("updated MCP configuration would be too large");
  if (before.digest !== expectedDigest || readMcpConfig(root).digest !== expectedDigest) throw new McpConfigConflictError("MCP configuration changed since review; review again before setup");
  let backup: string | null = null;
  if (before.bytes) {
    const folder = ensureDirectory(root, "setup-backups"); backup = `mcp-${randomUUID()}.json`;
    writeFileSync(join(folder, backup), before.bytes, { flag: "wx", mode: 0o600 });
  }
  const stage = managedPath(root, `.mcp-${randomUUID()}.tmp`);
  writeFileSync(stage, bytes, { flag: "wx", mode: 0o600 });
  try {
    if (readMcpConfig(root).digest !== expectedDigest) throw new McpConfigConflictError("MCP configuration changed during setup; no configuration was replaced");
    managedPath(root, "mcp.json"); renameSync(stage, join(root, "mcp.json"));
  } finally { if (existsSync(stage)) rmSync(stage); }
  return backup;
}

const LOCK_TRIES = 40, LOCK_WAIT_MS = 100;
/** Holds the exclusive local-writer lock (a directory, created atomically). Waits briefly for a running writer; never steals a lock. */
export async function withSetupLock<T>(root: string, fn: () => T | Promise<T>): Promise<T> {
  const lock = managedPath(root, SETUP_LOCK);
  for (let attempt = 0; ; attempt++) {
    try { mkdirSync(lock, { mode: 0o700 }); break; }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (attempt >= LOCK_TRIES) throw new McpConfigBusyError(`another MCP configuration change is running, or a stale ${SETUP_LOCK} directory was left in the data directory; remove it only after confirming no setup is running`);
      await new Promise(resolve => setTimeout(resolve, LOCK_WAIT_MS));
    }
  }
  try { return await fn(); }
  finally { rmSync(lock, { recursive: true, force: true }); }
}

export interface McpConfigUpdate<T> {
  /** Receives the current file contents and returns the full next value plus whatever the caller wants back. */
  mutate: (current: McpConfigRead) => { next: McpConfigValue; result: T;rollback?:()=>void };
  /** Digest the caller reviewed. A different current digest is a conflict (409), not a silent overwrite. */
  expectedDigest?: string;
  auditEvent: Record<string, unknown>;
}

/**
 * Lock, read strictly, mutate, audit `started`, write with a backup, audit the outcome. A refused audit stops the write before
 * anything changes; once the file has been replaced nothing here throws, so the caller always goes on to apply the change.
 */
export function updateMcpConfig<T>(root: string, update: McpConfigUpdate<T>): Promise<{ result: T; digest: string; backup: string | null }> {
  return withSetupLock(root, () => {
    const before = readMcpConfig(root);
    if (update.expectedDigest !== undefined && update.expectedDigest !== before.digest) throw new McpConfigConflictError("MCP configuration changed since review; review again before saving");
    const { next, result, rollback } = update.mutate(before);
    try {
    audit(root, { ...update.auditEvent, outcome: "started" });
    let backup: string | null;
    try { backup = writeConfig(root, before.digest, next, before); }
    catch (err) { try { audit(root, { ...update.auditEvent, outcome: "failed" }); } catch { /* the original failure is what matters */ } throw err; }
    try { audit(root, { ...update.auditEvent, outcome: "completed" }); } catch { /* the file is already replaced; the `started` record stands */ }
    return { result, digest: createHash("sha256").update(serializeConfig(next)).digest("hex"), backup };
    } catch(error){rollback?.();throw error;}
  });
}
