import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Computer, ComputerStatus } from "../computer.js";
import { openDb, type Db } from "../db/index.js";
import { createLedger } from "../ledger.js";
import { createComputerRouter, type BackendKind } from "./router.js";

let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-router-"));
  db = openDb(dir);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function fakeComputer(kind: BackendKind) {
  const log: string[] = [];
  let busy = false;
  let guard: unknown;
  const status = (): ComputerStatus => ({ backend: kind, name: kind, exists: true, state: "running", status: "ready", image: null, kind: null, runtime: null, busy, lastError: null });
  const c: Computer = {
    name: kind,
    status: async () => status(),
    start: async () => (log.push("start"), status()),
    stop: async () => (log.push("stop"), status()),
    destroy: async () => (log.push("destroy"), status()),
    screenshot: async () => (log.push("screenshot"), { path: `${kind}.png`, width: 1, height: 1 }),
    act: async (a) => (log.push(`act ${a.join(" ")}`), { message: kind }),
    shell: async () => ({ exitCode: 0, stdout: kind, stderr: "", truncated: false, timedOut: false }),
    viewLink: async () => ({ kind: "external", url: "https://x.example.com", expiresAt: 0 }),
    setInputGuard: (g) => void (guard = g),
    capabilities: () => ({ shell: kind !== "browserbase", view: "none" }),
    withLock: (fn) => fn(),
    busy: () => busy,
  };
  return { c, log, setBusy: (b: boolean) => (busy = b), guard: () => guard };
}

function setup(initial: BackendKind = "cua", missing: Partial<Record<BackendKind, string>> = {}) {
  let wanted = initial;
  let blocked = false;
  const fakes = { cua: fakeComputer("cua"), browserbase: fakeComputer("browserbase"), docker: fakeComputer("docker"), ssh: fakeComputer("ssh") };
  const created: BackendKind[] = [];
  const ledger = createLedger(db);
  const router = createComputerRouter({
    create: {
      cua: () => (created.push("cua"), fakes.cua.c),
      browserbase: () => (created.push("browserbase"), fakes.browserbase.c),
      docker: () => (created.push("docker"), fakes.docker.c),
      ssh: () => (created.push("ssh"), fakes.ssh.c),
    },
    unavailable: { cua: () => missing.cua ?? null, browserbase: () => missing.browserbase ?? null, docker: () => missing.docker ?? null, ssh: () => missing.ssh ?? null },
    wanted: () => wanted,
    switchBlocked: () => blocked,
    ledger,
  });
  return { router, fakes, created, ledger, want: (k: BackendKind) => (wanted = k), block: (b: boolean) => (blocked = b) };
}

describe("selection", () => {
  test("forwards every call to the active backend, created lazily, and the others are never created", async () => {
    const { router, fakes, created } = setup("cua");
    expect(created).toEqual([]);
    await router.act(["click", "1", "2"]);
    await router.screenshot();
    expect(fakes.cua.log).toEqual(["act click 1 2", "screenshot"]);
    expect(created).toEqual(["cua"]);
    expect((await router.status()).backend).toBe("cua");
  });

  test("a backend change applies on the next call, is audited, and the guard follows to the new backend", async () => {
    const { router, fakes, want, ledger } = setup("cua");
    const guard = () => "human has control";
    router.setInputGuard(guard);
    await router.act(["key", "a"]);
    want("browserbase");
    await router.act(["key", "b"]);
    expect(fakes.browserbase.log).toEqual(["act key b"]);
    expect(fakes.browserbase.guard()).toBe(guard);
    expect(router.activeBackend()).toBe("browserbase");
    const ev = ledger.list("_system").filter((e) => e.type === "config" && (e.payload as { action?: string }).action === "computer_backend_switched");
    expect(ev.map((e) => e.payload)).toEqual([{ action: "computer_backend_switched", from: "cua", to: "browserbase" }]);
  });

  test("no switch while the current backend is busy or a human holds control; it applies once both clear", async () => {
    const { router, fakes, want, block } = setup("cua");
    await router.act(["key", "a"]);
    want("docker");
    fakes.cua.setBusy(true);
    await router.act(["key", "b"]);
    expect(fakes.docker.log).toEqual([]);
    fakes.cua.setBusy(false);
    block(true);
    await router.act(["key", "c"]);
    expect(fakes.docker.log).toEqual([]);
    block(false);
    await router.act(["key", "d"]);
    expect(fakes.docker.log).toEqual(["act key d"]);
  });

  test("capabilities and name follow the active backend", async () => {
    const { router, want } = setup("browserbase");
    expect(router.capabilities().shell).toBe(false);
    await router.start();
    expect(router.name).toBe("browserbase");
    want("cua");
    expect(router.capabilities().shell).toBe(true);
  });
});

describe("inert backends", () => {
  test("an unconfigured backend is never created or contacted; status explains why and every action fails with the reason", async () => {
    const { router, created } = setup("browserbase", { browserbase: "BROWSERBASE_API_KEY is not set" });
    const st = await router.status();
    expect(st).toMatchObject({ backend: "browserbase", state: "absent", lastError: "BROWSERBASE_API_KEY is not set" });
    for (const call of [() => router.start(), () => router.act(["click", "1", "2"]), () => router.screenshot(), () => router.shell("ls", 5), () => router.viewLink()]) {
      await expect(call()).rejects.toMatchObject({ message: "BROWSERBASE_API_KEY is not set" });
    }
    expect(created).toEqual([]);
    expect(router.capabilities()).toEqual({ shell: false, view: "none" });
  });

  test("availability lists every backend with its reason", () => {
    const { router } = setup("cua", { docker: "docker is not installed", ssh: "OPENAG_SSH_HOST is not set" });
    expect(router.availability()).toEqual([
      { backend: "cua", reason: null },
      { backend: "browserbase", reason: null },
      { backend: "docker", reason: "docker is not installed" },
      { backend: "ssh", reason: "OPENAG_SSH_HOST is not set" },
    ]);
  });

  test("Cua keeps working when another backend is selected and broken, then wanted again", async () => {
    const { router, fakes, want } = setup("cua", { browserbase: "no key" });
    await router.act(["key", "a"]);
    want("browserbase");
    await expect(router.act(["key", "b"])).rejects.toMatchObject({ message: "no key" });
    want("cua");
    await router.act(["key", "c"]);
    expect(fakes.cua.log).toEqual(["act key a", "act key c"]);
  });
});

describe("hosted backends", () => {
  const hosted = (kind: BackendKind) => {
    const f = fakeComputer(kind);
    f.c.capabilities = () => ({ shell: false, view: "external", hosted: true });
    // A release is only confirmed when the backend reports the session stopped or absent.
    f.c.stop = async () => (f.log.push("stop"), { ...(await f.c.status()), exists: false, state: "absent" as const });
    return f;
  };

  test("switching AWAY from a hosted backend releases its session (it would keep billing otherwise)", async () => {
    let wanted: BackendKind = "browserbase";
    const bb = hosted("browserbase");
    const cua = fakeComputer("cua");
    const router = createComputerRouter({
      create: { cua: () => cua.c, browserbase: () => bb.c, docker: () => fakeComputer("docker").c, ssh: () => fakeComputer("ssh").c },
      unavailable: { cua: () => null, browserbase: () => null, docker: () => null, ssh: () => null },
      wanted: () => wanted,
    });
    await router.act(["click", "1", "2"]);
    wanted = "cua";
    await router.act(["key", "a"]);
    expect(bb.log).toContain("stop");
    expect(cua.log).toEqual(["act key a"]);
  });

  test("switching away from a NON-hosted backend does not stop it", async () => {
    const { router, fakes, want } = setup("cua");
    await router.act(["key", "a"]);
    want("docker");
    await router.act(["key", "b"]);
    expect(fakes.cua.log).not.toContain("stop");
  });

  test("releaseHosted stops every hosted session the router created and nothing else", async () => {
    const bb = hosted("browserbase");
    const cua = fakeComputer("cua");
    const router = createComputerRouter({
      create: { cua: () => cua.c, browserbase: () => bb.c, docker: () => fakeComputer("docker").c, ssh: () => fakeComputer("ssh").c },
      unavailable: { cua: () => null, browserbase: () => null, docker: () => null, ssh: () => null },
      wanted: () => "browserbase",
    });
    await router.status();
    await router.releaseHosted();
    expect(bb.log).toEqual(["stop"]);
    expect(cua.log).toEqual([]);
  });

  test("releaseHosted fails loudly when the backend does not confirm the session stopped", async () => {
    const bb = fakeComputer("browserbase");
    bb.c.capabilities = () => ({ shell: false, view: "external", hosted: true });
    const router = createComputerRouter({
      create: { cua: () => fakeComputer("cua").c, browserbase: () => bb.c, docker: () => fakeComputer("docker").c, ssh: () => fakeComputer("ssh").c },
      unavailable: { cua: () => null, browserbase: () => null, docker: () => null, ssh: () => null },
      wanted: () => "browserbase",
    });
    await router.status();
    await expect(router.releaseHosted()).rejects.toThrow(/unconfirmed/);
  });
});
