import { describe, expect, test } from "vitest";
import { ComputerError } from "../computer.js";
import { createX11Driver, keysym, type X11Exec, type X11ExecResult, type X11Lifecycle } from "./x11.js";

const SECRET = "SECRET-leak-9f3a";

interface Call {
  argv: string[];
  timeoutMs: number;
  binary?: boolean;
}

function fakeX11(script?: (argv: string[]) => Partial<X11ExecResult> | undefined) {
  const calls: Call[] = [];
  const exec: X11Exec = async (argv, o) => {
    calls.push({ argv: [...argv], timeoutMs: o.timeoutMs, binary: o.binary });
    const r = script?.(argv) ?? {};
    return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false, ...r };
  };
  const lifecycleCalls: string[] = [];
  const lifecycle: X11Lifecycle = {
    inspect: async () => {
      lifecycleCalls.push("inspect");
      return null;
    },
    create: async () => void lifecycleCalls.push("create"),
    start: async () => void lifecycleCalls.push("start"),
    stop: async () => void lifecycleCalls.push("stop"),
    destroy: async () => void lifecycleCalls.push("destroy"),
  };
  const driver = createX11Driver({ kind: "docker", name: "box", exec, lifecycle });
  return { driver, calls, lifecycleCalls };
}

const xdo = (...rest: string[]) => ["xdotool", ...rest];

async function expectError(p: Promise<unknown>, code: string, message: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ComputerError);
  expect((err as ComputerError).code).toBe(code);
  expect((err as ComputerError).message).toBe(message);
}

describe("x11 actions: exact argv", () => {
  const table: Array<[string[], string[][]]> = [
    [["click", "10", "20"], [xdo("mousemove", "--sync", "10", "20", "click", "1")]],
    [["click", "0", "10000", "right"], [xdo("mousemove", "--sync", "0", "10000", "click", "3")]],
    [["click", "5", "6", "middle"], [xdo("mousemove", "--sync", "5", "6", "click", "2")]],
    [["type", "--", "hi there"], [xdo("type", "--delay", "20", "--", "hi there")]],
    [["key", "enter"], [xdo("key", "Return")]],
    [["key", "TAB"], [xdo("key", "Tab")]],
    [["key", "escape"], [xdo("key", "Escape")]],
    [["key", "backspace"], [xdo("key", "BackSpace")]],
    [["key", "delete"], [xdo("key", "Delete")]],
    [["key", "space"], [xdo("key", "space")]],
    [["key", "up"], [xdo("key", "Up")]],
    [["key", "down"], [xdo("key", "Down")]],
    [["key", "left"], [xdo("key", "Left")]],
    [["key", "right"], [xdo("key", "Right")]],
    [["key", "home"], [xdo("key", "Home")]],
    [["key", "end"], [xdo("key", "End")]],
    [["key", "pageup"], [xdo("key", "Prior")]],
    [["key", "pagedown"], [xdo("key", "Next")]],
    [["key", "a"], [xdo("key", "a")]],
    [["key", "-"], [xdo("key", "-")]],
    [["hotkey", "ctrl+shift+t"], [xdo("key", "ctrl+shift+t")]],
    [["hotkey", "cmd+l"], [xdo("key", "super+l")]],
    [["hotkey", "meta+enter"], [xdo("key", "super+Return")]],
    [["hotkey", "ctrl", "l"], [xdo("key", "ctrl+l")]],
    [["hotkey", "alt+tab"], [xdo("key", "alt+Tab")]],
    [["scroll", "down", "3"], [xdo("click", "--repeat", "3", "5")]],
    [["scroll", "up", "999"], [xdo("click", "--repeat", "50", "4")]],
    [["scroll", "left", "0"], [xdo("click", "--repeat", "1", "6")]],
    [["scroll", "right", "2"], [xdo("click", "--repeat", "2", "7")]],
    [
      ["open", "--", "https://example.com/a?b=1"],
      [
        xdo("key", "ctrl+l"),
        xdo("type", "--delay", "5", "--", "https://example.com/a?b=1"),
        xdo("key", "Return"),
      ],
    ],
  ];

  for (const [argv, expected] of table) {
    test(`${argv.join(" ")}`, async () => {
      const { driver, calls } = fakeX11();
      await driver.act(argv);
      expect(calls.map((c) => c.argv)).toEqual(expected);
      for (const c of calls) expect(c.timeoutMs).toBeGreaterThan(0);
    });
  }

  test("messages", async () => {
    const { driver } = fakeX11();
    expect((await driver.act(["click", "10", "20"])).message).toBe("clicked (10, 20) left");
    expect((await driver.act(["open", "--", "https://Example.com:8080/x"])).message).toBe("opened example.com");
    expect((await driver.act(["type", "--", "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz"])).message).toBe(
      `typed: "${"abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz".slice(0, 40)}"`,
    );
  });

  test("the transport never receives a shell string: every argv element is one token", async () => {
    const { driver, calls } = fakeX11();
    await driver.act(["type", "--", "a; rm -rf / $(id)"]);
    expect(calls[0]?.argv.at(-1)).toBe("a; rm -rf / $(id)");
  });
});

describe("keysym table", () => {
  test("own-property lookup refuses prototype names", () => {
    for (const k of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "CONSTRUCTOR"]) {
      expect(keysym(k)).toBeNull();
    }
  });

  test("multi-character unknown names are refused", () => {
    expect(keysym("f5")).toBeNull();
    expect(keysym("")).toBeNull();
    expect(keysym(" ")).toBeNull();
  });

  test("single printable ASCII passes through", () => {
    expect(keysym("A")).toBe("A");
    expect(keysym("~")).toBe("~");
  });
});

describe("act refusals", () => {
  test("prototype names as keys or modifiers are refused, never resolved", async () => {
    const { driver, calls } = fakeX11();
    for (const argv of [
      ["key", "constructor"],
      ["key", "__proto__"],
      ["key", "toString"],
      ["hotkey", "constructor+a"],
      ["hotkey", "__proto__+a"],
      ["hotkey", "ctrl+constructor"],
      ["hotkey", "toString"],
      ["scroll", "constructor", "1"],
      ["click", "1", "1", "constructor"],
    ]) {
      await expectError(driver.act(argv), "failed", "invalid arguments");
    }
    expect(calls).toHaveLength(0);
  });

  test("open refuses non-http(s) schemes, whitespace, control characters and no scheme", async () => {
    const { driver, calls } = fakeX11();
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html,hi",
      "chrome://settings",
      "ftp://example.com/x",
      "example.com",
      "https://exa mple.com",
      "https://example.com/\nkey Return",
      "https://example.com/\t",
      "",
      "https://",
      "x".repeat(2100),
    ]) {
      await expectError(driver.act(["open", "--", url]), "failed", "invalid arguments");
    }
    expect(calls).toHaveLength(0);
  });

  test("invalid argument table", async () => {
    const { driver, calls } = fakeX11();
    const bad: string[][] = [
      [],
      ["nope"],
      ["click", "10001", "0"],
      ["click", "-1", "0"],
      ["click", "1.5", "2"],
      ["click", "1"],
      ["click", "1", "2", "wheel"],
      ["type", "hi"],
      ["type", "--"],
      ["type", "--", "x".repeat(4001)],
      ["key"],
      ["key", "f5"],
      ["key", "a", "b"],
      ["hotkey"],
      ["hotkey", "ctrl+"],
      ["hotkey", "+a"],
      ["hotkey", "a+b+c+d+e+f"],
      ["scroll", "sideways", "1"],
      ["scroll", "up", "x"],
      ["scroll", "up"],
      ["open", "https://example.com"],
    ];
    for (const argv of bad) await expectError(driver.act(argv), "failed", "invalid arguments");
    expect(calls).toHaveLength(0);
  });

  test("non-string argv is refused", async () => {
    const { driver } = fakeX11();
    await expectError(driver.act([1 as unknown as string]), "failed", "invalid arguments");
  });
});

describe("action failures", () => {
  test("nonzero exit, transport failure and timeout map to fixed messages", async () => {
    const nonzero = fakeX11(() => ({ code: 1, stderr: SECRET }));
    await expectError(nonzero.driver.act(["click", "1", "1"]), "failed", "action failed");
    const transport = fakeX11(() => ({ code: null, stderr: SECRET }));
    await expectError(transport.driver.act(["key", "enter"]), "failed", "action failed");
    const timed = fakeX11(() => ({ code: null, timedOut: true, stderr: SECRET }));
    await expectError(timed.driver.act(["key", "enter"]), "timeout", "action timed out");
  });

  test("open stops at the first failing step", async () => {
    const { driver, calls } = fakeX11((argv) => (argv[1] === "type" ? { code: 1 } : undefined));
    await expectError(driver.act(["open", "--", "https://example.com"]), "failed", "action failed");
    expect(calls).toHaveLength(2);
  });

  test("typed text and stderr never reach an error message", async () => {
    const typed = `${SECRET}-typed`;
    const { driver } = fakeX11(() => ({ code: 1, stderr: `${SECRET} ${typed}`, stdout: Buffer.from(SECRET) }));
    const err = await driver.act(["type", "--", typed]).then(
      () => null,
      (e: unknown) => e as ComputerError,
    );
    expect(err?.message).toBe("action failed");
    expect(err?.message).not.toContain("SECRET");
    expect(err?.message).not.toContain(typed);
  });
});

describe("screenshot", () => {
  test("runs import with binary stdout and returns the bytes", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const { driver, calls } = fakeX11(() => ({ stdout: png }));
    const out = await driver.screenshot();
    expect(out.equals(png)).toBe(true);
    expect(calls[0]).toEqual({ argv: ["import", "-window", "root", "png:-"], timeoutMs: 30_000, binary: true });
  });

  test("failure, timeout, empty and oversize", async () => {
    await expectError(fakeX11(() => ({ code: 1, stderr: SECRET })).driver.screenshot(), "failed", "screenshot failed");
    await expectError(fakeX11(() => ({ code: null })).driver.screenshot(), "failed", "screenshot failed");
    await expectError(fakeX11(() => ({ code: null, timedOut: true })).driver.screenshot(), "timeout", "screenshot timed out");
    await expectError(fakeX11().driver.screenshot(), "failed", "screenshot failed");
    const big = Buffer.alloc(20 * 1024 * 1024 + 1, 1);
    await expectError(fakeX11(() => ({ stdout: big })).driver.screenshot(), "bad_output", "screenshot too large");
  });
});

describe("shell", () => {
  test("argv is sh -c with timeout + 5 s slack", async () => {
    const { driver, calls } = fakeX11(() => ({ stdout: Buffer.from("hi\n"), code: 0 }));
    const res = await driver.shell("echo hi", 10);
    expect(calls[0]).toEqual({ argv: ["sh", "-c", "echo hi"], timeoutMs: 15_000, binary: undefined });
    expect(res).toEqual({ exitCode: 0, stdout: "hi\n", stderr: "", truncated: false, timedOut: false });
  });

  test("a nonzero command exit is a result", async () => {
    const { driver } = fakeX11(() => ({ code: 3, stderr: "bad" }));
    const res = await driver.shell("false", 5);
    expect(res.exitCode).toBe(3);
    expect(res.stderr).toBe("bad");
  });

  test("each stream is capped at 8000 characters and flagged", async () => {
    const { driver } = fakeX11(() => ({ stdout: Buffer.from("a".repeat(9000)), stderr: "b".repeat(8000) }));
    const res = await driver.shell("x", 5);
    expect(res.stdout).toHaveLength(8000);
    expect(res.stderr).toHaveLength(8000);
    expect(res.truncated).toBe(true);
  });

  test("a transport timeout is exit 124 with timedOut", async () => {
    const { driver } = fakeX11(() => ({ code: null, timedOut: true, stdout: Buffer.from("partial") }));
    const res = await driver.shell("sleep 99", 1);
    expect(res).toEqual({ exitCode: 124, stdout: "partial", stderr: "", truncated: false, timedOut: true });
  });

  test("a transport failure (not a timeout) throws a fixed message", async () => {
    const { driver } = fakeX11(() => ({ code: null, stderr: SECRET }));
    await expectError(driver.shell("x", 5), "failed", "shell failed");
  });

  test("timeoutSec must be an integer 1..600", async () => {
    const { driver, calls } = fakeX11();
    for (const t of [0, 601, 1.5, Number.NaN]) await expectError(driver.shell("x", t), "failed", "invalid arguments");
    expect(calls).toHaveLength(0);
  });
});

describe("driver surface", () => {
  test("capabilities and kind/name", () => {
    const { driver } = fakeX11();
    expect(driver.kind).toBe("docker");
    expect(driver.name).toBe("box");
    expect(driver.capabilities).toEqual({ shell: true, view: "none", hosted: false });
  });

  test("hosted flag is passed through", () => {
    const driver = createX11Driver({
      kind: "ssh",
      name: "remote",
      exec: async () => ({ code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false }),
      lifecycle: { inspect: async () => null, create: async () => {}, start: async () => {}, stop: async () => {}, destroy: async () => {} },
      hosted: true,
    });
    expect(driver.capabilities.hosted).toBe(true);
  });

  test("viewLink is refused", async () => {
    const { driver } = fakeX11();
    await expectError(driver.viewLink(), "failed", "this computer backend has no live view");
  });

  test("lifecycle methods delegate", async () => {
    const { driver, lifecycleCalls } = fakeX11();
    await driver.inspect();
    await driver.create();
    await driver.start();
    await driver.stop();
    await driver.destroy();
    expect(lifecycleCalls).toEqual(["inspect", "create", "start", "stop", "destroy"]);
  });

  test("a malformed display is refused at creation", () => {
    expect(() =>
      createX11Driver({
        kind: "docker",
        name: "box",
        display: ":99; rm",
        exec: async () => ({ code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false }),
        lifecycle: { inspect: async () => null, create: async () => {}, start: async () => {}, stop: async () => {}, destroy: async () => {} },
      }),
    ).toThrow("invalid X display");
  });
});

describe("review fixes", () => {
  test("typing time limit grows with the text (xdotool types ~20 ms per character), and a 124 exit is a timeout", async () => {
    const seen: number[] = [];
    const driver = createX11Driver({
      kind: "docker",
      name: "t",
      exec: async (argv, o) => {
        seen.push(o.timeoutMs);
        return { code: 0, stdout: Buffer.alloc(0), stderr: "", timedOut: false };
      },
      lifecycle: { inspect: async () => null, create: async () => {}, start: async () => {}, stop: async () => {}, destroy: async () => {} },
    });
    await driver.act(["type", "--", "short"]);
    await driver.act(["type", "--", "x".repeat(2000)]);
    expect(seen[1]!).toBeGreaterThanOrEqual(20_000 + 2000 * 25); // 2000 chars at 20 ms needs ~40 s
    expect(seen[1]!).toBeGreaterThan(seen[0]!);
    const timedOut = createX11Driver({
      kind: "docker",
      name: "t",
      exec: async () => ({ code: 124, stdout: Buffer.alloc(0), stderr: "", timedOut: false }),
      lifecycle: { inspect: async () => null, create: async () => {}, start: async () => {}, stop: async () => {}, destroy: async () => {} },
    });
    await expect(timedOut.act(["click", "1", "1"])).rejects.toMatchObject({ code: "timeout" });
  });
});
