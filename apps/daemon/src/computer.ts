import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Ledger } from "./ledger.js";
import { getDefaultRedactor } from "./redact.js";

export type ComputerState = "absent" | "running" | "stopped" | "unknown";

export interface ComputerObservation {
  backend: string;
  requestedBackend: string | null;
  configured: boolean;
  shell: boolean | null;
  state: ComputerState | "not_observed";
  observedAt: number | null;
  busy: boolean;
  inputBlocked: boolean;
}

export type ComputerStatus = {
  /** Which backend answered: cua | browserbase | docker | ssh. */
  backend: string;
  name: string;
  exists: boolean;
  state: ComputerState;
  status: string | null;
  image: string | null;
  kind: string | null;
  runtime: string | null;
  busy: boolean;
  lastError: string | null;
};

export interface ComputerScreenshot {
  path: string;
  width: number;
  height: number;
}

export type ComputerErrorCode = "not_found" | "failed" | "timeout" | "bad_output" | "paused";

export interface ShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  /** cua reports a --timeout as exit 1, like a failing command; this flags it when the time limit was reached. */
  timedOut: boolean;
}

export class ComputerError extends Error {
  readonly code: ComputerErrorCode;
  constructor(code: ComputerErrorCode, message: string) {
    super(message);
    this.name = "ComputerError";
    this.code = code;
  }
}

export interface RunResult {
  /** Exit code, or null when the process did not exit normally (timeout, spawn failure). */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type Runner = (
  bin: string,
  args: readonly string[],
  opts: { timeoutMs: number; env: NodeJS.ProcessEnv },
) => Promise<RunResult>;

export interface Computer {
  readonly name: string;
  /** Cached facts only: no refresh, locking, backend switch or lifecycle operation. */
  peek?(): ComputerObservation;
  status(): Promise<ComputerStatus>;
  start(): Promise<ComputerStatus>;
  stop(): Promise<ComputerStatus>;
  destroy(): Promise<ComputerStatus>;
  screenshot(): Promise<ComputerScreenshot>;
  /** One `cua do` action (argv after `do`), on the global target. Serialised, guarded by inputGuard. */
  act(args: string[], assertPermission?:()=>void): Promise<{ message: string }>;
  /** Runs a command inside the sandbox. A non-zero exit code is a result, not an error. */
  shell(command: string, timeoutSec: number, assertPermission?:()=>void): Promise<ShellResult>;
  setInputGuard(fn: InputGuard | undefined): void;
  capabilities(): ComputerCapabilities;
  /**
   * A fresh viewer link for the sandbox: the loopback origin of its viewer server plus the URL fragment that carries
   * the viewer's bearer ticket. The ticket is a credential: callers must never log or store it.
   */
  viewLink(): Promise<ComputerViewLink>;
  withLock<T>(fn: () => Promise<T>): Promise<T>;
  /** True while a computer call holds the lock or waits for it. Never blocks. */
  busy(): boolean;
}

/** What a backend can do. The tools and the desk adapt to it instead of failing at call time. */
export interface ComputerCapabilities {
  shell: boolean;
  /** A billed remote session (e.g. a hosted browser): released when the backend is switched away from or the daemon stops. */
  hosted?: boolean;
  /** How a human can take over: through the daemon's loopback viewer proxy, an external (https) live-view link, or not at all. */
  view: "proxy" | "external" | "none";
}

export type ComputerViewLink =
  | {
      kind?: "proxy";
      origin: string;
      /** The URL fragment without the leading `#` (holds the ticket). */
      fragment: string;
      /** Unix ms. */
      expiresAt: number;
    }
  | {
      /** A live-view link on the backend's own https host. A credential: shown only to the takeover caller. */
      kind: "external";
      url: string;
      expiresAt: number;
    };

/** Returns a reason string to pause input (act, shell), or null to allow it. Screenshots and status are never guarded. */
export type InputGuard = () => string | null;

export interface ComputerOptions {
  dataDir: string;
  cuaBin?: string;
  name?: string;
  ledger?: Ledger;
  run?: Runner;
  inputGuard?: InputGuard;
  /** Test knobs for the start/stop wait loops. */
  timing?: { pollMs?: number; startWaitMs?: number; stopWaitMs?: number; destroyRetryMs?: number };
}

const VIEW_TIMEOUT_MS = 15_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export const NOT_RUNNING_MESSAGE = "computer is not running";

const NAME_RE = /^[a-z][a-z0-9-]{0,30}$/;
const CHILD_ENV_KEYS = ["PATH", "HOME", "LANG", "TMPDIR"] as const;
export const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const SCREEN_MIN_BYTES = 100;
export const SCREEN_MAX_BYTES = 20 * 1024 * 1024;
const SCREEN_KEEP = 50;
const SCREEN_NAME_RE = /^\d{8}-\d{6}-\d{3}(?:-\d+)?\.png$/;
const CREATE_TIMEOUT_MS = 15 * 60_000;
const CLI_TIMEOUT_MS = 60_000;
const SCREENSHOT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 1000;
const DEFAULT_START_WAIT_MS = 60_000;
const DEFAULT_STOP_WAIT_MS = 30_000;
export const MAX_MESSAGE = 200;
const EXIT_NOT_FOUND = 3;
const EXIT_USAGE = 2;
const DESTROY_ATTEMPTS = 3;
const ACT_TIMEOUT_MS = 30_000;
export const SHELL_OUTPUT_CAP = 8_000;

/** The CLI only ever sees these four variables; the daemon's full environment holds the owner token and API keys. */
export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV_KEYS) {
    const value = base[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export const defaultRunner: Runner = (bin, args, opts) =>
  new Promise((resolveRun) => {
    execFile(
      bin,
      [...args],
      { timeout: opts.timeoutMs, env: opts.env, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (!err) {
          resolveRun({ code: 0, stdout: String(stdout), stderr: String(stderr), timedOut: false });
          return;
        }
        const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
        const timedOut = e.killed === true && e.signal != null;
        const code = typeof e.code === "number" ? e.code : null;
        // A missing binary is a setup problem, not a CLI failure: say so instead of Node's "spawn cua ENOENT".
        const missing = e.code === "ENOENT" ? `${basename(bin)} is not installed` : undefined;
        resolveRun({
          code,
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: missing ?? (typeof stderr === "string" && stderr !== "" ? stderr : e.message),
          timedOut,
        });
      },
    );
  });

/** First line of the CLI's own output, clipped and redacted. Never the command line or environment. */
function shortMessage(res: RunResult, fallback: string): string {
  const text = [res.stderr, res.stdout].find((s) => s.trim() !== "") ?? "";
  const firstLine = (text.split("\n").find((l) => l.trim() !== "") ?? "").trim();
  const clipped = (firstLine || fallback).slice(0, MAX_MESSAGE);
  return getDefaultRedactor().redactString(clipped);
}

function errorFromResult(res: RunResult, what: string): ComputerError {
  if (res.timedOut) return new ComputerError("timeout", `${what} timed out`);
  const code: ComputerErrorCode = res.code === EXIT_NOT_FOUND ? "not_found" : "failed";
  return new ComputerError(code, shortMessage(res, `${what} failed`));
}

/**
 * First non-empty line of a `cua do` result (the `✅`/`❌` line). stderr is used only when it is not Node's
 * "Command failed: <argv>" wrapper, which would echo typed text.
 */
/**
 * The status line of a `cua do` call. Real cua prints a success line (`✅ ...`) on stdout but the failure reason
 * (`❌ ...`) on STDERR, and always ends stdout with a footer line (`💻 <target> 🔍 zoom: off`) that is not a message.
 */
function cuaDoLine(res: RunResult): string {
  const lines = [...res.stderr.split("\n"), ...res.stdout.split("\n")]
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("💻") && !l.startsWith("Command failed:"));
  return lines.find((l) => l.startsWith("❌") || l.startsWith("✅")) ?? lines[0] ?? "";
}

function actError(res: RunResult, what: string): ComputerError {
  if (res.timedOut) return new ComputerError("timeout", `${what} timed out`);
  if (res.code === EXIT_USAGE) return new ComputerError("failed", "invalid arguments");
  const line = cuaDoLine(res).replace(/^❌\s*/, "").slice(0, MAX_MESSAGE);
  const msg = getDefaultRedactor().redactString(line || `${what} failed`);
  return new ComputerError(res.code === EXIT_NOT_FOUND ? "not_found" : "failed", msg);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function timestampName(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${p(now.getMilliseconds(), 3)}`
  );
}

/** Reads width/height from the IHDR chunk, or null when the bytes are not a PNG header. */
export function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_MAGIC)) return null;
  if (buf.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

export function createComputer(opts: ComputerOptions): Computer {
  const cuaBin = opts.cuaBin ?? process.env.CUA_BIN ?? "cua";
  const name = opts.name ?? process.env.OPENAG_COMPUTER_NAME ?? "openag-main";
  if (!NAME_RE.test(name)) throw new Error("invalid computer name: must match ^[a-z][a-z0-9-]{0,30}$");
  const run: Runner = opts.run ?? defaultRunner;
  const ledger = opts.ledger;
  const dataDir = resolve(opts.dataDir);
  const pollMs = opts.timing?.pollMs ?? DEFAULT_POLL_MS;
  const startWaitMs = opts.timing?.startWaitMs ?? DEFAULT_START_WAIT_MS;
  const stopWaitMs = opts.timing?.stopWaitMs ?? DEFAULT_STOP_WAIT_MS;
  const destroyRetryMs = opts.timing?.destroyRetryMs ?? 2000;
  let inputGuard: InputGuard | undefined = opts.inputGuard;

  let tail: Promise<void> = Promise.resolve();
  let pending = 0;
  let lastError: string | null = null;
  let observedAt: number | null = null;
  let last: Omit<ComputerStatus, "busy" | "lastError" | "backend"> = {
    name,
    exists: false,
    state: "absent",
    status: null,
    image: null,
    kind: null,
    runtime: null,
  };

  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    pending++;
    const run = tail.then(async () => {
      try {
        return await fn();
      } finally {
        pending--;
      }
    });
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** `inLock`: the caller holds the lock itself, so its own slot does not count as busy. */
  function snapshot(inLock = false): ComputerStatus {
    return { backend: "cua", ...last, busy: pending > (inLock ? 1 : 0), lastError };
  }

  function observe(info: Record<string, unknown> | null): void {
    observedAt = Date.now();
    if (!info) {
      last = { name, exists: false, state: "absent", status: null, image: null, kind: null, runtime: null };
      return;
    }
    const state: ComputerState =
      info.state === "running" && info.status === "ready"
        ? "running"
        : info.state === "stopped"
          ? "stopped"
          : "unknown";
    last = {
      name,
      exists: true,
      state,
      status: str(info.status),
      image: str(info.image),
      kind: str(info.kind),
      runtime: str(info.runtime),
    };
  }

  /** Only the CLI's not-found exit establishes absence; malformed output is uncertain. */
  async function readInfo(): Promise<Record<string, unknown> | null> {
    const res = await run(cuaBin, ["sandbox", "info", name, "--json"], { timeoutMs: CLI_TIMEOUT_MS, env: childEnv() });
    if (res.code === EXIT_NOT_FOUND) return null;
    if (res.timedOut || res.code !== 0) throw errorFromResult(res, "status check");
    try {
      const info = asRecord(JSON.parse(res.stdout));
      if (!info || typeof info.state !== "string" || info.status != null && typeof info.status !== "string") throw new Error("Invalid info");
      return info;
    } catch {
      throw new ComputerError("bad_output", "Computer status could not be understood. Refresh status before any lifecycle action.");
    }
  }

  async function refresh(): Promise<void> {
    observe(await readInfo());
  }

  async function waitFor(target: "running" | "stopped", waitMs: number): Promise<ComputerStatus> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      await refresh();
      if (last.state === target) return snapshot(true);
      if (Date.now() >= deadline) return { ...snapshot(true), state: "unknown" };
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  function audit(action: string): void {
    ledger?.append("_system", "user", "config", { action, name });
  }

  /** Lifecycle calls record their failure as lastError (and rethrow); success clears it. */
  function lifecycle(fn: () => Promise<unknown>): Promise<ComputerStatus> {
    return withLock(async () => {
      try {
        await fn();
        lastError = null;
        return snapshot(true);
      } catch (err) {
        lastError = err instanceof ComputerError ? err.message : "computer call failed";
        throw err;
      }
    });
  }

  /** Checked before any CLI call of act/shell, including inside the lock, so a pause applies to queued calls too. */
  function assertNotPaused(): void {
    const why = inputGuard?.();
    if (typeof why === "string") throw new ComputerError("paused", why);
  }

  return {
    name,

    peek: () => ({ backend: "cua", requestedBackend: null, configured: true, shell: true, state: observedAt === null ? "not_observed" : last.state, observedAt, busy: pending > 0, inputBlocked: typeof inputGuard?.() === "string" }),

    busy: () => pending > 0,

    withLock,

    setInputGuard(fn) {
      inputGuard = fn;
    },

    capabilities: () => ({ shell: true, view: "proxy" }),

    async act(args,assertPermission) {
      return withLock(async () => {
        assertNotPaused();
        await refresh();
        if (last.state !== "running") throw new ComputerError("failed", NOT_RUNNING_MESSAGE);
        // The target is global machine state another process may change: select it on every call.
        const sw = await run(cuaBin, ["do", "switch", name], { timeoutMs: ACT_TIMEOUT_MS, env: childEnv() });
        if (sw.timedOut || sw.code !== 0) throw actError(sw, "select computer");
        assertPermission?.();
        const res = await run(cuaBin, ["do", ...args], { timeoutMs: ACT_TIMEOUT_MS, env: childEnv() });
        if (res.timedOut || res.code !== 0) throw actError(res, "action");
        const line = cuaDoLine(res).replace(/^✅\s*/, "").slice(0, MAX_MESSAGE);
        return { message: getDefaultRedactor().redactString(line || "done") };
      });
    },

    async shell(command, timeoutSec,assertPermission) {
      return withLock(async (): Promise<ShellResult> => {
        assertNotPaused();
        await refresh();
        if (last.state !== "running") throw new ComputerError("failed", NOT_RUNNING_MESSAGE);
        assertPermission?.();
        const startedAt = Date.now();
        const res = await run(cuaBin, ["sandbox", "exec", name, "--timeout", String(timeoutSec), "--", command], {
          timeoutMs: (timeoutSec + 10) * 1000,
          env: childEnv(),
        });
        const elapsedMs = Date.now() - startedAt;
        if (res.timedOut) throw new ComputerError("timeout", "shell timed out");
        if (res.code === null) throw new ComputerError("failed", "shell failed");
        const stderr = res.stderr.startsWith("Command failed:") ? "" : res.stderr; // Node's wrapper echoes the command
        if (res.code === EXIT_NOT_FOUND && res.stdout === "" && (stderr === "" || stderr.startsWith("cua:"))) {
          throw new ComputerError("not_found", "sandbox not found");
        }
        const out = getDefaultRedactor().redactString(res.stdout);
        const err = getDefaultRedactor().redactString(stderr);
        return {
          exitCode: res.code,
          stdout: out.slice(0, SHELL_OUTPUT_CAP),
          stderr: err.slice(0, SHELL_OUTPUT_CAP),
          truncated: out.length > SHELL_OUTPUT_CAP || err.length > SHELL_OUTPUT_CAP,
          timedOut: res.code === 1 && elapsedMs >= timeoutSec * 1000 - 250,
        };
      });
    },

    async status() {
      if (pending > 0) return snapshot(); // never wait behind a lifecycle call
      return withLock(async () => {
        await refresh();
        return snapshot(true);
      });
    },

    start: () =>
      lifecycle(async () => {
        await refresh();
        if (last.state === "running") return snapshot(true);
        if (!last.exists) {
          const res = await run(
            cuaBin,
            ["sandbox", "create", "linux", "--tier", "slim", "--browser", "--name", name, "--json", "--wait", "desktop"],
            { timeoutMs: CREATE_TIMEOUT_MS, env: childEnv() },
          );
          if (res.timedOut || res.code !== 0) throw errorFromResult(res, "create");
          audit("computer_created");
        } else {
          const res = await run(cuaBin, ["sandbox", "resume", name], { timeoutMs: CLI_TIMEOUT_MS, env: childEnv() });
          if (res.timedOut || res.code !== 0) throw errorFromResult(res, "resume");
          audit("computer_started");
        }
        return waitFor("running", startWaitMs);
      }),

    stop: () =>
      lifecycle(async () => {
        await refresh();
        if (last.state === "absent" || last.state === "stopped") return snapshot(true);
        const res = await run(cuaBin, ["sandbox", "suspend", name], { timeoutMs: CLI_TIMEOUT_MS, env: childEnv() });
        if (res.timedOut || res.code !== 0) throw errorFromResult(res, "suspend");
        audit("computer_stopped");
        return waitFor("stopped", stopWaitMs);
      }),

    destroy: () =>
      lifecycle(async () => {
        await refresh();
        if (last.state === "absent") return snapshot(true);
        // Real cua is flaky here: after a suspend/resume cycle the first `rm` can fail on a stale container and a
        // retry succeeds. Retry a few times, and trust only a follow-up `info`, not the exit code alone.
        const isAbsent = (): boolean => last.state === "absent"; // refresh() mutates `last`; keep TS from narrowing
        let lastRes: Awaited<ReturnType<typeof run>> | undefined;
        for (let attempt = 0; attempt < DESTROY_ATTEMPTS; attempt++) {
          if (attempt > 0) await new Promise((r) => setTimeout(r, destroyRetryMs));
          lastRes = await run(cuaBin, ["sandbox", "rm", name, "-f"], { timeoutMs: CLI_TIMEOUT_MS, env: childEnv() });
          if (lastRes.code === 0 || lastRes.code === EXIT_NOT_FOUND) {
            await refresh();
            if (isAbsent()) {
              audit("computer_destroyed");
              return snapshot(true);
            }
          }
        }
        throw errorFromResult(lastRes!, "destroy");
      }),

    viewLink() {
      return withLock(async (): Promise<ComputerViewLink> => {
        await refresh();
        if (last.state !== "running") throw new ComputerError("failed", NOT_RUNNING_MESSAGE);
        const res = await run(cuaBin, ["sandbox", "view", name, "--no-open", "--ttl", "30m", "--json"], {
          timeoutMs: VIEW_TIMEOUT_MS,
          env: childEnv(),
        });
        if (res.timedOut) throw new ComputerError("timeout", "viewer link timed out");
        if (res.code !== 0) throw new ComputerError("failed", "viewer link failed");
        // Never put the output in an error: it holds the ticket.
        const bad = () => new ComputerError("bad_output", "unexpected viewer link");
        let parsed: unknown;
        try {
          parsed = JSON.parse(res.stdout.trim().split("\n").pop() ?? "");
        } catch {
          throw bad();
        }
        const rec = asRecord(parsed);
        if (!rec || typeof rec.url !== "string" || typeof rec.expires_at_unix !== "number") throw bad();
        let url: URL;
        try {
          url = new URL(rec.url);
        } catch {
          throw bad();
        }
        if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname) || url.username || url.password) throw bad();
        const fragment = url.hash.replace(/^#/, "");
        if (!fragment) throw bad();
        return { origin: url.origin, fragment, expiresAt: rec.expires_at_unix * 1000 };
      });
    },

    screenshot() {
      return withLock(async (): Promise<ComputerScreenshot> => {
        await refresh();
        if (last.state !== "running") throw new ComputerError("failed", NOT_RUNNING_MESSAGE);

        const dir = join(dataDir, "computer", "screens");
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        chmodSync(join(dataDir, "computer"), 0o700);
        chmodSync(dir, 0o700);

        let file = `${timestampName(new Date())}.png`;
        for (let n = 1; statSyncSafe(join(dir, file)); n++) file = `${timestampName(new Date())}-${n}.png`;
        const abs = join(dir, file);

        const res = await run(cuaBin, ["sandbox", "screenshot", name, "-o", abs, "--json"], {
          timeoutMs: SCREENSHOT_TIMEOUT_MS,
          env: childEnv(),
        });
        if (res.timedOut || res.code !== 0) {
          rmSync(abs, { force: true });
          throw errorFromResult(res, "screenshot");
        }

        const fail = (why: string): ComputerError => {
          rmSync(abs, { force: true });
          return new ComputerError("bad_output", why);
        };
        const size = statSyncSafe(abs) ? statSync(abs).size : -1;
        if (size < SCREEN_MIN_BYTES || size > SCREEN_MAX_BYTES) throw fail("screenshot file has an unexpected size");
        const buf = readFileSync(abs);
        const fromHeader = pngSize(buf);
        if (!buf.subarray(0, 8).equals(PNG_MAGIC) || !fromHeader) throw fail("screenshot is not a PNG");

        let width = fromHeader.width;
        let height = fromHeader.height;
        try {
          const json = asRecord(JSON.parse(res.stdout));
          if (json && Number.isInteger(json.width) && Number.isInteger(json.height) && (json.width as number) > 0 && (json.height as number) > 0) {
            width = json.width as number;
            height = json.height as number;
          }
        } catch {
          /* fall back to the IHDR values */
        }

        pruneScreens(dir);
        return { path: join("computer", "screens", file), width, height };
      });
    },
  };
}

export function statSyncSafe(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Keeps the newest SCREEN_KEEP screenshots. Only files named like ours are ever deleted. */
export function pruneScreens(dir: string): void {
  const names = readdirSync(dir).filter((n) => SCREEN_NAME_RE.test(n)).sort();
  for (const old of names.slice(0, Math.max(0, names.length - SCREEN_KEEP))) rmSync(join(dir, old), { force: true });
}
