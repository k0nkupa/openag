import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type Api, type Device } from "../api";
import { DevicesPanel, relativeTime } from "./DevicesPanel";
import { chooseOption } from "../test/select";

const NOW = Date.parse("2026-10-27T12:00:00Z");

function device(overrides: Partial<Device> = {}): Device {
  return { id: "d1", name: "Mac browser", createdAt: NOW - 86_400_000, lastSeenAt: null, revokedAt: null, createdBy: "owner", access: "limited", current: false, ...overrides };
}

function makeApi(devices: Device[], overrides: Partial<Record<keyof Api, unknown>> = {}) {
  return {
    listDevices: vi.fn(async () => ({ devices })),
    revokeDevice: vi.fn(async () => undefined),
    createPairingCode: vi.fn(async () => ({ code: "ABCD-2345", expiresAt: Date.now() + 300_000 })),
    ...overrides,
  } as unknown as Api & {
    listDevices: ReturnType<typeof vi.fn>;
    revokeDevice: ReturnType<typeof vi.fn>;
    createPairingCode: ReturnType<typeof vi.fn>;
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function openRemoval(index = 0) {
  const controls = await screen.findAllByRole("button", { name: /^Manage / });
  fireEvent.click(controls[index]!);
  fireEvent.click(screen.getByRole("button", { name: "Remove access" }));
}

async function openPairing() {
  fireEvent.click(await screen.findByRole("button", { name: "Pair device" }));
}

describe("relativeTime", () => {
  it("formats never, just now, minutes, hours and days", () => {
    expect(relativeTime(null, NOW)).toBe("never");
    expect(relativeTime(NOW - 20_000, NOW)).toBe("just now");
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe("5 min ago");
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3 h ago");
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2 d ago");
  });
});

describe("DevicesPanel", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("lists devices with status, this-device badge and relative last-seen", async () => {
    const api = makeApi([
      device({ id: "d1", name: "Mac browser", lastSeenAt: Date.now() - 5 * 60_000, current: true }),
      device({ id: "d2", name: "Old phone", revokedAt: Date.now() - 1000 }),
    ]);
    render(<DevicesPanel api={api} identity={{ kind: "owner" }} onSignOut={vi.fn()} />);
    expect(await screen.findByText("Mac browser")).toBeTruthy();
    expect(screen.getByText("This device")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Active devices" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Revoked devices/ }));
    expect(screen.getByText("Revoked")).toBeTruthy();
    expect(screen.getByText(/Last seen 5 min ago/)).toBeTruthy();
    // Revoked rows have no revoke action.
    expect(screen.getAllByRole("button", { name: /^Manage / })).toHaveLength(1);
  });

  it("calls revokeDevice only after the inline confirm", async () => {
    const api = makeApi([device({ id: "d9", name: "Laptop" })]);
    render(<DevicesPanel api={api} identity={{ kind: "owner" }} onSignOut={vi.fn()} />);
    await openRemoval();
    expect(api.revokeDevice).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("button", { name: "Remove device" })).toBeNull();

    await openRemoval();
    fireEvent.click(screen.getByRole("button", { name: "Remove device" }));
    await flush();
    expect(api.revokeDevice).toHaveBeenCalledWith("d9", { cascade: true });
  });

  it("shows who added a device and offers to revoke the devices it added too", async () => {
    const api = makeApi([
      device({ id: "a", name: "Stolen phone" }),
      device({ id: "b", name: "Mystery tablet", createdBy: "a" }),
      device({ id: "c", name: "Old one", createdBy: "a", revokedAt: NOW - 1000 }),
    ]);
    render(<DevicesPanel api={api} identity={{ kind: "owner" }} onSignOut={vi.fn()} />);
    await flush();
    expect(screen.getAllByText(/Added by Stolen phone/)).toHaveLength(1); // b and the already-revoked c
    // Revoke the parent: the checkbox counts only ACTIVE descendants (b), default on.
    await openRemoval();
    const box = screen.getByRole("switch");
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Also remove 1 device it added/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove device" }));
    await flush();
    expect(api.revokeDevice).toHaveBeenCalledWith("a", { cascade: true });
  });

  it("can revoke only the one device by unticking the cascade box", async () => {
    const api = makeApi([device({ id: "a", name: "P" }), device({ id: "b", name: "Q", createdBy: "a" })]);
    render(<DevicesPanel api={api} identity={{ kind: "owner" }} onSignOut={vi.fn()} />);
    await flush();
    await openRemoval();
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Remove device" }));
    await flush();
    expect(api.revokeDevice).toHaveBeenCalledWith("a", { cascade: false });
  });

  it("offers no cascade box for a device that added nothing", async () => {
    const api = makeApi([device({ id: "a", name: "Solo" })]);
    render(<DevicesPanel api={api} identity={{ kind: "owner" }} onSignOut={vi.fn()} />);
    await openRemoval();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("signs out when the current device is revoked", async () => {
    const api = makeApi([device({ id: "me", name: "This one", current: true })]);
    const onSignOut = vi.fn();
    render(<DevicesPanel api={api} identity={{ kind: "owner" }} onSignOut={onSignOut} />);
    await openRemoval();
    fireEvent.click(screen.getByRole("button", { name: "Remove device" }));
    await flush();
    expect(api.revokeDevice).toHaveBeenCalledWith("me", { cascade: true });
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("shows a pairing code with a live countdown, then an expired state", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
    const api = makeApi([], {
      createPairingCode: vi.fn(async () => ({ code: "ABCD-2345", expiresAt: NOW + 300_000 })),
    });
    render(<DevicesPanel api={api} identity={{ kind: "owner" }} onSignOut={vi.fn()} />);
    await flush();
    await openPairing();
    fireEvent.click(screen.getByRole("button", { name: "Create pairing code" }));
    await flush();

    expect(screen.getByLabelText("Pairing code").textContent).toBe("ABCD-2345");
    expect(screen.getByRole("timer").textContent).toBe("Expires in 5:00");
    expect(screen.getByText(/Valid for 5 minutes, one use\./)).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole("timer").textContent).toBe("Expires in 4:59");

    await act(async () => {
      vi.advanceTimersByTime(300_000);
    });
    expect(screen.getByText("This code has expired. Create a new code to continue.")).toBeTruthy();
    expect(screen.queryByLabelText("Pairing code")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create a new code" }));
    await flush();
    expect(api.createPairingCode).toHaveBeenCalledTimes(2);
  });

  it("explains a 429 on pairing-code creation", async () => {
    const api = makeApi([], {
      createPairingCode: vi.fn(async () => {
        throw new ApiError("too many active pairing codes", 429);
      }),
    });
    render(<DevicesPanel api={api} identity={{ kind: "owner" }} onSignOut={vi.fn()} />);
    await openPairing();
    fireEvent.click(screen.getByRole("button", { name: "Create pairing code" }));
    expect(await screen.findByText(/Too many active pairing codes/)).toBeTruthy();
  });
});

describe("DevicesPanel access", () => {
  it("shows each device's access and lets the owner switch it", async () => {
    const setDeviceAccess = vi.fn(async () => ({ id: "d1", access: "full" as const }));
    const api = makeApi([device()], { setDeviceAccess });
    render(<DevicesPanel api={api} identity={{ kind: "owner" }} onSignOut={() => {}} />);
    await screen.findByText("Limited");
    fireEvent.click(screen.getByRole("button", { name: /^Manage / }));
    await chooseOption(screen.getByRole("combobox", { name: "Access" }), "Full access");
    fireEvent.click(screen.getByRole("button", { name: "Save access" }));
    await waitFor(() => expect(setDeviceAccess).toHaveBeenCalledWith("d1", "full"));
  });

  it("creates a pairing code with the chosen access", async () => {
    const createPairingCode = vi.fn(async () => ({ code: "ABCD-2345", expiresAt: Date.now() + 300_000 }));
    const api = makeApi([], { createPairingCode });
    render(<DevicesPanel api={api} identity={{ kind: "owner" }} onSignOut={() => {}} />);
    await openPairing();
    await chooseOption(await screen.findByRole("combobox", { name: "Access for the new device" }), "Full access");
    fireEvent.click(screen.getByRole("button", { name: "Create pairing code" }));
    await waitFor(() => expect(createPairingCode).toHaveBeenCalledWith("full"));
  });
});
