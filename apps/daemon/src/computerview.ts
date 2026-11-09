import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { Takeover } from "./takeover.js";

/**
 * Reverse proxy from `/computer/view/*` to the sandbox's viewer server (HTTP + WebSocket).
 *
 * - Auth is the HttpOnly `oag_view` cookie minted by POST /computer/takeover, or (for the viewer's cookie-less RPC
 *   fetches) the viewer ticket of the current takeover. Daemon Bearer tokens are not accepted here.
 * - The upstream is always the loopback origin `computer.viewLink()` reported. Nothing in the request can choose it.
 * - The viewer's own bearer ticket travels in the `authorization` header set by the viewer's JS and is forwarded;
 *   the view cookie and every proxy/hop header are never forwarded.
 */

export const VIEW_PREFIX = "/computer/view";
export const VIEW_COOKIE = "oag_view";
export const VIEW_COOKIE_MAX_AGE_S = 30 * 60;
export const VIEW_BODY_BYTES = 8 * 1024 * 1024;
const WS_MAX_PAYLOAD = 16 * 1024 * 1024;
const MAX_VIEW_SOCKETS = 8;
const VIEW_CLOSE_CODE = 4002;

const FORWARD_REQUEST_HEADERS = [
  "authorization",
  "x-cua-env-authorization", // where the viewer's JS puts its ticket
  "content-type",
  "accept",
  "range",
  "if-none-match",
  "user-agent",
  "x-grpc-web",
  "x-user-agent",
  "grpc-timeout",
  "connect-protocol-version",
  "connect-timeout-ms",
];
// fetch() already decoded the body, so its length/encoding no longer describe what we send. Cookies, CORS and the
// hop-by-hop set never cross the proxy.
const DROP_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "proxy-authenticate",
  "trailer",
]);

export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** The upstream path (with leading slash) for a request path, or null when it is not safe to forward. */
export function upstreamPath(pathname: string): string | null {
  if (!pathname.startsWith(`${VIEW_PREFIX}/`)) return null;
  const raw = pathname.slice(VIEW_PREFIX.length);
  // Encoded dots, slashes, backslashes and NULs have no business in viewer paths: refuse rather than interpret them.
  if (/%(2e|2f|5c|00)/i.test(raw)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.includes("\0") || decoded.includes("//")) return null;
  if (decoded.split("/").some((seg) => seg === ".." || seg === ".")) return null;
  return raw;
}

export function viewCookie(sessionId: string, secure: boolean): string {
  return `${VIEW_COOKIE}=${sessionId}; Path=${VIEW_PREFIX}; HttpOnly; SameSite=Strict; Max-Age=${VIEW_COOKIE_MAX_AGE_S}${secure ? "; Secure" : ""}`;
}

export interface ViewProxy {
  handle(req: Request): Promise<Response>;
  /** Attach the WebSocket upgrade handler for `/computer/view/*`. Returns a detach function. */
  attach(server: Server): () => void;
}

const text = (status: number, body: string) =>
  new Response(JSON.stringify({ error: body }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function createViewProxy(deps: { takeover: Takeover }): ViewProxy {
  const { takeover } = deps;
  const sockets = new Set<WebSocket>();
  const connecting = new Set<object>(); // handshakes in flight (count against the cap)
  const upstreams = new Set<WebSocket>(); // every upstream connection, so none can outlive a release
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD });

  const closeAll = () => {
    for (const up of upstreams) up.terminate();
    for (const ws of sockets) {
      ws.close(VIEW_CLOSE_CODE, "control handed back");
      const t = setTimeout(() => ws.terminate(), 1000);
      t.unref();
    }
  };
  takeover.onRelease(closeAll);

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // Pages and sockets carry the view cookie; the viewer's own RPC fetches (credentials omitted) carry its ticket.
    const authed =
      takeover.checkSession(readCookie(req.headers.get("cookie"), VIEW_COOKIE)) || takeover.checkTicket(req.headers.get("x-cua-env-authorization") ?? req.headers.get("authorization"));
    if (!authed) return text(401, "unauthorized");
    const path = upstreamPath(url.pathname);
    if (path === null) return text(400, "bad path");
    let origin: string;
    try {
      const link = await takeover.viewLink();
      // An external live-view link is opened by the browser directly; there is nothing of ours to proxy.
      if (link.kind === "external") return text(404, "no proxied viewer for this backend");
      origin = link.origin;
    } catch {
      return text(502, "viewer unavailable");
    }
    takeover.touch();
    const headers = new Headers();
    for (const name of FORWARD_REQUEST_HEADERS) {
      const v = req.headers.get(name);
      if (v !== null) headers.set(name, v);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body !== null;
    let upstream: Response;
    try {
      upstream = await fetch(`${origin}${path}${url.search}`, {
        method: req.method,
        headers,
        body: hasBody ? req.body : undefined,
        // @ts-expect-error `duplex` is required by Node's fetch for streamed bodies and missing from the DOM typings.
        duplex: hasBody ? "half" : undefined,
        redirect: "manual",
        signal: req.signal,
      });
    } catch {
      return text(502, "viewer unavailable");
    }
    const out = new Headers();
    for (const [k, v] of upstream.headers) {
      const key = k.toLowerCase();
      if (DROP_RESPONSE_HEADERS.has(key) || key.startsWith("access-control-")) continue;
      out.set(k, v);
    }
    out.set("cache-control", "no-store");
    out.set("x-content-type-options", "nosniff");
    // Only the viewer page itself may run script; any other HTML the viewer serves (e.g. a file from the sandbox) is
    // sandboxed so it cannot reach the desk's same-origin storage.
    if ((out.get("content-type") ?? "").toLowerCase().includes("html") && !path.startsWith("/viewer/")) {
      out.set("content-security-policy", "sandbox; default-src 'none'");
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }

  function reject(socket: Duplex, status: string): void {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  async function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith(`${VIEW_PREFIX}/`)) return; // not ours; attachStream owns /stream and drops the rest
    socket.on("error", () => undefined);
    // A browser always sends Origin on WebSocket handshakes: a cross-site page must not ride the view cookie.
    const originHeader = req.headers.origin;
    if (originHeader) {
      let host: string | undefined;
      try {
        host = new URL(originHeader).host;
      } catch {
        host = undefined;
      }
      if (host === undefined || host !== req.headers.host) return reject(socket, "403 Forbidden");
    }
    if (!takeover.checkSession(readCookie(req.headers.cookie, VIEW_COOKIE))) return reject(socket, "401 Unauthorized");
    const path = upstreamPath(url.pathname);
    if (path === null) return reject(socket, "400 Bad Request");
    // Reserve the slot before any await: concurrent handshakes must not all pass the cap.
    if (sockets.size + connecting.size >= MAX_VIEW_SOCKETS) return reject(socket, "503 Service Unavailable");
    const slot = {};
    connecting.add(slot);
    let upstream: WebSocket | undefined;
    const fail = (status: string) => {
      connecting.delete(slot);
      upstream?.terminate();
      reject(socket, status);
    };
    // A client that gives up mid-handshake must not leave the upstream connection behind.
    socket.once("close", () => {
      if (connecting.delete(slot)) upstream?.terminate();
    });

    try {
      const protocols = String(req.headers["sec-websocket-protocol"] ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      // ws throws on duplicate or malformed subprotocols; refuse them instead of letting that escape.
      if (new Set(protocols).size !== protocols.length || protocols.some((p) => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(p))) {
        return fail("400 Bad Request");
      }
      let origin: string;
      try {
        const link = await takeover.viewLink();
      if (link.kind === "external") return fail("404 Not Found");
      origin = link.origin;
      } catch {
        return fail("502 Bad Gateway");
      }
      const headers: Record<string, string> = { origin };
      if (typeof req.headers.authorization === "string") headers.authorization = req.headers.authorization;
      const up = new WebSocket(`${origin.replace(/^http/, "ws")}${path}${url.search}`, protocols, {
        headers,
        maxPayload: WS_MAX_PAYLOAD,
        handshakeTimeout: 10_000,
      });
      upstream = up;
      upstreams.add(up);
      up.once("close", () => upstreams.delete(up));
      up.once("error", () => fail("502 Bad Gateway"));
      up.once("open", () => {
        // Hand-back, or the client leaving, while connecting: do not complete the client's upgrade.
        if (!connecting.has(slot) || !takeover.checkSession(readCookie(req.headers.cookie, VIEW_COOKIE))) return fail("401 Unauthorized");
        connecting.delete(slot);
        wss.handleUpgrade(req, socket, head, (client) => {
          sockets.add(client);
          takeover.touch();
          const closeBoth = () => {
            sockets.delete(client);
            if (client.readyState !== WebSocket.CLOSED) client.terminate();
            if (up.readyState !== WebSocket.CLOSED) up.terminate();
          };
          // Only what the human does counts as activity: the viewer streams frames on its own, which would
          // otherwise keep an abandoned tab from ever going idle.
          client.on("message", (data, isBinary) => {
            takeover.touch();
            if (up.readyState === WebSocket.OPEN) up.send(data, { binary: isBinary });
          });
          up.on("message", (data, isBinary) => {
            if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
          });
          client.once("close", closeBoth);
          up.once("close", closeBoth);
          client.on("error", closeBoth);
          up.on("error", closeBoth);
        });
      });
    } catch {
      fail("502 Bad Gateway");
    }
  }

  return {
    handle,
    attach(server) {
      const listener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void onUpgrade(req, socket, head);
      server.on("upgrade", listener);
      return () => {
        server.off("upgrade", listener);
        closeAll();
      };
    },
  };
}
