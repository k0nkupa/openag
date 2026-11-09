import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, REVOKED_MESSAGE } from "./app";

const OWNER = "owner-secret-value-xyz";
const DEVICE = "device-token-abc";
const KEY = "openag-token";

function json(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  close() {}
}

type Handler = (url: string, method: string) => Response;

function routes(opts: { whoami: "owner" | "device"; mint?: Handler }): Handler {
  return (url, method) => {
    if (url === "/whoami") {
      return opts.whoami === "owner" ? json(200, { kind: "owner" }) : json(200, { kind: "device", deviceId: "d1", name: "Mac browser" });
    }
    if (url === "/devices" && method === "POST") {
      return opts.mint ? opts.mint(url, method) : json(201, { device: { id: "d1", name: "x" }, token: DEVICE });
    }
    if (url === "/rooms") return json(200, { rooms: [] });
    if (url.startsWith("/approvals")) return json(200, { approvals: [] });
    if (url === "/devices") return json(200, { devices: [] });
    if (url === "/health") return json(200, { ok: true, vec_version: "0.1" });
    return json(404, { error: "not found" });
  };
}

function stubFetch(handler: Handler) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(String(url), init?.method ?? "GET"));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("App token handling", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
    window.location.hash = "#/room/main";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    window.location.hash = "";
  });

  it("silently replaces a stored owner token with a device token", async () => {
    localStorage.setItem(KEY, OWNER);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    stubFetch(routes({ whoami: "owner", mint: () => json(201, { device: { id: "d1", name: "x" }, token: DEVICE }) }));
    render(<App />);

    await waitFor(() => expect(localStorage.getItem(KEY)).toBe(DEVICE));
    expect(screen.queryByLabelText("Access token")).toBeNull();
    expect(setItem.mock.calls.flat().join(" ")).not.toContain(OWNER);
  });

  it("keeps the owner token and shows a Settings notice when minting fails", async () => {
    localStorage.setItem(KEY, OWNER);
    stubFetch(routes({ whoami: "owner", mint: () => json(500, { error: "boom" }) }));
    render(<App />);

    await waitFor(() => expect(localStorage.getItem(KEY)).toBe(OWNER));
    window.location.hash = "#/settings/devices";
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(
      await screen.findByText("Using the owner token on this device; pairing failed: boom"),
    ).toBeTruthy();
  });

  it("signs out with the revoked message when the stream closes with 4001", async () => {
    localStorage.setItem(KEY, DEVICE);
    stubFetch(routes({ whoami: "device" }));
    render(<App />);

    await waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(0));
    act(() => {
      FakeSocket.instances[0].onclose?.({ code: 4001 });
    });
    expect(await screen.findByText(REVOKED_MESSAGE)).toBeTruthy();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
