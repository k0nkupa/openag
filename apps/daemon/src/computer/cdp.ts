import WebSocket from "ws";

/**
 * A minimal Chrome DevTools Protocol client. The socket is injected so tests never touch the network. Errors are
 * always fixed strings: a CDP error message, a URL or a connect URL is never copied into an Error.
 */

export interface CdpSocket {
  send(data: string): void;
  onMessage(cb: (data: string) => void): void;
  onClose(cb: () => void): void;
  onOpen(cb: () => void): void;
  close(): void;
}

export const CDP_TIMEOUT = "cdp timeout";
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_PAYLOAD = 20 * 1024 * 1024;

/** Production socket. No redirects, bounded handshake and payload. */
export function defaultConnect(url: string): CdpSocket {
  const ws = new WebSocket(url, { handshakeTimeout: 15_000, maxPayload: MAX_PAYLOAD, followRedirects: false, maxRedirects: 0 });
  // An error event without a listener would crash the daemon; the close event that follows is what callers act on.
  ws.on("error", () => undefined);
  return {
    send: (data) => ws.send(data),
    onMessage: (cb) => ws.on("message", (data: Buffer | string) => cb(data.toString())),
    onClose: (cb) => ws.on("close", () => cb()),
    onOpen: (cb) => ws.on("open", () => cb()),
    close: () => ws.close(),
  };
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface Cdp {
  /** Opens the socket. Rejects with a fixed message if it does not open. */
  connect(url: string): Promise<void>;
  /** One CDP command. Rejects on a CDP error, a timeout or a closed socket. */
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Record<string, any>>;
  /** Attaches to the first page target (creating about:blank if none) and returns the flat session id. */
  attachFirstPage(): Promise<string>;
  close(): void;
}

export function createCdp(connect: (url: string) => CdpSocket, timeoutMs = DEFAULT_TIMEOUT_MS): Cdp {
  let socket: CdpSocket | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  function failAll(reason: string): void {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    pending.clear();
  }

  function handle(raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const m = msg as { id?: unknown; result?: unknown; error?: unknown };
    if (typeof m.id !== "number") return; // events are not used
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.error !== undefined) p.reject(new Error("cdp error"));
    else p.resolve(m.result ?? {});
  }

  const cdp: Cdp = {
    connect(url) {
      return new Promise<void>((resolve, reject) => {
        let opened = false;
        const s = connect(url);
        socket = s;
        s.onOpen(() => {
          opened = true;
          resolve();
        });
        s.onMessage(handle);
        s.onClose(() => {
          if (socket === s) socket = null;
          failAll("cdp socket closed");
          if (!opened) reject(new Error("cdp connect failed"));
        });
      });
    },

    send(method, params = {}, sessionId) {
      const s = socket;
      if (!s) return Promise.reject(new Error("cdp not connected"));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(CDP_TIMEOUT));
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        const msg: Record<string, unknown> = { id, method, params };
        if (sessionId) msg.sessionId = sessionId;
        try {
          s.send(JSON.stringify(msg));
        } catch {
          clearTimeout(timer);
          pending.delete(id);
          reject(new Error("cdp send failed"));
        }
      }) as Promise<Record<string, any>>;
    },

    async attachFirstPage() {
      const { targetInfos } = await cdp.send("Target.getTargets");
      const list = Array.isArray(targetInfos) ? (targetInfos as Array<{ targetId?: unknown; type?: unknown }>) : [];
      const page = list.find((t) => t.type === "page" && typeof t.targetId === "string");
      const targetId =
        page && typeof page.targetId === "string"
          ? page.targetId
          : (await cdp.send("Target.createTarget", { url: "about:blank" })).targetId;
      if (typeof targetId !== "string") throw new Error("cdp target failed");
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      if (typeof sessionId !== "string" || !sessionId) throw new Error("cdp attach failed");
      return sessionId;
    },

    close() {
      const s = socket;
      socket = null;
      failAll("cdp closed");
      s?.close();
    },
  };
  return cdp;
}
