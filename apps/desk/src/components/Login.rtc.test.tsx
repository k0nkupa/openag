import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Login, parseInvite } from "./Login";

const { createRtcTransportMock, transport } = vi.hoisted(() => ({
  createRtcTransportMock: vi.fn(),
  transport: { state: "open", request: vi.fn(), close: vi.fn(), subscribe: vi.fn() },
}));

vi.mock("../rtc/transport", () => ({
  createRtcTransport: (...args: unknown[]) => createRtcTransportMock(...args),
}));

const INVITE = {
  server: "https://ntfy.example.com",
  topic: "openag-rtc-abcdefgh1234",
  stun: ["stun:stun.example.com:3478"],
  code: "ABCD-EFGH",
  secret: "abcdefghijklmnop",
};
const DEVICE_ID = "0123456789abcdef";
const DEVICE_TOKEN = "device-token-from-pairing";

function openRtcTab() {
  fireEvent.click(screen.getByRole("tab", { name: "Join without VPN" }));
}

function typeInvite(text: string) {
  fireEvent.change(screen.getByLabelText("Invite JSON"), { target: { value: text } });
}

describe("Login join without VPN", () => {
  beforeEach(() => {
    createRtcTransportMock.mockReset();
    transport.request.mockReset();
    transport.close.mockReset();
    createRtcTransportMock.mockResolvedValue(transport);
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("rejects an invite that is not valid JSON without dialing", async () => {
    render(<Login notice={null} onSignedIn={vi.fn()} />);
    openRtcTab();
    typeInvite("{not json");
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Invite is not valid"));
    expect(createRtcTransportMock).not.toHaveBeenCalled();
  });

  it("pairs through the transport, stores the token and the RTC identity, then signs in", async () => {
    const onSignedIn = vi.fn();
    transport.request.mockResolvedValue({ status: 200, body: JSON.stringify({ deviceId: DEVICE_ID, token: DEVICE_TOKEN }) });
    render(<Login notice={null} onSignedIn={onSignedIn} />);
    openRtcTab();
    typeInvite(JSON.stringify(INVITE));
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(DEVICE_TOKEN));

    expect(createRtcTransportMock).toHaveBeenCalledWith({
      invite: INVITE,
      auth: { kind: "pair", code: "ABCD-EFGH" },
    });
    const [method, path, opts] = transport.request.mock.calls[0] as unknown as [string, string, { headers: Record<string, string>; body: string }];
    expect([method, path]).toEqual(["POST", "/pair"]);
    expect(opts.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toMatchObject({ code: "ABCD-EFGH" });
    expect(transport.close).toHaveBeenCalled();
    expect(localStorage.getItem("openag-token")).toBe(DEVICE_TOKEN);
    expect(JSON.parse(localStorage.getItem("openag-rtc")!)).toEqual({
      server: "https://ntfy.example.com",
      topic: "openag-rtc-abcdefgh1234",
      stun: ["stun:stun.example.com:3478"],
      deviceId: DEVICE_ID,
    });
  });

  it("shows the expired-code message on 400, stores nothing and never retries", async () => {
    const onSignedIn = vi.fn();
    transport.request.mockResolvedValue({ status: 400, body: "{}" });
    render(<Login notice={null} onSignedIn={onSignedIn} />);
    openRtcTab();
    typeInvite(JSON.stringify(INVITE));
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Invalid or expired code"));
    expect(transport.request).toHaveBeenCalledTimes(1);
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(localStorage.getItem("openag-token")).toBeNull();
    expect(localStorage.getItem("openag-rtc")).toBeNull();
    expect(transport.close).toHaveBeenCalled();
  });
});

describe("parseInvite", () => {
  it("requires a secret and an 8 character code", () => {
    expect(() => parseInvite(JSON.stringify({ ...INVITE, secret: undefined }))).toThrow("missing secret");
    expect(() => parseInvite(JSON.stringify({ ...INVITE, code: "ABC" }))).toThrow("invite: bad code");
    expect(parseInvite(JSON.stringify(INVITE)).code).toBe("ABCD-EFGH");
  });
});
