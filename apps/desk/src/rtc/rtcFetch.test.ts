import { describe, expect, it, vi } from "vitest";
import { createRtcFetch } from "./rtcFetch";

function fakeTransport(status = 200, body = "{}") {
  const request = vi.fn(async (_m: "GET" | "POST", _p: string, _o?: { headers?: Record<string, string>; body?: string }) => ({ status, body }));
  return { request };
}

describe("createRtcFetch", () => {
  it("returns a Response with the daemon status and text body", async () => {
    const t = fakeTransport(200, '{"ok":true}');
    const f = createRtcFetch(t);
    const res = await f("/rooms?limit=5");
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ ok: true });
    expect(t.request).toHaveBeenCalledWith("GET", "/rooms?limit=5", {});
  });

  it("forwards POST bodies, uppercases the method, and keeps authorization and content-type", async () => {
    const t = fakeTransport(201, "{}");
    const f = createRtcFetch(t);
    const res = await f("/rooms/main/messages", {
      method: "post",
      headers: { Authorization: "Bearer abc", "Content-Type": "application/json" },
      body: '{"text":"hi"}',
    });
    expect(res.status).toBe(201);
    expect(t.request).toHaveBeenCalledWith("POST", "/rooms/main/messages", {
      headers: { authorization: "Bearer abc", "content-type": "application/json" },
      body: '{"text":"hi"}',
    });
  });

  it("uses a null body for 204", async () => {
    const f = createRtcFetch(fakeTransport(204, ""));
    const res = await f("/approvals/1", { method: "POST", body: "{}" });
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it("accepts a Request object for a path on the daemon", async () => {
    const t = fakeTransport(200, "[]");
    const f = createRtcFetch(t);
    await f(new Request("http://rtc.local/bots", { headers: { authorization: "Bearer t" } }));
    expect(t.request).toHaveBeenCalledWith("GET", "/bots", { headers: { authorization: "Bearer t" } });
  });

  it("refuses absolute URLs to other origins before sending anything", async () => {
    const t = fakeTransport();
    const f = createRtcFetch(t);
    await expect(f("https://evil.example.com/rooms")).rejects.toThrow(TypeError);
    await expect(f("//evil.example.com/rooms")).rejects.toThrow(TypeError);
    expect(t.request).not.toHaveBeenCalled();
  });

  it("refuses methods other than GET and POST", async () => {
    const t = fakeTransport();
    const f = createRtcFetch(t);
    await expect(f("/rooms", { method: "PUT", body: "{}" })).rejects.toThrow(TypeError);
    await expect(f("/rooms", { method: "DELETE" })).rejects.toThrow(TypeError);
    expect(t.request).not.toHaveBeenCalled();
  });

  it("refuses non-string bodies and a body on GET", async () => {
    const t = fakeTransport();
    const f = createRtcFetch(t);
    await expect(f("/rooms", { method: "POST", body: new Uint8Array([1]) })).rejects.toThrow(TypeError);
    await expect(f("/rooms", { method: "GET", body: "{}" })).rejects.toThrow(TypeError);
    expect(t.request).not.toHaveBeenCalled();
  });

  it("refuses headers other than authorization and content-type", async () => {
    const t = fakeTransport();
    const f = createRtcFetch(t);
    await expect(f("/rooms", { headers: { "x-forwarded-for": "1.2.3.4" } })).rejects.toThrow(TypeError);
    await expect(f("/rooms", { headers: { accept: "*/*" } })).rejects.toThrow(TypeError);
    expect(t.request).not.toHaveBeenCalled();
  });

  it("rejects a status outside the Response range", async () => {
    const f = createRtcFetch(fakeTransport(700, ""));
    await expect(f("/rooms")).rejects.toThrow(TypeError);
  });

  it("passes transport errors through", async () => {
    const t = { request: vi.fn(async () => Promise.reject(new Error("request timed out"))) };
    const f = createRtcFetch(t);
    await expect(f("/rooms")).rejects.toThrow("request timed out");
  });

  it("rejects with AbortError when the signal is already aborted", async () => {
    const t = fakeTransport();
    const f = createRtcFetch(t);
    const ctl = new AbortController();
    ctl.abort();
    await expect(f("/rooms", { signal: ctl.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});
