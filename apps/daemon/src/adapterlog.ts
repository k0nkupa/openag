import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Adapter diagnostics: the ACP adapter child's stderr (ALREADY redacted by the caller) goes to a size-capped, rotated log
 * under `$OPENAG_DATA/logs/` and into a short in-memory tail, so a stalled turn can be explained afterwards. Env is
 * recorded as KEY NAMES only.
 */

const MAX_BYTES = 512 * 1024;
const TAIL_LINES = 40;
const LINE_MAX = 500;

export interface AdapterDiagnostics {
  pid: number | null;
  /** Last stderr lines, redacted. */
  lines: string[];
  exit: { code: number | null; signal: string | null } | null;
  /** Names only, never values. */
  envKeys: string[];
}

export interface AdapterLog {
  line(text: string): void;
  setProcess(pid: number | null, envKeys: string[]): void;
  setExit(code: number | null, signal: string | null): void;
  diagnostics(): AdapterDiagnostics;
}

export function createAdapterLog(dataDir: string, botId: string, maxBytes = MAX_BYTES): AdapterLog {
  const dir = join(dataDir, "logs");
  const file = join(dir, `adapter-${botId.replace(/[^a-z0-9_-]/gi, "_")}.log`);
  let ready = false;
  const tail: string[] = [];
  let pid: number | null = null;
  let envKeys: string[] = [];
  let exit: AdapterDiagnostics["exit"] = null;

  function write(text: string): void {
    try {
      if (!ready) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        ready = true;
      }
      try {
        if (statSync(file).size > maxBytes) renameSync(file, `${file}.1`);
      } catch {
        // no file yet
      }
      appendFileSync(file, text, { mode: 0o600 });
    } catch {
      // diagnostics must never affect a turn
    }
  }

  return {
    line(text) {
      const clipped = text.replace(/\r?\n$/, "").slice(0, LINE_MAX);
      tail.push(clipped);
      if (tail.length > TAIL_LINES) tail.shift();
      write(`${new Date().toISOString()} ${clipped}\n`);
    },
    setProcess(p, keys) {
      pid = p;
      envKeys = [...keys].sort();
      write(`${new Date().toISOString()} [start] pid=${p ?? "?"} env=${envKeys.join(",")}\n`);
    },
    setExit(code, signal) {
      exit = { code, signal };
      write(`${new Date().toISOString()} [exit] code=${code ?? "null"} signal=${signal ?? "null"}\n`);
    },
    diagnostics: () => ({ pid, lines: tail.slice(-20), exit, envKeys }),
  };
}
