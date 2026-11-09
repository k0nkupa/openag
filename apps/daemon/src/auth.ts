import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Db } from "./db/index.js";
import { getDefaultRedactor, type Redactor } from "./redact.js";

export type DeviceAccess = "limited" | "full";
export const isDeviceAccess = (v: unknown): v is DeviceAccess => v === "limited" || v === "full";

export type Principal = { kind: "owner" } | { kind: "device"; deviceId: string; name: string; access: DeviceAccess };

export interface DeviceInfo {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
  /** 'owner' or the id of the device whose pairing code created this one. */
  createdBy: string;
  /** 'full' devices act as the owner; 'limited' ones cannot use owner-only routes. */
  access: DeviceAccess;
}

export interface Auth {
  authenticate(token: string | null | undefined): Principal | null;
  createDevice(name: string, createdBy?: string, access?: DeviceAccess): { device: DeviceInfo; token: string };
  createPairingCode(createdBy: string, access?: DeviceAccess): { code: string; expiresAt: number };
  /** Changes a live device's access level. False when the device is unknown or revoked. */
  setDeviceAccess(id: string, access: DeviceAccess): boolean;
  redeemPairingCode(code: string, name: string): { device: DeviceInfo; token: string; createdBy: string } | null;
  listDevices(): DeviceInfo[];
  revokeDevice(id: string): boolean;
  /** Revokes a device and, with `cascade`, every device it (transitively) created. Returns the ids revoked now. */
  revokeDeviceTree(id: string, cascade: boolean): string[];
  onRevoke(cb: (deviceId: string) => void): () => void;
  /**
   * HMAC key for a channel that must prove a device WITHOUT sending its token (WebRTC signaling, rtc.ts): the stored SHA-256
   * of the device's token (a client derives the same value locally). High entropy, but note it equals the stored hash:
   * a copy of the DB can sign offers (never frames, which need the token itself). Never exposed over any API.
   */
  deviceKey(deviceId: string): string | null;
}

const TOKEN_PREFIX = "oag_";
const MAX_TOKEN_LENGTH = 512;
const LAST_SEEN_INTERVAL_MS = 60_000;
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LENGTH = 8;
const PAIRING_TTL_MS = 5 * 60_000;
const MAX_ACTIVE_PAIRING_CODES = 5;
export const TOO_MANY_PAIRING_CODES = "too many active pairing codes";
const DEFAULT_DEVICE_NAME = "Unnamed device";
const MAX_NAME_LENGTH = 64;
const MAX_RATE_KEYS = 10_000;

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenMatches(expected: string, given: string | null | undefined): boolean {
  if (!expected || !given) return false;
  return timingSafeEqual(digest(expected), digest(given));
}

function normalisePairingCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, "");
}

/** Strips control characters, trims, and clips to 64 code points; falls back to a default name. */
function sanitiseName(name: unknown): string {
  if (typeof name !== "string") return DEFAULT_DEVICE_NAME;
  const cleaned = name.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  const clipped = Array.from(cleaned.trim()).slice(0, MAX_NAME_LENGTH).join("").trim();
  return clipped === "" ? DEFAULT_DEVICE_NAME : clipped;
}

interface DeviceRow {
  id: string;
  name: string;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
  created_by: string;
  access: DeviceAccess;
}

const toInfo = (r: DeviceRow): DeviceInfo => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
  revokedAt: r.revoked_at,
  createdBy: r.created_by,
  access: r.access,
});

export interface AuthDeps {
  db: Db;
  ownerToken: string;
  redactor?: Redactor;
  now?: () => number;
  random?: (n: number) => Buffer;
}

export function createAuth(deps: AuthDeps): Auth {
  const { db, ownerToken } = deps;
  const redactor = deps.redactor ?? getDefaultRedactor();
  const now = deps.now ?? Date.now;
  const random = deps.random ?? ((n: number) => randomBytes(n));
  const lastSeenWritten = new Map<string, number>();
  const revokeCallbacks = new Set<(deviceId: string) => void>();
  let lastRedeemErrorLog = Number.NEGATIVE_INFINITY;

  const insertDevice = db.prepare(
    "INSERT INTO devices (id, name, token_hash, created_at, created_by, access) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const findByHash = db.prepare("SELECT id, name, revoked_at, access FROM devices WHERE token_hash = ?");
  const getDevice = db.prepare("SELECT * FROM devices WHERE id = ?");
  const listDevicesStmt = db.prepare("SELECT * FROM devices ORDER BY created_at, id");
  const updateLastSeen = db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?");
  const childrenStmt = db.prepare("SELECT id FROM devices WHERE created_by = ?");
  const revokeStmt = db.prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL");
  const countActiveCodes = db.prepare(
    "SELECT COUNT(*) AS n FROM pairing_codes WHERE used_at IS NULL AND expires_at > ?",
  );
  const insertCode = db.prepare(
    "INSERT INTO pairing_codes (code_hash, created_by, created_at, expires_at, access) VALUES (?, ?, ?, ?, ?)",
  );
  // Atomic single-use: only one caller can flip used_at from NULL, so concurrent redemptions yield one winner.
  const findCode = db.prepare("SELECT created_by, access FROM pairing_codes WHERE code_hash = ?");
  const markCodeUsed = db.prepare(
    "UPDATE pairing_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?",
  );

  const setAccessStmt = db.prepare("UPDATE devices SET access = ? WHERE id = ? AND revoked_at IS NULL");
  const deviceHash = db.prepare("SELECT token_hash FROM devices WHERE id = ? AND revoked_at IS NULL");

  function revokeOne(id: string): boolean {
    if (revokeStmt.run(now(), id).changes !== 1) return false;
    for (const cb of [...revokeCallbacks]) {
      try {
        cb(id);
      } catch (err) {
        console.error("device revoke callback failed:", err);
      }
    }
    return true;
  }

  function createDeviceRow(name: string, createdBy: string, access: DeviceAccess): { device: DeviceInfo; token: string } {
    const id = random(8).toString("hex");
    const token = TOKEN_PREFIX + random(32).toString("base64url");
    const t = now();
    insertDevice.run(id, sanitiseName(name), hashToken(token), t, createdBy, access);
    // Registered so the token is redacted in this process; after a restart the oag_ pattern covers it.
    redactor.addSecret(token);
    const row = getDevice.get(id) as DeviceRow;
    return { device: toInfo(row), token };
  }

  return {
    deviceKey(deviceId) {
      return (deviceHash.get(deviceId) as { token_hash: string } | undefined)?.token_hash ?? null;
    },
    authenticate(token) {
      if (typeof token !== "string" || token === "") return null;
      // The owner secret is compared first and uncapped, so an unusually long OPENAG_TOKEN can never lock the owner out.
      if (tokenMatches(ownerToken, token)) return { kind: "owner" };
      if (token.length > MAX_TOKEN_LENGTH) return null;
      const row = findByHash.get(hashToken(token)) as
        | { id: string; name: string; revoked_at: number | null; access: DeviceAccess }
        | undefined;
      if (!row || row.revoked_at !== null) return null;
      const t = now();
      const last = lastSeenWritten.get(row.id);
      if (last === undefined || t - last >= LAST_SEEN_INTERVAL_MS) {
        updateLastSeen.run(t, row.id);
        lastSeenWritten.set(row.id, t);
      }
      return { kind: "device", deviceId: row.id, name: row.name, access: row.access };
    },

    createDevice(name, createdBy = "owner", access = "limited") {
      return db.transaction(() => createDeviceRow(name, createdBy, access))();
    },

    setDeviceAccess(id, access) {
      return setAccessStmt.run(access, id).changes === 1;
    },

    createPairingCode(createdBy, access = "limited") {
      return db.transaction(() => {
        const t = now();
        const { n } = countActiveCodes.get(t) as { n: number };
        if (n >= MAX_ACTIVE_PAIRING_CODES) throw new Error(TOO_MANY_PAIRING_CODES);
        let raw = "";
        for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
          raw += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
        }
        const expiresAt = t + PAIRING_TTL_MS;
        insertCode.run(hashToken(normalisePairingCode(raw)), createdBy, t, expiresAt, access);
        return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt };
      })();
    },

    redeemPairingCode(code, name) {
      if (typeof code !== "string" || code.length > 64) return null;
      const normalised = normalisePairingCode(code);
      if (normalised.length !== PAIRING_CODE_LENGTH) return null;
      for (const ch of normalised) if (!PAIRING_ALPHABET.includes(ch)) return null;
      try {
        return db.transaction(() => {
          const t = now();
          const hash = hashToken(normalised);
          const res = markCodeUsed.run(t, hash, t);
          if (res.changes !== 1) return null;
          const found = findCode.get(hash) as { created_by: string; access: DeviceAccess };
          return { ...createDeviceRow(name, found.created_by, found.access), createdBy: found.created_by };
        })();
      } catch (err) {
        // Any failure looks the same to the caller: never reveal why a code was refused. Operators still get a
        // rate-limited hint that something is wrong (error class only: nothing about the code or the DB contents).
        const t = now();
        if (t - lastRedeemErrorLog >= 60_000) {
          lastRedeemErrorLog = t;
          console.error(`pairing redemption failed with an internal error (${err instanceof Error ? err.name : "unknown"})`);
        }
        return null;
      }
    },

    listDevices() {
      return (listDevicesStmt.all() as DeviceRow[]).map(toInfo);
    },

    revokeDevice(id) {
      return revokeOne(id);
    },

    revokeDeviceTree(id, cascade) {
      const revoked: string[] = [];
      if (!getDevice.get(id)) return revoked;
      if (revokeOne(id)) revoked.push(id);
      if (!cascade) return revoked;
      // Walk the whole tree, including through already-revoked intermediates, so nothing a stolen device added survives.
      const seen = new Set<string>([id]);
      const queue = [id];
      while (queue.length > 0) {
        const parent = queue.shift()!;
        for (const child of childrenStmt.all(parent) as { id: string }[]) {
          if (seen.has(child.id)) continue;
          seen.add(child.id);
          queue.push(child.id);
          if (revokeOne(child.id)) revoked.push(child.id);
        }
      }
      return revoked;
    },

    onRevoke(cb) {
      revokeCallbacks.add(cb);
      return () => {
        revokeCallbacks.delete(cb);
      };
    },
  };
}

export interface RateLimiter {
  /** Check and record one hit. */
  allow(key: string): { ok: boolean; retryAfterSec: number };
  /** Check without recording. */
  check(key: string): { ok: boolean; retryAfterSec: number };
  /** Record a hit without checking. */
  record(key: string): void;
}

/** Sliding-window limiter, in memory. Keys are bounded; the least recently used key is evicted first. */
export function createRateLimiter(opts: { max: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  const recent = (key: string, t: number) => (hits.get(key) ?? []).filter((ts) => ts > t - opts.windowMs);
  const verdict = (list: number[], t: number) =>
    list.length >= opts.max
      ? { ok: false, retryAfterSec: Math.max(1, Math.ceil((list[0]! + opts.windowMs - t) / 1000)) }
      : { ok: true, retryAfterSec: 0 };
  function record(key: string): void {
    const t = now();
    const list = recent(key, t);
    list.push(t);
    hits.delete(key); // re-insert so the least recently used key is evicted first
    hits.set(key, list);
    while (hits.size > MAX_RATE_KEYS) {
      const oldest = hits.keys().next().value;
      if (oldest === undefined) break;
      hits.delete(oldest);
    }
  }
  return {
    check: (key) => verdict(recent(key, now()), now()),
    record,
    allow(key) {
      const v = verdict(recent(key, now()), now());
      if (v.ok) record(key);
      return v;
    },
  };
}
