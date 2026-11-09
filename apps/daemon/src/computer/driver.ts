import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ComputerError,
  type Computer,
  type ComputerCapabilities,
  type ComputerScreenshot,
  type ComputerState,
  type ComputerStatus,
  type ComputerViewLink,
  type InputGuard,
  MAX_MESSAGE,
  NOT_RUNNING_MESSAGE,
  PNG_MAGIC,
  pngSize,
  pruneScreens,
  SCREEN_MAX_BYTES,
  SCREEN_MIN_BYTES,
  type ShellResult,
  SHELL_OUTPUT_CAP,
  statSyncSafe,
  timestampName,
} from "../computer.js";
import type { Ledger } from "../ledger.js";
import { getDefaultRedactor } from "../redact.js";

/**
 * A backend driver is the LOW-LEVEL part of a computer: how to inspect, start, stop and destroy the box, take a PNG and
 * perform one action. Everything else (the single mutex, the input guard used by human takeover, screenshot storage and
 * validation, redaction, audit events, status) lives once, in `createDriverComputer`, so every backend gets the same
 * safety behaviour and the `computer_*` tools and the gate never change.
 */

export type DriverKind = "browserbase" | "docker" | "ssh";

export interface DriverInfo {
  state: ComputerState;
  status: string | null;
  image: string | null;
  kind: string | null;
  runtime: string | null;
}

export interface ComputerDriver {
  readonly kind: DriverKind;
  readonly name: string;
  readonly capabilities: ComputerCapabilities;
  /** The box cannot be suspended: stop() releases it, so "absent" is the expected state afterwards. */
  readonly stopMeansDestroy?: boolean;
  /** null when the box does not exist. Throws ComputerError (messages must be short, fixed and secret-free). */
  inspect(): Promise<DriverInfo | null>;
  /** Creates the box (and starts it). */
  create(): Promise<void>;
  /** Resumes an existing, stopped box. */
  start(): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
  /** Raw PNG bytes of the screen. */
  screenshot(): Promise<Buffer>;
  /** One action in the `cua do` vocabulary: click X Y [button], type -- TEXT, key K, hotkey A B, scroll DIR N, open -- URL. */
  act(argv: string[]): Promise<{ message: string }>;
  shell(command: string, timeoutSec: number): Promise<ShellResult>;
  viewLink(): Promise<ComputerViewLink>;
}

export interface DriverComputerOptions {
  dataDir: string;
  ledger?: Ledger;
  inputGuard?: InputGuard;
  /** Test knobs for the start/stop wait loops. */
  timing?: { pollMs?: number; startWaitMs?: number; stopWaitMs?: number };
}

const STATUS_CACHE_MS = 5_000;
const clipMessage = (s: string) => getDefaultRedactor().redactString(s).slice(0, MAX_MESSAGE);

export function createDriverComputer(driver: ComputerDriver, opts: DriverComputerOptions): Computer {
  const dataDir = resolve(opts.dataDir);
  const ledger = opts.ledger;
  const pollMs = opts.timing?.pollMs ?? 1000;
  const startWaitMs = opts.timing?.startWaitMs ?? 120_000;
  const stopWaitMs = opts.timing?.stopWaitMs ?? 30_000;
  let inputGuard: InputGuard | undefined = opts.inputGuard;

  let tail: Promise<void> = Promise.resolve();
  let pending = 0;
  let lastError: string | null = null;
  let last: Omit<ComputerStatus, "busy" | "lastError" | "backend"> = {
    name: driver.name,
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

  const snapshot = (inLock = false): ComputerStatus => ({
    backend: driver.kind,
    ...last,
    busy: pending > (inLock ? 1 : 0),
    lastError,
  });

  /** Drivers throw ComputerError with fixed messages; anything else becomes a generic failure (never e.message). */
  const wrap = async <T>(fn: () => Promise<T>, what: string): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ComputerError) throw err;
      throw new ComputerError("failed", `${what} failed`);
    }
  };

  let lastRefreshAt = 0;
  async function refresh(): Promise<void> {
    const info = await wrap(() => driver.inspect(), "status check");
    lastRefreshAt = Date.now();
    last = info
      ? { name: driver.name, exists: true, state: info.state, status: info.status, image: info.image, kind: info.kind, runtime: info.runtime }
      : { name: driver.name, exists: false, state: "absent", status: null, image: null, kind: null, runtime: null };
  }

  async function waitFor(target: ComputerState, waitMs: number): Promise<ComputerStatus> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      await refresh();
      if (last.state === target) return snapshot(true);
      if (Date.now() >= deadline) return { ...snapshot(true), state: "unknown" };
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  const audit = (action: string) => ledger?.append("_system", "user", "config", { action, name: driver.name, backend: driver.kind });

  function lifecycle(fn: () => Promise<ComputerStatus>): Promise<ComputerStatus> {
    return withLock(async () => {
      lastRefreshAt = 0;
      try {
        const res = await fn();
        lastError = null;
        return res;
      } catch (err) {
        lastError = err instanceof ComputerError ? err.message : "computer call failed";
        throw err;
      }
    });
  }

  function assertNotPaused(): void {
    const why = inputGuard?.();
    if (typeof why === "string") throw new ComputerError("paused", why);
  }

  return {
    name: driver.name,
    peek: () => ({ backend: driver.kind, requestedBackend: null, configured: true, shell: driver.capabilities.shell, state: lastRefreshAt === 0 ? "not_observed" : last.state, observedAt: lastRefreshAt || null, busy: pending > 0, inputBlocked: typeof inputGuard?.() === "string" }),
    busy: () => pending > 0,
    withLock,
    setInputGuard(fn) {
      inputGuard = fn;
    },
    capabilities: () => driver.capabilities,

    async status() {
      if (pending > 0) return snapshot(); // never wait behind a lifecycle call
      // The desk polls every few seconds: answer from a recent observation instead of a remote call each time (a hosted
      // backend's inspect() is a REST request that holds the lock). Actions and lifecycle calls always refresh.
      if (Date.now() - lastRefreshAt < STATUS_CACHE_MS && lastRefreshAt > 0) return snapshot();
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
          await wrap(() => driver.create(), "create");
          audit("computer_created");
        } else {
          await wrap(() => driver.start(), "start");
          audit("computer_started");
        }
        return waitFor("running", startWaitMs);
      }),

    stop: () =>
      lifecycle(async () => {
        await refresh();
        if (last.state === "absent" || last.state === "stopped") return snapshot(true);
        await wrap(() => driver.stop(), "stop");
        audit("computer_stopped");
        return waitFor(driver.stopMeansDestroy === true ? "absent" : "stopped", stopWaitMs);
      }),

    destroy: () =>
      lifecycle(async () => {
        await refresh();
        if (last.state === "absent") return snapshot(true);
        await wrap(() => driver.destroy(), "destroy");
        await refresh();
        const isAbsent = (): boolean => last.state === "absent"; // refresh() mutates `last`; keep TS from narrowing
        if (!isAbsent()) throw new ComputerError("failed", "destroy did not remove the computer");
        audit("computer_destroyed");
        return snapshot(true);
      }),

    async act(args,assertPermission) {
      return withLock(async () => {
        assertNotPaused();
        await refresh();
        if (last.state !== "running") throw new ComputerError("failed", NOT_RUNNING_MESSAGE);
        assertPermission?.();
        const res = await wrap(() => driver.act(args), "action");
        return { message: clipMessage(res.message || "done") };
      });
    },

    async shell(command, timeoutSec,assertPermission) {
      return withLock(async (): Promise<ShellResult> => {
        assertNotPaused();
        if (!driver.capabilities.shell) throw new ComputerError("failed", "this computer backend has no shell");
        await refresh();
        if (last.state !== "running") throw new ComputerError("failed", NOT_RUNNING_MESSAGE);
        assertPermission?.();
        const res = await wrap(() => driver.shell(command, timeoutSec), "shell");
        const redactor = getDefaultRedactor();
        const out = redactor.redactString(res.stdout);
        const err = redactor.redactString(res.stderr);
        return {
          exitCode: res.exitCode,
          stdout: out.slice(0, SHELL_OUTPUT_CAP),
          stderr: err.slice(0, SHELL_OUTPUT_CAP),
          truncated: res.truncated || out.length > SHELL_OUTPUT_CAP || err.length > SHELL_OUTPUT_CAP,
          timedOut: res.timedOut,
        };
      });
    },

    viewLink() {
      return withLock(async () => {
        await refresh();
        if (last.state !== "running") throw new ComputerError("failed", NOT_RUNNING_MESSAGE);
        if (driver.capabilities.view === "none") throw new ComputerError("failed", "this computer backend has no live view");
        return wrap(() => driver.viewLink(), "viewer link");
      });
    },

    screenshot() {
      return withLock(async (): Promise<ComputerScreenshot> => {
        await refresh();
        if (last.state !== "running") throw new ComputerError("failed", NOT_RUNNING_MESSAGE);
        const buf = await wrap(() => driver.screenshot(), "screenshot");
        if (buf.length < SCREEN_MIN_BYTES || buf.length > SCREEN_MAX_BYTES) {
          throw new ComputerError("bad_output", "screenshot has an unexpected size");
        }
        const size = pngSize(buf);
        if (!buf.subarray(0, 8).equals(PNG_MAGIC) || !size) throw new ComputerError("bad_output", "screenshot is not a PNG");

        const dir = join(dataDir, "computer", "screens");
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        chmodSync(join(dataDir, "computer"), 0o700);
        chmodSync(dir, 0o700);
        let file = `${timestampName(new Date())}.png`;
        for (let n = 1; statSyncSafe(join(dir, file)); n++) file = `${timestampName(new Date())}-${n}.png`;
        const abs = join(dir, file);
        try {
          writeFileSync(abs, buf, { flag: "wx", mode: 0o600 });
        } catch {
          rmSync(abs, { force: true });
          throw new ComputerError("failed", "screenshot could not be saved");
        }
        pruneScreens(dir);
        return { path: join("computer", "screens", file), width: size.width, height: size.height };
      });
    },
  };
}
