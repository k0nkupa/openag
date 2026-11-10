import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComputerError, NOT_RUNNING_MESSAGE, type Computer, type Runner } from "./computer.js";
import { makeFakeCua, scriptedRunner, type FakeCua } from "./computer/harness.testkit.js";

const ALLOWED_ENV = new Set([
  "PATH", "HOME", "LANG", "TMPDIR", "PWD", "OLDPWD", "SHLVL", "_", "__CF_USER_TEXT_ENCODING",
  "FAKE_CUA_STATE", "FAKE_CUA_LOG", "FAKE_CUA_FAIL", "FAKE_CUA_SLEEP_MS", "FAKE_CUA_RESUME_LAG", "FAKE_CUA_INFO_RAW", "FAKE_CUA_SCREENSHOT_BAD", "FAKE_CUA_RM_FLAKY",
]);
const savedEnv = { ...process.env };

let fake: FakeCua;

beforeEach(() => {
  fake = makeFakeCua();
});
afterEach(() => {
  fake.cleanup();
  for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
  Object.assign(process.env, savedEnv);
});

const doCalls = () => fake.calls().filter((c) => c.argv[0] === "do");
const argvs = () => fake.calls().map((c) => c.argv);

async function rejects(p: Promise<unknown>): Promise<ComputerError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ComputerError) return err;
    throw err;
  }
  throw new Error("expected a ComputerError");
}

describe("act", () => {
  it("selects the target on every call, then runs the action with its argv", async () => {
    fake.seed({ "openag-main": "running" });
    const c = fake.computer();
    const res = await c.act(["click", "10", "20", "right"]);
    expect(res).toEqual({ message: "clicked (10, 20) [right]" });
    expect(argvs().slice(-2)).toEqual([
      ["do", "switch", "openag-main"],
      ["do", "click", "10", "20", "right"],
    ]);
  });

  it("passes typed text after a literal `--`, so a leading dash is text, not an option", async () => {
    fake.seed({ "openag-main": "running" });
    const c = fake.computer();
    expect(await c.act(["type", "--", "-rf /"])).toEqual({ message: 'typed: "-rf /"' });
    expect(argvs().at(-1)).toEqual(["do", "type", "--", "-rf /"]);
  });

  it("maps a clap usage error (exit 2) to failed with a fixed message", async () => {
    fake.seed({ "openag-main": "running" });
    const c = fake.computer();
    const err = await rejects(c.act(["type", "-x"]));
    expect(err).toMatchObject({ code: "failed", message: "invalid arguments" });
  });

  it("returns the CLI's failure line without the cross mark (exit 1)", async () => {
    fake.seed({ "openag-main": "running" });
    const c = fake.computer();
    const err = await rejects(c.act(["key", "notakey"]));
    expect(err.code).toBe("failed");
    expect(err.message).toBe('invalid argument: protocol error: unknown key "notakey"');
  });

  it("refuses without any `do` call when the sandbox is not running", async () => {
    fake.seed({ "openag-main": "stopped" });
    const c = fake.computer();
    const err = await rejects(c.act(["click", "1", "2"]));
    expect(err).toMatchObject({ code: "failed", message: NOT_RUNNING_MESSAGE });
    expect(doCalls()).toEqual([]);
  });

  it("maps exit 3 from the switch to not_found, and never runs the action", async () => {
    const c = fake.computer({
      run: scriptedRunner(async (_bin, args) => {
        if (args[1] === "switch") return { code: 3, stdout: "", stderr: "cua: not found: sandbox openag-main\n", timedOut: false };
        return { code: 0, stdout: "", stderr: "", timedOut: false };
      }),
    });
    const err = await rejects(c.act(["click", "1", "2"]));
    expect(err.code).toBe("not_found");
  });

  it("maps a timeout to the timeout code", async () => {
    const c = fake.computer({
      run: scriptedRunner(async (_bin, args) =>
        args[1] === "switch" ? { code: 0, stdout: "", stderr: "", timedOut: false } : { code: null, stdout: "", stderr: "", timedOut: true },
      ),
    });
    const err = await rejects(c.act(["click", "1", "2"]));
    expect(err.code).toBe("timeout");
  });

  it("redacts a secret echoed by the CLI and never shows the command line on failure", async () => {
    const c = fake.computer({
      run: scriptedRunner(async (_bin, args) => {
        if (args[1] === "switch") return { code: 0, stdout: "", stderr: "", timedOut: false };
        return { code: 1, stdout: "❌ failed sk-abcdefghijklmnopqrstuvwxyz0123\n", stderr: "", timedOut: false };
      }),
    });
    const err = await rejects(c.act(["open", "--", "https://example.com"]));
    expect(err.message).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
    expect(err.message).not.toContain("example.com");
  });
});

describe("shell", () => {
  it("runs the command name-addressed with argv exactly, and returns the exit code", async () => {
    fake.seed({ "openag-main": "running" });
    const c = fake.computer();
    const res = await c.shell("echo hi", 5);
    expect(res).toEqual({ exitCode: 0, stdout: "hi\n", stderr: "", truncated: false, timedOut: false });
    expect(argvs().at(-1)).toEqual(["sandbox", "exec", "openag-main", "--timeout", "5", "--", "echo hi"]);
    expect(doCalls()).toEqual([]);
  });

  it("returns a non-zero command exit code as a result, not an error", async () => {
    fake.seed({ "openag-main": "running" });
    const res = await fake.computer().shell("exit 5", 5);
    expect(res.exitCode).toBe(5);
  });

  it("reads the failure reason of a rejected action from stderr (real cua prints the ❌ line there, only the footer on stdout)", async () => {
    fake.seed({ "openag-main": "running" });
    const c = fake.computer();
    const err = await rejects(c.act(["key", "notakey"]));
    expect(err.message).toBe('invalid argument: protocol error: unknown key "notakey"');
    expect(err.message).not.toContain("zoom");
  });

  it("returns exit 1 for a command that outruns its timeout", async () => {
    fake.seed({ "openag-main": "running" });
    const res = await fake.computer().shell("sleep 10", 1);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain("timed out");
  });

  it("flags timedOut only when exit 1 coincides with the time limit being reached (cua reports both as exit 1)", async () => {
    fake.seed({ "openag-main": "running" });
    const quickFail = await fake.computer().shell("exit 1", 30);
    expect(quickFail.exitCode).toBe(1);
    expect(quickFail.timedOut).toBe(false);
    const slow = await fake.computer({ knobs: { sleepMs: 1300 } }).shell("sleep 10", 1);
    expect(slow.exitCode).toBe(1);
    expect(slow.timedOut).toBe(true);
  });

  it("caps stdout at 8000 characters and sets truncated", async () => {
    fake.seed({ "openag-main": "running" });
    const res = await fake.computer().shell("emit 9000", 5);
    expect(res.stdout).toHaveLength(8000);
    expect(res.truncated).toBe(true);
  });

  it("redacts a secret in output and never returns it", async () => {
    fake.seed({ "openag-main": "running" });
    const res = await fake.computer().shell("echo sk-abcdefghijklmnopqrstuvwxyz0123", 5);
    expect(res.stdout).not.toContain("sk-abcdefghijklmnopqrstuvwxyz0123");
  });

  it("maps exit 3 with no output to not_found", async () => {
    const c = fake.computer({
      run: scriptedRunner(async () => ({ code: 3, stdout: "", stderr: "", timedOut: false })),
    });
    const err = await rejects(c.shell("echo hi", 5));
    expect(err.code).toBe("not_found");
  });

  it("refuses without a CLI exec call when not running", async () => {
    fake.seed({ "openag-main": "stopped" });
    const err = await rejects(fake.computer().shell("echo hi", 5));
    expect(err.message).toBe(NOT_RUNNING_MESSAGE);
    expect(fake.calls().some((c) => c.argv[1] === "exec")).toBe(false);
  });

  it("never echoes the command line in a failure", async () => {
    const c = fake.computer({
      run: scriptedRunner(async () => ({ code: 1, stdout: "", stderr: "Command failed: cua sandbox exec x -- secret-cmd\n", timedOut: false })),
    });
    const res = await c.shell("secret-cmd", 5);
    expect(res.stderr).toBe("");
  });
});

describe("inputGuard", () => {
  it("blocks act and shell with paused before any CLI call, but not screenshot or status", async () => {
    fake.seed({ "openag-main": "running" });
    let reason: string | null = "takeover in progress";
    const c = fake.computer({ inputGuard: () => reason });

    const a = await rejects(c.act(["click", "1", "2"]));
    expect(a).toMatchObject({ code: "paused", message: "takeover in progress" });
    const s = await rejects(c.shell("echo hi", 5));
    expect(s.code).toBe("paused");
    expect(fake.calls()).toEqual([]);

    expect((await c.screenshot()).path).toMatch(/\.png$/);
    expect((await c.status()).state).toBe("running");
    expect(fake.calls().length).toBeGreaterThan(0);
  });

  it("can be replaced at runtime with setInputGuard", async () => {
    fake.seed({ "openag-main": "running" });
    const c = fake.computer();
    c.setInputGuard(() => "paused");
    await rejects(c.act(["click", "1", "2"]));
    c.setInputGuard(undefined);
    expect((await c.act(["click", "1", "2"])).message).toBe("clicked (1, 2) [left]");
  });
});

describe("serialisation", () => {
  it("never overlaps CLI calls and always selects the right target before each do action", async () => {
    fake.seed({ "openag-main": "running", other: "running" });
    const c: Computer = fake.computer({ knobs: { sleepMs: 20 } });

    // The machine-global target is pointed elsewhere between calls; each act must still re-select.
    await c.act(["click", "1", "1"]);
    fake.setTarget("other");

    await Promise.all([
      c.act(["click", "10", "20"]),
      c.shell("echo a", 5),
      c.act(["type", "--", "hello"]),
      c.screenshot(),
      c.act(["key", "enter"]),
      c.shell("echo b", 5),
      c.act(["scroll", "down", "2"]),
      c.act(["open", "--", "https://example.com"]),
    ]);

    const calls = fake.calls().slice().sort((a, b) => a.t0 - b.t0);
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]!.t0).toBeGreaterThanOrEqual(calls[i - 1]!.t1);
    }

    const actions = ["click", "type", "key", "hotkey", "scroll", "open"];
    const doIdx = calls.map((x, i) => (x.argv[0] === "do" && actions.includes(x.argv[1]!) ? i : -1)).filter((i) => i >= 0);
    expect(doIdx).toHaveLength(6); // the pre-run click plus the five in the batch
    for (const i of doIdx) {
      const prev = calls[i - 1]!;
      expect(prev.argv.slice(0, 3)).toEqual(["do", "switch", "openag-main"]);
      expect(calls[i]!.target).toBe("openag-main");
    }
  });
});

describe("child environment", () => {
  it("never passes OPENAG_TOKEN or other daemon secrets to the CLI", async () => {
    process.env.OPENAG_TOKEN = "owner-token-value";
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-not-leak";
    fake.seed({ "openag-main": "running" });
    await fake.computer().act(["click", "1", "2"]);
    await fake.computer().shell("echo hi", 5);
    for (const call of fake.calls()) {
      expect(call.envKeys.filter((k) => !ALLOWED_ENV.has(k))).toEqual([]);
    }
  });
});

describe("viewLink", () => {
  const link = (viewUrl?: string) => fake.computer({ knobs: { viewUrl } }).viewLink();

  it("returns the loopback origin and the ticket fragment without calling `do`", async () => {
    fake.seed({ "openag-main": "running" });
    const res = await link();
    if (res.kind === "external") throw new Error("expected a proxy link");
    expect(res.origin).toBe("http://127.0.0.1:32768");
    expect(res.fragment).toContain("ticket=v1.faketicket");
    expect(res.expiresAt).toBeGreaterThan(Date.now());
    expect(argvs().at(-1)).toEqual(["sandbox", "view", "openag-main", "--no-open", "--ttl", "30m", "--json"]);
    expect(doCalls()).toEqual([]);
  });

  it.each([
    ["https", "https://127.0.0.1:1/viewer/#ticket=x"],
    ["a non-loopback host", "http://evil.example.com:80/viewer/#ticket=x"],
    ["credentials in the URL", "http://u:p@127.0.0.1:1/viewer/#ticket=x"],
    ["no ticket fragment", "http://127.0.0.1:1/viewer/"],
    ["garbage", "not a url"],
  ])("rejects %s, and the error never contains the URL", async (_l, url) => {
    fake.seed({ "openag-main": "running" });
    const err = await rejects(link(url));
    expect(err.message).not.toContain("ticket");
    expect(err.message).not.toContain("evil.example.com");
  });

  it("refuses when the sandbox is not running", async () => {
    fake.seed({ "openag-main": "stopped" });
    const err = await rejects(link());
    expect(err.message).toBe(NOT_RUNNING_MESSAGE);
    expect(argvs().some((a) => a[1] === "view")).toBe(false);
  });
});
