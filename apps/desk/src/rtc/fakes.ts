import { offerMac, sdpFingerprint } from "./protocol";
import type { RtcDataChannelLike, RtcPeerConnectionCtor, RtcPeerLike } from "./transport";

/**
 * Test doubles for the RTC transport: a fake RTCPeerConnection, data channel and ntfy-compatible signaling fetch.
 * Imported by tests only. No real WebRTC and no network.
 */

/** An offer whose fingerprint is upper-case, so the lower-casing is exercised. 95-char fingerprint. */
export const OFFER_SDP = [
  "v=0",
  "o=- 1 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=fingerprint:sha-256 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89",
  "",
].join("\r\n");

/** The daemon answer carries exactly one sha-256 fingerprint line (95 chars). */
export const ANSWER_FP = Array.from({ length: 32 }, () => "11").join(":");
export const ANSWER_SDP = ["v=0", "o=- 2 2 IN IP4 127.0.0.1", "s=-", "t=0 0", "a=fingerprint:sha-256 " + ANSWER_FP, ""].join("\r\n");

export class FakeChannel implements RtcDataChannelLike {
  readyState = "connecting";
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  readonly sent: string[] = [];

  constructor(readonly label: string) {}

  send(data: string): void {
    if (this.readyState !== "open") throw new Error("channel not open");
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.onclose?.();
  }

  /** Test: the channel opens. */
  open(): void {
    this.readyState = "open";
    this.onopen?.();
  }

  /** Test: a frame arrives from the daemon. */
  receive(data: string): void {
    this.onmessage?.({ data });
  }

  /** Test: the last frame the transport sent, parsed. */
  lastSent(): Record<string, unknown> {
    const raw = this.sent.at(-1);
    if (raw === undefined) throw new Error("nothing sent");
    return JSON.parse(raw) as Record<string, unknown>;
  }
}

export interface FakePeerOptions {
  /** Default true: ICE gathering is complete as soon as the local description is set. */
  iceComplete?: boolean;
  /** Default true: the channel opens when the answer is applied. */
  openOnAnswer?: boolean;
  /** Override the offer SDP (for the size check). */
  offerSdp?: string;
}

export class FakePeer implements RtcPeerLike {
  iceGatheringState = "new";
  localDescription: { sdp?: string } | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  remote: { type: "answer"; sdp: string } | null = null;
  readonly channels: FakeChannel[] = [];
  closed = false;

  constructor(
    readonly config: { iceServers: Array<{ urls: string }> },
    private readonly opts: FakePeerOptions,
  ) {}

  createDataChannel(label: string): FakeChannel {
    const ch = new FakeChannel(label);
    this.channels.push(ch);
    return ch;
  }

  async createOffer(): Promise<unknown> {
    return { type: "offer", sdp: this.opts.offerSdp ?? OFFER_SDP };
  }

  async setLocalDescription(desc: unknown): Promise<void> {
    this.localDescription = { sdp: (desc as { sdp: string }).sdp };
    this.iceGatheringState = this.opts.iceComplete === false ? "gathering" : "complete";
  }

  async setRemoteDescription(desc: { type: "answer"; sdp: string }): Promise<void> {
    this.remote = desc;
    if (this.opts.openOnAnswer !== false) {
      const ch = this.channels[0];
      queueMicrotask(() => ch?.open());
    }
  }

  close(): void {
    this.closed = true;
  }
}

/** A PeerConnection constructor that records every peer it makes. */
export function createFakePeerFactory(opts: FakePeerOptions = {}): { PeerConnection: RtcPeerConnectionCtor; peers: FakePeer[] } {
  const peers: FakePeer[] = [];
  class Ctor {
    constructor(config: { iceServers: Array<{ urls: string }> }) {
      const p = new FakePeer(config, opts);
      peers.push(p);
      return p as unknown as Ctor;
    }
  }
  return { PeerConnection: Ctor as unknown as RtcPeerConnectionCtor, peers };
}

export interface FakeSignalingOptions {
  /** Default true: the daemon answers every offer it receives on the publish call. */
  autoAnswer?: boolean;
  publishStatus?: number;
  streamStatus?: number;
  /** Extra text enqueued on the answer stream before the real answer (e.g. an unrelated ntfy event). */
  noise?: string[];
  /** Custom answer SDP. */
  answerSdp?: string;
  /** MAC key the fake daemon signs answers with (the pair secret, or sha256 of the device token). */
  answerKey?: string;
  /** Override the answer MAC: a string is sent as-is, null omits the field. Default: a valid MAC under answerKey. */
  answerMac?: string | null;
}

export interface FakeSignaling {
  fetch: typeof fetch;
  /** Every call in order: "stream <url>" or "publish". */
  order: string[];
  published: Array<{ url: string; body: string }>;
  streamSignals: AbortSignal[];
  /** Test: send a message on the answer stream for `${topic}-${id}`. */
  send(streamUrl: string, line: string): void;
}

const encoder = new TextEncoder();

/** An ntfy-compatible signaling server: JSON publish to `/` and a newline-delimited JSON stream per sub-topic. */
export function createFakeSignaling(opts: FakeSignalingOptions = {}): FakeSignaling {
  const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  const order: string[] = [];
  const published: Array<{ url: string; body: string }> = [];
  const streamSignals: AbortSignal[] = [];
  const line = (msg: unknown) => `${JSON.stringify({ event: "message", message: JSON.stringify(msg) })}\n`;
  const sendTo = (url: string, text: string) => {
    const c = streams.get(url);
    if (!c) throw new Error(`no stream for ${url}`);
    c.enqueue(encoder.encode(text));
  };

  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST") {
      order.push("publish");
      published.push({ url, body: String(init?.body) });
      if ((opts.publishStatus ?? 200) !== 200) return new Response("nope", { status: opts.publishStatus });
      if (opts.autoAnswer !== false) {
        const req = JSON.parse(String(init?.body)) as { topic: string; message: string };
        const offer = JSON.parse(req.message) as { id: string };
        const target = `${url.replace(/\/$/, "")}/${req.topic}-${offer.id}/json`; // POST goes to `${base}/`
        const full = JSON.parse(req.message) as { ts: number; auth: { device?: string } };
        const sdp = opts.answerSdp ?? ANSWER_SDP;
        let mac: string | undefined;
        if (opts.answerMac === null) mac = undefined;
        else if (typeof opts.answerMac === "string") mac = opts.answerMac;
        else {
          mac = await offerMac(opts.answerKey ?? "", {
            id: offer.id,
            ts: full.ts,
            fingerprint: sdpFingerprint(sdp) ?? "",
            kind: "answer",
            device: full.auth.device,
          });
        }
        for (const n of opts.noise ?? []) sendTo(target, `${n}\n`);
        sendTo(target, line({ v: 1, t: "answer", id: offer.id, sdp, ...(mac === undefined ? {} : { mac }) }));
      }
      return new Response("{}", { status: 200 });
    }
    order.push(`stream ${url}`);
    if (init?.signal) streamSignals.push(init.signal);
    if (opts.streamStatus !== undefined && opts.streamStatus !== 200) return new Response("no", { status: opts.streamStatus });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streams.set(url, controller);
      },
    });
    return new Response(body, { status: 200 });
  }) as typeof fetch;

  return {
    fetch: fetchFn,
    order,
    published,
    streamSignals,
    send(streamUrl, text) {
      sendTo(streamUrl, text);
    },
  };
}
