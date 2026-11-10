import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ComputerError } from "../computer.js";
import { createDriverComputer } from "./driver.js";
import { createDockerDriver, type DockerRunner, type DockerRunResult, dockerAvailability } from "./docker.js";

const SECRET = "SECRET-leak-7c21";

interface Call {
  bin: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  binary?: boolean;
  timeoutMs: number;
}

const png = () => {
  const b = Buffer.alloc(200);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(8, 16);
  b.writeUInt32BE(6, 20);
  return b;
};

const ok = (stdout = "") => ({ code: 0, stdout, stderr: "", timedOut: false });
const fail = (code: number | null, stderr = "", extra: { timedOut?: boolean } = {}) => ({
  code,
  stdout: "",
  stderr,
  timedOut: extra.timedOut ?? false,
});

/** A fake docker CLI with a tiny state machine. */
function fakeDocker(override?: (args: readonly string[]) => DockerRunResult | undefined) {
  const state = { exists: false, running: false };
  const calls: Call[] = [];
  const run: DockerRunner = async (bin, args, o) => {
    calls.push({ bin, args: [...args], env: o.env, binary: o.binary, timeoutMs: o.timeoutMs });
    const forced = override?.(args);
    if (forced) return forced;
    const verb = args[0];
    if (verb === "inspect") return state.exists ? ok(JSON.stringify({ Running: state.running })) : fail(1, "Error: No such object: openag-box\n");
    if (verb === "run") {
      state.exists = true;
      state.running = true;
      return ok("abc123\n");
    }
    if (verb === "start") {
      state.running = true;
      return ok();
    }
    if (verb === "stop") {
      state.running = false;
      return ok();
    }
    if (verb === "rm") {
      state.exists = false;
      state.running = false;
      return ok();
    }
    if (verb === "exec") {
      // The transport wraps every command in `timeout -k 2 N` so the BOX enforces the limit.
      const wrapped = args.slice(4);
      const argv = wrapped[0] === "timeout" ? wrapped.slice(4) : wrapped;
      if (argv[0] === "import") return { code: 0, stdout: png() as unknown as string, stderr: "", timedOut: false };
      if (argv[0] === "sh") return ok("hi\n");
      return ok();
    }
    return fail(2, "unknown");
  };
  return { run, calls, state };
}

const HOME_ENV: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin", HOME: "/home/t", LANG: "C.UTF-8", TMPDIR: "/tmp" };

describe("docker argv", () => {
  test("inspect", async () => {
    const f = fakeDocker();
    await createDockerDriver({ run: f.run, env: HOME_ENV }).inspect();
    expect(f.calls[0]?.args).toEqual(["inspect", "--format", "{{json .State}}", "openag-box"]);
    expect(f.calls[0]?.bin).toBe("docker");
  });

  test("create is hardened: no privileged, no mounts beyond the named volume, no ports", async () => {
    const f = fakeDocker();
    await createDockerDriver({ run: f.run, env: HOME_ENV }).create();
    expect(f.calls[0]?.args).toEqual([
      "run",
      "-d",
      "--name",
      "openag-box",
      "--label",
      "openag=1",
      "--pull",
      "never",
      "--init",
      "--cap-drop",
      "ALL",
      "--pids-limit",
      "512",
      "--security-opt",
      "no-new-privileges",
      "--shm-size",
      "1g",
      "--memory",
      "4g",
      "--cpus",
      "2",
      "-v",
      "openag-openag-box-workspace:/workspace",
      "openag/computer:latest",
    ]);
    const all = f.calls[0]?.args.join(" ") ?? "";
    expect(all).not.toMatch(/--privileged|--publish|--mount|-p |-v \//);
    expect(all).toContain("-v openag-openag-box-workspace:/workspace");
  });

  test("start, stop, destroy", async () => {
    const f = fakeDocker();
    const d = createDockerDriver({ run: f.run, env: HOME_ENV });
    await d.start();
    await d.stop();
    await d.destroy();
    expect(f.calls.map((c) => c.args)).toEqual([["start", "openag-box"], ["stop", "-t", "10", "openag-box"], ["rm", "-f", "openag-box"]]);
  });

  test("exec runs argv with DISPLAY set and no shell", async () => {
    const f = fakeDocker();
    const d = createDockerDriver({ run: f.run, env: HOME_ENV });
    await d.act(["click", "10", "20"]);
    await d.screenshot();
    await d.shell("echo hi; id", 5);
    expect(f.calls[0]?.args).toEqual([
      "exec",
      "-e",
      "DISPLAY=:99",
      "openag-box",
      "timeout",
      "-k",
      "2",
      "18",
      "xdotool",
      "mousemove",
      "--sync",
      "10",
      "20",
      "click",
      "1",
    ]);
    expect(f.calls[1]?.args).toEqual(["exec", "-e", "DISPLAY=:99", "openag-box", "timeout", "-k", "2", "28", "import", "-window", "root", "png:-"]);
    expect(f.calls[1]?.binary).toBe(true);
    expect(f.calls[2]?.args).toEqual(["exec", "-e", "DISPLAY=:99", "openag-box", "timeout", "-k", "2", "8", "sh", "-c", "echo hi; id"]);
  });

  test("the box enforces the time limit itself (timeout wrapper), a bit before the local client gives up, and 124 is a timeout", async () => {
    const f = fakeDocker();
    const d = createDockerDriver({ run: f.run, env: HOME_ENV });
    await d.shell("sleep 1", 30);
    const wrapped = f.calls.at(-1)!.args.slice(4);
    expect(wrapped.slice(0, 3)).toEqual(["timeout", "-k", "2"]);
    expect(Number(wrapped[3])).toBeLessThan(30 + 5); // below the transport timeout (30 s + 5 s slack)
    expect(Number(wrapped[3])).toBeGreaterThanOrEqual(30);
  });

  test("display option is used", async () => {
    const f = fakeDocker();
    await createDockerDriver({ run: f.run, env: HOME_ENV, display: ":42" }).act(["key", "enter"]);
    expect(f.calls[0]?.args.slice(0, 3)).toEqual(["exec", "-e", "DISPLAY=:42"]);
  });

  test("custom name, image and bin", async () => {
    const f = fakeDocker();
    await createDockerDriver({ run: f.run, env: HOME_ENV, name: "my.box_1", image: "ghcr.io/o/img:1.2", bin: "/opt/docker" }).destroy();
    expect(f.calls[0]).toMatchObject({ bin: "/opt/docker", args: ["rm", "-f", "my.box_1"] });
  });
});

describe("name and image validation", () => {
  test("bad names are refused at creation", () => {
    for (const name of ["Bad", "-x", "1box", "a b", "a;rm", "a".repeat(64), ""]) {
      expect(() => createDockerDriver({ name, run: fakeDocker().run })).toThrow("invalid docker container name");
    }
  });

  test("bad image references are refused at creation", () => {
    for (const image of ["Bad:Image", "img with space", "", "x;rm -rf", "-img", "a".repeat(202), "img\nx"]) {
      expect(() => createDockerDriver({ image, run: fakeDocker().run })).toThrow("invalid docker image reference");
    }
  });

  test("good names and images are accepted", () => {
    expect(() => createDockerDriver({ name: "openag-box", image: "openag/computer:latest", run: fakeDocker().run })).not.toThrow();
    expect(() => createDockerDriver({ name: "a", image: "registry.local:5000/x/y@sha256:abc", run: fakeDocker().run })).not.toThrow();
  });
});

describe("child environment", () => {
  test("only the allow-listed keys reach the docker CLI, even with secrets in the daemon env", async () => {
    const f = fakeDocker();
    const poisoned: NodeJS.ProcessEnv = {
      ...HOME_ENV,
      OPENAG_TOKEN: SECRET,
      ANTHROPIC_API_KEY: SECRET,
      BROWSERBASE_API_KEY: SECRET,
      DOCKER_HOST: "unix:///var/run/docker.sock",
      DOCKER_CONTEXT: "orbstack",
      DOCKER_CONFIG: "/home/t/.docker",
    };
    await createDockerDriver({ run: f.run, env: poisoned }).inspect();
    const env = f.calls[0]?.env ?? {};
    expect(Object.keys(env).sort()).toEqual(["DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_HOST", "HOME", "LANG", "PATH", "TMPDIR"]);
    expect(JSON.stringify(env)).not.toContain(SECRET);
  });

  test("defaults to process.env when no env is given, still filtered", async () => {
    const saved = { ...process.env };
    process.env.OPENAG_TOKEN = SECRET;
    try {
      const f = fakeDocker();
      await createDockerDriver({ run: f.run }).inspect();
      expect(f.calls[0]?.env.OPENAG_TOKEN).toBeUndefined();
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});

describe("inspect", () => {
  test("absent", async () => {
    const f = fakeDocker();
    expect(await createDockerDriver({ run: f.run, env: HOME_ENV }).inspect()).toBeNull();
  });

  test("running and stopped", async () => {
    const running = fakeDocker(() => ok('{"Running":true,"Status":"running"}'));
    expect(await createDockerDriver({ run: running.run, env: HOME_ENV }).inspect()).toEqual({
      state: "running",
      status: "ready",
      image: "openag/computer:latest",
      kind: "container",
      runtime: "docker",
    });
    const stopped = fakeDocker(() => ok('{"Running":false,"Status":"exited"}'));
    expect((await createDockerDriver({ run: stopped.run, env: HOME_ENV }).inspect())?.state).toBe("stopped");
  });

  test("unparseable output is bad_output", async () => {
    const f = fakeDocker(() => ok("not json"));
    const err = await createDockerDriver({ run: f.run, env: HOME_ENV }).inspect().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ComputerError);
    expect((err as ComputerError).message).toBe("status check failed");
  });
});

describe("failure mapping", () => {
  const cases: Array<[string, ReturnType<typeof fail>, string]> = [
    ["binary missing (no output)", fail(null), "docker is not installed"],
    [
      "daemon down",
      fail(1, `Cannot connect to the Docker daemon at unix:///var/run/docker.sock. ${SECRET}`),
      "the Docker daemon is not running",
    ],
    [
      "image missing on run",
      fail(125, `Unable to find image 'openag/computer:latest' locally ${SECRET}`),
      "docker image not found: pull or build it first",
    ],
    ["pull denied", fail(1, `pull access denied for openag/computer ${SECRET}`), "docker image not found: pull or build it first"],
    ["timeout", fail(null, "", { timedOut: true }), "timed out"],
    ["unknown error", fail(1, `boom ${SECRET}`), "start failed"],
  ];

  for (const [label, res, message] of cases) {
    test(label, async () => {
      const f = fakeDocker((args) => (args[0] === "start" ? res : undefined));
      const err = await createDockerDriver({ run: f.run, env: HOME_ENV }).start().then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ComputerError);
      expect((err as ComputerError).message).toBe(message);
      expect((err as ComputerError).message).not.toContain(SECRET);
    });
  }

  test("create maps image-missing", async () => {
    const f = fakeDocker((args) => (args[0] === "run" ? fail(125, "Unable to find image") : undefined));
    await expect(createDockerDriver({ run: f.run, env: HOME_ENV }).create()).rejects.toThrow("docker image not found: pull or build it first");
  });

  test("destroy of an already-absent box succeeds", async () => {
    const f = fakeDocker((args) => (args[0] === "rm" ? fail(1, "Error: No such container: openag-box") : undefined));
    await expect(createDockerDriver({ run: f.run, env: HOME_ENV }).destroy()).resolves.toBeUndefined();
  });

  test("inspect with a daemon error is not reported as absent", async () => {
    const f = fakeDocker(() => fail(1, "Cannot connect to the Docker daemon"));
    await expect(createDockerDriver({ run: f.run, env: HOME_ENV }).inspect()).rejects.toThrow("the Docker daemon is not running");
  });

  test("exec failures never carry stderr", async () => {
    const f = fakeDocker((args) => (args[0] === "exec" ? fail(1, `leak ${SECRET}`) : undefined));
    const err = await createDockerDriver({ run: f.run, env: HOME_ENV }).act(["type", "--", SECRET]).then(
      () => null,
      (e: unknown) => e as ComputerError,
    );
    expect(err?.message).toBe("action failed");
    expect(err?.message).not.toContain(SECRET);
  });
});

describe("dockerAvailability", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "openag-docker-path-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("null when an executable docker is on PATH", () => {
    writeFileSync(join(dir, "docker"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, "docker"), 0o755);
    expect(dockerAvailability({ PATH: `/nonexistent:${dir}` })).toBeNull();
  });

  test("not installed when docker is absent or not executable", () => {
    expect(dockerAvailability({ PATH: dir })).toBe("docker is not installed");
    writeFileSync(join(dir, "docker"), "x");
    chmodSync(join(dir, "docker"), 0o644);
    expect(dockerAvailability({ PATH: dir })).toBe("docker is not installed");
    expect(dockerAvailability({})).toBe("docker is not installed");
  });
});

describe("integration through createDriverComputer", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "openag-docker-int-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("start, act, screenshot, shell, stop", async () => {
    const f = fakeDocker();
    const computer = createDriverComputer(createDockerDriver({ run: f.run, env: HOME_ENV }), {
      dataDir: dir,
      timing: { pollMs: 1, startWaitMs: 2000, stopWaitMs: 2000 },
    });
    const started = await computer.start();
    expect(started).toMatchObject({ backend: "docker", exists: true, state: "running", runtime: "docker" });
    expect(f.calls[0]?.args[0]).toBe("inspect");
    expect((await computer.act(["click", "5", "6"])).message).toBe("clicked (5, 6) left");
    const shot = await computer.screenshot();
    expect(shot.path).toMatch(/\.png$/);
    const sh = await computer.shell("echo hi", 5);
    expect(sh).toMatchObject({ exitCode: 0, stdout: "hi\n" });
    const stopped = await computer.stop();
    expect(stopped.state).toBe("stopped");
    expect(computer.capabilities()).toEqual({ shell: true, view: "none", hosted: false });
    await expect(createDockerDriver({ run: f.run, env: HOME_ENV }).viewLink()).rejects.toThrow("this computer backend has no live view");
  });
});
