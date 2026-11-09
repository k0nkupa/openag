import { ComputerError, type ShellResult } from "../computer.js";
import type { ComputerDriver, DriverInfo, DriverKind } from "./driver.js";

/**
 * X11 layer: a ComputerDriver for ANY box where one command can be run inside it with DISPLAY set (a Docker container
 * today, an SSH host later). The transport (docker exec, ssh) is injected as `exec` and must pass argv WITHOUT a shell.
 * This module builds every argv itself; it never concatenates a shell string. Every error is a ComputerError with a
 * fixed message: transport stderr, stdout, argv and typed text never reach an error.
 */

export interface X11ExecResult {
  /** Exit code, or null when the transport failed (not started, killed, output too large). */
  code: number | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
}

/** Runs ONE command inside the box, DISPLAY set, no shell. */
export type X11Exec = (argv: string[], o: { timeoutMs: number; binary?: boolean }) => Promise<X11ExecResult>;

export interface X11Lifecycle {
  inspect(): Promise<DriverInfo | null>;
  create(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
}

export interface X11Options {
  kind: Extract<DriverKind, "docker" | "ssh">;
  name: string;
  exec: X11Exec;
  lifecycle: X11Lifecycle;
  /** Informational for the transport (which DISPLAY it sets). Default ":99". */
  display?: string;
  hosted?: boolean;
}

const ACTION_TIMEOUT_MS = 20_000;
const SCREENSHOT_TIMEOUT_MS = 30_000;
export const X11_SCREENSHOT_MAX_BYTES = 20 * 1024 * 1024;
export const X11_SHELL_CAP = 8_000;
const SHELL_SLACK_MS = 5_000;
const TYPE_MAX = 4_000;
const TYPE_PREVIEW = 40;
const SCROLL_MAX = 50;
const COORD_MAX = 10_000;
const URL_MAX = 2_000;
const COORD_RE = /^\d{1,5}$/;
const SCROLL_N_RE = /^\d{1,3}$/;
const DISPLAY_RE = /^:\d{1,3}$/;
const CONTROL_OR_SPACE = /[\u0000- \u007f-\u009f]/;

const invalid = () => new ComputerError("failed", "invalid arguments");

/** Own-property lookup only: "constructor", "__proto__", "toString" are valid input and must not resolve. */
function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

const NAMED_KEYS: Record<string, string> = {
  enter: "Return",
  tab: "Tab",
  escape: "Escape",
  backspace: "BackSpace",
  delete: "Delete",
  space: "space",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  pageup: "Prior",
  pagedown: "Next",
};

const MODIFIERS: Record<string, string> = { ctrl: "ctrl", alt: "alt", shift: "shift", meta: "super", cmd: "super", super: "super" };
const BUTTONS: Record<string, number> = { left: 1, middle: 2, right: 3 };
const SCROLL_BUTTONS: Record<string, number> = { up: 4, down: 5, left: 6, right: 7 };

/** Keysym for a `key` name, or null when it is not in the table. */
export function keysym(k: string): string | null {
  const named = own(NAMED_KEYS, k.toLowerCase());
  if (named !== undefined) return named;
  if (k.length === 1 && k.charCodeAt(0) >= 0x21 && k.charCodeAt(0) <= 0x7e) return k;
  return null;
}

function parseCoord(s: string | undefined): number {
  if (s === undefined || !COORD_RE.test(s)) throw invalid();
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > COORD_MAX) throw invalid();
  return n;
}

function parseHttpUrl(s: string): string {
  if (s.length === 0 || s.length > URL_MAX || CONTROL_OR_SPACE.test(s)) throw invalid();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw invalid();
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw invalid();
  return u.href;
}

/** Caps a decoded stream at X11_SHELL_CAP characters. */
function capText(s: string): { text: string; truncated: boolean } {
  return s.length > X11_SHELL_CAP ? { text: s.slice(0, X11_SHELL_CAP), truncated: true } : { text: s, truncated: false };
}

/**
 * Makes the BOX enforce the time limit: the transport's own timeout only kills the local docker/ssh client, which would
 * leave the command running inside the box while the lock moves on. `timeout` exits 124 on expiry (-k 2: then SIGKILL).
 */
export function boxTimeout(argv: string[], timeoutMs: number): string[] {
  return ["timeout", "-k", "2", String(Math.max(1, Math.floor(timeoutMs / 1000) - 2)), ...argv];
}

export function createX11Driver(opts: X11Options): ComputerDriver {
  const display = opts.display ?? ":99";
  if (!DISPLAY_RE.test(display)) throw new Error("invalid X display");
  const { exec, lifecycle } = opts;

  const runAction = async (argv: string[], timeoutMs = ACTION_TIMEOUT_MS): Promise<void> => {
    const res = await exec(argv, { timeoutMs });
    if (res.timedOut || res.code === 124) throw new ComputerError("timeout", "action timed out");
    if (res.code !== 0) throw new ComputerError("failed", "action failed");
  };

  const hotkeyParts = (args: string[]): { mods: string[]; key: string } => {
    const tokens = args.flatMap((s) => s.split("+"));
    if (tokens.length === 0 || tokens.length > 5 || tokens.some((t) => t.length === 0)) throw invalid();
    const keyTok = tokens[tokens.length - 1] as string;
    const key = keysym(keyTok);
    if (key === null) throw invalid();
    const mods = tokens.slice(0, -1).map((m) => own(MODIFIERS, m.toLowerCase()));
    if (mods.some((m) => m === undefined)) throw invalid();
    return { mods: mods as string[], key };
  };

  async function act(argv: string[]): Promise<{ message: string }> {
    if (!Array.isArray(argv) || argv.some((a) => typeof a !== "string") || argv.length === 0) throw invalid();
    const [verb, ...rest] = argv as [string, ...string[]];
    switch (verb) {
      case "click": {
        if (rest.length !== 2 && rest.length !== 3) throw invalid();
        const x = parseCoord(rest[0]);
        const y = parseCoord(rest[1]);
        const button = rest[2] ?? "left";
        const b = own(BUTTONS, button);
        if (b === undefined) throw invalid();
        await runAction(["xdotool", "mousemove", "--sync", String(x), String(y), "click", String(b)]);
        return { message: `clicked (${x}, ${y}) ${button}` };
      }
      case "type": {
        if (rest.length !== 2 || rest[0] !== "--") throw invalid();
        const text = rest[1] as string;
        if (text.length === 0 || text.length > TYPE_MAX) throw invalid();
        // xdotool types about 20 ms per character: the limit must grow with the text or long text always times out.
        await runAction(["xdotool", "type", "--delay", "20", "--", text], ACTION_TIMEOUT_MS + text.length * 30);
        return { message: `typed: "${text.slice(0, TYPE_PREVIEW)}"` };
      }
      case "key": {
        if (rest.length !== 1) throw invalid();
        const key = keysym(rest[0] as string);
        if (key === null) throw invalid();
        await runAction(["xdotool", "key", key]);
        return { message: `pressed ${rest[0]}` };
      }
      case "hotkey": {
        if (rest.length < 1) throw invalid();
        const { mods, key } = hotkeyParts(rest);
        await runAction(["xdotool", "key", [...mods, key].join("+")]);
        return { message: `pressed ${[...mods, key].join("+")}` };
      }
      case "scroll": {
        if (rest.length !== 2) throw invalid();
        const button = own(SCROLL_BUTTONS, rest[0] as string);
        const n = rest[1] as string;
        if (button === undefined || !SCROLL_N_RE.test(n)) throw invalid();
        const count = Math.min(SCROLL_MAX, Math.max(1, Number(n)));
        await runAction(["xdotool", "click", "--repeat", String(count), String(button)]);
        return { message: `scrolled ${rest[0]} ${count}` };
      }
      case "open": {
        if (rest.length !== 2 || rest[0] !== "--") throw invalid();
        const href = parseHttpUrl(rest[1] as string);
        await runAction(["xdotool", "key", "ctrl+l"]);
        await runAction(["xdotool", "type", "--delay", "5", "--", href]);
        await runAction(["xdotool", "key", "Return"]);
        return { message: `opened ${new URL(href).hostname}` };
      }
      default:
        throw invalid();
    }
  }

  return {
    kind: opts.kind,
    name: opts.name,
    capabilities: { shell: true, view: "none", hosted: opts.hosted ?? false },
    inspect: () => lifecycle.inspect(),
    create: () => lifecycle.create(),
    start: () => lifecycle.start(),
    stop: () => lifecycle.stop(),
    destroy: () => lifecycle.destroy(),

    async screenshot(): Promise<Buffer> {
      const res = await exec(["import", "-window", "root", "png:-"], { timeoutMs: SCREENSHOT_TIMEOUT_MS, binary: true });
      if (res.timedOut) throw new ComputerError("timeout", "screenshot timed out");
      if (res.code !== 0) throw new ComputerError("failed", "screenshot failed");
      if (res.stdout.length > X11_SCREENSHOT_MAX_BYTES) throw new ComputerError("bad_output", "screenshot too large");
      if (res.stdout.length === 0) throw new ComputerError("failed", "screenshot failed");
      return res.stdout;
    },

    act,

    async shell(command: string, timeoutSec: number): Promise<ShellResult> {
      if (typeof command !== "string" || !Number.isInteger(timeoutSec) || timeoutSec < 1 || timeoutSec > 600) throw invalid();
      const res = await exec(["sh", "-c", command], { timeoutMs: timeoutSec * 1000 + SHELL_SLACK_MS });
      const out = capText(res.stdout.toString("utf8"));
      const err = capText(res.stderr);
      if (res.timedOut || res.code === 124) {
        return { exitCode: 124, stdout: out.text, stderr: err.text, truncated: out.truncated || err.truncated, timedOut: true };
      }
      // A transport failure is not a command result: there is no exit code to report.
      if (res.code === null) throw new ComputerError("failed", "shell failed");
      return { exitCode: res.code, stdout: out.text, stderr: err.text, truncated: out.truncated || err.truncated, timedOut: false };
    },

    async viewLink() {
      throw new ComputerError("failed", "this computer backend has no live view");
    },
  };
}
