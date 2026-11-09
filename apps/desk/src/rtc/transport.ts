import {
  DATA_CHANNEL_LABEL,
  MAX_OFFER_SDP,
  asResponseChunk,
  authKey,
  checkInvite,
  checkTurn,
  encodeFrame,
  isMac,
  isObject,
  macEquals,
  offerMac,
  parseAnswerLine,
  randomId,
  sdpFingerprint,
  type AnswerMessage,
  type ClientFrame,
  type RtcAuth,
  type RtcInvite,
  type RtcTurn,
} from "./protocol";

/** The subset of RTCDataChannel the transport uses (a fake satisfies it in tests). */
export interface RtcDataChannelLike {
  readyState: string;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
}

/** The subset of RTCPeerConnection the transport uses. */
export interface RtcPeerLike {
  readonly iceGatheringState: string;
  readonly localDescription: { sdp?: string } | null;
  onicegatheringstatechange: (() => void) | null;
  createDataChannel(label: string): RtcDataChannelLike;
  createOffer(): Promise<unknown>;
  setLocalDescription(desc: unknown): Promise<void>;
  setRemoteDescription(desc: { type: "answer"; sdp: string }): Promise<void>;
  close(): void;
}

export type RtcPeerConnectionCtor = new (config: {
  iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
}) => RtcPeerLike;

export interface RtcTimeouts {
  /** How long to wait for ICE gathering to complete before offering what we have. */
  iceMs: number;
  /** Whole connect (stream open, publish, answer, channel open). */
  connectMs: number;
  /** Per request frame. */
  requestMs: number;
}

export interface RtcTransportOptions {
  invite: RtcInvite;
  auth: RtcAuth;
  rtc?: {
    PeerConnection?: RtcPeerConnectionCtor;
    fetch?: typeof fetch;
    timeouts?: Partial<RtcTimeouts>;
  };
}

export type RtcState = "connecting" | "open" | "closed";

export interface RtcResponse {
  status: number;
  body: string;
}

export interface RtcTransport {
  readonly state: RtcState;
  request(method: "GET" | "POST", path: string, opts?: { headers?: Record<string, string>; body?: string }): Promise<RtcResponse>;
  /** Resolves with an unsubscribe function once the daemon acknowledges with 200. */
  subscribe(headers: Record<string, string>, onEvent: (event: unknown) => void): Promise<() => void>;
  /** Fresh TURN credentials from the daemon, or null when it has no TURN. Only meaningful on a device transport. */
  turnCredentials(headers: Record<string, string>): Promise<RtcTurn | null>;
  /** Called once when the transport closes (after being open or while connecting). Returns the remover. */
  onClose(cb: () => void): () => void;
  close(): void;
}

interface Pending {
  resolve(r: RtcResponse): void;
  reject(e: Error): void;
  timer: ReturnType<typeof setTimeout>;
  chunks: Map<number, string>;
  status: number;
  last: number | null;
}

const MAX_SEQ = 10_000;

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

/** Streams the signaling topic `${topic}-${id}`; resolves with the answer SDP, then the caller stops the stream. */
async function openAnswerStream(
  base: string,
  topic: string,
  id: string,
  doFetch: typeof fetch,
): Promise<{ answer: Promise<AnswerMessage>; stop(): void }> {
  const ctl = new AbortController();
  const res = await doFetch(`${base}/${topic}-${id}/json`, { redirect: "error", signal: ctl.signal });
  if (!res.ok || !res.body) {
    ctl.abort();
    throw new Error(`answer stream failed: http ${res.status}`);
  }
  const body = res.body;
  const answer = new Promise<AnswerMessage>((resolve, reject) => {
    void (async () => {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        if (buf.length > 64 * 1024) buf = ""; // never grow without a newline
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          const ans = parseAnswerLine(line, id);
          if (ans !== null) return resolve(ans);
        }
      }
      reject(new Error("answer stream closed"));
    })().catch(() => reject(new Error("answer stream failed")));
  });
  answer.catch(() => undefined); // consumed only if the connect gets that far
  return { answer, stop: () => ctl.abort() };
}

/** Waits for ICE gathering to complete, or `ms` at most; then the current local description is used. */
function gatherIce(pc: RtcPeerLike, ms: number): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      pc.onicegatheringstatechange = null;
      resolve();
    }
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") done();
    };
  });
}

/**
 * Connects to the daemon over the signaling rendezvous and returns an open data-channel transport. Rejects if the
 * offer cannot be built, published, answered, or opened in time. Nothing here touches the network except through the
 * injected fetch and the injected PeerConnection.
 */
export async function createRtcTransport(opts: RtcTransportOptions): Promise<RtcTransport> {
  const { base, topic, stun, secret, turn } = checkInvite(opts.invite);
  const { key, device } = await authKey(opts.auth, secret); // validate before any peer exists
  const PC = opts.rtc?.PeerConnection ?? (globalThis as unknown as { RTCPeerConnection?: RtcPeerConnectionCtor }).RTCPeerConnection;
  if (!PC) throw new Error("WebRTC is not available");
  const doFetch: typeof fetch = opts.rtc?.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeouts: RtcTimeouts = { iceMs: 5000, connectMs: 20_000, requestMs: 30_000, ...opts.rtc?.timeouts };

  const iceServers = [
    ...stun.map((urls) => ({ urls })),
    ...(turn ? [{ urls: turn.urls, username: turn.username, credential: turn.credential }] : []),
  ];
  const pc = new PC({ iceServers });
  const channel = pc.createDataChannel(DATA_CHANNEL_LABEL);
  let state: RtcState = "connecting";
  const pending = new Map<string, Pending>();
  const subs = new Map<string, (event: unknown) => void>();
  const closeListeners = new Set<() => void>();

  let onOpen!: () => void;
  let onOpenFail!: (e: Error) => void;
  const opened = new Promise<void>((res, rej) => {
    onOpen = res;
    onOpenFail = rej;
  });
  opened.catch(() => undefined);

  function teardown(err: Error): void {
    if (state === "closed") return;
    state = "closed";
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
    subs.clear();
    onOpenFail(err);
    for (const cb of [...closeListeners]) {
      try {
        cb();
      } catch {
        // a throwing listener must not break teardown
      }
    }
    closeListeners.clear();
    try {
      channel.close();
    } catch {
      // already closed
    }
    try {
      pc.close();
    } catch {
      // already closed
    }
  }

  function onMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      return;
    }
    if (!isObject(frame)) return;
    if (frame.type === "event") {
      for (const cb of [...subs.values()]) {
        try {
          cb(frame.event);
        } catch {
          // a throwing listener must not break the channel
        }
      }
      return;
    }
    const chunk = asResponseChunk(frame);
    if (!chunk || chunk.seq > MAX_SEQ) return;
    const p = pending.get(chunk.id);
    if (!p || p.chunks.has(chunk.seq)) return;
    p.status = chunk.status;
    p.chunks.set(chunk.seq, chunk.body);
    if (chunk.last) p.last = chunk.seq;
    if (p.last === null) return;
    for (let i = 0; i <= p.last; i++) if (!p.chunks.has(i)) return;
    clearTimeout(p.timer);
    pending.delete(chunk.id);
    let body = "";
    for (let i = 0; i <= p.last; i++) body += p.chunks.get(i);
    p.resolve({ status: p.status, body });
  }

  function send(frame: ClientFrame): Promise<RtcResponse> {
    if (state !== "open") return Promise.reject(new Error("transport is not open"));
    let text: string;
    try {
      text = encodeFrame(frame);
    } catch (e) {
      return Promise.reject(e);
    }
    return new Promise<RtcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(frame.id);
        reject(new Error("request timed out"));
      }, timeouts.requestMs);
      pending.set(frame.id, { resolve, reject, timer, chunks: new Map(), status: 0, last: null });
      try {
        channel.send(text);
      } catch {
        clearTimeout(timer);
        pending.delete(frame.id);
        reject(new Error("send failed"));
      }
    });
  }

  channel.onopen = () => onOpen();
  channel.onclose = () => teardown(new Error("data channel closed"));
  channel.onmessage = (ev) => onMessage(ev.data);

  let stopStream = null as (() => void) | null; // assigned inside connectP
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await gatherIce(pc, timeouts.iceMs);
    const sdp = pc.localDescription?.sdp;
    if (!sdp) throw new Error("no local description");
    if (sdp.length > MAX_OFFER_SDP) throw new Error("offer too large for signaling");
    const fingerprint = sdpFingerprint(sdp);
    if (!fingerprint) throw new Error("offer has no valid DTLS fingerprint");

    const id = randomId();
    const ts = Date.now();
    const kind = opts.auth.kind;
    const mac = await offerMac(key, { id, ts, fingerprint, kind, device });
    const message = JSON.stringify({
      v: 1,
      t: "offer",
      id,
      ts,
      sdp,
      auth: device !== undefined ? { kind, device, mac } : { kind, mac },
    });

    const connectP = (async () => {
      const stream = await openAnswerStream(base, topic, id, doFetch);
      stopStream = stream.stop;
      try {
        const res = await doFetch(`${base}/`, {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ topic, message, priority: 3 }),
        });
        if (!res.ok) throw new Error(`offer publish failed: http ${res.status}`);
        const answer = await stream.answer;
        stream.stop();
        // Verify before anything is applied: the answer must be bound to THIS offer (id, ts, DTLS fingerprint).
        const fp = sdpFingerprint(answer.sdp);
        if (!fp) throw new Error("answer has no valid DTLS fingerprint");
        if (!isMac(answer.mac)) throw new Error("answer MAC missing or invalid");
        const expected = await offerMac(key, { id, ts, fingerprint: fp, kind: "answer", device });
        if (!macEquals(expected, answer.mac)) throw new Error("answer MAC mismatch");
        await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
        await opened;
      } finally {
        stream.stop();
      }
    })();
    await withTimeout(connectP, timeouts.connectMs, "WebRTC connect timed out");
  } catch (e) {
    const err = e instanceof Error ? e : new Error("WebRTC connect failed");
    stopStream?.();
    teardown(err);
    throw err;
  }

  state = "open";

  return {
    get state() {
      return state;
    },

    async request(method, path, o = {}) {
      if (method !== "GET" && method !== "POST") throw new TypeError("rtc request: only GET and POST");
      if (typeof path !== "string" || !path.startsWith("/")) throw new TypeError("rtc request: path must start with /");
      const frame: ClientFrame = {
        id: randomId(),
        type: "request",
        method,
        path,
        ...(o.headers !== undefined ? { headers: o.headers } : {}),
        ...(o.body !== undefined ? { body: o.body } : {}),
      };
      return send(frame);
    },

    async subscribe(headers, onEvent) {
      const id = randomId();
      subs.set(id, onEvent); // registered before the ack so no event is missed
      try {
        const res = await send({ id, type: "subscribe", headers });
        if (res.status !== 200) throw new Error(`subscribe failed: http ${res.status}`);
      } catch (e) {
        subs.delete(id);
        throw e;
      }
      return () => {
        if (!subs.delete(id)) return;
        if (state === "open") void send({ id, type: "unsubscribe" }).catch(() => undefined);
      };
    },

    async turnCredentials(headers) {
      const res = await send({ id: randomId(), type: "turn", headers });
      if (res.status === 404) return null;
      if (res.status !== 200) throw new Error(`turn failed: http ${res.status}`);
      let data: unknown;
      try {
        data = JSON.parse(res.body);
      } catch {
        throw new Error("turn: bad body");
      }
      return checkTurn(data);
    },

    onClose(cb) {
      closeListeners.add(cb);
      return () => {
        closeListeners.delete(cb);
      };
    },

    close() {
      teardown(new Error("transport closed"));
    },
  };
}
