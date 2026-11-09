import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRtcIdentity, getRtcIdentity, setRtcIdentity, type RtcIdentity } from "./auth";

const KEY = "openag-rtc";
const GOOD: RtcIdentity = {
  server: "https://ntfy.example.com",
  topic: "openag-rtc-abcdefgh1234",
  stun: ["stun:stun.example.com:3478"],
  deviceId: "0123456789abcdef",
};

describe("RTC identity storage", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("round-trips a valid identity under the openag-rtc key", () => {
    setRtcIdentity(GOOD);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(GOOD);
    expect(getRtcIdentity()).toEqual(GOOD);
  });

  it("returns null when nothing is stored", () => {
    expect(getRtcIdentity()).toBeNull();
  });

  it("treats malformed stored values as absent", () => {
    for (const bad of ["not json", JSON.stringify({ ...GOOD, deviceId: "xyz" }), JSON.stringify({ ...GOOD, stun: [1] }), JSON.stringify({ ...GOOD, server: "ftp://x" }), "[]"]) {
      localStorage.setItem(KEY, bad);
      expect(getRtcIdentity()).toBeNull();
    }
  });

  it("clears the identity", () => {
    setRtcIdentity(GOOD);
    clearRtcIdentity();
    expect(getRtcIdentity()).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => setRtcIdentity(GOOD)).not.toThrow();
    expect(getRtcIdentity()).toBeNull();
    expect(() => clearRtcIdentity()).not.toThrow();
  });
});

describe("RTC identity TURN", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  const TURN = { urls: ["turn:relay.example.com:3478"], username: "u", credential: "c" };

  it("round-trips optional turn credentials", () => {
    setRtcIdentity({ ...GOOD, turn: TURN });
    expect(getRtcIdentity()).toEqual({ ...GOOD, turn: TURN });
  });

  it("drops a malformed stored turn but keeps the identity", () => {
    localStorage.setItem(KEY, JSON.stringify({ ...GOOD, turn: { urls: ["https://x"], username: "u", credential: "c" } }));
    expect(getRtcIdentity()).toEqual(GOOD);
  });
});
