import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RTCPeerConnection } from "werift";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth } from "./auth.js";
import { openDb, type Db } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger } from "./ledger.js";
import { createRtcService, newRtcTopic, type RtcService, type Signaling } from "./rtc.js";
import { addMember, createBot, createRoom } from "./rooms.js";
import { setSetting } from "./settings.js";
// The REAL desk transport (browser code), driven against the REAL daemon service over real werift peers.
import { createRtcTransport, type RtcPeerLike } from "../../desk/src/rtc/transport";
import { createRtcFetch } from "../../desk/src/rtc/rtcFetch";

const OWNER = "owner-interop-token";
let dir: string;
let db: Db;
let service: RtcService;
let deliver: (text: string) => void;
const answerWaiters = new Map<string, (text: string) => void>();
const pcs: Array<{ close(): unknown }> = [];

/** Browser-style RTCPeerConnection facade over werift (the desk transport is written against the browser API). */
class BrowserLikePc implements RtcPeerLike {
  private pc = new RTCPeerConnection({ iceServers: [] });
  onicegatheringstatechange: (() => void) | null = null;
  constructor(_config: unknown) {
    pcs.push(this.pc);
    this.pc.iceGatheringStateChange.subscribe(() => this.onicegatheringstatechange?.());
  }
  get iceGatheringState() {
    return this.pc.iceGatheringState;
  }
  get localDescription() {
    return this.pc.localDescription ?? null;
  }
  createDataChannel(label: string) {
    const ch = this.pc.createDataChannel(label);
    const facade = {
      get readyState() {
        return ch.readyState;
      },
      onopen: null as (() => void) | null,
      onclose: null as (() => void) | null,
      onmessage: null as ((ev: { data: unknown }) => void) | null,
      send: (d: string) => ch.send(d),
      close: () => ch.close(),
    };
    ch.stateChanged.subscribe((s) => {
      if (s === "open") facade.onopen?.();
      if (s === "closed") facade.onclose?.();
    });
    ch.onMessage.subscribe((m) => facade.onmessage?.({ data: typeof m === "string" ? m : m.toString("utf8") }));
    return facade;
  }
  createOffer() {
    return this.pc.createOffer();
  }
  async setLocalDescription(d: unknown) {
    await this.pc.setLocalDescription(d as never);
  }
  async setRemoteDescription(d: { type: "answer"; sdp: string }) {
    await this.pc.setRemoteDescription(d);
  }
  close() {
    void this.pc.close();
  }
}

/** ntfy stand-in: POST to the root publishes (offers reach the daemon, answers reach the waiting GET stream). */
const ntfyFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (init?.method === "POST") {
    const body = JSON.parse(String(init.body)) as { topic: string; message: string };
    if (body.topic.includes("-", "openag-rtc-".length + 22)) answerWaiters.get(body.topic)?.(body.message);
    else deliver(body.message);
    return new Response("{}", { status: 200 });
  }
  const topic = url.replace(/^https:\/\/ntfy\.test\//, "").replace(/\/json$/, "");
  const enc = new TextEncoder();
  let ctl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctl = c;
      c.enqueue(enc.encode('{"event":"open"}\n'));
    },
  });
  answerWaiters.set(topic, (message) => ctl.enqueue(enc.encode(`${JSON.stringify({ event: "message", message })}\n`)));
  init?.signal?.addEventListener("abort", () => {
    try {
      ctl.close();
    } catch {
      // closed
    }
  });
  return new Response(stream, { status: 200 });
}) as typeof fetch;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-rtc-interop-"));
  db = openDb(dir);
  const ledger = createLedger(db);
  const auth = createAuth({ db, ownerToken: OWNER });
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  const gw = createGateway({ db, ledger, approvals: createApprovals(db, ledger), auth, dispatch: () => {}, deskDir: join(dir, "none") });
  const signaling: Signaling = {
    subscribe(onMessage) {
      deliver = onMessage;
      return () => undefined;
    },
    async publish(suffix, text) {
      answerWaiters.get(`${topic}-${suffix}`)?.(text);
    },
  };
  const topic = newRtcTopic();
  setSetting(db, "rtc", { enabled: true, server: "https://ntfy.test", topic, stun: [] });
  service = createRtcService({ db, ledger, auth, fetch: (r) => Promise.resolve(gw.fetch(r)), signaling: () => signaling });
  service.reload();
  (globalThis as { __topic?: string }).__topic = topic;
  (globalThis as { __auth?: unknown }).__auth = auth;
});
afterEach(async () => {
  service.stop();
  for (const p of pcs.splice(0)) await Promise.resolve(p.close()).catch(() => undefined);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("desk transport <-> daemon service", () => {
  test("pair with an invite, then reconnect as the device and call the gateway through rtcFetch", async () => {
    const g = globalThis as unknown as { __topic: string; __auth: ReturnType<typeof createAuth> };
    const { code } = g.__auth.createPairingCode("owner");
    const invite = { server: "https://ntfy.test", topic: g.__topic, stun: [] as string[], code, secret: service.createInvite().secret };
    const rtc = { PeerConnection: BrowserLikePc as never, fetch: ntfyFetch };

    const pairing = await createRtcTransport({ invite, auth: { kind: "pair", code }, rtc });
    const paired = await pairing.request("POST", "/pair", { headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "interop phone" }) });
    expect(paired.status).toBe(200);
    const { deviceId, token } = JSON.parse(paired.body) as { deviceId: string; token: string };
    expect(deviceId).toMatch(/^[a-f0-9]{16}$/);
    pairing.close();

    const device = await createRtcTransport({ invite: { server: invite.server, topic: invite.topic, stun: [] }, auth: { kind: "device", deviceId, token }, rtc });
    const f = createRtcFetch(device);
    const who = await f("/whoami", { headers: { authorization: `Bearer ${token}` } });
    expect(who.status).toBe(200);
    expect(await who.json()).toMatchObject({ kind: "device", deviceId });
    const rooms = await f("/rooms", { headers: { authorization: `Bearer ${token}` } });
    expect(rooms.status).toBe(200);
    expect(((await rooms.json()) as { rooms: unknown[] }).rooms.length).toBeGreaterThan(0);
    expect((await f("/whoami")).status).toBe(401);
    device.close();
  }, 60_000);
});
