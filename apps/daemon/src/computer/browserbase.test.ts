import { describe, expect, test } from "vitest";
import { ComputerError } from "../computer.js";
import { type CdpSocket } from "./cdp.js";
import { createBrowserbaseDriver } from "./browserbase.js";

const KEY = "bb_test_key_0123456789abcdef";
const CONNECT = "wss://connect.browserbase.com/session?signingKey=SECRETTOKEN123456";
const LIVE = "https://www.browserbase.com/sessions/sess_abc123?debug=1";
const SID = "sess_abc123";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: any;
  init: RequestInit;
}

type Route = (c: Call) => { status: number; json?: unknown; raw?: string } | "timeout" | "network";

function fakeFetch(route: Route) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL, init: RequestInit = {}) => {
    const headers = { ...(init.headers as Record<string, string>) };
    const c: Call = { url: String(url), method: init.method ?? "GET", headers, body: init.body ? JSON.parse(String(init.body)) : undefined, init };
    calls.push(c);
    const r = route(c);
    if (r === "timeout") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    if (r === "network") throw new TypeError("fetch failed");
    return new Response(r.raw ?? (r.json === undefined ? "" : JSON.stringify(r.json)), { status: r.status });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const happy: Route = (c) => {
  if (c.method === "POST" && c.url.endsWith("/v1/sessions")) return { status: 201, json: { id: SID, status: "RUNNING", connectUrl: CONNECT } };
  if (c.url.endsWith(`/v1/sessions/${SID}`) && c.method === "GET") return { status: 200, json: { id: SID, status: "RUNNING" } };
  if (c.url.endsWith(`/v1/sessions/${SID}`) && c.method === "POST") return { status: 200, json: {} };
  if (c.url.endsWith(`/v1/sessions/${SID}/debug?expiresIn=1800`)) return { status: 200, json: { debuggerFullscreenUrl: LIVE, wsUrl: "wss://x" } };
  return { status: 404 };
};

interface Cdp {
  calls: Array<{ method: string; params: any; sessionId?: string }>;
  socket: CdpSocket;
  connects: string[];
  sock: () => FakeSock;
}
class FakeSock implements CdpSocket {
  onM: ((d: string) => void) | null = null;
  onC: (() => void) | null = null;
  onO: (() => void) | null = null;
  constructor(private readonly reply: (m: any) => unknown) {}
  send(data: string) {
    const m = JSON.parse(data);
    queueMicrotask(() => {
      const r = this.reply(m);
      if (r === "drop") this.onC?.();
      else if (r !== undefined) this.onM?.(JSON.stringify({ id: m.id, ...(r as object) }));
    });
  }
  onMessage(cb: (d: string) => void) {
    this.onM = cb;
  }
  onClose(cb: () => void) {
    this.onC = cb;
  }
  onOpen(cb: () => void) {
    this.onO = cb;
    queueMicrotask(() => cb());
  }
  close() {
    this.onC?.();
  }
}

function fakeCdp(page: (m: any) => unknown = () => ({ result: {} })): Cdp {
  const calls: Cdp["calls"] = [];
  const connects: string[] = [];
  let last!: FakeSock;
  const reply = (m: any) => {
    calls.push({ method: m.method, params: m.params, sessionId: m.sessionId });
    if (m.method === "Target.getTargets") return { result: { targetInfos: [{ type: "page", targetId: "T" }] } };
    if (m.method === "Target.attachToTarget") return { result: { sessionId: "PAGE" } };
    return page(m);
  };
  const connect = (url: string): CdpSocket => {
    connects.push(url);
    last = new FakeSock(reply);
    return last;
  };
  return { calls, socket: undefined as unknown as CdpSocket, connects, sock: () => last, ...{ connect } } as Cdp & { connect: (u: string) => CdpSocket };
}

function driverWith(route: Route = happy, cdp?: ReturnType<typeof fakeCdp>, extra: Partial<Parameters<typeof createBrowserbaseDriver>[0]> = {}) {
  const f = fakeFetch(route);
  const c = cdp ?? fakeCdp();
  const d = createBrowserbaseDriver({
    apiKey: KEY,
    fetch: f.fetchFn,
    connect: (c as unknown as { connect: (u: string) => CdpSocket }).connect,
    now: () => 1_000,
    ...extra,
  });
  return { d, calls: f.calls, cdp: c };
}

const allText = (calls: Call[]) => JSON.stringify(calls.map((c) => [c.url, c.body]));

describe("lifecycle", () => {
  test("create stores the session; inspect maps RUNNING, PENDING and terminal statuses", async () => {
    const { d, calls } = driverWith();
    expect(await d.inspect()).toBeNull();
    await d.create();
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://api.browserbase.com/v1/sessions" });
    expect(calls[0].body).toEqual({ timeout: 1800, browserSettings: { viewport: { width: 1280, height: 800 } } });
    expect(await d.inspect()).toEqual({ state: "running", status: "ready", image: null, kind: "browser", runtime: "browserbase" });
  });

  test("PENDING is unknown; ERROR/TIMED_OUT/COMPLETED forget the session", async () => {
    let status = "PENDING";
    const { d, calls } = driverWith((c) => (c.method === "GET" && c.url.endsWith(SID) ? { status: 200, json: { status } } : happy(c)));
    await d.create();
    expect((await d.inspect())?.state).toBe("unknown");
    status = "TIMED_OUT";
    expect(await d.inspect()).toBeNull();
    expect(await d.inspect()).toBeNull();
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(2);
  });

  test("a 404 on the status check forgets the session and reports absent", async () => {
    const { d } = driverWith((c) => (c.method === "GET" ? { status: 404 } : happy(c)));
    await d.create();
    expect(await d.inspect()).toBeNull();
  });

  test("stop releases once and forgets the session; start after stop creates a new one", async () => {
    const { d, calls } = driverWith();
    await d.create();
    await d.stop();
    const releases = calls.filter((c) => c.method === "POST" && c.url.endsWith(SID));
    expect(releases).toHaveLength(1);
    expect(releases[0].body).toEqual({ status: "REQUEST_RELEASE" });
    expect(await d.inspect()).toBeNull();
    await d.start();
    expect(calls.filter((c) => c.method === "POST" && c.url.endsWith("/v1/sessions"))).toHaveLength(2);
  });

  test("destroy releases; a release that answers 404 counts as already released", async () => {
    const { d } = driverWith((c) => (c.method === "POST" && c.url.endsWith(SID) ? { status: 404 } : happy(c)));
    await d.create();
    await expect(d.destroy()).resolves.toBeUndefined();
    expect(await d.inspect()).toBeNull();
  });

  test("a failed release keeps the handle so it can be retried", async () => {
    let fail = true;
    const { d } = driverWith((c) => (c.method === "POST" && c.url.endsWith(SID) && fail ? { status: 500 } : happy(c)));
    await d.create();
    await expect(d.stop()).rejects.toMatchObject({ message: "release failed" });
    expect(await d.inspect()).not.toBeNull();
    fail = false;
    await d.stop();
    expect(await d.inspect()).toBeNull();
  });

  test("a session without a valid connect url is released and refused", async () => {
    const { d, calls } = driverWith((c) =>
      c.method === "POST" && c.url.endsWith("/v1/sessions") ? { status: 201, json: { id: SID, connectUrl: "wss://evil.example.com/x" } } : happy(c),
    );
    await expect(d.create()).rejects.toMatchObject({ code: "bad_output", message: "unexpected connect url" });
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith(SID))).toBe(true);
    expect(await d.inspect()).toBeNull();
  });

  test("a session id that fails validation is refused before it reaches a URL", async () => {
    const { d, calls } = driverWith((c) => (c.method === "POST" && c.url.endsWith("/v1/sessions") ? { status: 201, json: { id: "../x", connectUrl: CONNECT } } : happy(c)));
    await expect(d.create()).rejects.toMatchObject({ code: "bad_output", message: "unexpected session id" });
    expect(calls.every((c) => !c.url.includes(".."))).toBe(true);
  });
});

describe("screenshot and actions", () => {
  const b64 = Buffer.from("png-bytes").toString("base64");

  test("screenshot connects once, attaches the first page and returns the PNG bytes", async () => {
    const cdp = fakeCdp((m) => (m.method === "Page.captureScreenshot" ? { result: { data: b64 } } : { result: {} }));
    const { d } = driverWith(happy, cdp);
    await d.create();
    expect((await d.screenshot()).toString()).toBe("png-bytes");
    expect(cdp.connects).toEqual([CONNECT]);
    expect(cdp.calls.find((c) => c.method === "Page.captureScreenshot")).toMatchObject({ params: { format: "png" }, sessionId: "PAGE" });
  });

  test("click sends moved, pressed and released with the button", async () => {
    const cdp = fakeCdp();
    const { d } = driverWith(happy, cdp);
    await d.create();
    expect((await d.act(["click", "10", "20", "right"])).message).toBe("clicked (10, 20) [right]");
    const mouse = cdp.calls.filter((c) => c.method === "Input.dispatchMouseEvent").map((c) => c.params.type);
    expect(mouse).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
    expect(cdp.calls.find((c) => c.params.type === "mousePressed")!.params).toMatchObject({ x: 10, y: 20, button: "right", clickCount: 1 });
    expect((await d.act(["click", "1", "2"])).message).toBe("clicked (1, 2) [left]");
  });

  test("type uses Input.insertText and previews at most 40 characters", async () => {
    const cdp = fakeCdp();
    const { d } = driverWith(happy, cdp);
    await d.create();
    const long = "x".repeat(60);
    expect((await d.act(["type", "--", long])).message).toBe(`typed: "${"x".repeat(40)}"`);
    expect(cdp.calls.find((c) => c.method === "Input.insertText")!.params).toEqual({ text: long });
  });

  test("key sends keyDown and keyUp; enter carries text", async () => {
    const cdp = fakeCdp();
    const { d } = driverWith(happy, cdp);
    await d.create();
    expect((await d.act(["key", "enter"])).message).toBe("pressed enter");
    const keys = cdp.calls.filter((c) => c.method === "Input.dispatchKeyEvent");
    expect(keys.map((c) => c.params.type)).toEqual(["keyDown", "keyUp"]);
    expect(keys[0].params).toMatchObject({ key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    expect(keys[1].params.text).toBeUndefined();
    await d.act(["key", "a"]);
    expect(cdp.calls.filter((c) => c.method === "Input.dispatchKeyEvent").at(-2)!.params).toMatchObject({ key: "a", code: "KeyA", text: "a" });
  });

  test("key table covers named keys and rejects unknown ones", async () => {
    const cdp = fakeCdp();
    const { d } = driverWith(happy, cdp);
    await d.create();
    for (const k of ["tab", "escape", "backspace", "delete", "space", "up", "down", "left", "right", "home", "end", "pageup", "pagedown", "7", "Z"]) {
      await expect(d.act(["key", k])).resolves.toBeDefined();
    }
    await expect(d.act(["key", "f13"])).rejects.toMatchObject({ code: "failed", message: 'invalid argument: unknown key "f13"' });
  });

  test("hotkey holds modifiers down and releases them in reverse; ctrl suppresses text", async () => {
    const cdp = fakeCdp();
    const { d } = driverWith(happy, cdp);
    await d.create();
    expect((await d.act(["hotkey", "ctrl+shift+a"])).message).toBe("pressed ctrl+shift+a");
    const seq = cdp.calls.filter((c) => c.method === "Input.dispatchKeyEvent").map((c) => `${c.params.type}:${c.params.key}:${c.params.modifiers}:${c.params.text ?? "-"}`);
    expect(seq).toEqual([
      "keyDown:Control:2:-",
      "keyDown:Shift:10:-",
      "keyDown:a:10:-",
      "keyUp:a:10:-",
      "keyUp:Shift:2:-",
      "keyUp:Control:0:-",
    ]);
  });

  test("cmd and super map to meta (bitmask 4); plain letters keep text", async () => {
    const cdp = fakeCdp();
    const { d } = driverWith(happy, cdp);
    await d.create();
    await d.act(["hotkey", "cmd+c"]);
    await d.act(["hotkey", "super", "v"]);
    const downs = cdp.calls.filter((c) => c.method === "Input.dispatchKeyEvent" && c.params.type === "keyDown");
    expect(downs[0].params).toMatchObject({ key: "Meta", modifiers: 4 });
    expect(downs[1].params).toMatchObject({ key: "c", modifiers: 4 });
    expect(downs[1].params.text).toBeUndefined();
    const alt = cdp.calls.filter((c) => c.method === "Input.dispatchKeyEvent").length;
    await d.act(["hotkey", "alt+x"]);
    expect(cdp.calls.filter((c) => c.method === "Input.dispatchKeyEvent").length).toBe(alt + 4);
  });

  test("scroll sends one mouseWheel at the centre, 100 px per step, clamped to 1..50", async () => {
    const cdp = fakeCdp();
    const { d } = driverWith(happy, cdp);
    await d.create();
    expect((await d.act(["scroll", "down", "3"])).message).toBe("scrolled down 3");
    await d.act(["scroll", "up", "999"]);
    await d.act(["scroll", "left", "0"]);
    const wheels = cdp.calls.filter((c) => c.params.type === "mouseWheel").map((c) => c.params);
    expect(wheels[0]).toMatchObject({ x: 640, y: 400, deltaX: 0, deltaY: 300 });
    expect(wheels[1]).toMatchObject({ deltaY: -5000 });
    expect(wheels[2]).toMatchObject({ deltaX: -100 });
  });

  test("open navigates http(s) only and refuses everything else", async () => {
    const cdp = fakeCdp((m) => (m.method === "Page.navigate" ? { result: { frameId: "f" } } : { result: {} }));
    const { d } = driverWith(happy, cdp);
    await d.create();
    expect((await d.act(["open", "--", "https://example.com/a"])).message).toBe("opened example.com");
    expect(cdp.calls.find((c) => c.method === "Page.navigate")!.params).toEqual({ url: "https://example.com/a" });
    for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "ftp://x.test", "not a url"]) {
      await expect(d.act(["open", "--", bad])).rejects.toMatchObject({ code: "failed", message: "invalid argument: only http(s) URLs" });
    }
    const navCount = cdp.calls.filter((c) => c.method === "Page.navigate").length;
    expect(navCount).toBe(1);
  });

  test("navigation errorText becomes action failed", async () => {
    const cdp = fakeCdp((m) => (m.method === "Page.navigate" ? { result: { errorText: "net::ERR" } } : { result: {} }));
    const { d } = driverWith(happy, cdp);
    await d.create();
    await expect(d.act(["open", "--", "https://example.com"])).rejects.toMatchObject({ message: "action failed" });
  });

  test("invalid argument table: all refused with invalid arguments and no CDP call", async () => {
    const cdp = fakeCdp();
    const { d } = driverWith(happy, cdp);
    await d.create();
    const bad: string[][] = [
      [],
      ["bogus"],
      ["click", "1"],
      ["click", "-1", "2"],
      ["click", "1.5", "2"],
      ["click", "10001", "2"],
      ["click", "1", "2", "wheel"],
      ["click", "a", "b"],
      ["type", "hello"],
      ["type", "--"],
      ["type", "--", "a", "b"],
      ["scroll", "diagonal", "2"],
      ["scroll", "down", "x"],
      ["scroll", "down"],
      ["key"],
      ["key", "a", "b"],
      ["hotkey", "ctrl+"],
      ["hotkey", "a"],
      ["open", "https://example.com"],
    ];
    for (const argv of bad) {
      await expect(d.act(argv)).rejects.toBeInstanceOf(ComputerError);
    }
    await expect(d.act(["click", "-1", "2"])).rejects.toMatchObject({ message: "invalid arguments" });
    expect(cdp.calls.filter((c) => c.method.startsWith("Input.") || c.method === "Page.navigate")).toHaveLength(0);
  });

  test("shell is refused and never reaches the API", async () => {
    const { d, calls } = driverWith();
    await d.create();
    await expect(d.shell("ls", 5)).rejects.toMatchObject({ message: "this computer backend has no shell" });
    expect(calls.filter((c) => c.url.includes("/exec"))).toHaveLength(0);
  });

  test("a CDP error mid-call becomes action failed and resets the connection", async () => {
    const cdp = fakeCdp((m) => (m.method === "Input.insertText" ? { error: { message: "boom https://x.browserbase.com/?k=1" } } : { result: {} }));
    const { d } = driverWith(happy, cdp);
    await d.create();
    const err = await d.act(["type", "--", "hi"]).catch((e) => e);
    expect(err).toMatchObject({ code: "failed", message: "action failed" });
    expect(String(err.message)).not.toContain("browserbase.com");
  });

  test("a socket drop during a screenshot becomes screenshot failed", async () => {
    const cdp = fakeCdp((m) => (m.method === "Page.captureScreenshot" ? "drop" : undefined) as never);
    const { d } = driverWith(happy, cdp);
    await d.create();
    await expect(d.screenshot()).rejects.toMatchObject({ code: "failed", message: "screenshot failed" });
  });

  test("actions without a session fail with session ended", async () => {
    const { d } = driverWith();
    await expect(d.act(["click", "1", "2"])).rejects.toMatchObject({ message: "session ended" });
  });
});

describe("viewLink", () => {
  test("returns the external https live view with a 30 minute expiry", async () => {
    const { d } = driverWith();
    await d.create();
    expect(await d.viewLink()).toEqual({ kind: "external", url: LIVE, expiresAt: 1_000 + 30 * 60_000 });
  });

  test.each([
    ["http", "http://www.browserbase.com/s"],
    ["userinfo", "https://user:pw@www.browserbase.com/s"],
    ["other host", "https://evil.example.com/s"],
    ["suffix trick", "https://browserbase.com.evil.example/s"],
    ["bad url", "not a url"],
    ["missing", undefined],
  ])("refuses a live view link that is %s", async (_label, url) => {
    const { d } = driverWith((c) => (c.url.includes("/debug") ? { status: 200, json: { debuggerFullscreenUrl: url } } : happy(c)));
    await d.create();
    await expect(d.viewLink()).rejects.toMatchObject({ code: "bad_output", message: "unexpected live view link" });
  });
});

describe("error mapping and secrecy", () => {
  const cases: Array<[string, Route, string]> = [
    ["401", () => ({ status: 401, raw: `bad key ${KEY}` }), "api key rejected"],
    ["403", () => ({ status: 403 }), "api key rejected"],
    ["429", () => ({ status: 429 }), "rate limited"],
    ["500", () => ({ status: 500, raw: `leak ${CONNECT}` }), "create failed"],
    ["timeout", () => "timeout", "request timed out"],
    ["network", () => "network", "create failed"],
  ];
  test.each(cases)("%s on create maps to a fixed message", async (_l, route, msg) => {
    const { d, calls } = driverWith(route);
    const err = await d.create().catch((e) => e);
    expect(err).toBeInstanceOf(ComputerError);
    expect(err.message).toBe(msg);
    expect(JSON.stringify(err)).not.toContain(KEY);
    expect(allText(calls)).not.toContain(KEY);
  });

  test("404 on a session call forgets the session with session ended", async () => {
    const { d } = driverWith((c) => (c.method === "POST" && c.url.endsWith("/v1/sessions") ? { status: 201, json: { id: SID, connectUrl: CONNECT } } : { status: 404 }));
    await d.create();
    await expect(d.viewLink()).rejects.toMatchObject({ message: "session ended" });
    expect(await d.inspect()).toBeNull();
  });

  test("the API key is only in the X-BB-API-Key header, redirects are refused, and every fetch has a timeout signal", async () => {
    const { d, calls } = driverWith();
    await d.create();
    await d.inspect();
    await d.stop();
    expect(allText(calls)).not.toContain(KEY);
    for (const c of calls) {
      expect(c.headers["X-BB-API-Key"]).toBe(KEY);
      expect(c.init.redirect).toBe("error");
      expect(c.init.signal).toBeDefined();
    }
  });

  test("the connect url and key never appear in error strings from CDP failures", async () => {
    const cdp = fakeCdp((m) => (m.method === "Page.captureScreenshot" ? { error: { message: CONNECT } } : undefined) as never);
    const { d, calls } = driverWith(happy, cdp);
    await d.create();
    const err = await d.screenshot().catch((e) => e);
    expect(JSON.stringify(err)).not.toContain("SECRETTOKEN");
    expect(allText(calls)).not.toContain("SECRETTOKEN");
  });

  test("an oversized response is refused as bad output", async () => {
    const big = "x".repeat(1024 * 1024 + 10);
    const { d } = driverWith((c) => (c.method === "POST" && c.url.endsWith("/v1/sessions") ? { status: 201, raw: big } : { status: 404 }));
    await expect(d.create()).rejects.toMatchObject({ code: "bad_output", message: "response too large" });
  });

  test("the session id is validated before it is placed in a URL", async () => {
    const { d, calls } = driverWith((c) => (c.method === "POST" && c.url.endsWith("/v1/sessions") ? { status: 201, json: { id: "abc/../../x", connectUrl: CONNECT } } : happy(c)));
    await expect(d.create()).rejects.toMatchObject({ message: "unexpected session id" });
    expect(calls.every((c) => !c.url.includes("abc/"))).toBe(true);
  });
});

describe("review fixes", () => {
  test("stop through the driver wrapper returns `absent` at once (a release is the expected end state), not after the 30 s wait", async () => {
    const { createDriverComputer } = await import("./driver.js");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "openag-bb-stop-"));
    try {
      const { d } = driverWith();
      const computer = createDriverComputer(d, { dataDir: dir, timing: { pollMs: 5, startWaitMs: 500, stopWaitMs: 4000 } });
      await computer.start();
      const t0 = Date.now();
      const st = await computer.stop();
      expect(st.state).toBe("absent");
      expect(Date.now() - t0).toBeLessThan(1500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the driver is hosted and says a stop means destroy", () => {
    const { d } = driverWith();
    expect(d.capabilities).toEqual({ shell: false, view: "external", hosted: true });
    expect(d.stopMeansDestroy).toBe(true);
  });

  test("the live view link asks for a 30 minute expiry", async () => {
    const { d, calls } = driverWith();
    await d.create();
    await d.viewLink();
    expect(calls.at(-1)!.url).toContain("/debug?expiresIn=1800");
  });

  test.each(["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"])("key %s is refused, not resolved through the prototype chain", async (key) => {
    const { d } = driverWith();
    await d.create();
    await expect(d.act(["key", key])).rejects.toMatchObject({ code: "failed" });
  });

  test.each(["constructor+a", "ctrl+constructor", "__proto__+a"])("hotkey %s is refused without breaking the CDP connection", async (combo) => {
    const cdp = fakeCdp();
    const { d } = driverWith(happy, cdp);
    await d.create();
    await d.act(["click", "1", "1"]); // opens the connection
    const connectsBefore = cdp.connects.length;
    await expect(d.act(["hotkey", combo])).rejects.toMatchObject({ code: "failed" });
    await d.act(["click", "2", "2"]);
    expect(cdp.connects.length).toBe(connectsBefore); // no reconnect needed: the connection survived
  });
});
