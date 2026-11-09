import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createDriverComputer } from "./driver.js";
import { createSshDriver, remoteLine, shellQuote, sshArgs, sshAvailability, sshChildEnv, sshConfigFromEnv, type SshConfig, type SshRunResult, type SshRunner } from "./ssh.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-ssh-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const cfg = (over: Partial<SshConfig> = {}): SshConfig => ({ host: "box.example.com", user: "agent", port: 2222, keyFile: "/keys/id", knownHosts: "/keys/known", ...over });
const png = () => {
  const b = Buffer.alloc(200);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(8, 16);
  b.writeUInt32BE(6, 20);
  return b;
};

describe("shellQuote", () => {
  const nasty = [
    "plain",
    "with space",
    "it's",
    "'; touch /tmp/pwned-by-test; '",
    "$(touch /tmp/pwned-by-test)",
    "`touch /tmp/pwned-by-test`",
    "a\nb",
    "a\\b",
    '"quoted"',
    "-rf /",
    "--flag=$HOME",
    "x;y&&z||w|v>o<i",
    "*",
    "~/x",
    "{a,b}",
    "!!",
    "",
    "unicode ✓  ",
    "''''",
  ];
  test.each(nasty)("%j survives a real POSIX shell unchanged and is never executed", (s) => {
    const out = execFileSync("sh", ["-c", `printf %s ${shellQuote(s)}`], { encoding: "utf8" });
    expect(out).toBe(s);
    expect(existsSync("/tmp/pwned-by-test")).toBe(false);
  });

  test("a whole remote command line round-trips argument by argument", () => {
    const args = ["xdotool", "type", "--delay", "20", "--", "'; rm -rf ~ #", "$(id)"];
    const line = args.map(shellQuote).join(" ");
    const out = execFileSync("sh", ["-c", `for a in ${line}; do printf '[%s]' "$a"; done`], { encoding: "utf8" });
    expect(out).toBe(args.map((a) => `[${a}]`).join(""));
  });
});

const decode = (line: string) => {
  const m = /^echo ([A-Za-z0-9+/=]+) \| base64 -d \| sh$/.exec(line);
  expect(m, `remote line must be fixed words + base64 only: ${line}`).not.toBeNull();
  return Buffer.from(m![1]!, "base64").toString("utf8");
};

describe("ssh argv", () => {
  test("ignores every ssh config file, hardened options, no agent/forwarding/multiplexing/proxy, stdin closed, target after the options", () => {
    const args = sshArgs(cfg(), ["env", "DISPLAY=:0", "xdotool", "type", "--", "it's"]);
    const joined = args.join(" ");
    expect(args.slice(0, 3)).toEqual(["-F", "/dev/null", "-n"]);
    for (const opt of ["BatchMode=yes", "StrictHostKeyChecking=yes", "IdentitiesOnly=yes", "IdentityAgent=none", "ForwardAgent=no", "ForwardX11=no", "ClearAllForwardings=yes", "PermitLocalCommand=no", "UserKnownHostsFile=/keys/known", "GlobalKnownHostsFile=/dev/null", "ControlMaster=no", "ControlPath=none", "ProxyCommand=none", "ProxyJump=none"]) {
      expect(joined).toContain(opt);
    }
    expect(args).toContain("-T");
    expect(args.slice(args.indexOf("-p"), args.indexOf("-p") + 2)).toEqual(["-p", "2222"]);
    expect(args.at(-2)).toBe("agent@box.example.com");
    expect(joined).not.toContain("StrictHostKeyChecking=no");
    expect(joined).not.toContain("accept-new");
  });

  test("the remote command is fixed words plus base64 only; the decoded script is a quoted exec with stdin closed", () => {
    const line = sshArgs(cfg(), ["env", "DISPLAY=:0", "xdotool", "type", "--", "it's"]).at(-1)!;
    expect(decode(line)).toBe(`exec 'env' 'DISPLAY=:0' 'xdotool' 'type' '--' 'it'\\''s' </dev/null`);
    // Nothing a login shell treats specially is outside the base64 alphabet.
    expect(line.replace(/^echo /, "").replace(/ \| base64 -d \| sh$/, "")).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe("the same command line behaves identically in every login shell (injection-proof)", () => {
  const evil = ["x", "'; touch /tmp/pwned-by-test; '", "\\';touch /tmp/pwned-by-test;echo \\", "$(touch /tmp/pwned-by-test)", "`touch /tmp/pwned-by-test`", "a\nb", "!event", "it's", "-rf /", "~", "*", "a b"];
  const line = remoteLine(["env", "DISPLAY=:0", "printf", "[%s]", ...evil]);
  const shells = ["/bin/sh", "/bin/bash", "/bin/zsh", "/bin/dash", "/bin/csh", "/bin/tcsh", "/usr/bin/fish", "/opt/homebrew/bin/fish"].filter((p) => existsSync(p));
  const expected = evil.map((a) => `[${a}]`).join("");

  test.each(shells)("%s runs it exactly and never executes injected commands", (shell) => {
    const out = execFileSync(shell, ["-c", line], { encoding: "utf8" });
    expect(out).toBe(expected);
    expect(existsSync("/tmp/pwned-by-test")).toBe(false);
  });

  test("at least the POSIX shells and csh/tcsh were exercised on this machine", () => {
    expect(shells.length).toBeGreaterThanOrEqual(3);
  });
});

describe("configuration from the environment", () => {
  const files = () => {
    const key = join(dir, "id");
    const known = join(dir, "known_hosts");
    writeFileSync(key, "KEY");
    chmodSync(key, 0o600);
    writeFileSync(known, "box.example.com ssh-ed25519 AAAA\n");
    return { key, known };
  };
  const env = (over: Record<string, string | undefined> = {}) => {
    const { key, known } = files();
    return { OPENAG_SSH_HOST: "box.example.com", OPENAG_SSH_USER: "agent", OPENAG_SSH_KEY_FILE: key, OPENAG_SSH_KNOWN_HOSTS: known, ...over } as NodeJS.ProcessEnv;
  };

  test("a complete, valid configuration is accepted", () => {
    const r = sshConfigFromEnv(env({ OPENAG_SSH_PORT: "2200", OPENAG_SSH_DISPLAY: ":1" }));
    expect(r).toMatchObject({ config: { host: "box.example.com", user: "agent", port: 2200, display: ":1" } });
  });

  test.each([
    ["no host", { OPENAG_SSH_HOST: undefined }, /OPENAG_SSH_HOST is not set/],
    ["host with a leading dash (an ssh option)", { OPENAG_SSH_HOST: "-oProxyCommand=evil" }, /not a valid host/],
    ["host with a space", { OPENAG_SSH_HOST: "a b" }, /not a valid host/],
    ["host with user@", { OPENAG_SSH_HOST: "root@evil.com" }, /not a valid host/],
    ["no user", { OPENAG_SSH_USER: undefined }, /OPENAG_SSH_USER is not set/],
    ["bad user", { OPENAG_SSH_USER: "-oFoo" }, /OPENAG_SSH_USER is not valid/],
    ["bad port", { OPENAG_SSH_PORT: "99999" }, /OPENAG_SSH_PORT/],
    ["bad port text", { OPENAG_SSH_PORT: "22; ls" }, /OPENAG_SSH_PORT/],
    ["relative key path", { OPENAG_SSH_KEY_FILE: "id" }, /absolute path/],
    ["missing key file", { OPENAG_SSH_KEY_FILE: "/nonexistent/key" }, /cannot be read/],
    ["no known_hosts", { OPENAG_SSH_KNOWN_HOSTS: undefined }, /OPENAG_SSH_KNOWN_HOSTS is not set/],
    ["bad display", { OPENAG_SSH_DISPLAY: "0; ls" }, /OPENAG_SSH_DISPLAY/],
  ])("%s is refused with a reason", (_n, over, re) => {
    const r = sshConfigFromEnv(env(over));
    expect(r).toMatchObject({ reason: expect.stringMatching(re) });
  });

  test("a key file readable by group or others is refused; an empty known_hosts is refused", () => {
    const e = env();
    chmodSync(e.OPENAG_SSH_KEY_FILE!, 0o644);
    expect(sshConfigFromEnv(e)).toMatchObject({ reason: expect.stringMatching(/chmod 600/) });
    chmodSync(e.OPENAG_SSH_KEY_FILE!, 0o600);
    writeFileSync(e.OPENAG_SSH_KNOWN_HOSTS!, "");
    expect(sshConfigFromEnv(e)).toMatchObject({ reason: expect.stringMatching(/empty/) });
  });

  test("reasons never echo the values they reject", () => {
    const r = sshConfigFromEnv(env({ OPENAG_SSH_HOST: "-oProxyCommand=evil-secret" })) as { reason: string };
    expect(r.reason).not.toContain("evil-secret");
  });

  test("sshAvailability and the child env", () => {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    expect(sshAvailability({ PATH: bin })).toBe("ssh is not installed");
    writeFileSync(join(bin, "ssh"), "#!/bin/sh\n");
    chmodSync(join(bin, "ssh"), 0o755);
    expect(sshAvailability({ PATH: bin })).toBeNull();
    expect(Object.keys(sshChildEnv({ PATH: "/bin", HOME: "/h", OPENAG_TOKEN: "t", SSH_AUTH_SOCK: "/s", ANTHROPIC_API_KEY: "k", BROWSERBASE_API_KEY: "b" })).sort()).toEqual(["HOME", "PATH"]);
  });
});

describe("driver through the generic computer", () => {
  function fakeRunner(script: (args: readonly string[]) => Partial<SshRunResult>) {
    const calls: Array<{ bin: string; args: readonly string[]; env: NodeJS.ProcessEnv }> = [];
    const run: SshRunner = async (bin, args, o) => {
      calls.push({ bin, args, env: o.env });
      return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false, ...script(args) };
    };
    return { run, calls };
  }
  const remoteOf = (args: readonly string[]) => args.at(-1) as string;

  test("start checks the connection, actions run `env DISPLAY=... <quoted argv>` on the box, stop and destroy only detach", async () => {
    const f = fakeRunner((args) => (decode(remoteOf(args)).includes("'import'") ? { stdout: png() } : {}));
    const computer = createDriverComputer(createSshDriver({ config: cfg({ display: ":1" }), run: f.run, env: { PATH: "/bin", OPENAG_TOKEN: "t" } }), { dataDir: dir, timing: { pollMs: 5, startWaitMs: 500, stopWaitMs: 500 } });
    expect((await computer.start()).state).toBe("running");
    await computer.act(["type", "--", "'; rm -rf ~ #"]);
    expect(decode(remoteOf(f.calls.at(-1)!.args))).toBe(`exec 'env' 'DISPLAY=:1' 'timeout' '-k' '2' '${Math.floor((20_000 + 13 * 30) / 1000) - 2}' 'xdotool' 'type' '--delay' '20' '--' ''\\''; rm -rf ~ #' </dev/null`);
    expect((await computer.screenshot()).width).toBe(8);
    const before = f.calls.length;
    expect((await computer.stop()).state).toBe("stopped");
    expect((await computer.destroy()).state).toBe("absent");
    // Detaching never touches the remote machine beyond the connectivity probes the wrapper makes.
    for (const c of f.calls.slice(before)) expect(decode(remoteOf(c.args))).toBe("exec 'true' </dev/null");
    expect(f.calls.every((c) => Object.keys(c.env).sort().join() === "PATH")).toBe(true);
    expect(computer.capabilities()).toEqual({ shell: true, view: "none", hosted: false });
  });

  test.each([
    ["Host key verification failed.", "the remote host key is not trusted"],
    ["@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@", "the remote host key is not trusted"],
    ["agent@box: Permission denied (publickey).", "ssh authentication failed"],
    ["ssh: connect to host box port 22: Connection refused", "the remote box is unreachable"],
    ["ssh: Could not resolve hostname box: nodename nor servname provided", "the remote box is unreachable"],
    ["something weird with /keys/id and secret-token-xyz", "connect failed"],
  ])("a failed connection (%s) maps to the fixed message %j and never leaks stderr", async (stderr, message) => {
    const f = fakeRunner(() => ({ code: 255, stderr }));
    const computer = createDriverComputer(createSshDriver({ config: cfg(), run: f.run }), { dataDir: dir });
    await expect(computer.start()).rejects.toMatchObject({ message });
    expect(JSON.stringify(await computer.status())).not.toContain("secret-token-xyz");
    expect(JSON.stringify(await computer.status())).not.toContain("/keys/id");
  });

  test("a timeout is a timeout and ssh missing is reported as such", async () => {
    const t = createDriverComputer(createSshDriver({ config: cfg(), run: fakeRunner(() => ({ code: null, timedOut: true })).run }), { dataDir: dir });
    await expect(t.start()).rejects.toMatchObject({ code: "timeout" });
    const missing = createDriverComputer(createSshDriver({ config: cfg(), run: fakeRunner(() => ({ code: null })).run }), { dataDir: dir });
    await expect(missing.start()).rejects.toMatchObject({ message: "ssh is not installed" });
  });

  test("an invalid target is refused at creation", () => {
    expect(() => createSshDriver({ config: cfg({ host: "-oProxyCommand=x" }) })).toThrow();
    expect(() => createSshDriver({ config: cfg({ user: "a b" }) })).toThrow();
    expect(() => createSshDriver({ config: cfg({ display: "0;ls" }) })).toThrow();
  });
});

describe("review fixes", () => {
  function runnerWith(script: (args: readonly string[]) => Partial<SshRunResult>) {
    const calls: Array<readonly string[]> = [];
    const run: SshRunner = async (_b, args) => {
      calls.push(args);
      return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false, ...script(args) };
    };
    return { run, calls };
  }

  test("ssh's own exit 255 (connection/auth failure) is a transport failure: no host, port or stderr reaches the bot", async () => {
    const f = runnerWith((args) => (decode(args.at(-1) as string).includes("'sh'") ? { code: 255, stderr: "ssh: connect to host box.example.com port 2222: Connection refused" } : {}));
    const computer = createDriverComputer(createSshDriver({ config: cfg(), run: f.run }), { dataDir: dir, timing: { pollMs: 5, startWaitMs: 500, stopWaitMs: 500 } });
    await computer.start();
    await expect(computer.shell("ls", 5)).rejects.toMatchObject({ message: "shell failed" });
    await expect(computer.shell("ls", 5)).rejects.not.toMatchObject({ message: expect.stringContaining("box.example.com") });
  });

  test("a command that exits 124 (the box's own timeout) is reported as timed out", async () => {
    const f = runnerWith((args) => (decode(args.at(-1) as string).includes("'sh'") ? { code: 124 } : {}));
    const computer = createDriverComputer(createSshDriver({ config: cfg(), run: f.run }), { dataDir: dir, timing: { pollMs: 5, startWaitMs: 500, stopWaitMs: 500 } });
    await computer.start();
    expect(await computer.shell("sleep 100", 5)).toMatchObject({ exitCode: 124, timedOut: true });
  });

  test("a successful reachability probe is reused for a few seconds (one handshake per action, not two)", async () => {
    const f = runnerWith(() => ({}));
    const computer = createDriverComputer(createSshDriver({ config: cfg(), run: f.run }), { dataDir: dir, timing: { pollMs: 5, startWaitMs: 500, stopWaitMs: 500 } });
    await computer.start();
    const before = f.calls.length;
    await computer.act(["key", "a"]);
    await computer.act(["key", "b"]);
    expect(f.calls.length - before).toBe(2); // the two actions only, no extra probes
  });

  test.each(["/home/me/My Keys/id", "/home/me/%h/id", "/home/me/a%20b"])("a path ssh would re-interpret (%s) is refused", (path) => {
    const key = join(dir, "id");
    writeFileSync(key, "K");
    chmodSync(key, 0o600);
    const known = join(dir, "known");
    writeFileSync(known, "h ssh-ed25519 AAAA\n");
    for (const over of [{ OPENAG_SSH_KEY_FILE: path }, { OPENAG_SSH_KNOWN_HOSTS: path }]) {
      const r = sshConfigFromEnv({ OPENAG_SSH_HOST: "h.example.com", OPENAG_SSH_USER: "a", OPENAG_SSH_KEY_FILE: key, OPENAG_SSH_KNOWN_HOSTS: known, ...over });
      expect(r).toMatchObject({ reason: expect.stringMatching(/spaces or %/) });
    }
  });
});
