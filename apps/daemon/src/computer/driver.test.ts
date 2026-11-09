import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ComputerError, type ShellResult } from "../computer.js";
import { createDriverComputer, type ComputerDriver, type DriverInfo } from "./driver.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-driver-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const png = (w = 8, h = 6) => {
  const b = Buffer.alloc(200);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

interface FakeOpts {
  shell?: boolean;
  view?: "proxy" | "external" | "none";
  throwWith?: unknown;
  screenshot?: Buffer;
}
function fakeDriver(o: FakeOpts = {}) {
  let info: DriverInfo | null = null;
  const calls: string[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const track = async <T>(name: string, fn: () => T | Promise<T>): Promise<T> => {
    calls.push(name);
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise((r) => setTimeout(r, 5));
    try {
      if (o.throwWith !== undefined && name === "act") throw o.throwWith;
      return await fn();
    } finally {
      concurrent--;
    }
  };
  const driver: ComputerDriver = {
    kind: "browserbase",
    name: "fake-box",
    capabilities: { shell: o.shell ?? false, view: o.view ?? "external" },
    inspect: async () => info,
    create: () => track("create", () => void (info = { state: "running", status: "ready", image: null, kind: "browser", runtime: "fake" })),
    start: () => track("start", () => void (info = { ...info!, state: "running" })),
    stop: () => track("stop", () => void (info = { ...info!, state: "stopped" })),
    destroy: () => track("destroy", () => void (info = null)),
    screenshot: () => track("screenshot", () => o.screenshot ?? png()),
    act: (argv) => track("act", () => ({ message: `did ${argv.join(" ")} sk-abcdefghijklmnopqrstuvwxyz0123` })),
    shell: (cmd) => track("shell", (): ShellResult => ({ exitCode: 0, stdout: `out sk-abcdefghijklmnopqrstuvwxyz0123 ${cmd}`, stderr: "", truncated: false, timedOut: false })),
    viewLink: () => track("viewLink", () => ({ kind: "external" as const, url: "https://live.example.com/x", expiresAt: Date.now() + 1000 })),
  };
  return { driver, calls, max: () => maxConcurrent, setInfo: (i: DriverInfo | null) => (info = i) };
}
const make = (o?: FakeOpts, extra: Parameters<typeof createDriverComputer>[1] = { dataDir: dir }) => {
  const f = fakeDriver(o);
  return { ...f, computer: createDriverComputer(f.driver, { dataDir: dir, timing: { pollMs: 5, startWaitMs: 200, stopWaitMs: 200 }, ...extra }) };
};

describe("lifecycle", () => {
  test("start creates a missing box, resumes a stopped one and is a no-op when running; status says which backend", async () => {
    const { computer, calls } = make();
    expect((await computer.status()).state).toBe("absent");
    expect((await computer.start()).state).toBe("running");
    expect(calls).toEqual(["create"]);
    await computer.start();
    expect(calls).toEqual(["create"]);
    expect((await computer.stop()).state).toBe("stopped");
    await computer.start();
    expect(calls).toEqual(["create", "stop", "start"]);
    expect((await computer.status()).backend).toBe("browserbase");
    expect((await computer.destroy()).state).toBe("absent");
  });

  test("a driver error becomes lastError with its fixed message; generic errors never leak their text", async () => {
    const f = fakeDriver();
    f.driver.create = async () => {
      throw new Error("boom with secret sk-abcdefghijklmnopqrstuvwxyz0123");
    };
    const c = createDriverComputer(f.driver, { dataDir: dir });
    await expect(c.start()).rejects.toMatchObject({ code: "failed", message: "create failed" });
    expect((await c.status()).lastError).toBe("create failed");
    expect(JSON.stringify(await c.status())).not.toContain("sk-abc");
  });
});

describe("serialisation and the input guard", () => {
  test("calls never overlap", async () => {
    const { computer, max } = make({ shell: true });
    await computer.start();
    await Promise.all([computer.act(["click", "1", "2"]), computer.screenshot(), computer.shell("echo", 5), computer.act(["key", "enter"])]);
    expect(max()).toBe(1);
  });

  test("act and shell are refused as `paused` before the driver is touched; screenshots still work; the guard can be replaced", async () => {
    let reason: string | null = "human has control";
    const { computer, calls } = make({ shell: true }, { dataDir: dir, inputGuard: () => reason });
    await computer.start();
    calls.length = 0;
    await expect(computer.act(["click", "1", "2"])).rejects.toMatchObject({ code: "paused", message: "human has control" });
    await expect(computer.shell("ls", 5)).rejects.toMatchObject({ code: "paused" });
    expect(calls).toEqual([]);
    expect((await computer.screenshot()).path).toMatch(/\.png$/);
    reason = null;
    computer.setInputGuard(() => "other");
    await expect(computer.act(["key", "a"])).rejects.toMatchObject({ message: "other" });
    computer.setInputGuard(undefined);
    expect((await computer.act(["key", "a"])).message).toContain("did key a");
  });

  test("act, shell and screenshot refuse when the box is not running, without calling the driver", async () => {
    const { computer, calls } = make({ shell: true });
    await expect(computer.act(["click", "1", "2"])).rejects.toMatchObject({ message: "computer is not running" });
    await expect(computer.screenshot()).rejects.toMatchObject({ message: "computer is not running" });
    expect(calls).toEqual([]);
  });
});

describe("output handling", () => {
  test("messages and shell output are redacted and capped", async () => {
    const { computer } = make({ shell: true });
    await computer.start();
    expect((await computer.act(["click", "1", "2"])).message).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
    expect((await computer.shell("echo", 5)).stdout).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
  });

  test("a backend without a shell refuses shell() with a clear error and never calls the driver", async () => {
    const { computer, calls } = make({ shell: false });
    await computer.start();
    calls.length = 0;
    await expect(computer.shell("ls", 5)).rejects.toMatchObject({ code: "failed", message: "this computer backend has no shell" });
    expect(calls).toEqual([]);
    expect(computer.capabilities().shell).toBe(false);
  });

  test("a ComputerError from the driver keeps its code and message", async () => {
    const { computer } = make({ throwWith: new ComputerError("timeout", "action timed out") });
    await computer.start();
    await expect(computer.act(["click", "1", "2"])).rejects.toMatchObject({ code: "timeout", message: "action timed out" });
  });
});

describe("screenshots", () => {
  test("valid PNGs are stored under computer/screens with their real size; the newest 50 are kept", async () => {
    const { computer } = make({ screenshot: png(1280, 800) });
    await computer.start();
    const shot = await computer.screenshot();
    expect(shot).toMatchObject({ width: 1280, height: 800 });
    expect(shot.path.startsWith(join("computer", "screens"))).toBe(true);
    expect(existsSync(join(dir, shot.path))).toBe(true);
    for (let i = 0; i < 55; i++) await computer.screenshot();
    expect(readdirSync(join(dir, "computer", "screens")).length).toBeLessThanOrEqual(50);
  });

  test.each([
    ["not a PNG", Buffer.alloc(300, 7)],
    ["too small", Buffer.alloc(10)],
  ])("%s is rejected and nothing is written", async (_n, buf) => {
    const { computer } = make({ screenshot: buf });
    await computer.start();
    await expect(computer.screenshot()).rejects.toMatchObject({ code: "bad_output" });
    expect(existsSync(join(dir, "computer", "screens")) ? readdirSync(join(dir, "computer", "screens")) : []).toEqual([]);
  });
});

describe("viewLink", () => {
  test("a backend with no live view refuses; otherwise the driver's link is returned", async () => {
    const none = make({ view: "none" });
    await none.computer.start();
    await expect(none.computer.viewLink()).rejects.toMatchObject({ message: "this computer backend has no live view" });
    const ext = make({ view: "external" });
    await ext.computer.start();
    expect(await ext.computer.viewLink()).toMatchObject({ kind: "external", url: "https://live.example.com/x" });
  });
});

describe("status caching", () => {
  test("repeated status polls inside 5 s do not call the driver again; lifecycle and actions always refresh", async () => {
    const f = fakeDriver();
    let inspects = 0;
    const inner = f.driver.inspect;
    f.driver.inspect = async () => {
      inspects++;
      return inner();
    };
    const computer = createDriverComputer(f.driver, { dataDir: dir, timing: { pollMs: 5, startWaitMs: 200, stopWaitMs: 200 } });
    await computer.status();
    const after1 = inspects;
    for (let i = 0; i < 5; i++) await computer.status();
    expect(inspects).toBe(after1); // served from the recent observation
    await computer.start(); // lifecycle refreshes
    expect(inspects).toBeGreaterThan(after1);
    const afterStart = inspects;
    await computer.act(["click", "1", "2"]); // actions refresh too
    expect(inspects).toBeGreaterThan(afterStart);
    expect((await computer.status()).state).toBe("running");
  });
});
