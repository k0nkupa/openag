// Test double for the `cua` CLI. Emulates the VERIFIED behaviour in docs/notes/cua.md. Never a real VM.
// Knobs (set by the test's wrapper script, because the daemon passes only PATH/HOME/LANG/TMPDIR to children):
//   FAKE_CUA_STATE   JSON file holding { [name]: sandboxObject, __target: name }
//   FAKE_CUA_LOG     JSON-lines log of every invocation (argv, env keys, start/end times, target for `do`)
//   FAKE_CUA_FAIL    subcommand name that fails with exit 1 and a secret-looking stderr line
//   FAKE_CUA_SLEEP_MS  sleep before answering (lock and timeout tests)
//   FAKE_CUA_RESUME_LAG  number of `info` calls that still report status "starting" after a resume
//   FAKE_CUA_INFO_RAW  if set, `info` prints this text verbatim (exit 0)
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

const STATE_FILE = process.env.FAKE_CUA_STATE;
const LOG_FILE = process.env.FAKE_CUA_LOG;
const argv = process.argv.slice(2);
const t0 = Date.now(); // invocation time: the process only starts after the previous one exited
const TARGET_KEY = "__target"; // global `cua do` target, like the real machine-wide selection
const KEYS = new Set(["enter", "escape", "tab", "backspace", "space", "up", "down", "left", "right", "delete", "home", "end", "pageup", "pagedown", "cmd", "ctrl", "alt", "shift"]);
const BUTTONS = new Set(["left", "right", "middle"]);
const DIRECTIONS = new Set(["up", "down", "left", "right"]);

function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}
function saveState(s) {
  writeFileSync(STATE_FILE, JSON.stringify(s));
}
function log(extra) {
  if (!LOG_FILE) return;
  appendFileSync(LOG_FILE, JSON.stringify({ argv, envKeys: Object.keys(process.env), t0, t1: Date.now(), ...extra }) + "\n");
}
function finish(code, out = "", err = "", extra = {}) {
  if (out) process.stdout.write(out);
  if (err) process.stderr.write(err);
  log({ code, ...extra });
  process.exit(code);
}
function sandboxObject(name, state, status) {
  return {
    id: `local:${name}`,
    name,
    image: "ghcr.io/trycua/linux:24.04-slim",
    kind: "container",
    runtime: "gvisor",
    state,
    status,
    services: { env: 8000 },
    endpoints: { env: "http://127.0.0.1:8000" },
    provider_details: { backend: "gvisor", provider: "local" },
  };
}
function pngBytes(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(0, 9); // greyscale
  const raw = Buffer.alloc((width + 1) * height);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const isInt = (s) => /^-?\d+$/.test(s ?? "");

/** `cua do <action> ...`: acts on the CURRENT global target, exits 3 when none is set. */
function doCommand(sub, rest, state) {
  if (sub === "switch") {
    const name = rest[0];
    if (!name || !state[name]) finish(3, "", `cua: not found: sandbox ${name}\n`, { target: name });
    state[TARGET_KEY] = name;
    saveState(state);
    finish(0, `✅ switched to ${name}\n💻 ${name}\t🔍 zoom: off\n`, "", { target: name, do: sub });
  }

  const target = state[TARGET_KEY];
  if (!target || !state[target]) finish(3, "", "cua: no target sandbox selected\n", { do: sub, target: target ?? null });
  const ok = (message) => finish(0, `✅ ${message}\n💻 ${target}\t🔍 zoom: off\n`, "", { do: sub, target });
  const usage = (msg) => finish(2, "", `error: ${msg}\n`, { do: sub, target });

  // Free text: after a literal `--`, or it must not start with `-` (clap treats it as an option otherwise).
  const freeText = () => {
    if (rest[0] === "--") return rest[1] ?? null;
    if ((rest[0] ?? "").startsWith("-")) return undefined;
    return rest[0] ?? null;
  };

  switch (sub) {
    case "click": {
      const [x, y, button = "left"] = rest;
      if (!isInt(x)) usage(`invalid value '${x}' for '<X>': invalid digit found in string`);
      if (!isInt(y)) usage(`invalid value '${y}' for '<Y>': invalid digit found in string`);
      if (!BUTTONS.has(button)) usage(`invalid value '${button}' for '[BUTTON]'`);
      ok(`clicked (${x}, ${y}) [${button}]`);
    }
    case "type": {
      const text = freeText();
      if (text === undefined) usage(`unexpected argument '${rest[0]}' found`);
      if (text === null) usage("the following required arguments were not provided: <TEXT>");
      ok(`typed: "${text}"`);
    }
    case "key": {
      const key = rest[0];
      if (!key) usage("the following required arguments were not provided: <KEY>");
      if (!KEYS.has(key) && key.length > 1) finish(1, `💻 ${target}\t🔍 zoom: off\n`, `❌ invalid argument: protocol error: unknown key "${key}"\n`, { do: sub, target });
      ok(`pressed key: ${key}`);
    }
    case "hotkey": {
      const keys = rest[0];
      if (!keys) usage("the following required arguments were not provided: <KEYS>");
      ok(`pressed hotkey: ${keys}`);
    }
    case "scroll": {
      const [direction, amount = "3"] = rest;
      if (!DIRECTIONS.has(direction)) usage(`invalid value '${direction}' for '<DIRECTION>'`);
      if (!isInt(amount)) usage(`invalid value '${amount}' for '[AMOUNT]'`);
      ok(`scrolled ${direction} ${amount}x`);
    }
    case "open": {
      const url = freeText();
      if (url === undefined) usage(`unexpected argument '${rest[0]}' found`);
      if (url === null) usage("the following required arguments were not provided: <PATH>");
      ok(`opened: ${url}`);
    }
    default:
      usage(`unrecognized subcommand '${sub}'`);
  }
}

/** Runs a scripted command line. Understands a few builtins only; nothing real is executed. */
async function scriptedShell(command, timeoutSec) {
  const m = command.match(/^(\S+)(?:\s+(.*))?$/s);
  const cmd = m?.[1] ?? "";
  const arg = m?.[2] ?? "";
  if (cmd === "echo") return { code: 0, out: `${arg}\n` };
  if (cmd === "exit") return { code: Number(arg) || 0, out: "" };
  if (cmd === "err") return { code: 0, err: `${arg}\n` };
  if (cmd === "emit") return { code: 0, out: "x".repeat(Number(arg) || 0) };
  if (cmd === "sleep") {
    const secs = Number(arg);
    if (secs > timeoutSec) {
      await new Promise((r) => setTimeout(r, timeoutSec * 1000));
      return { code: 1, err: "cua: command timed out\n" };
    }
    await new Promise((r) => setTimeout(r, secs * 1000));
    return { code: 0, out: "" };
  }
  return { code: 127, err: `sh: 1: ${cmd}: not found\n` };
}

async function main() {
  const sleepMs = Number(process.env.FAKE_CUA_SLEEP_MS ?? 0);
  if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));

  const [group, sub, ...rest] = argv;
  if (group === "do") {
    if (process.env.FAKE_CUA_FAIL === sub) finish(1, "", `cua: boom sk-abcdefghijklmnopqrstuvwxyz0123 while ${sub}\n`);
    return doCommand(sub, rest, loadState());
  }
  if (group !== "sandbox") finish(2, "", "cua: unsupported in fake\n");
  if (process.env.FAKE_CUA_FAIL === sub) {
    finish(1, "", `cua: boom sk-abcdefghijklmnopqrstuvwxyz0123 while ${sub}\n`);
  }
  const flagValue = (flag) => {
    const i = rest.indexOf(flag);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const nameArg = rest.find((a) => !a.startsWith("-") && a !== "linux") ?? flagValue("--name");
  const state = loadState();

  if (sub === "exec") {
    // sandbox exec NAME [--timeout N] -- CMD  (CMD must follow `--`; a bare leading `-` is an option, as in sh)
    const name = rest[0];
    if (!state[name]) finish(3, "", `cua: not found: sandbox ${name}\n`, { exec: name });
    const timeout = Number(flagValue("--timeout") ?? 300);
    const dd = rest.indexOf("--");
    let command;
    if (dd >= 0) command = rest[dd + 1];
    else command = rest.slice(1).find((a) => !a.startsWith("--") && a !== String(timeout));
    if (command === undefined) finish(2, "", "error: a command is required\n", { exec: name });
    if (dd < 0 && command.startsWith("-")) finish(2, "", `sh: 0: Illegal option ${command.split(" ")[0]}\n`, { exec: name });
    const result = await scriptedShell(command, timeout);
    if (result.out) process.stdout.write(result.out);
    if (result.err) process.stderr.write(result.err);
    finish(result.code, "", "", { exec: name, timeout, command: command.slice(0, 40) });
  }

  if (sub === "create") {
    const name = flagValue("--name");
    if (state[name]) finish(1, "", `cua: sandbox ${name} already exists\n`);
    state[name] = sandboxObject(name, "running", "ready");
    saveState(state);
    finish(0, JSON.stringify(state[name]) + "\n");
  }

  if (sub === "info") {
    const obj = state[nameArg];
    if (!obj) finish(3, "", `cua: not found: sandbox ${nameArg}\n`);
    if (process.env.FAKE_CUA_INFO_RAW !== undefined) finish(0, process.env.FAKE_CUA_INFO_RAW + "\n");
    const { pendingLag, ...clean } = obj;
    if (pendingLag > 0) {
      // Report "starting" for the lagging calls, then flip to ready.
      obj.pendingLag = pendingLag - 1;
      if (obj.pendingLag === 0) {
        delete obj.pendingLag;
        obj.status = "ready";
      }
      saveState(state);
      finish(0, JSON.stringify({ ...clean, status: "starting" }) + "\n");
    }
    finish(0, JSON.stringify(clean) + "\n");
  }

  if (sub === "ls") {
    finish(0, JSON.stringify(Object.entries(state).filter(([k]) => !k.startsWith("__")).map(([, v]) => v)) + "\n");
  }

  if (sub === "suspend" || sub === "resume") {
    const obj = state[nameArg];
    if (!obj) finish(3, "", `cua: not found: sandbox ${nameArg}\n`);
    if (sub === "suspend") {
      obj.state = "stopped";
      obj.status = "stopped";
      saveState(state);
      finish(0, `Suspended sandbox ${nameArg}.\n`);
    }
    obj.state = "running";
    obj.status = "ready";
    const lag = Number(process.env.FAKE_CUA_RESUME_LAG ?? 0);
    if (lag > 0) {
      obj.status = "starting";
      obj.pendingLag = lag;
    }
    saveState(state);
    finish(0, `Resumed sandbox ${nameArg}.\n`);
  }

  if (sub === "rm") {
    if (!state[nameArg]) finish(3, "", `cua: not found: sandbox ${nameArg}\n`);
    if (!rest.includes("-f")) finish(1, "", "cua: refusing to remove without -f (no terminal)\n");
    // Real cua is flaky after suspend/resume ("container ... is zombie and can not be killed"): fail the first N calls.
    const flaky = Number(process.env.FAKE_CUA_RM_FLAKY ?? 0);
    if (flaky > 0 && (state.__rmFails ?? 0) < flaky) {
      state.__rmFails = (state.__rmFails ?? 0) + 1;
      saveState(state);
      finish(1, "", `cua: local runtime: container engine: Docker responded with status code 500: cannot remove container "${nameArg}": could not kill container: PID 1918 is zombie\n`);
    }
    delete state[nameArg];
    saveState(state);
    finish(0, `Removed sandbox ${nameArg}.\n`);
  }

  if (sub === "screenshot") {
    if (!state[nameArg]) finish(3, "", `cua: not found: sandbox ${nameArg}\n`);
    const out = flagValue("-o");
    const width = 1280;
    const height = 800;
    const bad = process.env.FAKE_CUA_SCREENSHOT_BAD;
    if (bad !== "nofile") {
      writeFileSync(out, bad === "text" ? "not a png at all, just some text padded out for length ".repeat(4) : pngBytes(width, height));
    }
    finish(0, JSON.stringify({ height, path: out, width }) + "\n");
  }

  if (sub === "view") {
    if (!state[nameArg]) finish(3, "", `cua: not found: sandbox ${nameArg}\n`);
    const url = process.env.FAKE_CUA_VIEW_URL ?? "http://127.0.0.1:32768/viewer/#ticket=v1.faketicket&files=%2Fhome%2Fcua";
    finish(0, JSON.stringify({ expires_at_unix: Math.floor(Date.now() / 1000) + 1800, name: nameArg, url }) + "\n");
  }

  finish(2, "", `cua: unknown subcommand ${sub}\n`);
}

main().catch((err) => finish(1, "", `cua: internal ${String(err)}\n`));
