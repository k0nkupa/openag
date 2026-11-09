import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Api } from "../api";
import { RtcPanel, parseStun } from "./RtcPanel";

const STATUS = { enabled: false, inert: "disabled", subscribed: false, peers: 0, offers: 0, rejected: 0, lastError: null };
const SETTINGS = { enabled: true, server: "https://ntfy.example.com", topic: null, stun: ["stun:a:3478"] };

function makeApi(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getRtcStatus: vi.fn(async () => STATUS),
    getSettings: vi.fn(async () => ({ settings: { rtc: SETTINGS } })),
    putRtc: vi.fn(async () => ({ key: "rtc", value: {} })),
    generateRtcTopic: vi.fn(async () => ({ rtc: { ...SETTINGS, topic: "(set)" } })),
    createRtcInvite: vi.fn(async () => ({
      server: "https://ntfy.example.com",
      topic: "openag-rtc-abcdefgh1234",
      stun: [],
      code: "ABCD-EFGH",
      secret: "abcdefghijklmnop",
      expiresAt: 1,
    })),
    ...overrides,
  } as unknown as Api & { putRtc: ReturnType<typeof vi.fn>; generateRtcTopic: ReturnType<typeof vi.fn>; createRtcInvite: ReturnType<typeof vi.fn> };
}

const flush = () => act(async () => {
  await Promise.resolve();
});

describe("RtcPanel", () => {
  it("shows the status and fills the settings form", async () => {
    render(<RtcPanel api={makeApi()} />);
    await flush();
    expect(screen.getByText("Inert: disabled")).toBeTruthy();
    expect((screen.getByLabelText("Signaling server") as HTMLInputElement).value).toBe("https://ntfy.example.com");
    expect((screen.getByLabelText("STUN servers, one per line") as HTMLTextAreaElement).value).toBe("stun:a:3478");
    expect(screen.getByText("Signaling topic: not set")).toBeTruthy();
  });

  it("saves with a null topic when none is set, and parses STUN lines", async () => {
    const api = makeApi();
    render(<RtcPanel api={api} />);
    await flush();
    fireEvent.change(screen.getByLabelText("STUN servers, one per line"), { target: { value: "stun:a:3478\n\nstun:b:3478\nstun:a:3478" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await flush();
    expect(api.putRtc).toHaveBeenCalledWith({
      enabled: true,
      server: "https://ntfy.example.com",
      topic: null,
      stun: ["stun:a:3478", "stun:b:3478"],
    });
    expect(screen.getByText("Saved.")).toBeTruthy();
  });

  it("generates a topic and then keeps it on save with the (set) marker", async () => {
    const api = makeApi();
    render(<RtcPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Generate topic" }));
    await flush();
    expect(api.generateRtcTopic).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Signaling topic: set")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await flush();
    expect(api.putRtc.mock.calls[0]![0]).toMatchObject({ topic: "(set)" });
  });

  it("shows the owner-only message when the save is refused with 403", async () => {
    const { ApiError } = await import("../api");
    const api = makeApi({ putRtc: vi.fn(async () => { throw new ApiError("forbidden", 403); }) });
    render(<RtcPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toBe("Only a Full access device can change WebRTC settings");
  });

  it("creates a phone invite, shows the warning and the JSON read-only, without the expiry", async () => {
    const api = makeApi();
    render(<RtcPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Create phone invite" }));
    await flush();
    expect(api.createRtcInvite).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/single use, expires in 5 minutes, and contains secrets/)).toBeTruthy();
    const box = screen.getByLabelText("Invite JSON") as HTMLTextAreaElement;
    expect(box.readOnly).toBe(true);
    const shown = JSON.parse(box.value);
    expect(shown).toEqual({
      server: "https://ntfy.example.com",
      topic: "openag-rtc-abcdefgh1234",
      stun: [],
      code: "ABCD-EFGH",
      secret: "abcdefghijklmnop",
    });
  });

  it("shows an invite error as text", async () => {
    const api = makeApi({ createRtcInvite: vi.fn(async () => { throw new Error("WebRTC is disabled"); }) });
    render(<RtcPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Create phone invite" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toBe("WebRTC is disabled");
    expect(screen.queryByLabelText("Invite JSON")).toBeNull();
  });
});

describe("parseStun", () => {
  it("drops blanks and duplicates and trims", () => {
    expect(parseStun("  a \n\n b\r\na")).toEqual(["a", "b"]);
  });
});
