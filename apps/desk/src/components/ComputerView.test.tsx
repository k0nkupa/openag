import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "../api";
import { ApiError } from "../api";
import type { ComputerStatus } from "../types";
import { ComputerView } from "./ComputerView";
import { chooseOption, openSelect } from "../test/select";

const base: ComputerStatus = {
  name: "openag-main",
  exists: true,
  state: "running",
  status: "ready",
  image: "ghcr.io/trycua/linux:24.04-slim",
  kind: "container",
  runtime: "gvisor",
  busy: false,
  lastError: null,
};
const absent: ComputerStatus = { ...base, exists: false, state: "absent", status: null, image: null, kind: null, runtime: null };
const stopped: ComputerStatus = { ...base, state: "stopped", status: "stopped" };

function makeApi(overrides: Partial<Record<keyof Api, unknown>> = {}, initial: ComputerStatus = base) {
  return {
    getComputer: vi.fn(async () => initial),
    startComputer: vi.fn(async () => ({ started: true })),
    stopComputer: vi.fn(async () => ({ started: true })),
    destroyComputer: vi.fn(async () => ({ started: true })),
    computerScreenshot: vi.fn(async () => new Blob([new Uint8Array([0x89, 0x50])], { type: "image/png" })),
    getTakeover: vi.fn(async () => ({ active: false })),
    takeControl: vi.fn(async () => ({ viewPath: SECRET_VIEW, expiresAt: Date.now() + 60_000 })),
    handBack: vi.fn(async () => ({})),
    putComputerBackend: vi.fn(async (backend: string) => ({ key: "computer", value: { backend } })),
    ...overrides,
  } as unknown as Api & Record<string, ReturnType<typeof vi.fn>>;
}

const SECRET_VIEW = "/computer/view/viewer/#ticket=SECRETTICKET123";

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

let created: string[];
let revoked: string[];

beforeEach(() => {
  created = [];
  revoked = [];
  let n = 0;
  URL.createObjectURL = vi.fn(() => {
    const u = `blob:shot-${++n}`;
    created.push(u);
    return u;
  });
  URL.revokeObjectURL = vi.fn((u: string) => {
    revoked.push(u);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ComputerView state", () => {
  it("shows Running with image and runtime and the matching buttons", async () => {
    render(<ComputerView api={makeApi()} />);
    await flush();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("ghcr.io/trycua/linux:24.04-slim")).toBeTruthy();
    expect(screen.getByText("gvisor")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take screenshot" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("shows Not created with only Start", async () => {
    render(<ComputerView api={makeApi({}, absent)} />);
    await flush();
    expect(screen.getByText("Not created")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Destroy" })).toBeNull();
  });

  it("shows Stopped with Start and Destroy", async () => {
    render(<ComputerView api={makeApi({}, stopped)} />);
    await flush();
    expect(screen.getByText("Stopped")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Destroy" })).toBeTruthy();
  });

  it("shows Working... while busy and disables the lifecycle buttons", async () => {
    render(<ComputerView api={makeApi({}, { ...base, busy: true })} />);
    await flush();
    expect(screen.getByText("Working...")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("surfaces lastError in an alert", async () => {
    render(<ComputerView api={makeApi({}, { ...stopped, lastError: "resume failed" })} />);
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("resume failed");
  });
});

describe("actions", () => {
  it("Start calls startComputer", async () => {
    const api = makeApi({}, stopped);
    render(<ComputerView api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await flush();
    expect(api.startComputer).toHaveBeenCalledTimes(1);
  });

  it("Stop calls stopComputer", async () => {
    const api = makeApi();
    render(<ComputerView api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await flush();
    expect(api.stopComputer).toHaveBeenCalledTimes(1);
  });

  it("Destroy needs a second confirm, and Cancel backs out", async () => {
    const api = makeApi();
    render(<ComputerView api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Destroy" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.destroyComputer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Destroy" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm destroy" }));
    await flush();
    expect(api.destroyComputer).toHaveBeenCalledTimes(1);
  });

  it("shows the daemon's text when an action is refused (403)", async () => {
    const api = makeApi({ destroyComputer: vi.fn(async () => Promise.reject(new ApiError("owner token required", 403))) });
    render(<ComputerView api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Destroy" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm destroy" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("owner token required");
  });
});

describe("human takeover", () => {
  it("takes control, opens the viewer with noopener, and shows the banner without the ticket", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const api = makeApi({ getTakeover: vi.fn(async () => ({ active: true, by: { kind: "owner" as const }, since: Date.now() - 120_000, idleExpiresAt: Date.now() + 600_000 })) });
    render(<ComputerView api={api} />);
    await flush();
    expect(screen.getByRole("status").textContent).toContain("held by owner");
    expect(screen.queryByRole("button", { name: "Take control" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open viewer" }));
    await flush();
    expect(api.takeControl).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(SECRET_VIEW, "_blank", "noopener");
    expect(document.body.textContent).not.toContain("SECRETTICKET123");
    open.mockRestore();
  });

  it("Take control from an idle running computer opens the viewer", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const api = makeApi();
    render(<ComputerView api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Take control" }));
    await flush();
    expect(open).toHaveBeenCalledWith(SECRET_VIEW, "_blank", "noopener");
    expect(document.body.textContent).not.toContain("SECRETTICKET123");
    open.mockRestore();
  });

  it("the Take control button is absent when the computer is stopped", async () => {
    render(<ComputerView api={makeApi({}, stopped)} />);
    await flush();
    expect(screen.queryByRole("button", { name: "Take control" })).toBeNull();
  });

  it("hand back calls handBack and hides the banner", async () => {
    let active = true;
    const api = makeApi({ getTakeover: vi.fn(async () => (active ? { active: true, by: { kind: "device" as const, name: "phone" } } : { active: false })), handBack: vi.fn(async () => {
      active = false;
      return {};
    }) });
    render(<ComputerView api={api} />);
    await flush();
    expect(screen.getByRole("status").textContent).toContain("held by phone");
    fireEvent.click(screen.getByRole("button", { name: "Hand back" }));
    await flush();
    expect(api.handBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a 409 from takeover inline and opens nothing", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const api = makeApi({ takeControl: vi.fn(async () => Promise.reject(new ApiError("someone else holds control", 409))) });
    render(<ComputerView api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Take control" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("someone else holds control");
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("shows the banner from the poll when another device holds control", async () => {
    vi.useFakeTimers();
    let active = false;
    const api = makeApi({ getTakeover: vi.fn(async () => (active ? { active: true, by: { kind: "device" as const, name: "laptop" }, since: Date.now() } : { active: false })) });
    render(<ComputerView api={api} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole("status")).toBeNull();
    active = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByRole("status").textContent).toContain("held by laptop");
    expect(screen.getByRole("status").textContent).toContain("Agent input is paused");
  });
});

describe("screenshot", () => {
  it("creates a blob URL, shows it, and revokes the previous one on the next shot", async () => {
    const api = makeApi();
    render(<ComputerView api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Take screenshot" }));
    await flush();
    expect(screen.getByAltText("Computer screenshot").getAttribute("src")).toBe("blob:shot-1");
    fireEvent.click(screen.getByRole("button", { name: "Take screenshot" }));
    await flush();
    expect(revoked).toEqual(["blob:shot-1"]);
    expect(screen.getByAltText("Computer screenshot").getAttribute("src")).toBe("blob:shot-2");
  });

  it("shows the error text on 409 and creates no URL", async () => {
    const api = makeApi({ computerScreenshot: vi.fn(async () => Promise.reject(new ApiError("computer is not running", 409))) });
    render(<ComputerView api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Take screenshot" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("computer is not running");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("shows busy text on 503", async () => {
    const api = makeApi({ computerScreenshot: vi.fn(async () => Promise.reject(new ApiError("computer is busy", 503))) });
    render(<ComputerView api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Take screenshot" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("computer is busy");
  });

  it("revokes the last blob URL on unmount", async () => {
    const api = makeApi();
    const { unmount } = render(<ComputerView api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Take screenshot" }));
    await flush();
    unmount();
    expect(revoked).toEqual(["blob:shot-1"]);
  });
});

describe("polling", () => {
  it("polls every 3 s and stops when unmounted", async () => {
    vi.useFakeTimers();
    const api = makeApi();
    const { unmount } = render(<ComputerView api={api} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.getComputer).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(api.getComputer).toHaveBeenCalledTimes(2);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(api.getComputer).toHaveBeenCalledTimes(2);
  });

  it("re-reads about 1 s after an action", async () => {
    vi.useFakeTimers();
    const api = makeApi({}, stopped);
    render(<ComputerView api={api} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const before = (api.getComputer as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect((api.getComputer as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1);
  });
});

const withBackends: ComputerStatus = {
  ...base,
  backend: "cua",
  wantedBackend: "cua",
  capabilities: { shell: true, view: "proxy" },
  backends: [
    { backend: "cua", reason: null },
    { backend: "browserbase", reason: "BROWSERBASE_API_KEY is not set" },
    { backend: "docker", reason: null },
    { backend: "ssh", reason: "no host configured" },
  ],
};

describe("backend section", () => {
  it("disables unconfigured backends and shows their reasons", async () => {
    render(<ComputerView api={makeApi({}, withBackends)} />);
    await flush();
    openSelect(screen.getByRole("combobox"));
    const opt = (name: RegExp) => screen.getByRole("option", { name });
    const disabled = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled");
    expect(disabled(await screen.findByRole("option", { name: /Browserbase/ }))).toBe(true);
    expect(disabled(opt(/Remote box/))).toBe(true);
    expect(disabled(opt(/Cua sandbox/))).toBe(false);
    expect(disabled(opt(/Docker box/))).toBe(false);
    expect(opt(/Browserbase/).textContent).toContain("not configured");
    expect(screen.getByText(/BROWSERBASE_API_KEY is not set/)).toBeTruthy();
    expect(screen.getByText(/no host configured/)).toBeTruthy();
  });

  it("choosing an available backend saves { backend }", async () => {
    const api = makeApi({}, withBackends);
    render(<ComputerView api={api} />);
    await flush();
    await chooseOption(screen.getByRole("combobox"), /Docker box/);
    await flush();
    expect(api.putComputerBackend).toHaveBeenCalledWith("docker");
  });

  it("disables the select while a takeover is active", async () => {
    const api = makeApi({ getTakeover: vi.fn(async () => ({ active: true, by: { kind: "owner" as const } })) }, withBackends);
    render(<ComputerView api={api} />);
    await flush();
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(true);
  });

  it("shows the active backend and a pending switch message", async () => {
    render(<ComputerView api={makeApi({}, { ...withBackends, backend: "cua", wantedBackend: "docker" })} />);
    await flush();
    expect(screen.getByText("Active: Cua sandbox (default)")).toBeTruthy();
    expect(screen.getByText(/Switch pending\. Wait until the computer is idle and nobody has control/)).toBeTruthy();
  });

  it("shows no pending message when backend matches wanted", async () => {
    render(<ComputerView api={makeApi({}, withBackends)} />);
    await flush();
    expect(screen.queryByText(/Switch pending/)).toBeNull();
  });

  it("notes a backend without shell", async () => {
    render(<ComputerView api={makeApi({}, { ...withBackends, capabilities: { shell: false, view: "proxy" } })} />);
    await flush();
    expect(screen.getByText("This backend has no shell: computer_shell is unavailable.")).toBeTruthy();
  });

  it("hides Take control and shows a note for view none", async () => {
    render(<ComputerView api={makeApi({}, { ...withBackends, capabilities: { shell: true, view: "none" } })} />);
    await flush();
    expect(screen.getByText("No live view on this backend.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take control" })).toBeNull();
    expect(screen.getByRole("button", { name: "Take screenshot" })).toBeTruthy();
  });

  it("shows the external hint next to Take control", async () => {
    render(<ComputerView api={makeApi({}, { ...withBackends, capabilities: { shell: true, view: "external" } })} />);
    await flush();
    expect(screen.getByText("Opens the provider's live view in a new tab.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take control" })).toBeTruthy();
  });

  it("opens an external takeover URL with noopener and never renders it", async () => {
    const EXTERNAL = "https://live.example-provider.test/session/abc?token=EXTSECRET987";
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const api = makeApi({ takeControl: vi.fn(async () => ({ viewPath: EXTERNAL, expiresAt: Date.now() + 60_000, external: true })) }, { ...withBackends, capabilities: { shell: true, view: "external" } });
    render(<ComputerView api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Take control" }));
    await flush();
    expect(open).toHaveBeenCalledWith(EXTERNAL, "_blank", "noopener");
    expect(document.body.innerHTML).not.toContain("EXTSECRET987");
    open.mockRestore();
  });

  it("an old-shape status without the new fields still renders with no backend section", async () => {
    render(<ComputerView api={makeApi()} />);
    await flush();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: "Take control" })).toBeTruthy();
  });
});
