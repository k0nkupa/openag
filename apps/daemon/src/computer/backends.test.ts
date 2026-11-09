import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createComputerBackends } from "./backends.js";
import type { BackendKind } from "./router.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-backends-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const make = (wanted: BackendKind, env: NodeJS.ProcessEnv = {}, fetchMock = vi.fn(async () => new Response("{}", { status: 500 }))) => ({
  router: createComputerBackends({ dataDir: dir, wanted: () => wanted, env, fetch: fetchMock as unknown as typeof fetch }),
  fetchMock,
});

describe("environment-driven availability", () => {
  test("Cua is always available; Browserbase needs a valid key; Docker and the remote box are not in this build", () => {
    const { router } = make("cua", {});
    const reasons = Object.fromEntries(router.availability().map((a) => [a.backend, a.reason]));
    expect(reasons.cua).toBeNull();
    expect(reasons.browserbase).toBe("BROWSERBASE_API_KEY is not set");
    expect(reasons.docker === null || /docker is not installed/.test(reasons.docker)).toBe(true);
    expect(reasons.ssh === "ssh is not installed" || /OPENAG_SSH_HOST is not set/.test(reasons.ssh!)).toBe(true);
    const withKey = make("cua", { BROWSERBASE_API_KEY: "bb_live_abcdefghijkl" }).router;
    expect(withKey.availability().find((a) => a.backend === "browserbase")!.reason).toBeNull();
  });

  test.each([
    ["has spaces", { BROWSERBASE_API_KEY: "bad key value here" }],
    ["too short", { BROWSERBASE_API_KEY: "short" }],
    ["control chars", { BROWSERBASE_API_KEY: "abcdefgh\nijkl" }],
    ["bad project id", { BROWSERBASE_API_KEY: "bb_live_abcdefghijkl", BROWSERBASE_PROJECT_ID: "bad id!" }],
  ])("an invalid configuration (%s) keeps Browserbase inert with a reason that never echoes the value", (_n, env) => {
    const { router } = make("cua", env);
    const reason = router.availability().find((a) => a.backend === "browserbase")!.reason!;
    expect(reason).toMatch(/BROWSERBASE_/);
    expect(reason).not.toContain("bad key");
    expect(reason).not.toContain("bb_live");
  });
});

describe("inert without configuration", () => {
  test("Browserbase selected without a key never makes a request and every action fails with the reason", async () => {
    const { router, fetchMock } = make("browserbase", {});
    expect(await router.status()).toMatchObject({ backend: "browserbase", state: "absent", lastError: "BROWSERBASE_API_KEY is not set" });
    await expect(router.start()).rejects.toMatchObject({ message: "BROWSERBASE_API_KEY is not set" });
    await expect(router.act(["click", "1", "2"])).rejects.toMatchObject({ message: "BROWSERBASE_API_KEY is not set" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("Docker without a docker executable and the remote box fail with a clear reason, and Cua selection is unaffected", async () => {
    await expect(make("docker", { PATH: "/nonexistent-dir" }).router.start()).rejects.toMatchObject({ message: "docker is not installed" });
    await expect(make("ssh", { PATH: "/nonexistent-dir" }).router.start()).rejects.toMatchObject({ message: "ssh is not installed" });
    const { router } = make("cua");
    expect(router.peek().backend).toBe("cua"); // passive: does not need the cua CLI on the test machine
  });
});

describe("with a key", () => {
  test("Browserbase is created lazily, the key goes only into a header, and start creates a session", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (init.method === "POST" && String(url).endsWith("/v1/sessions")) {
        return new Response(JSON.stringify({ id: "sess_123456", status: "RUNNING", connectUrl: "wss://connect.browserbase.com/x" }), { status: 201, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ id: "sess_123456", status: "RUNNING" }), { status: 200 });
    });
    const { router } = make("browserbase", { BROWSERBASE_API_KEY: "bb_live_abcdefghijkl", BROWSERBASE_PROJECT_ID: "proj_123456" }, fetchMock as never);
    expect(fetchMock).not.toHaveBeenCalled();
    const st = await router.start();
    expect(st).toMatchObject({ backend: "browserbase", state: "running" });
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.url.startsWith("https://api.browserbase.com/")).toBe(true);
      expect(c.url).not.toContain("bb_live");
      expect((c.init.headers as Record<string, string>)["X-BB-API-Key"]).toBe("bb_live_abcdefghijkl");
    }
    expect(router.capabilities()).toEqual({ shell: false, view: "external", hosted: true });
  });
});

describe("docker configuration", () => {
  test("a bad container name or image keeps Docker inert with a reason that does not echo the value", async () => {
    const { mkdirSync, writeFileSync, chmodSync } = await import("node:fs");
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "docker"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, "docker"), 0o755);
    const ok = make("cua", { PATH: bin }).router.availability().find((a) => a.backend === "docker");
    expect(ok!.reason).toBeNull();
    for (const env of [{ OPENAG_DOCKER_NAME: "Bad Name!" }, { OPENAG_DOCKER_IMAGE: "x y; rm -rf /" }]) {
      const reason = make("cua", { PATH: bin, ...env }).router.availability().find((a) => a.backend === "docker")!.reason!;
      expect(reason).toMatch(/OPENAG_DOCKER_/);
      expect(reason).not.toContain("rm -rf");
      expect(reason).not.toContain("Bad Name");
    }
  });
});

describe("remote box configuration", () => {
  test("without OPENAG_SSH_* the backend is inert with the first missing variable named; with a valid configuration it is available", async () => {
    const { mkdirSync, writeFileSync, chmodSync } = await import("node:fs");
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "ssh"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, "ssh"), 0o755);
    const none = make("cua", { PATH: bin }).router.availability().find((a) => a.backend === "ssh");
    expect(none!.reason).toBe("OPENAG_SSH_HOST is not set");
    const key = join(dir, "id");
    const known = join(dir, "known");
    writeFileSync(key, "K");
    chmodSync(key, 0o600);
    writeFileSync(known, "h ssh-ed25519 AAAA\n");
    const ok = make("cua", { PATH: bin, OPENAG_SSH_HOST: "box.example.com", OPENAG_SSH_USER: "agent", OPENAG_SSH_KEY_FILE: key, OPENAG_SSH_KNOWN_HOSTS: known }).router.availability().find((a) => a.backend === "ssh");
    expect(ok!.reason).toBeNull();
  });
});
