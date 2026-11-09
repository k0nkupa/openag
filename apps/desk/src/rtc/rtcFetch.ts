import type { RtcTransport } from "./transport";

/**
 * A `fetch`-shaped adapter over the RTC transport for the desk's API calls. Deliberately narrow: GET and POST only,
 * string bodies only, and only the `authorization` and `content-type` headers. Anything else is a TypeError before
 * anything is sent. Relative URLs (and `http://rtc.local`) are the only accepted targets; any other origin is refused
 * so a call can never leave the tunnel by accident.
 */
const ORIGIN = "http://rtc.local";
const ALLOWED_HEADERS = new Set(["authorization", "content-type"]);
const NULL_BODY_STATUS = new Set([204, 205, 304]);

function abortError(): Error {
  const e = new Error("The operation was aborted.");
  e.name = "AbortError";
  return e;
}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

export function createRtcFetch(transport: Pick<RtcTransport, "request">): typeof fetch {
  return async (input, init) => {
    const isRequest = typeof input === "object" && input !== null && !(input instanceof URL);
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;

    let url: URL;
    try {
      url = new URL(raw, ORIGIN);
    } catch {
      throw new TypeError("rtc fetch: bad url");
    }
    if (url.origin !== ORIGIN) throw new TypeError("rtc fetch: only paths on the daemon are allowed");

    // shortcut: RTC carries bounded text frames only; add binary framing before enabling attachments here.
    if (/^\/rooms\/[^/]+\/uploads(?:\/|$)/.test(url.pathname)) throw new TypeError("rtc fetch: attachments require a LAN or Tailscale connection");
    if (/^\/dictation$|^\/rooms\/[^/]+\/dictation$/.test(url.pathname)) throw new TypeError("rtc fetch: dictation requires a LAN or Tailscale connection");
    const method = (init?.method ?? (isRequest ? (input as Request).method : "GET")).toUpperCase();
    if (method !== "GET" && method !== "POST") throw new TypeError("rtc fetch: only GET and POST are supported");

    let body: string | undefined;
    if (init?.body !== undefined && init.body !== null) {
      if (typeof init.body !== "string") throw new TypeError("rtc fetch: only string bodies are supported");
      body = init.body;
    } else if (isRequest && method === "POST") {
      body = await (input as Request).text();
    }
    if (method === "GET" && body !== undefined) throw new TypeError("rtc fetch: GET cannot have a body");

    const headers: Record<string, string> = {};
    const hdrSource = init?.headers ?? (isRequest ? (input as Request).headers : undefined);
    if (hdrSource !== undefined) {
      new Headers(hdrSource).forEach((value, name) => {
        const key = name.toLowerCase();
        if (!ALLOWED_HEADERS.has(key)) throw new TypeError(`rtc fetch: header not supported: ${key}`);
        headers[key] = value;
      });
    }

    const path = url.pathname + url.search;
    const pending = transport.request(method as "GET" | "POST", path, {
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(body !== undefined ? { body } : {}),
    });
    const res = init?.signal ? await raceAbort(pending, init.signal) : await pending;

    if (!Number.isInteger(res.status) || res.status < 200 || res.status > 599) {
      throw new TypeError("rtc fetch: bad status from daemon");
    }
    return new Response(NULL_BODY_STATUS.has(res.status) ? null : res.body, { status: res.status });
  };
}
