import { describe, expect, it } from "vitest";
import {
  asResponseChunk,
  authKey,
  checkInvite,
  checkTurn,
  encodeFrame,
  macEquals,
  normalizeCode,
  offerMac,
  parseAnswerLine,
  randomId,
  sdpFingerprint,
  sha256Hex,
} from "./protocol";

// Known vectors, computed with node:crypto (hard-coded so the test needs no node types):
//   SECRET = "Sx9_test-secret-VALUE-0123" (pair MAC key, used as the UTF-8 string)
//   pair MAC   = HMAC(SECRET, "abcdefgh_ID-12345\n1700000000000\n<FP>\npair\n")        = 44b7514f...ced4abd
//   answer MAC = HMAC(SECRET, "abcdefgh_ID-12345\n1700000000000\n<ANSWER_FP>\nanswer\n") = 6f27550c...883b4a3
//   sha256("ABCDEFGH")                 = 9ac2197d...83fc48
//   device key = sha256("tok-secret")  = b45db811...5975b
//   device MAC = HMAC(devkey, "...\n<FP>\ndevice\n0123456789abcdef")                   = adb2c280...2fe41
//   device answer MAC = HMAC(devkey, "...\n<ANSWER_FP>\nanswer\n0123456789abcdef")      = ed78c8ea...d06b004
const SECRET = "Sx9_test-secret-VALUE-0123";
const FP = "ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89";
const ANSWER_FP = Array.from({ length: 32 }, () => "11").join(":");
const MATERIAL = { id: "abcdefgh_ID-12345", ts: 1700000000000, fingerprint: FP };
const SDP_ONE = `v=0\r\na=fingerprint:sha-256 ${FP.toUpperCase()}\r\n`;

describe("protocol", () => {
  it("normalizes pairing codes (case, dashes, spaces)", () => {
    expect(normalizeCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizeCode(" ABCD EFGH ")).toBe("ABCDEFGH");
  });

  it("sha256 hex matches the node:crypto vector", async () => {
    expect(await sha256Hex("ABCDEFGH")).toBe("9ac2197d9258257b1ae8463e4214e4cd0a578bc1517f2415928b91be4283fc48");
    expect(await sha256Hex("tok-secret")).toBe("b45db811118693be2874ea36745d7271d15466e9c1f228c06bc72052d175975b");
  });

  it("pair offer MAC is keyed by the invite secret (as-is)", async () => {
    const { key } = await authKey({ kind: "pair", code: "abcd-efgh" }, SECRET);
    expect(key).toBe(SECRET);
    expect(await offerMac(key, { ...MATERIAL, kind: "pair" })).toBe("44b7514f9949fc31b7a3812fe224a4e95515d4a44c3c5ebd3007be381ced4abd");
  });

  it("device offer MAC is keyed by sha256 of the token and covers the device id", async () => {
    const { key, device } = await authKey({ kind: "device", deviceId: "0123456789abcdef", token: "tok-secret" });
    expect(device).toBe("0123456789abcdef");
    const mac = await offerMac(key, { ...MATERIAL, kind: "device", device });
    expect(mac).toBe("adb2c280231bcf343edd50927adaa8f4fa98ad29599de91d29e565cff7e2fe41");
  });

  it("answer MAC uses kind 'answer' under the same key", async () => {
    const fp = ANSWER_FP.toLowerCase();
    expect(await offerMac(SECRET, { ...MATERIAL, fingerprint: fp, kind: "answer" })).toBe(
      "6f27550c8933872610077fe5288ef48f8b5b744d299a5c60fe38627c2883b4a3",
    );
    const devKey = await sha256Hex("tok-secret");
    expect(await offerMac(devKey, { ...MATERIAL, fingerprint: fp, kind: "answer", device: "0123456789abcdef" })).toBe(
      "ed78c8eaf83dd0540c3bb83642d6eb29cde4bddcd5e4b1d6ada166877d06b004",
    );
  });

  it("pair auth needs a secret", async () => {
    await expect(authKey({ kind: "pair", code: "abcdefgh" })).rejects.toThrow(/invite secret/);
    await expect(authKey({ kind: "pair", code: "abc" }, SECRET)).rejects.toThrow(/8 characters/);
  });

  it("extracts and lower-cases the single SHA-256 fingerprint", () => {
    expect(sdpFingerprint(SDP_ONE)).toBe(FP);
    expect(sdpFingerprint("v=0\r\n")).toBeNull();
  });

  it("rejects an SDP with two fingerprint lines", () => {
    expect(sdpFingerprint(SDP_ONE + `a=fingerprint:sha-256 ${ANSWER_FP}\r\n`)).toBeNull();
  });

  it("rejects a non sha-256 or malformed fingerprint line", () => {
    expect(sdpFingerprint("a=fingerprint:sha-1 " + FP + "\r\n")).toBeNull();
    expect(sdpFingerprint("a=fingerprint:sha-256 ab:cd\r\n")).toBeNull();
  });

  it("macEquals compares exactly", () => {
    expect(macEquals("abcd", "abcd")).toBe(true);
    expect(macEquals("abcd", "abce")).toBe(false);
    expect(macEquals("abcd", "abc")).toBe(false);
  });

  it("random ids are 16 url-safe chars and unique", () => {
    const ids = new Set(Array.from({ length: 100 }, () => randomId()));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });

  it("parses the answer for the expected id, returning sdp and the raw mac", () => {
    const answer = (over: Record<string, unknown> = {}) =>
      JSON.stringify({ event: "message", message: JSON.stringify({ v: 1, t: "answer", id: "abc", sdp: "v=0", mac: "m", ...over }) });
    expect(parseAnswerLine(answer(), "abc")).toEqual({ sdp: "v=0", mac: "m" });
    expect(parseAnswerLine(answer({ mac: undefined }), "abc")).toEqual({ sdp: "v=0", mac: undefined });
    expect(parseAnswerLine(answer(), "other")).toBeNull();
    expect(parseAnswerLine(answer({ t: "offer" }), "abc")).toBeNull();
    expect(parseAnswerLine(answer({ v: 2 }), "abc")).toBeNull();
    expect(parseAnswerLine(JSON.stringify({ event: "keepalive" }), "abc")).toBeNull();
    expect(parseAnswerLine("not json", "abc")).toBeNull();
  });

  it("encodeFrame refuses frames over 64 KB", () => {
    expect(encodeFrame({ id: "abcdefgh", type: "request", method: "GET", path: "/health" })).toContain("/health");
    expect(() => encodeFrame({ id: "abcdefgh", type: "request", method: "POST", path: "/x", body: "a".repeat(65 * 1024) })).toThrow(RangeError);
  });

  it("validates response chunks", () => {
    expect(asResponseChunk({ id: "a", status: 200, seq: 0, last: true, body: "x" })).not.toBeNull();
    expect(asResponseChunk({ id: "a", status: 200, seq: -1, last: true, body: "x" })).toBeNull();
    expect(asResponseChunk({ id: "a", status: 200, seq: 0.5, last: true, body: "x" })).toBeNull();
    expect(asResponseChunk({ id: "a", status: 200, seq: 0, last: "yes", body: "x" })).toBeNull();
  });

  it("checkInvite strips trailing slashes, validates the secret, and rejects bad fields", () => {
    const ok = { server: "https://ntfy.example.com//", topic: "openag-rtc-abcdefgh1234", stun: ["stun:stun.example.com:3478"], secret: SECRET };
    expect(checkInvite(ok).base).toBe("https://ntfy.example.com");
    expect(checkInvite(ok).secret).toBe(SECRET);
    expect(checkInvite({ ...ok, secret: undefined }).secret).toBeUndefined();
    expect(() => checkInvite({ ...ok, topic: "bad" })).toThrow(/bad topic/);
    expect(() => checkInvite({ ...ok, server: "ftp://x" })).toThrow(/bad server/);
    expect(() => checkInvite({ ...ok, stun: [1 as unknown as string] })).toThrow(/bad stun/);
    expect(() => checkInvite({ ...ok, secret: "short" })).toThrow(/bad secret/);
    expect(() => checkInvite({ ...ok, secret: "has spaces in it here" })).toThrow(/bad secret/);
  });
});

describe("TURN invite validation", () => {
  const base = { server: "https://ntfy.example.com", topic: "openag-rtc-abcdefgh1234", stun: [] as string[], secret: "abcdefghijklmnop" };
  const turn = { urls: ["turn:relay.example.com:3478"], username: "u", credential: "c" };

  it("accepts a valid turn and passes it through checkInvite", () => {
    expect(checkInvite({ ...base, turn }).turn).toEqual(turn);
    expect(checkInvite(base).turn).toBeUndefined();
  });

  it("rejects bad turn shapes", () => {
    expect(() => checkTurn({ ...turn, urls: [] })).toThrow("invite: bad turn urls");
    expect(() => checkTurn({ ...turn, urls: ["https://x"] })).toThrow("invite: bad turn urls");
    expect(() => checkTurn({ ...turn, urls: ["turn:a", "turn:b", "turn:c", "turn:d", "turn:e"] })).toThrow("invite: bad turn urls");
    expect(() => checkTurn({ ...turn, username: "" })).toThrow("invite: bad turn username");
    expect(() => checkTurn({ ...turn, credential: "x".repeat(201) })).toThrow("invite: bad turn credential");
    expect(() => checkInvite({ ...base, turn: "nope" as unknown as typeof turn })).toThrow("invite: bad turn");
  });
});
