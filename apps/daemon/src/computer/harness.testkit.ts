import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createComputer, type Computer, type ComputerOptions, type Ledger, type Runner } from "../computer.js";

// Test-only helper: drives the fake `cua` (fake-cua.testkit.mjs) through a shell wrapper. Never the real binary.
export const FAKE = fileURLToPath(new URL("./fake-cua.testkit.mjs", import.meta.url));

export interface Knobs {
  fail?: string;
  sleepMs?: number;
  resumeLag?: number;
  infoRaw?: string;
  screenshotBad?: string;
  rmFlaky?: number;
  viewUrl?: string;
}

export interface CallRecord {
  argv: string[];
  envKeys: string[];
  t0: number;
  t1: number;
  code: number;
  do?: string;
  target?: string | null;
  exec?: string;
}

const sh = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

export interface FakeCua {
  dir: string;
  bin: string;
  statePath: string;
  logPath: string;
  /** Rewrites the wrapper with these knobs. `computer()` does this for you. */
  writeWrapper(k?: Knobs): void;
  /** Replaces the sandbox state. `running` and `stopped` are the only states the tests need. */
  seed(sandboxes: Record<string, "running" | "stopped" | "absent">): void;
  /** Sets the machine-global `cua do` target, as another process could. */
  setTarget(name: string): void;
  calls(): CallRecord[];
  computer(opts?: Partial<ComputerOptions> & { knobs?: Knobs }): Computer;
  cleanup(): void;
}

export function makeFakeCua(ledger?: Ledger): FakeCua {
  const dir = mkdtempSync(join(tmpdir(), "openag-cua-harness-"));
  const statePath = join(dir, "state.json");
  const logPath = join(dir, "log.jsonl");
  const bin = join(dir, "cua");

  const fake: FakeCua = {
    dir,
    bin,
    statePath,
    logPath,
    writeWrapper(k: Knobs = {}) {
      const exports = [
        `export FAKE_CUA_STATE=${sh(statePath)}`,
        `export FAKE_CUA_LOG=${sh(logPath)}`,
        k.fail ? `export FAKE_CUA_FAIL=${sh(k.fail)}` : "",
        k.sleepMs ? `export FAKE_CUA_SLEEP_MS=${k.sleepMs}` : "",
        k.resumeLag ? `export FAKE_CUA_RESUME_LAG=${k.resumeLag}` : "",
        k.infoRaw !== undefined ? `export FAKE_CUA_INFO_RAW=${sh(k.infoRaw)}` : "",
        k.screenshotBad ? `export FAKE_CUA_SCREENSHOT_BAD=${sh(k.screenshotBad)}` : "",
        k.rmFlaky ? `export FAKE_CUA_RM_FLAKY=${k.rmFlaky}` : "",
        k.viewUrl ? `export FAKE_CUA_VIEW_URL=${sh(k.viewUrl)}` : "",
      ].filter(Boolean);
      writeFileSync(bin, `#!/bin/sh\n${exports.join("\n")}\nexec ${sh(process.execPath)} ${sh(FAKE)} "$@"\n`);
      chmodSync(bin, 0o755);
    },
    seed(sandboxes) {
      const state: Record<string, unknown> = {};
      for (const [name, s] of Object.entries(sandboxes)) {
        if (s === "absent") continue;
        state[name] = {
          id: `local:${name}`,
          name,
          image: "img:1",
          kind: "container",
          runtime: "gvisor",
          state: s,
          status: s === "running" ? "ready" : "stopped",
        };
      }
      writeFileSync(statePath, JSON.stringify(state));
    },
    setTarget(name) {
      const state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
      state.__target = name;
      writeFileSync(statePath, JSON.stringify(state));
    },
    calls() {
      if (!existsSync(logPath)) return [];
      return readFileSync(logPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as CallRecord);
    },
    computer(opts = {}) {
      const { knobs, ...rest } = opts;
      fake.writeWrapper(knobs);
      return createComputer({
        dataDir: dir,
        cuaBin: bin,
        name: "openag-main",
        ledger,
        timing: { pollMs: 10, startWaitMs: 300, stopWaitMs: 300, destroyRetryMs: 5 },
        ...rest,
      });
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return fake;
}

/** A Runner that answers `sandbox info` as running and hands every other call to `script`. */
export function scriptedRunner(script: Runner, state: "running" | "stopped" = "running"): Runner {
  return (bin, args, opts) => {
    if (args[0] === "sandbox" && args[1] === "info") {
      const info = { name: "openag-main", state: state === "running" ? "running" : "stopped", status: state === "running" ? "ready" : "stopped" };
      return Promise.resolve({ code: 0, stdout: JSON.stringify(info), stderr: "", timedOut: false });
    }
    return script(bin, args, opts);
  };
}
