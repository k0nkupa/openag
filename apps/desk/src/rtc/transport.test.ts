import { describe, expect, it, vi } from "vitest";
import { createFakePeerFactory, createFakeSignaling, OFFER_SDP, ANSWER_SDP, ANSWER_FP, type FakeSignalingOptions } from "./fakes";
import { sha256Hex, type RtcInvite } from "./protocol";
import { createRtcTransport, type RtcTimeouts } from "./transport";

const SECRET = "Sx9_test-secret-VALUE-0123";
const INVITE: RtcInvite = {
  server: "https://ntfy.example.com/",
  topic: "openag-rtc-abcdefgh1234",
  stun: ["stun:stun.example.com:3478"],
  code: "ABCD-EFGH",
  secret: SECRET,
};
const PAIR = { kind: "pair" as const, code: "abcd-efgh" };
const DEVICE = { kind: "device" as const, deviceId: "0123456789abcdef", token: "tok-secret" };

interface Harness {
  fake: ReturnType<typeof createFakeSignaling>;
  peers: ReturnType<typeof createFakePeerFactory>["peers"];
}

async function connect(
  opts: { peer?: Parameters<typeof createFakePeerFactory>[0]; signal?: FakeSignalingOptions; timeouts?: Partial<RtcTimeouts>; auth?: typeof PAIR | typeof DEVICE; invite?: RtcInvite } = {},
) {
  const factory = createFakePeerFactory(opts.peer);
  const answerKey = (opts.auth ?? PAIR).kind === "device" ? await sha256Hex(DEVICE.token) : SECRET;
  const fake = createFakeSignaling({ answerKey, ...opts.signal });
  const transport = await createRtcTransport({
    invite: opts.invite ?? INVITE,
    auth: opts.auth ?? PAIR,
    rtc: { PeerConnection: factory.PeerConnection, fetch: fake.fetch, timeouts: opts.timeouts },
  });
  const h: Harness = { fake, peers: factory.peers };
  return { transport, ...h, peer: factory.peers[0]!, channel: factory.peers[0]!.channels[0]! };
}

/** The response frame the daemon sends for a request frame. */
function respond(channel: { receive(d: string): void; lastSent(): Record<string, unknown> }, status: number, body: string) {
  channel.receive(JSON.stringify({ id: channel.lastSent().id, status, seq: 0, last: true, body }));
}

describe("createRtcTransport connect", () => {
  it("publishes a pair offer, streams the answer before publishing, and opens", async () => {
    const { transport, fake, peer, channel } = await connect();
    expect(transport.state).toBe("open");
    expect(peer.config.iceServers).toEqual([{ urls: "stun:stun.example.com:3478" }]);
    expect(channel.label).toBe("openag-api");
    expect(peer.remote).toEqual({ type: "answer", sdp: ANSWER_SDP });

    // Stream subscribed before the offer was published.
    expect(fake.order[0]).toMatch(/^stream https:\/\/ntfy\.example\.com\/openag-rtc-abcdefgh1234-[A-Za-z0-9_-]{16}\/json$/);
    expect(fake.order[1]).toBe("publish");

    const post = fake.published[0]!;
    expect(post.url).toBe("https://ntfy.example.com/");
    const req = JSON.parse(post.body) as { topic: string; message: string; priority: number };
    expect(req.topic).toBe(INVITE.topic);
    expect(req.priority).toBe(3);
    const msg = JSON.parse(req.message) as { v: number; t: string; id: string; ts: number; sdp: string; auth: Record<string, unknown> };
    expect(msg.v).toBe(1);
    expect(msg.t).toBe("offer");
    expect(msg.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(fake.order[0]).toContain(`-${msg.id}/json`);
    expect(Math.abs(msg.ts - Date.now())).toBeLessThan(10_000);
    expect(msg.sdp).toBe(OFFER_SDP);
    expect(msg.auth.kind).toBe("pair");
    expect("device" in msg.auth).toBe(false);
    expect(String(msg.auth.mac)).toMatch(/^[a-f0-9]{64}$/);
    transport.close();
  });

  it("device auth sends the device id and a MAC keyed by the token", async () => {
    const { transport, fake } = await connect({ auth: DEVICE });
    const req = JSON.parse(fake.published[0]!.body) as { message: string };
    const msg = JSON.parse(req.message) as { auth: { kind: string; device: string; mac: string } };
    expect(msg.auth.kind).toBe("device");
    expect(msg.auth.device).toBe("0123456789abcdef");
    expect(msg.auth.mac).toMatch(/^[a-f0-9]{64}$/);
    transport.close();
  });

  it("ignores unrelated stream events before the answer", async () => {
    const { transport } = await connect({ signal: { noise: ['{"event":"keepalive"}', "garbage"] } });
    expect(transport.state).toBe("open");
    transport.close();
  });

  it("aborts the answer stream once the answer is applied", async () => {
    const { transport, fake } = await connect();
    expect(fake.streamSignals).toHaveLength(1);
    expect(fake.streamSignals[0]!.aborted).toBe(true);
    transport.close();
  });

  it("still offers when ICE gathering does not complete in time", async () => {
    const { transport, peer } = await connect({ peer: { iceComplete: false }, timeouts: { iceMs: 10 } });
    expect(transport.state).toBe("open");
    expect(peer.localDescription?.sdp).toBe(OFFER_SDP);
    transport.close();
  });

  it("rejects when no answer arrives within the connect timeout and closes the peer", async () => {
    const factory = createFakePeerFactory();
    const sig = createFakeSignaling({ autoAnswer: false });
    await expect(
      createRtcTransport({ invite: INVITE, auth: PAIR, rtc: { PeerConnection: factory.PeerConnection, fetch: sig.fetch, timeouts: { connectMs: 30 } } }),
    ).rejects.toThrow(/timed out/);
    expect(factory.peers[0]!.closed).toBe(true);
  });

  it("rejects an offer whose SDP is over the signaling cap", async () => {
    const factory = createFakePeerFactory({ offerSdp: "a".repeat(3501) });
    const sig = createFakeSignaling();
    await expect(createRtcTransport({ invite: INVITE, auth: PAIR, rtc: { PeerConnection: factory.PeerConnection, fetch: sig.fetch } })).rejects.toThrow(/too large/);
    expect(sig.published).toHaveLength(0);
  });

  it("rejects when the offer publish fails", async () => {
    await expect(connect({ signal: { publishStatus: 500 } })).rejects.toThrow(/publish failed: http 500/);
  });

  it("rejects when the answer stream cannot be opened", async () => {
    await expect(connect({ signal: { streamStatus: 503 } })).rejects.toThrow(/answer stream failed/);
  });

  it("rejects invalid invites and auth without touching the network", async () => {
    const factory = createFakePeerFactory();
    const sig = createFakeSignaling();
    const rtc = { PeerConnection: factory.PeerConnection, fetch: sig.fetch };
    await expect(createRtcTransport({ invite: { ...INVITE, topic: "bad" }, auth: PAIR, rtc })).rejects.toThrow(/bad topic/);
    await expect(createRtcTransport({ invite: INVITE, auth: { kind: "pair", code: "ABC" }, rtc })).rejects.toThrow(/8 characters/);
    await expect(createRtcTransport({ invite: INVITE, auth: { ...DEVICE, deviceId: "xyz" }, rtc })).rejects.toThrow(/device id/);
    expect(factory.peers).toHaveLength(0);
  });
});

/** One connect attempt that is expected to fail; reports the error and what the peer saw. */
async function attempt(signal: FakeSignalingOptions, peer?: Parameters<typeof createFakePeerFactory>[0], invite: RtcInvite = INVITE) {
  const factory = createFakePeerFactory(peer);
  const fake = createFakeSignaling({ answerKey: SECRET, ...signal });
  const err = await createRtcTransport({ invite, auth: PAIR, rtc: { PeerConnection: factory.PeerConnection, fetch: fake.fetch } }).then(
    () => null,
    (e: unknown) => e as Error,
  );
  return { err, peer: factory.peers[0], fake };
}

describe("createRtcTransport answer verification", () => {
  it("accepts an answer whose MAC verifies and applies it", async () => {
    const { err, peer } = await attempt({});
    expect(err).toBeNull();
    expect(peer!.remote).toEqual({ type: "answer", sdp: ANSWER_SDP });
  });

  it("rejects a bad MAC and never calls setRemoteDescription", async () => {
    const { err, peer } = await attempt({ answerMac: "0".repeat(64) });
    expect(err?.message).toMatch(/answer MAC mismatch/);
    expect(peer!.remote).toBeNull();
    expect(peer!.closed).toBe(true);
  });

  it("rejects an answer MAC made with the wrong key", async () => {
    const { err, peer } = await attempt({ answerKey: "some-other-secret-value" });
    expect(err?.message).toMatch(/answer MAC mismatch/);
    expect(peer!.remote).toBeNull();
  });

  it("rejects a missing or malformed MAC and never applies the SDP", async () => {
    const missing = await attempt({ answerMac: null });
    expect(missing.err?.message).toMatch(/answer MAC missing or invalid/);
    expect(missing.peer!.remote).toBeNull();
    expect(missing.peer!.closed).toBe(true);

    const malformed = await attempt({ answerMac: "ZZ" });
    expect(malformed.err?.message).toMatch(/answer MAC missing or invalid/);
    expect(malformed.peer!.remote).toBeNull();
  });

  it("rejects an answer SDP with two fingerprint lines", async () => {
    const twoFp = ANSWER_SDP + `a=fingerprint:sha-256 ${ANSWER_FP}\r\n`;
    const { err, peer } = await attempt({ answerSdp: twoFp });
    expect(err?.message).toMatch(/no valid DTLS fingerprint/);
    expect(peer!.remote).toBeNull();
  });

  it("rejects an offer SDP with two fingerprint lines before publishing", async () => {
    const twoFp = OFFER_SDP + `a=fingerprint:sha-256 ${ANSWER_FP}\r\n`;
    const { err, fake } = await attempt({}, { offerSdp: twoFp });
    expect(err?.message).toMatch(/no valid DTLS fingerprint/);
    expect(fake.published).toHaveLength(0);
  });

  it("refuses a pair invite that has no secret", async () => {
    const { secret: _omit, ...noSecret } = INVITE;
    void _omit;
    const { err } = await attempt({}, undefined, noSecret);
    expect(err?.message).toMatch(/invite secret/);
  });
});

describe("createRtcTransport requests", () => {
  it("resolves a request with the daemon status and body", async () => {
    const { transport, channel } = await connect();
    const p = transport.request("GET", "/health", { headers: { authorization: "Bearer x" } });
    const sent = channel.lastSent();
    expect(sent).toMatchObject({ type: "request", method: "GET", path: "/health", headers: { authorization: "Bearer x" } });
    expect(sent).not.toHaveProperty("body");
    respond(channel, 200, '{"ok":true}');
    await expect(p).resolves.toEqual({ status: 200, body: '{"ok":true}' });
    transport.close();
  });

  it("joins chunks by seq regardless of arrival order", async () => {
    const { transport, channel } = await connect();
    const p = transport.request("POST", "/rooms", { body: "{}" });
    const id = channel.lastSent().id;
    channel.receive(JSON.stringify({ id, status: 201, seq: 1, last: true, body: "cd" }));
    channel.receive(JSON.stringify({ id, status: 201, seq: 0, last: false, body: "ab" }));
    await expect(p).resolves.toEqual({ status: 201, body: "abcd" });
    transport.close();
  });

  it("waits for the last chunk before resolving", async () => {
    const { transport, channel } = await connect();
    const p = transport.request("GET", "/bots");
    const id = channel.lastSent().id;
    channel.receive(JSON.stringify({ id, status: 200, seq: 0, last: false, body: "a" }));
    channel.receive(JSON.stringify({ id, status: 200, seq: 2, last: true, body: "c" }));
    let settled = false;
    void p.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 5));
    expect(settled).toBe(false);
    channel.receive(JSON.stringify({ id, status: 200, seq: 1, last: false, body: "b" }));
    await expect(p).resolves.toEqual({ status: 200, body: "abc" });
    transport.close();
  });

  it("ignores frames for unknown ids and garbage", async () => {
    const { transport, channel } = await connect();
    channel.receive("not json");
    channel.receive(JSON.stringify({ id: "nobody", status: 200, seq: 0, last: true, body: "x" }));
    channel.receive(JSON.stringify({ id: "x", status: 400, seq: 0, last: true, body: "bad frame" }));
    const p = transport.request("GET", "/health");
    respond(channel, 200, "ok");
    await expect(p).resolves.toEqual({ status: 200, body: "ok" });
    transport.close();
  });

  it("rejects a request that gets no reply within the request timeout", async () => {
    const { transport } = await connect({ timeouts: { requestMs: 20 } });
    await expect(transport.request("GET", "/health")).rejects.toThrow("request timed out");
    transport.close();
  });

  it("rejects pending requests on close and refuses new ones", async () => {
    const { transport, peer } = await connect();
    const p = transport.request("GET", "/health");
    transport.close();
    await expect(p).rejects.toThrow("transport closed");
    expect(transport.state).toBe("closed");
    expect(peer.closed).toBe(true);
    await expect(transport.request("GET", "/health")).rejects.toThrow("not open");
  });

  it("tears down when the data channel closes", async () => {
    const { transport, channel } = await connect();
    const p = transport.request("GET", "/health");
    channel.close();
    await expect(p).rejects.toThrow("data channel closed");
    expect(transport.state).toBe("closed");
  });

  it("refuses methods other than GET and POST, bad paths and oversize frames without sending", async () => {
    const { transport, channel } = await connect();
    const before = channel.sent.length;
    await expect(transport.request("DELETE" as "GET", "/rooms")).rejects.toThrow(TypeError);
    await expect(transport.request("GET", "rooms")).rejects.toThrow(TypeError);
    await expect(transport.request("POST", "/rooms", { body: "a".repeat(65 * 1024) })).rejects.toThrow(RangeError);
    expect(channel.sent.length).toBe(before);
    transport.close();
  });
});

describe("createRtcTransport subscribe", () => {
  it("subscribes with the bearer header, delivers events, and stops on unsubscribe", async () => {
    const { transport, channel } = await connect();
    const events: unknown[] = [];
    const sub = transport.subscribe({ authorization: "Bearer dev-token" }, (e) => events.push(e));
    const frame = channel.lastSent();
    expect(frame).toMatchObject({ type: "subscribe", headers: { authorization: "Bearer dev-token" } });
    respond(channel, 200, "{}");
    const unsubscribe = await sub;

    channel.receive(JSON.stringify({ type: "event", event: { id: 1, roomId: "main" } }));
    channel.receive(JSON.stringify({ type: "event", event: { id: 2, roomId: "main" } }));
    expect(events).toEqual([{ id: 1, roomId: "main" }, { id: 2, roomId: "main" }]);

    const before = channel.sent.length;
    unsubscribe();
    expect(channel.sent.length).toBe(before + 1);
    expect(channel.lastSent()).toMatchObject({ type: "unsubscribe", id: frame.id });
    channel.receive(JSON.stringify({ type: "event", event: { id: 3 } }));
    expect(events).toHaveLength(2);
    transport.close();
  });

  it("rejects when the daemon does not acknowledge with 200", async () => {
    const { transport, channel } = await connect();
    const sub = transport.subscribe({ authorization: "Bearer nope" }, () => undefined);
    respond(channel, 401, "unauthorized");
    await expect(sub).rejects.toThrow("subscribe failed: http 401");
    transport.close();
  });

  it("a throwing listener does not break the channel", async () => {
    const { transport, channel } = await connect();
    const sub = transport.subscribe({ authorization: "Bearer t" }, () => {
      throw new Error("boom");
    });
    respond(channel, 200, "{}");
    await sub;
    expect(() => channel.receive(JSON.stringify({ type: "event", event: {} }))).not.toThrow();
    expect(transport.state).toBe("open");
    transport.close();
  });
});

describe("createRtcTransport TURN and close", () => {
  const TURN = { urls: ["turn:relay.example.com:3478"], username: "user-1", credential: "cred-1" };

  it("passes TURN after the STUN entries in iceServers", async () => {
    const { transport, peer } = await connect({ invite: { ...INVITE, turn: TURN } });
    expect(peer.config.iceServers).toEqual([
      { urls: "stun:stun.example.com:3478" },
      { urls: TURN.urls, username: "user-1", credential: "cred-1" },
    ]);
    transport.close();
  });

  it("requests fresh TURN credentials with only id, type and headers", async () => {
    const { transport, channel } = await connect({ auth: DEVICE });
    const p = transport.turnCredentials({ authorization: "Bearer tok-secret" });
    const sent = channel.lastSent();
    expect(Object.keys(sent).sort()).toEqual(["headers", "id", "type"]);
    expect(sent).toMatchObject({ type: "turn", headers: { authorization: "Bearer tok-secret" } });
    channel.receive(JSON.stringify({ id: sent.id, status: 200, seq: 0, last: true, body: JSON.stringify(TURN) }));
    await expect(p).resolves.toEqual(TURN);
    transport.close();
  });

  it("returns null on 404 and rejects on other statuses", async () => {
    const { transport, channel } = await connect({ auth: DEVICE });
    const none = transport.turnCredentials({ authorization: "Bearer x" });
    respond(channel, 404, "{}");
    await expect(none).resolves.toBeNull();
    const bad = transport.turnCredentials({ authorization: "Bearer x" });
    respond(channel, 500, "{}");
    await expect(bad).rejects.toThrow("turn failed: http 500");
    transport.close();
  });

  it("calls onClose once when the transport closes and not after removal", async () => {
    const { transport } = await connect();
    const kept = vi.fn();
    const removed = vi.fn();
    transport.onClose(kept);
    transport.onClose(removed)();
    transport.close();
    transport.close();
    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });
});
