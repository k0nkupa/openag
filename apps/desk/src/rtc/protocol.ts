/**
 * Browser side of the WebRTC join-without-VPN wire contract (docs/notes/webrtc.md, apps/daemon/src/rtc.ts).
 * Pure and dependency-free: crypto.subtle + TextEncoder + btoa only. The daemon is the source of truth; keep these
 * shapes in step with it. No network, no RTCPeerConnection here.
 */

export const DATA_CHANNEL_LABEL = "openag-api";
export const MAX_OFFER_SDP = 3500; // ntfy messages are capped at 4096 bytes
export const MAX_FRAME_BYTES = 64 * 1024;
const MAX_ANSWER_SDP = 16 * 1024;
const FINGERPRINT_LINE_RE = /^a=fingerprint:sha-256 ([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){31})\s*$/;
const SECRET_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAC_RE = /^[a-f0-9]{64}$/;
const TOPIC_RE = /^openag-rtc-[A-Za-z0-9_-]{8,}$/;
const DEVICE_ID_RE = /^[a-f0-9]{16}$/;

/** TURN relay credentials (short lived). Never logged. */
export interface RtcTurn {
  urls: string[];
  username: string;
  credential: string;
}

/** Invite as shared by the owner (QR / paste). `code` is informational for pairing; the transport takes `auth`. */
export interface RtcInvite {
  server: string;
  topic: string;
  stun: string[];
  turn?: RtcTurn;
  code?: string;
  /** Random MAC key for pairing offers (base64url, 16..64 chars). Required when auth is `pair`. */
  secret?: string;
}

export type RtcAuth = { kind: "pair"; code: string } | { kind: "device"; deviceId: string; token: string };

/** The material the HMAC binds (daemon: offerMac). */
export interface OfferMaterial {
  id: string;
  ts: number;
  fingerprint: string;
  kind: "pair" | "device" | "answer";
  device?: string;
}

/** An answer as the daemon sends it: `mac` is checked by the transport, not here. */
export interface AnswerMessage {
  sdp: string;
  mac: unknown;
}

export interface RequestFrame {
  id: string;
  type: "request";
  method: "GET" | "POST";
  path: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface SubscribeFrame {
  id: string;
  type: "subscribe";
  headers: Record<string, string>;
}
export interface UnsubscribeFrame {
  id: string;
  type: "unsubscribe";
}
/** Asks a device for fresh TURN credentials. Strict shape: only id, type and headers. */
export interface TurnFrame {
  id: string;
  type: "turn";
  headers: Record<string, string>;
}
export type ClientFrame = RequestFrame | SubscribeFrame | UnsubscribeFrame | TurnFrame;

/** One piece of a daemon response. Join by `seq` until a chunk with `last: true`. */
export interface ResponseChunk {
  id: string;
  status: number;
  seq: number;
  last: boolean;
  body: string;
}

const enc = new TextEncoder();

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Pairing codes are typed by people: case, dashes and spaces are not significant. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[-\s]/g, "");
}

export function frameBytes(text: string): number {
  return enc.encode(text).length;
}

/** Throws RangeError when the encoded frame is over the 64 KB cap. */
export function encodeFrame(frame: ClientFrame): string {
  const text = JSON.stringify(frame);
  if (frameBytes(text) > MAX_FRAME_BYTES) throw new RangeError("rtc frame exceeds 64 KB");
  return text;
}

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

/** HMAC-SHA256, hex output. `key` is used as UTF-8 bytes (the daemon uses the hex string the same way). */
export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
}

/** Exact bytes the MAC covers. Must match daemon offerMac: `${id}\n${ts}\n${fingerprint}\n${kind}\n${device ?? ""}`. */
export function offerMessage(o: OfferMaterial): string {
  return `${o.id}\n${o.ts}\n${o.fingerprint}\n${o.kind}\n${o.device ?? ""}`;
}

/** `key` is the hex key string (sha256 of the pairing code or of the device token). */
export function offerMac(key: string, o: OfferMaterial): Promise<string> {
  return hmacSha256Hex(key, offerMessage(o));
}

/**
 * The SHA-256 DTLS fingerprint of the SDP, lower-cased. Null unless there is EXACTLY ONE `a=fingerprint:` line and it
 * is a 32-byte sha-256 value (95 chars). Offers and answers both go through this.
 */
export function sdpFingerprint(sdp: string): string | null {
  const lines = sdp.split(/\r?\n/).filter((l) => l.startsWith("a=fingerprint:"));
  if (lines.length !== 1) return null;
  const m = FINGERPRINT_LINE_RE.exec(lines[0]!);
  return m ? m[1]!.toLowerCase() : null;
}

/** Constant-time comparison of two hex MACs (length is not secret). */
export function macEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True for a hex MAC string (64 lower-case hex chars). */
export const isMac = (v: unknown): v is string => typeof v === "string" && MAC_RE.test(v);

/** 12 random bytes as unpadded base64url: 16 chars from [A-Za-z0-9_-]. */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const TURN_URL_RE = /^turns?:/;

/** Validates TURN credentials; throws a plain Error naming the bad field. */
export function checkTurn(turn: unknown): RtcTurn {
  if (!isObject(turn)) throw new Error("invite: bad turn");
  const { urls, username, credential } = turn;
  if (
    !Array.isArray(urls) ||
    urls.length < 1 ||
    urls.length > 4 ||
    urls.some((u) => typeof u !== "string" || !TURN_URL_RE.test(u))
  ) {
    throw new Error("invite: bad turn urls");
  }
  if (typeof username !== "string" || username.length === 0 || username.length > 200) throw new Error("invite: bad turn username");
  if (typeof credential !== "string" || credential.length === 0 || credential.length > 200) {
    throw new Error("invite: bad turn credential");
  }
  return { urls: [...(urls as string[])], username, credential };
}

/** Validates and normalizes the invite; throws a plain Error naming the bad field. */
export function checkInvite(invite: RtcInvite): { base: string; topic: string; stun: string[]; secret?: string; turn?: RtcTurn } {
  if (typeof invite.server !== "string" || !/^https?:\/\//.test(invite.server)) throw new Error("invite: bad server");
  if (typeof invite.topic !== "string" || !TOPIC_RE.test(invite.topic)) throw new Error("invite: bad topic");
  if (!Array.isArray(invite.stun) || invite.stun.some((s) => typeof s !== "string")) throw new Error("invite: bad stun");
  if (invite.secret !== undefined && (typeof invite.secret !== "string" || !SECRET_RE.test(invite.secret))) {
    throw new Error("invite: bad secret");
  }
  const turn = invite.turn === undefined ? undefined : checkTurn(invite.turn);
  return { base: invite.server.replace(/\/+$/, ""), topic: invite.topic, stun: [...invite.stun], secret: invite.secret, turn };
}

/**
 * Key for the offer MAC. Pair: the invite's random secret, used as-is (UTF-8). Device: sha256 hex of the token.
 * The pairing code is NOT a MAC key; the phone sends it to POST /pair.
 */
export async function authKey(auth: RtcAuth, secret?: string): Promise<{ key: string; device?: string }> {
  if (auth.kind === "pair") {
    if (normalizeCode(auth.code).length !== 8) throw new Error("pairing code must be 8 characters");
    if (secret === undefined || !SECRET_RE.test(secret)) throw new Error("pairing needs the invite secret");
    return { key: secret };
  }
  if (!DEVICE_ID_RE.test(auth.deviceId)) throw new Error("device id must be 16 hex characters");
  if (!auth.token) throw new Error("device token is empty");
  return { key: await sha256Hex(auth.token), device: auth.deviceId };
}

/**
 * Parses one ntfy JSON line; returns the answer (sdp + raw mac) when it is the answer for `id`, else null. The MAC is
 * NOT verified here: the transport verifies it before applying the SDP.
 */
export function parseAnswerLine(line: string, id: string): AnswerMessage | null {
  let ev: unknown;
  try {
    ev = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObject(ev) || ev.event !== "message" || typeof ev.message !== "string") return null;
  let msg: unknown;
  try {
    msg = JSON.parse(ev.message);
  } catch {
    return null;
  }
  if (!isObject(msg) || msg.v !== 1 || msg.t !== "answer" || msg.id !== id) return null;
  if (typeof msg.sdp !== "string" || msg.sdp.length === 0 || msg.sdp.length > MAX_ANSWER_SDP) return null;
  return { sdp: msg.sdp, mac: msg.mac };
}

/** Type guard for a response chunk frame. */
export function asResponseChunk(v: unknown): ResponseChunk | null {
  if (!isObject(v)) return null;
  const { id, status, seq, last, body } = v;
  if (typeof id !== "string" || typeof status !== "number" || !Number.isInteger(seq) || (seq as number) < 0) return null;
  if (typeof last !== "boolean" || typeof body !== "string") return null;
  return { id, status, seq: seq as number, last, body };
}
