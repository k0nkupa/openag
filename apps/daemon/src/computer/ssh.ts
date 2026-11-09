import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { ComputerError } from "../computer.js";
import type { ComputerDriver, DriverInfo } from "./driver.js";
import { boxTimeout, createX11Driver, type X11ExecResult, type X11Lifecycle } from "./x11.js";

/**
 * Remote box backend: an X11 desktop on a machine you control (a VPS, a spare mini), reached over SSH. Same X11 layer as
 * the Docker backend; only the transport differs.
 *
 * - Authentication is ONE key file; host keys are checked against a known_hosts file (StrictHostKeyChecking=yes): a
 *   box whose key is not already trusted is refused, never accepted on first use.
 * - ssh runs with no agent, no forwarding, no local commands, BatchMode (never prompts) and a child env of only
 *   PATH/HOME/LANG/TMPDIR.
 * - ssh joins its arguments into ONE string that the remote LOGIN shell parses, and login shells differ (sh, bash, zsh,
 *   fish, csh quote differently). So that string contains only fixed words and base64: `echo <b64> | base64 -d | sh`;
 *   the decoded script is parsed by POSIX `sh`, where every argument is single-quoted (`shellQuote`). A typed
 *   `'; rm -rf ~; '` is text, never a command, whatever the login shell is.
 * - ssh ignores ~/.ssh/config and /etc/ssh/ssh_config (`-F /dev/null`): no ProxyCommand/ControlMaster/SetEnv or extra
 *   identities from files we did not write, and only OUR known_hosts file is trusted.
 * - OpenAg does not own the machine: stop and destroy only DETACH (the daemon stops using it).
 */

const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const PORT_RE = /^\d{1,5}$/;
const DISPLAY_RE = /^:\d{1,3}$/;
const SSH_ENV_KEYS = ["PATH", "HOME", "LANG", "TMPDIR"] as const;
const CONNECT_TIMEOUT_S = 10;
const MAX_BUFFER = 21 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 20_000;
const PROBE_CACHE_MS = 10_000;

export interface SshConfig {
  host: string;
  user: string;
  port?: number;
  /** Private key file (mode 0600). */
  keyFile: string;
  /** known_hosts file that already contains the box's host key. */
  knownHosts: string;
  /** The X display on the box. Default ":0". */
  display?: string;
}

export interface SshRunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
}
export type SshRunner = (bin: string, args: readonly string[], opts: { timeoutMs: number; env: NodeJS.ProcessEnv }) => Promise<SshRunResult>;

export interface SshDriverOptions {
  config: SshConfig;
  run?: SshRunner;
  bin?: string;
  env?: NodeJS.ProcessEnv;
}

/** The command line the remote login shell sees: fixed words plus base64 only (safe in every shell). */
export function remoteLine(argv: string[]): string {
  // `exec ... </dev/null`: the script arrives on stdin, so the command must not be able to read (and eat) it.
  const script = `exec ${argv.map(shellQuote).join(" ")} </dev/null`;
  return `echo ${Buffer.from(script, "utf8").toString("base64")} | base64 -d | sh`;
}

/** Single-quotes one argument for a POSIX shell. */
export function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export const defaultSshRunner: SshRunner = (bin, args, opts) =>
  new Promise((resolveRun) => {
    execFile(bin, [...args], { timeout: opts.timeoutMs, env: opts.env, maxBuffer: MAX_BUFFER, encoding: "buffer" }, (err, stdout, stderr) => {
      const out = Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0);
      const errText = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : "";
      if (!err) return resolveRun({ code: 0, stdout: out, stderr: errText, timedOut: false });
      const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
      resolveRun({ code: typeof e.code === "number" ? e.code : null, stdout: out, stderr: errText, timedOut: e.killed === true && e.signal != null });
    });
  });

export function sshChildEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SSH_ENV_KEYS) {
    const value = base[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/** Reads the OPENAG_SSH_* variables. Returns the config, or the reason it cannot be used (never a secret). */
export function sshConfigFromEnv(env: NodeJS.ProcessEnv = process.env): { config: SshConfig } | { reason: string } {
  const host = env.OPENAG_SSH_HOST;
  if (!host) return { reason: "OPENAG_SSH_HOST is not set" };
  if (!HOST_RE.test(host)) return { reason: "OPENAG_SSH_HOST is not a valid host name" };
  const user = env.OPENAG_SSH_USER;
  if (!user) return { reason: "OPENAG_SSH_USER is not set" };
  if (!USER_RE.test(user)) return { reason: "OPENAG_SSH_USER is not valid" };
  const portText = env.OPENAG_SSH_PORT;
  if (portText && (!PORT_RE.test(portText) || Number(portText) < 1 || Number(portText) > 65535)) return { reason: "OPENAG_SSH_PORT is not valid" };
  const keyFile = env.OPENAG_SSH_KEY_FILE;
  if (!keyFile) return { reason: "OPENAG_SSH_KEY_FILE is not set" };
  const knownHosts = env.OPENAG_SSH_KNOWN_HOSTS;
  if (!knownHosts) return { reason: "OPENAG_SSH_KNOWN_HOSTS is not set (the host key must already be trusted)" };
  for (const [name, path] of [["OPENAG_SSH_KEY_FILE", keyFile], ["OPENAG_SSH_KNOWN_HOSTS", knownHosts]] as const) {
    if (!path.startsWith("/") || /[\u0000-\u001f]/.test(path)) return { reason: `${name} must be an absolute path` };
    // ssh splits some of these on whitespace and expands % and ~ tokens: what we validated must be what ssh reads.
    if (/[\s%]/.test(path)) return { reason: `${name} must not contain spaces or %` };
  }
  try {
    const st = statSync(keyFile);
    if (!st.isFile()) return { reason: "OPENAG_SSH_KEY_FILE is not a file" };
    // A private key readable by others is a leaked key: refuse it, as ssh itself would.
    if ((st.mode & 0o077) !== 0) return { reason: "OPENAG_SSH_KEY_FILE must not be readable by group or others (chmod 600)" };
  } catch {
    return { reason: "OPENAG_SSH_KEY_FILE cannot be read" };
  }
  try {
    const st = statSync(knownHosts);
    if (!st.isFile() || st.size === 0) return { reason: "OPENAG_SSH_KNOWN_HOSTS is empty or not a file" };
  } catch {
    return { reason: "OPENAG_SSH_KNOWN_HOSTS cannot be read" };
  }
  const display = env.OPENAG_SSH_DISPLAY;
  if (display && !DISPLAY_RE.test(display)) return { reason: "OPENAG_SSH_DISPLAY is not valid" };
  return { config: { host, user, port: portText ? Number(portText) : undefined, keyFile, knownHosts, display: display || undefined } };
}

/** Null when an `ssh` executable is on PATH (spawns nothing). */
export function sshAvailability(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    const candidate = join(dir, "ssh");
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return null;
      }
    } catch {
      // keep looking
    }
  }
  return "ssh is not installed";
}

/** The ssh argv for one remote command. Everything the remote shell will parse is quoted by shellQuote. */
export function sshArgs(cfg: SshConfig, remote: string[]): string[] {
  return [
    "-F", "/dev/null",
    "-n",
    "-i", cfg.keyFile,
    "-p", String(cfg.port ?? 22),
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${cfg.knownHosts}`,
    "-o", "IdentitiesOnly=yes",
    "-o", "IdentityAgent=none",
    "-o", "GlobalKnownHostsFile=/dev/null",
    "-o", "ControlMaster=no",
    "-o", "ControlPath=none",
    "-o", "ProxyCommand=none",
    "-o", "ProxyJump=none",
    "-o", `ConnectTimeout=${CONNECT_TIMEOUT_S}`,
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
    "-o", "ForwardAgent=no",
    "-o", "ForwardX11=no",
    "-o", "ClearAllForwardings=yes",
    "-o", "PermitLocalCommand=no",
    "-o", "LogLevel=ERROR",
    "-T",
    `${cfg.user}@${cfg.host}`,
    remoteLine(remote),
  ];
}

const UNREACHABLE = "the remote box is unreachable";

/** Maps a failed ssh call to a fixed message. stderr is read only to pick the message, never copied into it. */
function failure(what: string, res: SshRunResult): ComputerError {
  if (res.timedOut) return new ComputerError("timeout", "timed out");
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(res.stderr)) return new ComputerError("failed", "the remote host key is not trusted");
  if (/Permission denied/i.test(res.stderr)) return new ComputerError("failed", "ssh authentication failed");
  if (/Connection (refused|timed out|reset|closed)|No route to host|Could not resolve hostname|Network is unreachable/i.test(res.stderr)) {
    return new ComputerError("failed", UNREACHABLE);
  }
  if (res.code === null && res.stderr === "") return new ComputerError("failed", "ssh is not installed");
  return new ComputerError("failed", `${what} failed`);
}

export function createSshDriver(opts: SshDriverOptions): ComputerDriver {
  const cfg = opts.config;
  if (!HOST_RE.test(cfg.host) || !USER_RE.test(cfg.user)) throw new Error("invalid ssh target");
  const display = cfg.display ?? ":0";
  if (!DISPLAY_RE.test(display)) throw new Error("invalid X display");
  const bin = opts.bin ?? "ssh";
  const run: SshRunner = opts.run ?? defaultSshRunner;
  const env = sshChildEnv(opts.env ?? process.env);
  let detached: "stopped" | "absent" | null = null;
  // A successful probe is trusted for a few seconds: every action refreshes the state first, and each probe is a full
  // ssh handshake. Failures are never cached.
  let probedUntil = 0;

  const ssh = (remote: string[], timeoutMs: number) => run(bin, sshArgs(cfg, remote), { timeoutMs, env });

  const exec = async (argv: string[], o: { timeoutMs: number; binary?: boolean }): Promise<X11ExecResult> => {
    const res = await ssh(["env", `DISPLAY=${display}`, ...boxTimeout(argv, o.timeoutMs)], o.timeoutMs);
    // ssh itself exits 255 on connection/auth failures: that is a transport failure, not a command result (and its
    // stderr names the host and port, which must not reach the bot).
    return { code: res.code === 255 ? null : res.code, stdout: res.stdout, stderr: res.code === 255 ? "" : res.stderr, timedOut: res.timedOut };
  };

  async function reachable(what: string): Promise<void> {
    const res = await ssh(["true"], PROBE_TIMEOUT_MS);
    if (res.code !== 0) throw failure(what, res);
  }

  const lifecycle: X11Lifecycle = {
    async inspect(): Promise<DriverInfo | null> {
      if (detached === "absent") return null;
      const info = (state: "running" | "stopped"): DriverInfo => ({ state, status: state === "running" ? "ready" : null, image: null, kind: "remote", runtime: "ssh" });
      if (detached === "stopped") return info("stopped");
      if (Date.now() < probedUntil) return info("running");
      const res = await ssh(["true"], PROBE_TIMEOUT_MS);
      if (res.code === 0) {
        probedUntil = Date.now() + PROBE_CACHE_MS;
        return info("running");
      }
      probedUntil = 0;
      // Unreachable or refused: report it honestly as "not there" with the reason on the next start.
      return null;
    },
    async create() {
      await reachable("connect");
      detached = null;
    },
    async start() {
      await reachable("connect");
      detached = null;
    },
    // OpenAg does not own this machine: stop and destroy only stop USING it.
    async stop() {
      probedUntil = 0;
      detached = "stopped";
    },
    async destroy() {
      probedUntil = 0;
      detached = "absent";
    },
  };

  return createX11Driver({ kind: "ssh", name: `${cfg.user}@${cfg.host}`, exec, lifecycle, display });
}
