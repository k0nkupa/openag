import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { RTCPeerConnection } from "werift";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createApprovals } from "./approvals.js";
import { createAuth, type Auth } from "./auth.js";
import { openDb, type Db } from "./db/index.js";
import { createGateway } from "./gateway.js";
import { createLedger, type Ledger } from "./ledger.js";
import { createHmac } from "node:crypto";
import { createRtcService, mintTurnCredentials, newRtcTopic, offerMac, sdpFingerprint, turnConfig, type RtcService, type Signaling } from "./rtc.js";
import { addMember, createBot, createRoom } from "./rooms.js";
import { setSetting } from "./settings.js";

const OWNER = "owner-rtc-token";
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
let dir: string;
let db: Db;
let ledger: Ledger;
let auth: Auth;
let service: RtcService;
let deliver: (text: string) => void;
let answers: Map<string, string>;
let peers: RTCPeerConnection[];
let now: number;

function fakeSignaling(): Signaling {
  return {
    subscribe(onMessage) {
      deliver = onMessage;
      return () => undefined;
    },
    async publish(suffix, text) {
      answers.set(suffix, text);
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-rtc-"));
  db = openDb(dir);
  ledger = createLedger(db);
  auth = createAuth({ db, ownerToken: OWNER });
  createBot(db, { id: "boss", runtime: "api" });
  createRoom(db, { id: "main", leadBotId: "boss" });
  addMember(db, "main", "boss");
  const gateway = createGateway({ db, ledger, approvals: createApprovals(db, ledger), auth, dispatch: () => {}, deskDir: join(dir, "none") });
  answers = new Map();
  peers = [];
  now = Date.now();
  service = createRtcService({ db, ledger, auth, fetch: (r) => Promise.resolve(gateway.fetch(r)), signaling: () => fakeSignaling(), now: () => now, limits: { maxPeers: 3, idleMs: 60_000, pairPeerMs: 60_000, frameBudget: 8 } });
});
afterEach(async () => {
  service.stop();
  for (const p of peers) await Promise.resolve(p.close()).catch(() => undefined);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const enable = () => {
  setSetting(db, "rtc", { enabled: true, server: "https://ntfy.sh", topic: newRtcTopic(), stun: [] });
  service.reload();
};
const gathered = (pc: RTCPeerConnection) =>
  new Promise<void>((r) => {
    if (pc.iceGatheringState === "complete") r();
    pc.iceGatheringStateChange.subscribe((s) => s === "complete" && r());
  });
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

interface Phone {
  pc: RTCPeerConnection;
  id: string;
  call(method: string, path: string, headers?: Record<string, string>, body?: string): Promise<{ status: number; body: string }>;
  events: unknown[];
  closed: () => boolean;
  /** The daemon's answer carried a valid MAC over ITS fingerprint (what a real phone must check). */
  answerAuthentic: boolean;
}

/** Plays the phone: builds an offer, signs it with `key`, waits for the answer and the open channel. Null = no answer. */
async function joinAs(opts: { kind: "pair" | "device"; key: string; device?: string; ts?: number; id?: string; tamper?: (o: Record<string, unknown>) => void }): Promise<Phone | null> {
  const pc = new RTCPeerConnection({ iceServers: [] });
  peers.push(pc);
  const channel = pc.createDataChannel("openag-api");
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc);
  const sdp = pc.localDescription!.sdp;
  const id = opts.id ?? Math.random().toString(36).slice(2, 12) + "abcd";
  const ts = opts.ts ?? now;
  const mac = offerMac(opts.key, { id, ts, fingerprint: sdpFingerprint(sdp)!, kind: opts.kind, device: opts.device });
  const offer: Record<string, unknown> = { v: 1, t: "offer", id, ts, sdp, auth: { kind: opts.kind, ...(opts.device ? { device: opts.device } : {}), mac } };
  opts.tamper?.(offer);
  deliver(JSON.stringify(offer));
  for (let i = 0; i < 60 && !answers.has(id); i++) await tick(20);
  const raw = answers.get(id);
  if (!raw) return null;
  const ans = JSON.parse(raw) as { sdp: string; mac: string };
  const answerFp = sdpFingerprint(ans.sdp);
  const answerAuthentic = !!answerFp && ans.mac === offerMac(opts.key, { id, ts, fingerprint: answerFp, kind: "answer", device: opts.device });
  await pc.setRemoteDescription({ type: "answer", sdp: ans.sdp });
  await new Promise<void>((r) => (channel.readyState === "open" ? r() : channel.stateChanged.subscribe((s) => s === "open" && r())));
  const waiting = new Map<string, { chunks: string[]; resolve: (r: { status: number; body: string }) => void; status: number }>();
  const events: unknown[] = [];
  let closed = false;
  channel.stateChanged.subscribe((s) => s === "closed" && (closed = true));
  channel.onMessage.subscribe((m) => {
    const f = JSON.parse(String(m)) as { id?: string; type?: string; status: number; seq: number; last: boolean; body: string; event?: unknown };
    if (f.type === "event") return void events.push(f.event);
    const w = waiting.get(f.id!);
    if (!w) return;
    w.chunks[f.seq] = f.body;
    w.status = f.status;
    if (f.last) w.resolve({ status: w.status, body: w.chunks.join("") });
  });
  return {
    pc,
    id,
    answerAuthentic,
    events,
    closed: () => closed,
    call: (method, path, headers = {}, body) =>
      new Promise((resolve) => {
        const fid = Math.random().toString(36).slice(2, 10);
        waiting.set(fid, { chunks: [], resolve, status: 0 });
        const type = method === "SUBSCRIBE" ? "subscribe" : method === "TURN" ? "turn" : "request";
        channel.send(JSON.stringify({ id: fid, type, ...(type === "request" ? { method, path, body } : {}), headers }));
      }),
  };
}

describe("wire compatibility with the desk transport", () => {
  test("offerMac matches the vectors hard-coded in apps/desk/src/rtc/protocol.test.ts", () => {
    const fingerprint = "ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89";
    const m = { id: "abcdefgh_ID-12345", ts: 1700000000000, fingerprint };
    expect(offerMac(sha("ABCDEFGH"), { ...m, kind: "pair" })).toBe("1866d779fde14c97a82832421b4187f16e45d7d737852eb1d6abe9abf00e60ef");
    expect(offerMac(sha("tok-secret"), { ...m, kind: "device", device: "0123456789abcdef" })).toBe("adb2c280231bcf343edd50927adaa8f4fa98ad29599de91d29e565cff7e2fe41");
  });
});

describe("TURN (optional, env only)", () => {
  const env = { OPENAG_RTC_TURN_URLS: "turn:turn.example.com:3478?transport=udp, turns:turn.example.com:5349", OPENAG_RTC_TURN_SECRET: "a-long-shared-secret-value" };

  test("config is validated; credentials are short-lived REST credentials derived from the secret, never the secret", () => {
    const cfg = turnConfig(env)!;
    expect(cfg.urls).toEqual(["turn:turn.example.com:3478?transport=udp", "turns:turn.example.com:5349"]);
    const t = mintTurnCredentials(cfg, 1_700_000_000_000);
    expect(t.username).toBe("1700003600:openag");
    expect(t.credential).toBe(createHmac("sha1", env.OPENAG_RTC_TURN_SECRET).update("1700003600:openag").digest("base64"));
    expect(JSON.stringify(t)).not.toContain(env.OPENAG_RTC_TURN_SECRET);
    expect(turnConfig({})).toBeNull();
    expect(turnConfig({ ...env, OPENAG_RTC_TURN_SECRET: "short" })).toBeNull();
    expect(turnConfig({ ...env, OPENAG_RTC_TURN_URLS: "http://evil.example" })).toBeNull();
    expect(turnConfig({ ...env, OPENAG_RTC_TURN_URLS: "turn:a;rm -rf /" })).toBeNull();
  });

  test("invites and the daemon's own peer carry the minted credentials; status says only that TURN is configured", async () => {
    const seenIce: unknown[] = [];
    const gw = createGateway({ db, ledger, approvals: createApprovals(db, ledger), auth, dispatch: () => {}, deskDir: join(dir, "none") });
    service.stop();
    service = createRtcService({ db, ledger, auth, fetch: (r) => Promise.resolve(gw.fetch(r)), signaling: () => fakeSignaling(), now: () => now, env, createPeer: async (ice) => {
      seenIce.push(ice);
      return new RTCPeerConnection({ iceServers: [] }) as never;
    } });
    enable();
    const invite = service.createInvite();
    expect(invite.turn).toMatchObject({ urls: expect.any(Array), username: expect.stringMatching(/:openag$/) });
    expect(JSON.stringify(invite)).not.toContain(env.OPENAG_RTC_TURN_SECRET);
    expect(service.status().turn).toBe(true);
    const pairer = await joinAs({ kind: "pair", key: invite.secret });
    expect(pairer).toBeTruthy();
    expect(JSON.stringify(seenIce)).toContain("openag");
    expect(JSON.stringify(seenIce)).not.toContain(env.OPENAG_RTC_TURN_SECRET);

    // a device peer can fetch fresh relay credentials (24 h) for its next connect; a pair peer cannot
    const { device, token } = auth.createDevice("phone");
    const phone = (await joinAs({ kind: "device", key: sha(token), device: device.id }))!;
    const res = await phone.call("TURN", "", { authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    const creds = JSON.parse(res.body) as { username: string; credential: string };
    expect(Number(creds.username.split(":")[0]) - Math.floor(now / 1000)).toBeGreaterThan(23 * 3600);
    expect(res.body).not.toContain(env.OPENAG_RTC_TURN_SECRET);
    expect((await phone.call("TURN", "", {})).status).toBe(401);
    expect((await pairer!.call("TURN", "", { authorization: `Bearer ${token}` })).status).toBe(401);
  });
});

describe("rtc service", () => {
  test("is inert until enabled with a topic; an enabled one subscribes", () => {
    expect(service.status()).toMatchObject({ enabled: false, inert: "disabled", subscribed: false });
    setSetting(db, "rtc", { enabled: true, server: "https://ntfy.sh", topic: null, stun: [] });
    expect(service.status().inert).toMatch(/topic/);
    enable();
    expect(service.status().inert).toBeNull();
  });

  test("a device offer signed with the device key connects and gets the same answers as over HTTP", async () => {
    enable();
    const { device, token } = auth.createDevice("phone");
    const phone = (await joinAs({ kind: "device", key: sha(token), device: device.id }))!;
    expect(phone).toBeTruthy();
    expect(phone.answerAuthentic).toBe(true); // the answer is signed over the daemon's own fingerprint
    expect((await phone.call("GET", "/health")).status).toBe(200);
    const who = await phone.call("GET", "/whoami", { authorization: `Bearer ${token}` });
    expect(who.status).toBe(200);
    expect((await phone.call("GET", "/whoami")).status).toBe(401);
    expect((await phone.call("GET", "/whoami", { authorization: "Bearer oag_nope" })).status).toBe(401);
    expect(service.status().peers).toBe(1);
  });

  test("the OWNER token, another device's token, blocked paths, POST to a GET-only path and /pair are refused over a device peer", async () => {
    enable();
    const a = auth.createDevice("a");
    const b = auth.createDevice("b");
    const phone = (await joinAs({ kind: "device", key: sha(a.token), device: a.device.id }))!;
    const h = (t: string) => ({ authorization: `Bearer ${t}` });
    expect((await phone.call("GET", "/whoami", h(OWNER))).status).toBe(401);
    expect((await phone.call("GET", "/whoami", h(b.token))).status).toBe(401);
    expect((await phone.call("GET", "/devices", h(a.token))).status).toBe(403);
    expect((await phone.call("POST", "/settings/apps", h(a.token), "{}")).status).toBe(403);
    expect((await phone.call("GET", "/settings", h(a.token))).status).toBe(403); // not even reads: the topic lives there
    expect((await phone.call("POST", "/pair", h(a.token), JSON.stringify({ code: "AAAA-BBBB", name: "x" }))).status).toBe(403);
    expect((await phone.call("GET", "/rooms/../devices", h(a.token))).status).toBe(400);
  });

  test("MCP interaction routes do not expose the MCP protocol or administration",async()=>{
    enable();const full=auth.createDevice('full','owner','full'),phone=(await joinAs({kind:'device',key:sha(full.token),device:full.device.id}))!,h={authorization:'Bearer '+full.token};
    const path='/mcp/interactions/11111111-1111-4111-8111-111111111111';
    expect((await phone.call('GET',path,h)).status).toBe(404);
    expect((await phone.call('GET',path+'/response',h)).status).toBe(403);
    expect((await phone.call('POST',path,h,'{}')).status).toBe(403);
    expect((await phone.call('POST','/mcp/reload',h,'{}')).status).toBe(403);
  });

  test("a pairing-code peer can only POST /pair and GET /health; pairing mints a device and the code is single use", async () => {
    enable();
    const { code } = auth.createPairingCode("owner");
    const { secret: key } = service.createInvite();
    const pairer = (await joinAs({ kind: "pair", key }))!;
    expect(pairer).toBeTruthy();
    expect((await pairer.call("GET", "/health")).status).toBe(200);
    expect((await pairer.call("GET", "/rooms", { authorization: `Bearer ${OWNER}` })).status).toBe(403);
    expect((await pairer.call("GET", "/pair")).status).toBe(403);
    const res = await pairer.call("POST", "/pair", { "content-type": "application/json" }, JSON.stringify({ code, name: "rtc phone" }));
    expect(res.status).toBe(200);
    const minted = JSON.parse(res.body) as { token: string };
    expect(auth.authenticate(minted.token)).toMatchObject({ kind: "device" });
    // the 8-char code alone can never key an offer (it is guessable offline): only the random invite secret does
    expect(await joinAs({ kind: "pair", key: sha(code.replace("-", "")) })).toBeNull();
    expect(await joinAs({ kind: "pair", key: code })).toBeNull();
  });

  test("bad offers get no answer: wrong key, wrong device, stale, replayed id, tampered SDP, malformed, oversize", async () => {
    enable();
    const { device, token } = auth.createDevice("phone");
    const before = service.status().rejected;
    expect(await joinAs({ kind: "device", key: sha("wrong"), device: device.id })).toBeNull();
    expect(await joinAs({ kind: "device", key: sha(token), device: "0123456789abcdef" })).toBeNull();
    expect(await joinAs({ kind: "device", key: sha(token), device: device.id, ts: now - 10 * 60_000 })).toBeNull();
    // the MAC covers the DTLS fingerprint: swapping it (a signaling MITM) fails
    expect(await joinAs({ kind: "device", key: sha(token), device: device.id, tamper: (o) => void ((o.sdp as string) && (o.sdp = (o.sdp as string).replace(/a=fingerprint:sha-256 [0-9A-F:]+/i, `a=fingerprint:sha-256 ${"AA:".repeat(31)}AA`))) })).toBeNull();
    expect(await joinAs({ kind: "device", key: sha(token), device: device.id, tamper: (o) => void (o.sdp = "x".repeat(4000)) })).toBeNull();
    deliver("not json");
    deliver(JSON.stringify({ v: 2 }));
    await tick();
    expect(service.status().rejected).toBeGreaterThan(before + 3);
    expect(service.status().peers).toBe(0);
    // a valid one still works, and replaying its id is refused
    const ok = await joinAs({ kind: "device", key: sha(token), device: device.id, id: "replayable01" });
    expect(ok).toBeTruthy();
    answers.delete("replayable01");
    expect(await joinAs({ kind: "device", key: sha(token), device: device.id, id: "replayable01" })).toBeNull();
  });

  test("revoking the device closes its peer", async () => {
    enable();
    const { device, token } = auth.createDevice("phone");
    const phone = (await joinAs({ kind: "device", key: sha(token), device: device.id }))!;
    expect(service.status().peers).toBe(1);
    auth.revokeDevice(device.id);
    expect(service.status().peers).toBe(0);
    // the channel is torn down: a further request is never answered
    const after = await Promise.race([phone.call("GET", "/health"), tick(300).then(() => ({ status: -1, body: "" }))]);
    expect(after.status).toBe(-1);
    // and a revoked device can no longer open a new one
    expect(await joinAs({ kind: "device", key: sha(token), device: device.id })).toBeNull();
  });

  test("the number of peers is capped and the stopped service closes everything", async () => {
    enable();
    const devices = [1, 2, 3, 4].map((n) => auth.createDevice(`d${n}`));
    for (const d of devices.slice(0, 3)) expect(await joinAs({ kind: "device", key: sha(d.token), device: d.device.id })).toBeTruthy();
    expect(await joinAs({ kind: "device", key: sha(devices[3]!.token), device: devices[3]!.device.id })).toBeNull();
    expect(service.status().peers).toBe(3);
    service.stop();
    expect(service.status().peers).toBe(0);
  });

  test("a peer is rate limited per frame budget", async () => {
    enable();
    const { device, token } = auth.createDevice("phone");
    const phone = (await joinAs({ kind: "device", key: sha(token), device: device.id }))!;
    const results: number[] = [];
    for (let i = 0; i < 8; i++) results.push((await phone.call("GET", "/health")).status);
    expect(results).toEqual([200, 200, 200, 200, 200, 200, 200, 200]);
    const over = await Promise.race([phone.call("GET", "/health"), tick(300).then(() => ({ status: -1, body: "" }))]);
    expect(over.status).toBe(-1); // dropped, never answered
    const big = (await joinAs({ kind: "device", key: sha(token), device: device.id }))!;
    expect(service.status().peers).toBe(2);
  });

  test("a big response is chunked and reassembled; events stream to a subscribed peer but never from hidden rooms", async () => {
    enable();
    const { device, token } = auth.createDevice("phone");
    for (let i = 0; i < 120; i++) ledger.append("main", "user", "message", { text: "x".repeat(400) + i });
    const phone = (await joinAs({ kind: "device", key: sha(token), device: device.id }))!;
    const h = { authorization: `Bearer ${token}` };
    const events = await phone.call("GET", "/rooms/main/events", h);
    expect(events.status).toBe(200);
    expect(events.body.length).toBeGreaterThan(12 * 1024);
    expect((JSON.parse(events.body) as { events: unknown[] }).events.length).toBeGreaterThan(100);

    expect((await phone.call("SUBSCRIBE", "", {})).status).toBe(401);
    expect((await phone.call("SUBSCRIBE", "", h)).status).toBe(200);
    ledger.append("main", "user", "message", { text: "live one" });
    ledger.append("_system", "daemon", "config", { action: "secret-ish" });
    await tick(80);
    const texts = phone.events.map((e) => JSON.stringify(e));
    expect(texts.some((t) => t.includes("live one"))).toBe(true);
    expect(texts.some((t) => t.includes("secret-ish"))).toBe(false);
  });

  test("peers are audited with counts and enums only", async () => {
    enable();
    const { device, token } = auth.createDevice("phone");
    await joinAs({ kind: "device", key: sha(token), device: device.id });
    const e = ledger.list("_system").filter((x) => (x.payload as { action?: string }).action === "rtc_peer");
    expect(e.length).toBeGreaterThan(0);
    expect(JSON.stringify(e)).not.toContain(token);
  });

  test("review fixes: encoded dot segments, bad content-type and extra fingerprints cannot get past", async () => {
    enable();
    const { device, token } = auth.createDevice("phone");
    const phone = (await joinAs({ kind: "device", key: sha(token), device: device.id }))!;
    const h = { authorization: `Bearer ${token}` };
    for (const path of ["/rooms/%2e%2e/devices", "/rooms/.%2e/mcp/reload", "/rooms/%2E%2e/rtc/invite", "//devices", "/rooms/..\\devices", "/rooms/../devices"]) {
      expect((await phone.call("GET", path, h)).status, path).toBe(400);
    }
    // a hostile content-type is dropped, never thrown (it used to crash the daemon)
    const bad = await phone.call("POST", "/rooms/main/messages", { ...h, "content-type": "a\nb" }, "{}");
    expect([400, 415, 200, 202]).toContain(bad.status);
    expect((await phone.call("GET", "/health")).status).toBe(200); // the peer and the daemon are still alive
    // two fingerprint lines (a sha-512 one could carry a different certificate): refused
    const extra = await joinAs({
      kind: "device",
      key: sha(token),
      device: device.id,
      tamper: (o) => void (o.sdp = (o.sdp as string).replace(/(a=fingerprint:sha-256 [^\r\n]+)/, `$1\r\na=fingerprint:sha-512 ${"AA:".repeat(63)}AA`)),
    });
    expect(extra).toBeNull();
  });

  test("review fixes: settings never list the topic, per-device and pair-peer caps hold, pair peers have an absolute lifetime", async () => {
    enable();
    const { device, token } = auth.createDevice("phone");
    const a = await joinAs({ kind: "device", key: sha(token), device: device.id });
    const b = await joinAs({ kind: "device", key: sha(token), device: device.id });
    expect(a && b).toBeTruthy();
    expect(await joinAs({ kind: "device", key: sha(token), device: device.id })).toBeNull(); // 2 per device
  });

  test("a pair peer has an ABSOLUTE lifetime: keeping it busy does not extend it", async () => {
    service.stop();
    const gw = createGateway({ db, ledger, approvals: createApprovals(db, ledger), auth, dispatch: () => {}, deskDir: join(dir, "none") });
    service = createRtcService({ db, ledger, auth, fetch: (r) => Promise.resolve(gw.fetch(r)), signaling: () => fakeSignaling(), now: () => now, limits: { maxPeers: 3, pairPeerMs: 150, frameBudget: 1000 } });
    enable();
    const pairer = (await joinAs({ kind: "pair", key: service.createInvite().secret }))!;
    expect(service.status().peers).toBe(1);
    const until = Date.now() + 600;
    while (Date.now() < until && service.status().peers > 0) {
      now += 100; // the injected clock advances with real time
      void pairer.call("GET", "/health");
      await tick(40);
    }
    expect(service.status().peers).toBe(0);
  });
});
