import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { ComputerError } from "../computer.js";
import type { ComputerDriver, DriverInfo } from "./driver.js";
import { boxTimeout, createX11Driver, type X11ExecResult, type X11Lifecycle } from "./x11.js";

/**
 * Local Docker backend: an X11 box in a container (see docker/computer/Dockerfile and docs/notes/docker-computer.md).
 * Every docker call is an argv array (no shell). The child env is ONLY the allow-listed keys below, so the owner token
 * and API keys never reach the docker CLI. The container gets no privileges, no host mounts and no published ports.
 */

const NAME_RE = /^[a-z][a-z0-9_.-]{0,62}$/;
const IMAGE_RE = /^[a-z0-9][a-z0-9._/:@-]{0,200}$/;
const DOCKER_ENV_KEYS = ["PATH", "HOME", "LANG", "TMPDIR", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"] as const;
const CLI_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 40_000;
const RUN_TIMEOUT_MS = 10 * 60_000;
const MAX_BUFFER = 21 * 1024 * 1024;

export interface DockerRunResult {
  code: number | null;
  stdout: Buffer | string;
  stderr: string;
  timedOut: boolean;
}

/** Like computer.ts `Runner`, but stdout may be binary (`binary: true`). A plain `Runner` is assignable to this. */
export type DockerRunner = (
  bin: string,
  args: readonly string[],
  opts: { timeoutMs: number; env: NodeJS.ProcessEnv; binary?: boolean },
) => Promise<DockerRunResult>;

export interface DockerDriverOptions {
  name?: string;
  image?: string;
  run?: DockerRunner;
  bin?: string;
  env?: NodeJS.ProcessEnv;
  /** The X display inside the container. Default ":99". */
  display?: string;
}

export const defaultDockerRunner: DockerRunner = (bin, args, opts) =>
  new Promise((resolveRun) => {
    execFile(
      bin,
      [...args],
      { timeout: opts.timeoutMs, env: opts.env, maxBuffer: MAX_BUFFER, encoding: "buffer" },
      (err, stdout, stderr) => {
        const out = Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0);
        const errText = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : "";
        if (!err) {
          resolveRun({ code: 0, stdout: out, stderr: errText, timedOut: false });
          return;
        }
        const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
        resolveRun({
          code: typeof e.code === "number" ? e.code : null,
          stdout: out,
          stderr: errText,
          timedOut: e.killed === true && e.signal != null,
        });
      },
    );
  });

export function dockerChildEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of DOCKER_ENV_KEYS) {
    const value = base[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/** Null when a `docker` executable is on PATH. Spawns nothing. */
export function dockerAvailability(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, "docker");
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return null;
      }
    } catch {
      // not here; keep looking
    }
  }
  return "docker is not installed";
}

const NOT_INSTALLED = "docker is not installed";
const DAEMON_DOWN = "the Docker daemon is not running";
const IMAGE_MISSING = "docker image not found: pull or build it first";

/** Maps a failed docker call to a fixed message. stderr is read only to pick the message, never copied into it. */
function failure(what: string, res: DockerRunResult & { stdout: Buffer }): ComputerError {
  if (res.timedOut) return new ComputerError("timeout", "timed out");
  if (res.code === null && res.stdout.length === 0 && res.stderr === "") return new ComputerError("failed", NOT_INSTALLED);
  if (/Cannot connect to the Docker daemon/.test(res.stderr)) return new ComputerError("failed", DAEMON_DOWN);
  if (/Unable to find image|No such image|pull access denied|repository does not exist|manifest unknown/i.test(res.stderr)) {
    return new ComputerError("failed", IMAGE_MISSING);
  }
  return new ComputerError("failed", `${what} failed`);
}

export function createDockerDriver(opts: DockerDriverOptions = {}): ComputerDriver {
  const name = opts.name ?? "openag-box";
  const image = opts.image ?? "openag/computer:latest";
  if (!NAME_RE.test(name)) throw new Error("invalid docker container name");
  if (!IMAGE_RE.test(image)) throw new Error("invalid docker image reference");
  const bin = opts.bin ?? "docker";
  const run: DockerRunner = opts.run ?? defaultDockerRunner;
  const env = dockerChildEnv(opts.env ?? process.env);
  const display = opts.display ?? ":99";

  async function docker(args: string[], timeoutMs: number, binary = false): Promise<DockerRunResult & { stdout: Buffer }> {
    const res = await run(bin, args, { timeoutMs, env, binary });
    const stdout = Buffer.isBuffer(res.stdout) ? res.stdout : Buffer.from(res.stdout, "utf8");
    return { code: res.code, stdout, stderr: res.stderr, timedOut: res.timedOut };
  }

  const exec = async (argv: string[], o: { timeoutMs: number; binary?: boolean }): Promise<X11ExecResult> => {
    const res = await docker(["exec", "-e", `DISPLAY=${display}`, name, ...boxTimeout(argv, o.timeoutMs)], o.timeoutMs, o.binary === true);
    return { code: res.code, stdout: res.stdout, stderr: res.stderr, timedOut: res.timedOut };
  };

  const lifecycle: X11Lifecycle = {
    async inspect(): Promise<DriverInfo | null> {
      const res = await docker(["inspect", "--format", "{{json .State}}", name], CLI_TIMEOUT_MS);
      if (res.code !== 0) {
        if (!res.timedOut && res.code !== null && /No such/.test(res.stderr) && !/Cannot connect/.test(res.stderr)) return null;
        throw failure("status check", res);
      }
      let state: unknown;
      try {
        state = JSON.parse(res.stdout.toString("utf8"));
      } catch {
        throw new ComputerError("bad_output", "status check failed");
      }
      const running = typeof state === "object" && state !== null && (state as { Running?: unknown }).Running === true;
      return {
        state: running ? "running" : "stopped",
        status: running ? "ready" : null,
        image,
        kind: "container",
        runtime: "docker",
      };
    },

    async create() {
      const res = await docker(
        [
          "run",
          "-d",
          "--name",
          name,
          "--label",
          "openag=1",
          // Never pull: the image is not published, and a name like openag/computer would otherwise fetch whatever a
          // registry serves under it. Build it locally first (docker/computer/Dockerfile).
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
          `openag-${name}-workspace:/workspace`,
          image,
        ],
        RUN_TIMEOUT_MS,
      );
      if (res.code !== 0) throw failure("create", res);
    },

    async start() {
      const res = await docker(["start", name], CLI_TIMEOUT_MS);
      if (res.code !== 0) throw failure("start", res);
    },

    async stop() {
      const res = await docker(["stop", "-t", "10", name], STOP_TIMEOUT_MS);
      if (res.code !== 0) throw failure("stop", res);
    },

    async destroy() {
      const res = await docker(["rm", "-f", name], CLI_TIMEOUT_MS);
      // Already gone is the goal of destroy.
      if (res.code !== 0 && !(res.code !== null && /No such/.test(res.stderr) && !res.timedOut)) throw failure("destroy", res);
    },
  };

  return createX11Driver({ kind: "docker", name, exec, lifecycle, display });
}
