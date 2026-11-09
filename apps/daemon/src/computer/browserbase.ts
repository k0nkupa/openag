import { ComputerError, type ComputerViewLink, type ShellResult } from "../computer.js";
import { type Cdp, type CdpSocket, CDP_TIMEOUT, createCdp, defaultConnect } from "./cdp.js";
import type { ComputerDriver, DriverInfo } from "./driver.js";

/**
 * Browserbase backend: a cloud Chromium session driven over CDP. ONE session at a time, held in memory. A session cannot
 * be resumed or suspended, so stop == destroy == release. No shell. The human takes over through Browserbase's live view
 * (an external https link). Secrets: the API key lives only in the X-BB-API-Key header; the connect URL never leaves this
 * module. Every error is a ComputerError with a fixed message.
 */

const API = "https://api.browserbase.com";
const API_TIMEOUT_MS = 20_000;
const MAX_BODY = 1024 * 1024;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{6,80}$/;
const LIVE_VIEW_TTL_MS = 30 * 60_000;
const MAX_SCROLL = 50;
const SCROLL_STEP = 100;
const MAX_COORD = 10_000;
const TYPED_PREVIEW = 40;

export interface BrowserbaseOptions {
  apiKey: string;
  projectId?: string;
  fetch?: typeof fetch;
  connect?: (url: string) => CdpSocket;
  now?: () => number;
  sessionTimeoutSec?: number;
  viewport?: { width: number; height: number };
  name?: string;
}

interface Session {
  id: string;
  connectUrl: string;
}

interface KeyDef {
  key: string;
  code: string;
  vk: number;
  text?: string;
}

const NAMED_KEYS: Record<string, KeyDef> = {
  enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", vk: 9 },
  escape: { key: "Escape", code: "Escape", vk: 27 },
  backspace: { key: "Backspace", code: "Backspace", vk: 8 },
  delete: { key: "Delete", code: "Delete", vk: 46 },
  space: { key: " ", code: "Space", vk: 32, text: " " },
  up: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  left: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
  home: { key: "Home", code: "Home", vk: 36 },
  end: { key: "End", code: "End", vk: 35 },
  pageup: { key: "PageUp", code: "PageUp", vk: 33 },
  pagedown: { key: "PageDown", code: "PageDown", vk: 34 },
};

/** CDP modifier bitmask: alt 1, ctrl 2, meta 4, shift 8. */
const MODIFIERS: Record<string, { bit: number; def: KeyDef }> = {
  ctrl: { bit: 2, def: { key: "Control", code: "ControlLeft", vk: 17 } },
  alt: { bit: 1, def: { key: "Alt", code: "AltLeft", vk: 18 } },
  shift: { bit: 8, def: { key: "Shift", code: "ShiftLeft", vk: 16 } },
  meta: { bit: 4, def: { key: "Meta", code: "MetaLeft", vk: 91 } },
  cmd: { bit: 4, def: { key: "Meta", code: "MetaLeft", vk: 91 } },
  super: { bit: 4, def: { key: "Meta", code: "MetaLeft", vk: 91 } },
};
const BUTTONS = new Set(["left", "right", "middle"]);
const BUTTON_BITS: Record<string, number> = { left: 1, right: 2, middle: 4 };

/** A single printable ASCII character as a key. Returns null for anything else. */
function charKey(k: string): KeyDef | null {
  if (k.length !== 1 || k.charCodeAt(0) < 0x21 || k.charCodeAt(0) > 0x7e) return null;
  const lower = k.toLowerCase();
  if (/[a-z]/.test(lower)) return { key: k, code: `Key${lower.toUpperCase()}`, vk: lower.toUpperCase().charCodeAt(0), text: k };
  if (/[0-9]/.test(k)) return { key: k, code: `Digit${k}`, vk: k.charCodeAt(0), text: k };
  return { key: k, code: k, vk: k.charCodeAt(0), text: k };
}

function keyDef(k: string): KeyDef | null {
  const named = k.toLowerCase();
  // Own properties only: "constructor", "__proto__" and friends are valid by the tool's regex and must not resolve.
  return (Object.hasOwn(NAMED_KEYS, named) ? NAMED_KEYS[named] : undefined) ?? charKey(k);
}

const invalidArgs = () => new ComputerError("failed", "invalid arguments");

function parseCoord(s: string | undefined): number {
  if (s === undefined || !/^\d{1,5}$/.test(s)) throw invalidArgs();
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > MAX_COORD) throw invalidArgs();
  return n;
}

function validConnectUrl(s: unknown): string | null {
  if (typeof s !== "string") return null;
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "wss:" || u.username || u.password) return null;
    if (host !== "browserbase.com" && !host.endsWith(".browserbase.com")) return null;
    return s;
  } catch {
    return null;
  }
}

function validLiveViewUrl(s: unknown): string | null {
  if (typeof s !== "string") return null;
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password) return null;
    if (host !== "browserbase.com" && !host.endsWith(".browserbase.com")) return null;
    return s;
  } catch {
    return null;
  }
}

const asRec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

async function readCapped(res: Response): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) {
      await reader.cancel().catch(() => undefined);
      throw new ComputerError("bad_output", "response too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export function createBrowserbaseDriver(opts: BrowserbaseOptions): ComputerDriver {
  const apiKey = opts.apiKey;
  if (!apiKey) throw new Error("browserbase api key missing");
  const timeoutSec = opts.sessionTimeoutSec ?? 1800;
  if (!Number.isInteger(timeoutSec) || timeoutSec < 60 || timeoutSec > 21600) throw new Error("browserbase timeout out of range");
  const viewport = opts.viewport ?? { width: 1280, height: 800 };
  const doFetch: typeof fetch = (input, init) => (opts.fetch ?? fetch)(input, init);
  const connect = opts.connect ?? defaultConnect;
  const now = opts.now ?? Date.now;

  let session: Session | null = null;
  let cdp: Cdp | null = null;
  let cdpSid: string | null = null;

  function closeCdp(): void {
    cdp?.close();
    cdp = null;
    cdpSid = null;
  }

  function forget(): void {
    session = null;
    closeCdp();
  }

  /** One Browserbase REST call. `session` = the call is scoped to the current session id (404 means it is gone). */
  async function api(what: string, method: "GET" | "POST", path: string, body?: unknown, sessionCall = false): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(`${API}${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
        headers: {
          "X-BB-API-Key": apiKey,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      const name = (err as { name?: unknown })?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new ComputerError("timeout", "request timed out");
      throw new ComputerError("failed", `${what} failed`);
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => undefined);
      throw new ComputerError("failed", "api key rejected");
    }
    if (res.status === 429) {
      await res.body?.cancel().catch(() => undefined);
      throw new ComputerError("failed", "rate limited");
    }
    if (res.status === 404 && sessionCall) {
      await res.body?.cancel().catch(() => undefined);
      forget();
      throw new ComputerError("not_found", "session ended");
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new ComputerError("failed", `${what} failed`);
    }
    const buf = await readCapped(res);
    try {
      return JSON.parse(buf.toString("utf8")) as unknown;
    } catch {
      throw new ComputerError("bad_output", `${what} failed`);
    }
  }

  function sessionPath(id: string, suffix = ""): string {
    if (!SESSION_ID_RE.test(id)) throw new ComputerError("bad_output", "unexpected session id");
    return `/v1/sessions/${id}${suffix}`;
  }

  async function release(): Promise<void> {
    const s = session;
    if (!s) return;
    closeCdp();
    try {
      await api("release", "POST", sessionPath(s.id), { status: "REQUEST_RELEASE" }, true);
    } catch (err) {
      // Already gone: nothing left to release. Any other failure keeps the handle so a retry can still release it.
      if (err instanceof ComputerError && err.code === "not_found") return;
      throw err;
    }
    forget();
  }

  async function createSession(): Promise<void> {
    const body: Record<string, unknown> = { timeout: timeoutSec, browserSettings: { viewport } };
    if (opts.projectId) body.projectId = opts.projectId;
    const json = asRec(await api("create", "POST", "/v1/sessions", body));
    const id = typeof json.id === "string" ? json.id : "";
    if (!SESSION_ID_RE.test(id)) throw new ComputerError("bad_output", "unexpected session id");
    const connectUrl = validConnectUrl(json.connectUrl);
    if (!connectUrl) {
      // Do not keep a session we cannot drive; release it best-effort.
      await api("release", "POST", sessionPath(id), { status: "REQUEST_RELEASE" }).catch(() => undefined);
      throw new ComputerError("bad_output", "unexpected connect url");
    }
    closeCdp();
    session = { id, connectUrl };
  }

  async function page(): Promise<{ c: Cdp; sid: string }> {
    const s = session;
    if (!s) throw new ComputerError("not_found", "session ended");
    if (!cdp) {
      const c = createCdp(connect);
      cdp = c;
      try {
        await c.connect(s.connectUrl);
      } catch {
        closeCdp();
        throw new ComputerError("failed", "browser connection failed");
      }
    }
    if (!cdpSid) {
      try {
        cdpSid = await cdp.attachFirstPage();
      } catch {
        closeCdp();
        throw new ComputerError("failed", "browser connection failed");
      }
    }
    return { c: cdp, sid: cdpSid };
  }

  /** Runs one CDP exchange. Any failure resets the connection so the next call starts clean. */
  async function viaCdp<T>(what: string, fn: (c: Cdp, sid: string) => Promise<T>): Promise<T> {
    const { c, sid } = await page();
    try {
      return await fn(c, sid);
    } catch (err) {
      if (err instanceof ComputerError) throw err;
      closeCdp();
      if (err instanceof Error && err.message === CDP_TIMEOUT) throw new ComputerError("timeout", "request timed out");
      throw new ComputerError("failed", `${what} failed`);
    }
  }

  const mouse = (c: Cdp, sid: string, params: Record<string, unknown>) => c.send("Input.dispatchMouseEvent", params, sid);
  const keyEvent = (c: Cdp, sid: string, type: "keyDown" | "keyUp", def: KeyDef, modifiers = 0, withText = true) =>
    c.send(
      "Input.dispatchKeyEvent",
      {
        type,
        key: def.key,
        code: def.code,
        windowsVirtualKeyCode: def.vk,
        modifiers,
        ...(type === "keyDown" && withText && def.text !== undefined ? { text: def.text } : {}),
      },
      sid,
    );

  async function act(argv: string[]): Promise<{ message: string }> {
    const [verb, ...rest] = argv;
    switch (verb) {
      case "click": {
        if (rest.length < 2 || rest.length > 3) throw invalidArgs();
        const x = parseCoord(rest[0]);
        const y = parseCoord(rest[1]);
        const button = rest[2] ?? "left";
        if (!BUTTONS.has(button)) throw invalidArgs();
        return viaCdp("action", async (c, sid) => {
          await mouse(c, sid, { type: "mouseMoved", x, y });
          await mouse(c, sid, { type: "mousePressed", x, y, button, buttons: BUTTON_BITS[button], clickCount: 1 });
          await mouse(c, sid, { type: "mouseReleased", x, y, button, buttons: 0, clickCount: 1 });
          return { message: `clicked (${x}, ${y}) [${button}]` };
        });
      }
      case "type": {
        if (rest.length !== 2 || rest[0] !== "--") throw invalidArgs();
        const text = rest[1];
        return viaCdp("action", async (c, sid) => {
          await c.send("Input.insertText", { text }, sid);
          return { message: `typed: "${text.slice(0, TYPED_PREVIEW)}"` };
        });
      }
      case "key": {
        if (rest.length !== 1) throw invalidArgs();
        const def = keyDef(rest[0]);
        if (!def) throw new ComputerError("failed", `invalid argument: unknown key "${rest[0].slice(0, 40)}"`);
        return viaCdp("action", async (c, sid) => {
          await keyEvent(c, sid, "keyDown", def);
          await keyEvent(c, sid, "keyUp", def, 0, false);
          return { message: `pressed ${rest[0]}` };
        });
      }
      case "hotkey": {
        const tokens = rest.flatMap((r) => r.split("+"));
        if (tokens.length < 2 || tokens.some((t) => t === "")) throw invalidArgs();
        const mainName = tokens[tokens.length - 1];
        // Own properties only (a "constructor" token must not resolve through the prototype chain).
        const mods: Array<{ bit: number; def: KeyDef }> = [];
        for (const t of tokens.slice(0, -1)) {
          const m = Object.hasOwn(MODIFIERS, t.toLowerCase()) ? MODIFIERS[t.toLowerCase()] : undefined;
          if (!m) throw new ComputerError("failed", "invalid argument: unknown modifier");
          mods.push(m);
        }
        const main = keyDef(mainName);
        if (!main) throw new ComputerError("failed", `invalid argument: unknown key "${mainName.slice(0, 40)}"`);
        const bits = mods.reduce((acc, m) => acc | m.bit, 0);
        const withText = (bits & (2 | 4)) === 0; // ctrl and meta suppress text input, as in a real keyboard
        return viaCdp("action", async (c, sid) => {
          let held = 0;
          for (const m of mods) {
            held |= m.bit;
            await keyEvent(c, sid, "keyDown", m.def, held, false);
          }
          await keyEvent(c, sid, "keyDown", main, bits, withText);
          await keyEvent(c, sid, "keyUp", main, bits, false);
          for (const m of [...mods].reverse()) {
            held &= ~m.bit;
            await keyEvent(c, sid, "keyUp", m.def, held, false);
          }
          return { message: `pressed ${tokens.join("+")}` };
        });
      }
      case "scroll": {
        if (rest.length !== 2) throw invalidArgs();
        const [dir, amountRaw] = rest;
        if (!["up", "down", "left", "right"].includes(dir)) throw invalidArgs();
        if (!/^\d{1,4}$/.test(amountRaw)) throw invalidArgs();
        const n = Math.min(MAX_SCROLL, Math.max(1, Number(amountRaw)));
        const deltaX = dir === "left" ? -n * SCROLL_STEP : dir === "right" ? n * SCROLL_STEP : 0;
        const deltaY = dir === "up" ? -n * SCROLL_STEP : dir === "down" ? n * SCROLL_STEP : 0;
        return viaCdp("action", async (c, sid) => {
          await mouse(c, sid, {
            type: "mouseWheel",
            x: Math.floor(viewport.width / 2),
            y: Math.floor(viewport.height / 2),
            deltaX,
            deltaY,
          });
          return { message: `scrolled ${dir} ${n}` };
        });
      }
      case "open": {
        if (rest.length !== 2 || rest[0] !== "--") throw invalidArgs();
        let u: URL;
        try {
          u = new URL(rest[1]);
        } catch {
          throw new ComputerError("failed", "invalid argument: only http(s) URLs");
        }
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new ComputerError("failed", "invalid argument: only http(s) URLs");
        return viaCdp("action", async (c, sid) => {
          const res = await c.send("Page.navigate", { url: u.toString() }, sid);
          if (typeof res.errorText === "string" && res.errorText) throw new ComputerError("failed", "action failed");
          return { message: `opened ${u.hostname}` };
        });
      }
      default:
        throw invalidArgs();
    }
  }

  return {
    kind: "browserbase",
    name: opts.name ?? "browserbase",
    capabilities: { shell: false, view: "external", hosted: true },
    stopMeansDestroy: true,

    async inspect(): Promise<DriverInfo | null> {
      const s = session;
      if (!s) return null;
      let json: Record<string, unknown>;
      try {
        json = asRec(await api("status check", "GET", sessionPath(s.id), undefined, true));
      } catch (err) {
        if (err instanceof ComputerError && err.code === "not_found") return null;
        throw err;
      }
      const status = typeof json.status === "string" ? json.status : "";
      if (status === "RUNNING") return { state: "running", status: "ready", image: null, kind: "browser", runtime: "browserbase" };
      if (status === "PENDING") return { state: "unknown", status: "pending", image: null, kind: "browser", runtime: "browserbase" };
      if (status === "ERROR" || status === "TIMED_OUT" || status === "COMPLETED") {
        forget();
        return null;
      }
      return { state: "unknown", status: "unrecognized", image: null, kind: "browser", runtime: "browserbase" };
    },

    async create(): Promise<void> {
      if (session) return;
      await createSession();
    },

    async start(): Promise<void> {
      // A session cannot be resumed: starting an absent one creates it.
      if (session) return;
      await createSession();
    },

    /** A session cannot be suspended, so stop releases it (same as destroy). */
    async stop(): Promise<void> {
      await release();
    },

    async destroy(): Promise<void> {
      await release();
    },

    async screenshot(): Promise<Buffer> {
      return viaCdp("screenshot", async (c, sid) => {
        const res = await c.send("Page.captureScreenshot", { format: "png" }, sid);
        if (typeof res.data !== "string" || !res.data) throw new Error("no data");
        return Buffer.from(res.data, "base64");
      });
    },

    act,

    async shell(): Promise<ShellResult> {
      throw new ComputerError("failed", "this computer backend has no shell");
    },

    async viewLink(): Promise<ComputerViewLink> {
      const s = session;
      if (!s) throw new ComputerError("not_found", "session ended");
      const json = asRec(await api("live view", "GET", sessionPath(s.id, "/debug?expiresIn=1800"), undefined, true));
      const url = validLiveViewUrl(json.debuggerFullscreenUrl);
      if (!url) throw new ComputerError("bad_output", "unexpected live view link");
      return { kind: "external", url, expiresAt: now() + LIVE_VIEW_TTL_MS };
    },
  };
}
