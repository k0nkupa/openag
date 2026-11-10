import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { childEnv, ComputerError, createComputer, defaultRunner, type Computer, type Runner } from "./computer.js";
import type { Ledger } from "./ledger.js";

const FAKE = fileURLToPath(new URL("./computer/fake-cua.testkit.mjs", import.meta.url));
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ALLOWED_ENV = new Set([
  "PATH", "HOME", "LANG", "TMPDIR", "PWD", "OLDPWD", "SHLVL", "_", "__CF_USER_TEXT_ENCODING", // last one: macOS sh adds it
  "FAKE_CUA_STATE", "FAKE_CUA_LOG", "FAKE_CUA_FAIL", "FAKE_CUA_SLEEP_MS", "FAKE_CUA_RESUME_LAG", "FAKE_CUA_INFO_RAW", "FAKE_CUA_SCREENSHOT_BAD",
]);

const sh = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

interface Knobs {
  fail?: string;
  sleepMs?: number;
  resumeLag?: number;
  infoRaw?: string;
  screenshotBad?: string;
  rmFlaky?: number;
}

let dir: string;
let statePath: string;
let logPath: string;
let bin: string;
let events: Array<{ room: string; actor: string; type: string; payload: unknown }>;
const ledger = { append: (room: string, actor: string, type: string, payload: unknown) => events.push({ room, actor, type, payload }) } as unknown as Ledger;
const savedEnv = { ...process.env };

function writeWrapper(k: Knobs = {}) {
  const exports = [
    `export FAKE_CUA_STATE=${sh(statePath)}`,
    `export FAKE_CUA_LOG=${sh(logPath)}`,
    k.fail ? `export FAKE_CUA_FAIL=${sh(k.fail)}` : "",
    k.sleepMs ? `export FAKE_CUA_SLEEP_MS=${k.sleepMs}` : "",
    k.resumeLag ? `export FAKE_CUA_RESUME_LAG=${k.resumeLag}` : "",
    k.infoRaw !== undefined ? `export FAKE_CUA_INFO_RAW=${sh(k.infoRaw)}` : "",
    k.screenshotBad ? `export FAKE_CUA_SCREENSHOT_BAD=${sh(k.screenshotBad)}` : "",
    k.rmFlaky ? `export FAKE_CUA_RM_FLAKY=${k.rmFlaky}` : "",
  ].filter(Boolean);
  writeFileSync(bin, `#!/bin/sh\n${exports.join("\n")}\nexec ${sh(process.execPath)} ${sh(FAKE)} "$@"\n`);
  chmodSync(bin, 0o755);
}

function sandbox(state: string, status: string) {
  return { id: "local:openag-main", name: "openag-main", image: "img:1", kind: "container", runtime: "gvisor", state, status };
}

function seed(state: "running" | "stopped" | "weird" | null, status = state === "running" ? "ready" : "stopped") {
  writeFileSync(statePath, JSON.stringify(state ? { "openag-main": sandbox(state, status) } : {}));
}

function calls(): Array<{ argv: string[]; envKeys: string[]; t0: number; t1: number; code: number }> {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
const verbs = () => calls().map((c) => c.argv[1]);

function make(k: Knobs = {}, extra: { run?: Runner; name?: string; timing?: { pollMs?: number; startWaitMs?: number; stopWaitMs?: number; destroyRetryMs?: number } } = {}): Computer {
  writeWrapper(k);
  return createComputer({ dataDir: dir, cuaBin: bin, ledger, run: extra.run, name: extra.name, timing: extra.timing ?? { pollMs: 10, startWaitMs: 5000, stopWaitMs: 5000, destroyRetryMs: 5 } });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-cua-"));
  statePath = join(dir, "state.json");
  logPath = join(dir, "log.jsonl");
  bin = join(dir, "cua");
  events = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});

describe("lifecycle", () => {
  it("start from absent runs the exact create argv and reports the sandbox", async () => {
    seed(null);
    const c = make();
    const st = await c.start();
    expect(st).toMatchObject({ name: "openag-main", exists: true, state: "running", status: "ready", image: "ghcr.io/trycua/linux:24.04-slim", kind: "container", runtime: "gvisor", busy: false, lastError: null });
    const create = calls().find((x) => x.argv[1] === "create");
    expect(create?.argv).toEqual(["sandbox", "create", "linux", "--tier", "slim", "--browser", "--name", "openag-main", "--json", "--wait", "desktop"]);
    expect(verbs()).not.toContain("resume");
    expect(events).toEqual([{ room: "_system", actor: "user", type: "config", payload: { action: "computer_created", name: "openag-main" } }]);
  });

  it("start from stopped resumes instead of creating", async () => {
    seed("stopped");
    const c = make();
    const st = await c.start();
    expect(st.state).toBe("running");
    expect(verbs()).toContain("resume");
    expect(verbs()).not.toContain("create");
    expect(calls().find((x) => x.argv[1] === "resume")?.argv).toEqual(["sandbox", "resume", "openag-main"]);
    expect(events[0]?.payload).toEqual({ action: "computer_started", name: "openag-main" });
  });

  it("start while running makes no create or resume call", async () => {
    seed("running");
    const st = await make().start();
    expect(st.state).toBe("running");
    expect(verbs().filter((v) => v !== "info")).toEqual([]);
    expect(events).toEqual([]);
  });

  it("stop suspends a running sandbox and audits it", async () => {
    seed("running");
    const st = await make().stop();
    expect(st.state).toBe("stopped");
    expect(calls().find((x) => x.argv[1] === "suspend")?.argv).toEqual(["sandbox", "suspend", "openag-main"]);
    expect(events[0]?.payload).toEqual({ action: "computer_stopped", name: "openag-main" });
  });

  it("stop on absent or stopped is a no-op", async () => {
    seed(null);
    const c = make();
    expect((await c.stop()).state).toBe("absent");
    seed("stopped");
    expect((await c.stop()).state).toBe("stopped");
    expect(verbs().filter((v) => v !== "info")).toEqual([]);
  });

  it("destroy passes -f and is a no-op when absent", async () => {
    seed("running");
    const c = make();
    const st = await c.destroy();
    expect(st.exists).toBe(false);
    expect(calls().find((x) => x.argv[1] === "rm")?.argv).toEqual(["sandbox", "rm", "openag-main", "-f"]);
    expect(events[0]?.payload).toEqual({ action: "computer_destroyed", name: "openag-main" });
    const before = calls().length;
    expect((await c.destroy()).state).toBe("absent");
    expect(calls().slice(before).map((x) => x.argv[1])).toEqual(["info"]);
  });

  it("destroy retries a flaky `rm` (real cua leaves a stale container after suspend/resume) and verifies it is gone", async () => {
    seed("stopped");
    const c = make({ rmFlaky: 2 });
    const st = await c.destroy();
    expect(st.state).toBe("absent");
    expect(calls().filter((x) => x.argv[1] === "rm")).toHaveLength(3); // two failures, then success
    expect(events.filter((e) => (e.payload as { action?: string }).action === "computer_destroyed")).toHaveLength(1);
  });

  it("destroy gives up with a short error when rm keeps failing", async () => {
    seed("stopped");
    const c = make({ rmFlaky: 99 });
    await expect(c.destroy()).rejects.toMatchObject({ code: "failed" });
    expect(calls().filter((x) => x.argv[1] === "rm")).toHaveLength(3);
    expect(events.filter((e) => (e.payload as { action?: string }).action === "computer_destroyed")).toHaveLength(0);
  });

  it("maps state: unknown for other states; non-JSON info output is uncertain, never absence", async () => {
    seed("running", "starting");
    expect((await make().status()).state).toBe("unknown");
    expect((await make().status()).status).toBe("starting");
    seed("weird", "x");
    expect((await make().status()).state).toBe("unknown");
    await expect(make({ infoRaw: "not json at all" }).status()).rejects.toThrow(/could not be understood/);
  });

  it("polls until running after a resume", async () => {
    seed("stopped");
    const st = await make({ resumeLag: 2 }).start();
    expect(st.state).toBe("running");
    expect(verbs().filter((v) => v === "info").length).toBeGreaterThanOrEqual(3);
  });

  it("returns the last observed status as unknown when the state never arrives", async () => {
    seed("stopped");
    const st = await make({ resumeLag: 100000 }, { timing: { pollMs: 10, startWaitMs: 60 } }).start();
    expect(st.state).toBe("unknown");
    expect(st.exists).toBe(true);
    expect(st.lastError).toBeNull();
  });

  it("status returns immediately with busy true while a call holds the lock", async () => {
    seed(null);
    const c = make({ sleepMs: 400 });
    const pending = c.start();
    await new Promise((r) => setTimeout(r, 30));
    const t = Date.now();
    const st = await c.status();
    expect(Date.now() - t).toBeLessThan(200);
    expect(st.busy).toBe(true);
    expect(c.busy()).toBe(true);
    await pending;
    expect(c.busy()).toBe(false);
  });

  it("two concurrent lifecycle calls never overlap", async () => {
    seed("stopped");
    const c = make({ sleepMs: 60 });
    await Promise.all([c.start(), c.stop(), c.status()]);
    const lifecycle = calls().filter((x) => x.argv[1] !== "info");
    const ordered = [...calls()].sort((a, b) => a.t0 - b.t0);
    for (let i = 1; i < ordered.length; i++) expect(ordered[i]!.t0).toBeGreaterThanOrEqual(ordered[i - 1]!.t1);
    expect(lifecycle.map((x) => x.argv[1])).toEqual(["resume", "suspend"]);
  });

  it("serialises withLock with the lifecycle calls", async () => {
    seed("running");
    const c = make();
    const order: string[] = [];
    const a = c.withLock(async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 30));
      order.push("a-end");
    });
    const b = c.withLock(async () => order.push("b"));
    await Promise.all([a, b]);
    expect(order).toEqual(["a-start", "a-end", "b"]);
  });
});

describe("missing cua", () => {
  it("reports that cua is not installed instead of a spawn error", async () => {
    const computer = createComputer({ dataDir: dir, cuaBin: join(dir, "missing", "cua"), ledger });
    await expect(computer.status()).rejects.toMatchObject({ message: "cua is not installed" });
  });
});

describe("child environment", () => {
  it("passes only PATH, HOME, LANG and TMPDIR", async () => {
    process.env.OPENAG_TOKEN = "oag_secret_token_value_that_must_not_leak_0000000000000000";
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-not-leak-0123456789";
    process.env.OPENAI_API_KEY = "sk-should-not-leak-0123456789abcdef";
    expect(Object.keys(childEnv({ PATH: "/bin", HOME: "/h", LANG: "C", TMPDIR: "/t", OPENAG_TOKEN: "x" })).sort()).toEqual(["HOME", "LANG", "PATH", "TMPDIR"]);
    seed("running");
    await make().status();
    const keys = calls()[0]!.envKeys;
    expect(keys).not.toContain("OPENAG_TOKEN");
    expect(keys).not.toContain("ANTHROPIC_API_KEY");
    expect(keys).not.toContain("OPENAI_API_KEY");
    for (const k of keys) expect(ALLOWED_ENV.has(k), `unexpected env key ${k}`).toBe(true);
  });
});

describe("screenshot", () => {
  it("writes a verified PNG under computer/screens and returns a relative path", async () => {
    seed("running");
    const shot = await make().screenshot();
    expect(shot.path).toMatch(/^computer\/screens\/\d{8}-\d{6}-\d{3}\.png$/);
    expect(shot).toMatchObject({ width: 1280, height: 800 });
    const bytes = readFileSync(join(dir, shot.path));
    expect(bytes.subarray(0, 8).equals(PNG_MAGIC)).toBe(true);
    expect(calls().find((x) => x.argv[1] === "screenshot")?.argv.slice(0, 5)).toEqual(["sandbox", "screenshot", "openag-main", "-o", join(dir, shot.path)]);
  });

  it("refuses when not running without calling the screenshot CLI", async () => {
    seed("stopped");
    const err = await make().screenshot().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ComputerError);
    expect((err as ComputerError).code).toBe("failed");
    expect((err as ComputerError).message).toBe("computer is not running");
    expect(verbs()).not.toContain("screenshot");
  });

  it("rejects a non-PNG file and leaves nothing behind", async () => {
    seed("running");
    const err = await make({ screenshotBad: "text" }).screenshot().catch((e: unknown) => e);
    expect((err as ComputerError).code).toBe("bad_output");
    expect(existsSync(join(dir, "computer", "screens")) ? readdirSync(join(dir, "computer", "screens")) : []).toEqual([]);
  });

  it("rejects a missing or tiny output file", async () => {
    seed("running");
    const err = await make({ screenshotBad: "nofile" }).screenshot().catch((e: unknown) => e);
    expect((err as ComputerError).code).toBe("bad_output");
  });

  it("keeps only the newest 50 screenshots", async () => {
    seed("running");
    const screens = join(dir, "computer", "screens");
    mkdirSync(screens, { recursive: true });
    for (let i = 0; i < 50; i++) writeFileSync(join(screens, `20200101-0000${String(i).padStart(2, "0")}-000.png`), "x");
    await make().screenshot();
    const names = readdirSync(screens).filter((n) => n.endsWith(".png"));
    expect(names).toHaveLength(50);
    expect(names).not.toContain("20200101-000000-000.png");
    expect(names).toContain("20200101-000001-000.png");
  });
});

describe("errors", () => {
  it("maps failures to ComputerError with a short redacted message and never the secret", async () => {
    seed("stopped");
    const c = make({ fail: "resume" });
    const err = await c.start().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ComputerError);
    expect((err as ComputerError).code).toBe("failed");
    const msg = (err as ComputerError).message;
    expect(msg).toContain("boom");
    expect(msg).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
    expect(msg.length).toBeLessThanOrEqual(200);
    expect((await c.status()).lastError).toBe(msg);
  });

  it("clears lastError after a later successful call", async () => {
    seed("stopped");
    const c = make({ fail: "resume" });
    await c.start().catch(() => undefined);
    expect((await c.status()).lastError).not.toBeNull();
    // A successful stop of a running sandbox clears the error.
    seed("running");
    expect((await c.stop()).lastError).toBeNull();
  });

  it("maps a timed-out call to the timeout code", async () => {
    seed("stopped");
    const run: Runner = (bin, args, opts) =>
      args[1] === "resume" ? Promise.resolve({ code: null, stdout: "", stderr: "", timedOut: true }) : defaultRunner(bin, args, opts);
    const err = await make({}, { run }).start().catch((e: unknown) => e);
    expect((err as ComputerError).code).toBe("timeout");
  });

  it("maps exit 3 on screenshot to not_found", async () => {
    seed("running");
    const run: Runner = (bin, args, opts) =>
      args[1] === "screenshot" ? Promise.resolve({ code: 3, stdout: "", stderr: "cua: not found: sandbox openag-main\n", timedOut: false }) : defaultRunner(bin, args, opts);
    const err = await make({}, { run }).screenshot().catch((e: unknown) => e);
    expect((err as ComputerError).code).toBe("not_found");
  });

  it("rejects an invalid name", () => {
    expect(() => createComputer({ dataDir: dir, name: "Bad_Name" })).toThrow();
    expect(() => createComputer({ dataDir: dir, name: "1abc" })).toThrow();
  });

  it("audit events never carry CLI output", async () => {
    seed("stopped");
    await make({ infoRaw: undefined }).start();
    for (const e of events) expect(Object.keys(e.payload as object).sort()).toEqual(["action", "name"]);
  });
});
