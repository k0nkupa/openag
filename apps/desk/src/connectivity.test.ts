import { describe, expect, it, vi } from "vitest";
import type { RtcIdentity } from "./auth";
import { reconnectDelay, resolveTransport } from "./connectivity";
import type { RtcTransport } from "./rtc/transport";

const ID: RtcIdentity = {
  server: "https://ntfy.example.com",
  topic: "openag-rtc-abcdefgh1234",
  stun: ["stun:stun.example.com:3478"],
  deviceId: "0123456789abcdef",
};

const fakeTransport = { state: "open" } as unknown as RtcTransport;

describe("resolveTransport", () => {
  it("is direct without an identity and never probes or dials", async () => {
    const probe = vi.fn(async () => false);
    const createTransport = vi.fn();
    expect(await resolveTransport({ token: "t", identity: null, probe, createTransport })).toEqual({ mode: "direct" });
    expect(probe).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("is direct when the daemon answers the probe, and does not dial", async () => {
    const probe = vi.fn(async () => true);
    const createTransport = vi.fn();
    expect(await resolveTransport({ token: "t", identity: ID, probe, createTransport })).toEqual({ mode: "direct" });
    expect(probe).toHaveBeenCalledWith(3000);
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("joins over RTC with the device auth when the probe fails", async () => {
    const createTransport = vi.fn(async () => fakeTransport);
    const res = await resolveTransport({ token: "device-token", identity: ID, probe: async () => false, createTransport });
    expect(createTransport).toHaveBeenCalledWith({
      invite: { server: ID.server, topic: ID.topic, stun: ID.stun },
      auth: { kind: "device", deviceId: ID.deviceId, token: "device-token" },
    });
    expect(res.mode).toBe("rtc");
    if (res.mode !== "rtc") throw new Error("unreachable");
    expect(res.transport).toBe(fakeTransport);
    expect(typeof res.fetch).toBe("function");
  });

  it("falls back to direct with the error when the RTC connect fails", async () => {
    const res = await resolveTransport({
      token: "t",
      identity: ID,
      probe: async () => false,
      createTransport: async () => {
        throw new Error("WebRTC connect timed out");
      },
    });
    expect(res).toEqual({ mode: "direct", error: "WebRTC connect timed out" });
  });
});

describe("reconnectDelay", () => {
  it("doubles from 1 s and caps at 30 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
    expect(reconnectDelay(-1)).toBe(1000);
  });

  it("drives a retry loop with fake timers: 1 s, 2 s, 4 s, ... 30 s, 30 s", () => {
    vi.useFakeTimers();
    try {
      const fires: number[] = [];
      let attempt = 0;
      const start = Date.now();
      const schedule = () => {
        setTimeout(() => {
          fires.push(Date.now() - start);
          if (fires.length < 7) {
            attempt++;
            schedule();
          }
        }, reconnectDelay(attempt));
      };
      schedule();
      vi.advanceTimersByTime(200_000);
      expect(fires).toEqual([1000, 3000, 7000, 15000, 31000, 61000, 91000]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("resolveTransport TURN", () => {
  it("passes stored TURN into the invite and refreshes it in the background", async () => {
    const turn = { urls: ["turn:relay.example.com:3478"], username: "u", credential: "c" };
    const fresh = { urls: ["turns:relay.example.com:5349"], username: "u2", credential: "c2" };
    localStorage.setItem(
      "openag-rtc",
      JSON.stringify({ ...ID, turn }),
    );
    const turnCredentials = vi.fn(async () => fresh);
    const createTransport = vi.fn(async (_opts: unknown) => ({ state: "open", turnCredentials }) as unknown as RtcTransport);
    const res = await resolveTransport({ token: "t", identity: { ...ID, turn }, probe: async () => false, createTransport });
    expect(res.mode).toBe("rtc");
    expect(createTransport.mock.calls[0]?.[0]).toMatchObject({ invite: { turn } });
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem("openag-rtc")!).turn).toEqual(fresh));
    expect(turnCredentials).toHaveBeenCalledWith({ authorization: "Bearer t" });
    localStorage.clear();
  });

  it("ignores a failed background TURN refresh", async () => {
    const createTransport = vi.fn(async () => ({ state: "open", turnCredentials: async () => { throw new Error("nope"); } }) as unknown as RtcTransport);
    const res = await resolveTransport({ token: "t", identity: ID, probe: async () => false, createTransport });
    expect(res.mode).toBe("rtc");
    await new Promise((r) => setTimeout(r, 0));
    expect(localStorage.getItem("openag-rtc")).toBeNull();
  });
});
