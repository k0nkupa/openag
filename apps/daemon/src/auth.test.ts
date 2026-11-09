import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAuth, createRateLimiter, hashToken, tokenMatches, TOO_MANY_PAIRING_CODES } from "./auth.js";
import { type Db, openDb } from "./db/index.js";
import { createRedactor } from "./redact.js";

const OWNER = "owner-secret-value-123";
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;
const MIN = 60_000;

let dir: string;
let db: Db;
let clock: number;
const now = () => clock;

function makeAuth(opts: { redactor?: ReturnType<typeof createRedactor>; random?: (n: number) => Buffer } = {}) {
  return createAuth({ db, ownerToken: OWNER, now, ...opts });
}

function allRowsText(): string {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  return tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t.name}"`).all())).join("\n");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "openag-auth-"));
  db = openDb(dir);
  clock = 1_000_000;
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("tokens", () => {
  test("createDevice returns an oag_ token of 32 random bytes in base64url", () => {
    const auth = makeAuth({ random: (n) => Buffer.alloc(n, 7) });
    const { token, device } = auth.createDevice("phone");
    expect(token).toBe("oag_" + Buffer.alloc(32, 7).toString("base64url"));
    expect(device.id).toMatch(/^[0-9a-f]{16}$/);
    expect(device.name).toBe("phone");
    expect(device.lastSeenAt).toBeNull();
    expect(device.revokedAt).toBeNull();
  });

  test("default token generation uses 32 random bytes", () => {
    const { token } = makeAuth().createDevice("a");
    expect(token).toMatch(/^oag_[A-Za-z0-9_-]{43}$/);
  });

  test("the raw token is stored nowhere: not in any row and not in the database file", () => {
    const auth = makeAuth();
    const { token } = auth.createDevice("phone");
    const { code } = auth.createPairingCode("owner");
    const redeemed = auth.redeemPairingCode(code, "tablet");
    expect(redeemed).not.toBeNull();
    const rawTokens = [token, redeemed!.token];
    const text = allRowsText();
    for (const t of rawTokens) expect(text).not.toContain(t);
    expect(text).toContain(hashToken(token));
    db.pragma("wal_checkpoint(TRUNCATE)");
    const file = readFileSync(join(dir, "openag.db"));
    for (const t of rawTokens) expect(file.includes(Buffer.from(t))).toBe(false);
    expect(file.includes(Buffer.from(hashToken(token)))).toBe(true);
  });

  test("the stored hash is sha256 hex of the token", () => {
    const { token } = makeAuth().createDevice("p");
    expect(hashToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  test("createDevice registers the token with the redactor", () => {
    const redactor = createRedactor({ env: {} });
    const spy = vi.spyOn(redactor, "addSecret");
    const { token } = makeAuth({ redactor }).createDevice("p");
    expect(spy).toHaveBeenCalledWith(token);
    expect(redactor.redactString(`x ${token} y`)).toBe("x [REDACTED:secret] y");
  });

  test("tokenMatches is constant-time digest comparison and rejects empty input", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abc", "abd")).toBe(false);
    expect(tokenMatches("abc", "")).toBe(false);
    expect(tokenMatches("abc", null)).toBe(false);
    expect(tokenMatches("", "")).toBe(false);
  });
});

describe("authenticate", () => {
  test("missing, empty and non-string tokens are rejected", () => {
    const auth = makeAuth();
    for (const t of [null, undefined, "", 42 as unknown as string]) expect(auth.authenticate(t)).toBeNull();
  });

  test("owner token authenticates as owner", () => {
    expect(makeAuth().authenticate(OWNER)).toEqual({ kind: "owner" });
  });

  test("wrong owner token and unknown device token are rejected", () => {
    expect(makeAuth().authenticate(OWNER + "x")).toBeNull();
    expect(makeAuth().authenticate("oag_" + "A".repeat(43))).toBeNull();
  });

  test("device token authenticates as the device", () => {
    const auth = makeAuth();
    const { device, token } = auth.createDevice("laptop");
    expect(auth.authenticate(token)).toEqual({ kind: "device", deviceId: device.id, name: "laptop", access: "limited" });
  });

  test("revoked device token is rejected immediately", () => {
    const auth = makeAuth();
    const { device, token } = auth.createDevice("laptop");
    expect(auth.revokeDevice(device.id)).toBe(true);
    expect(auth.authenticate(token)).toBeNull();
  });

  test("garbage input never throws: non-ASCII, control characters, huge strings", () => {
    const auth = makeAuth();
    const inputs = ["ünïcødé🔥", "a\u0000b", "x".repeat(10_000), "Bearer x y", "oag_" + "é".repeat(200)];
    for (const input of inputs) expect(auth.authenticate(input)).toBeNull();
  });

  test("tokens longer than 512 characters are rejected before hashing", () => {
    const auth = makeAuth();
    const { token } = auth.createDevice("p");
    expect(auth.authenticate(token + "x".repeat(600))).toBeNull();
    const oversized = OWNER + "y".repeat(512);
    expect(auth.authenticate(oversized)).toBeNull();
  });

  test("last_seen_at is written at most once per 60 seconds per device", () => {
    const auth = makeAuth();
    const { device, token } = auth.createDevice("p");
    const lastSeen = () =>
      (db.prepare("SELECT last_seen_at FROM devices WHERE id = ?").get(device.id) as { last_seen_at: number }).last_seen_at;
    auth.authenticate(token);
    expect(lastSeen()).toBe(clock);
    clock += 59_999;
    auth.authenticate(token);
    expect(lastSeen()).toBe(clock - 59_999);
    clock += 1;
    auth.authenticate(token);
    expect(lastSeen()).toBe(clock);
  });
});

describe("pairing codes", () => {
  test("format is XXXX-XXXX from the unambiguous alphabet", () => {
    const auth = makeAuth();
    for (let i = 0; i < 5; i++) {
      const { code, expiresAt } = auth.createPairingCode("owner");
      expect(code).toMatch(CODE_RE);
      expect(expiresAt).toBe(clock + 5 * MIN);
      expect(code).not.toMatch(/[IO01]/);
      auth.redeemPairingCode(code, "x");
    }
  });

  test("the code is stored as sha256 of the normalised code, never in plain text", () => {
    const auth = makeAuth();
    const { code } = auth.createPairingCode("owner");
    const normalised = code.replace(/-/g, "");
    const stored = db.prepare("SELECT code_hash FROM pairing_codes").all() as Array<{ code_hash: string }>;
    expect(stored.map((r) => r.code_hash)).toEqual([hashToken(normalised)]);
    expect(allRowsText()).not.toContain(normalised);
  });

  test("redeem accepts lowercase, spaces and missing dash", () => {
    const auth = makeAuth();
    const { code } = auth.createPairingCode("owner");
    const variant = code.replace("-", "").toLowerCase().replace(/^(.{2})/, "$1 ");
    expect(auth.redeemPairingCode(variant, "phone")).not.toBeNull();
  });

  test("TTL boundary: valid one ms before expiry, rejected at expiry", () => {
    const auth = makeAuth();
    const first = auth.createPairingCode("owner");
    clock = first.expiresAt - 1;
    const second = makeAuth().createPairingCode("owner");
    expect(auth.redeemPairingCode(first.code, "a")).not.toBeNull();
    clock = second.expiresAt;
    expect(auth.redeemPairingCode(second.code, "b")).toBeNull();
  });

  test("single use: a second redemption of the same code fails", () => {
    const auth = makeAuth();
    const { code } = auth.createPairingCode("owner");
    expect(auth.redeemPairingCode(code, "one")).not.toBeNull();
    expect(auth.redeemPairingCode(code, "two")).toBeNull();
  });

  test("two concurrent redemptions through separate connections yield exactly one device", () => {
    const { code } = makeAuth().createPairingCode("owner");
    const file = join(dir, "openag.db");
    const other = new Database(file);
    other.pragma("busy_timeout = 5000");
    try {
      const a = makeAuth();
      const b = createAuth({ db: other, ownerToken: OWNER, now });
      const results = [a.redeemPairingCode(code, "A"), b.redeemPairingCode(code, "B")];
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(a.listDevices()).toHaveLength(1);
    } finally {
      other.close();
    }
  });

  test("wrong, expired, used and malformed codes all return the same null", () => {
    const auth = makeAuth();
    const used = auth.createPairingCode("owner").code;
    auth.redeemPairingCode(used, "x");
    const expired = auth.createPairingCode("owner").code;
    clock += 5 * MIN;
    const outcomes = [
      auth.redeemPairingCode("ZZZZ-ZZZZ", "x"),
      auth.redeemPairingCode(expired, "x"),
      auth.redeemPairingCode(used, "x"),
      auth.redeemPairingCode("", "x"),
      auth.redeemPairingCode("SHORT", "x"),
      auth.redeemPairingCode("IIII-OOOO", "x"),
      auth.redeemPairingCode("x".repeat(1000), "x"),
    ];
    expect(outcomes).toEqual(outcomes.map(() => null));
  });

  test("at most 5 unexpired unused codes; a 6th throws the exact message", () => {
    const auth = makeAuth();
    const codes = Array.from({ length: 5 }, () => auth.createPairingCode("owner").code);
    expect(() => auth.createPairingCode("owner")).toThrow(TOO_MANY_PAIRING_CODES);
    expect(TOO_MANY_PAIRING_CODES).toBe("too many active pairing codes");
    // A used code frees a slot.
    auth.redeemPairingCode(codes[0]!, "x");
    expect(() => auth.createPairingCode("owner")).not.toThrow();
    // Expired codes free their slots too.
    clock += 5 * MIN;
    expect(() => auth.createPairingCode("owner")).not.toThrow();
  });

  test("name is trimmed, control-stripped, clipped to 64 and defaulted", () => {
    const auth = makeAuth();
    const name = (n: string) => {
      const { code } = auth.createPairingCode("owner");
      return auth.redeemPairingCode(code, n)!.device.name;
    };
    expect(name("  Bob\u0007 \n Laptop  ")).toBe("Bob  Laptop");
    expect(name("a".repeat(100))).toBe("a".repeat(64));
    expect(name("   ")).toBe("Unnamed device");
    expect(name("\u0000\u001b")).toBe("Unnamed device");
    expect(name("é".repeat(70))).toBe("é".repeat(64));
  });

  test("a redemption that fails after consuming the code rolls back the consumption", () => {
    const auth = makeAuth({
      random: () => {
        throw new Error("boom");
      },
    });
    const { code } = auth.createPairingCode("owner");
    expect(auth.redeemPairingCode(code, "x")).toBeNull();
    const row = db.prepare("SELECT used_at FROM pairing_codes").get() as { used_at: number | null };
    expect(row.used_at).toBeNull();
  });
});

describe("devices and revocation", () => {
  test("listDevices never exposes hashes or tokens", () => {
    const auth = makeAuth();
    const { token } = auth.createDevice("phone");
    const listed = auth.listDevices();
    expect(listed).toHaveLength(1);
    expect(Object.keys(listed[0]!).sort()).toEqual(["access", "createdAt", "createdBy", "id", "lastSeenAt", "name", "revokedAt"]);
    expect(JSON.stringify(listed)).not.toContain(token);
    expect(JSON.stringify(listed)).not.toContain(hashToken(token));
  });

  test("revokeDevice returns false for unknown and already-revoked devices", () => {
    const auth = makeAuth();
    const { device } = auth.createDevice("p");
    expect(auth.revokeDevice("nope")).toBe(false);
    expect(auth.revokeDevice(device.id)).toBe(true);
    expect(auth.revokeDevice(device.id)).toBe(false);
  });

  test("revoke calls every onRevoke callback with the id; unsubscribe stops calls", () => {
    const auth = makeAuth();
    const a = vi.fn();
    const b = vi.fn();
    const offA = auth.onRevoke(a);
    auth.onRevoke(b);
    const { device } = auth.createDevice("p");
    auth.revokeDevice(device.id);
    expect(a).toHaveBeenCalledWith(device.id);
    expect(b).toHaveBeenCalledWith(device.id);
    offA();
    const second = auth.createDevice("q");
    auth.revokeDevice(second.device.id);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  test("a throwing callback does not stop the others", () => {
    const auth = makeAuth();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const later = vi.fn();
    auth.onRevoke(() => {
      throw new Error("bad");
    });
    auth.onRevoke(later);
    const { device } = auth.createDevice("p");
    expect(auth.revokeDevice(device.id)).toBe(true);
    expect(later).toHaveBeenCalledWith(device.id);
    spy.mockRestore();
  });
});

describe("rate limiter", () => {
  test("allows max per sliding window, then reports retry-after", () => {
    let t = 0;
    const rl = createRateLimiter({ max: 2, windowMs: 1000, now: () => t });
    expect(rl.allow("k").ok).toBe(true);
    t = 100;
    expect(rl.allow("k").ok).toBe(true);
    t = 200;
    expect(rl.allow("k")).toEqual({ ok: false, retryAfterSec: 1 });
    t = 1000; // first hit (t=0) has left the window
    expect(rl.allow("k").ok).toBe(true);
    expect(rl.allow("other").ok).toBe(true);
  });

  test("retry-after is rounded up and at least 1 second", () => {
    let t = 0;
    const rl = createRateLimiter({ max: 1, windowMs: 60_000, now: () => t });
    rl.allow("k");
    t = 59_500;
    expect(rl.allow("k")).toEqual({ ok: false, retryAfterSec: 1 });
    t = 30_100;
    const rl2 = createRateLimiter({ max: 1, windowMs: 60_000, now: () => t });
    rl2.allow("k");
    t = 30_100 + 20_001;
    expect(rl2.allow("k").retryAfterSec).toBe(40);
  });

  test("the key map is bounded and evicts the oldest key", () => {
    let t = 0;
    const rl = createRateLimiter({ max: 1, windowMs: 1e9, now: () => t });
    rl.allow("first");
    for (let i = 0; i < 10_000; i++) rl.allow(`k${i}`);
    // "first" was evicted, so it is allowed again despite the window.
    expect(rl.allow("first").ok).toBe(true);
  });
});
