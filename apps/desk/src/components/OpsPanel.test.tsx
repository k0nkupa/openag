import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type Api } from "../api";
import { OpsPanel, formatBytes, parseLimit } from "./OpsPanel";

const BACKUPS = {
  enabled: true,
  dir: "/data/backups",
  mirror: false,
  last: { at: 1_700_000_000_000, ok: true, name: "openag-1.db", error: null },
  backups: [{ name: "openag-1.db", bytes: 2048, createdAt: 1_700_000_000_000 }],
};
const OPS = {
  startedAt: 1_700_000_000_000,
  healthcheck: { configured: false, lastOkAt: null, lastError: null },
  logs: { lastRotatedAt: null, rotated: 0 },
};
const SETTINGS = {
  backup: { enabled: false, time: "03:00", keep: 7 },
  limits: { maxTurnsPerBotPerDay: 0, maxUnattendedPerDay: 0 },
};

function makeApi(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getBackups: vi.fn(async () => BACKUPS),
    getOps: vi.fn(async () => OPS),
    getSettings: vi.fn(async () => ({ settings: SETTINGS })),
    runBackup: vi.fn(async () => ({ ok: true, name: "openag-2.db", error: null })),
    putSetting: vi.fn(async (key: string, value: unknown) => ({ key, value })),
    ...overrides,
  } as unknown as Api & {
    runBackup: ReturnType<typeof vi.fn>;
    putSetting: ReturnType<typeof vi.fn>;
    getBackups: ReturnType<typeof vi.fn>;
  };
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

describe("OpsPanel helpers", () => {
  it("formats bytes and parses limits", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(parseLimit("0")).toBe(0);
    expect(parseLimit("100000")).toBe(100000);
    expect(parseLimit("100001")).toBeNull();
    expect(parseLimit("-1")).toBeNull();
    expect(parseLimit("1.5")).toBeNull();
  });
});

describe("OpsPanel backups", () => {
  it("shows the last backup, the list, and the off-machine hint", async () => {
    render(<OpsPanel api={makeApi()} />);
    await flush();
    expect(screen.getByText(/Last backup .*: ok \(openag-1\.db\)\./)).toBeTruthy();
    // The file list sits in the collapsed "Backup files" disclosure.
    fireEvent.click(screen.getByRole("button", { name: /Backup files/ }));
    expect(screen.getByText("openag-1.db")).toBeTruthy();
    expect(screen.getByText(/2\.0 KB/)).toBeTruthy();
    expect(screen.getByText(/OPENAG_BACKUP_DIR/)).toBeTruthy();
    expect(screen.getByText(/not encrypted/)).toBeTruthy();
  });

  it("runs a backup and refreshes the list", async () => {
    const api = makeApi();
    render(<OpsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
    await flush();
    await flush();
    expect(api.runBackup).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Backup created: openag-2.db.")).toBeTruthy();
    expect(api.getBackups).toHaveBeenCalledTimes(2);
  });

  it("explains a 403 from a device", async () => {
    const api = makeApi({ runBackup: vi.fn(async () => { throw new ApiError("forbidden", 403); }) });
    render(<OpsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
    await flush();
    await flush();
    expect(screen.getByText("Only a Full access device can run a backup").closest("[role=\"alert\"]")).toBeTruthy();
  });

  it("shows the daemon error when a backup fails", async () => {
    const api = makeApi({ runBackup: vi.fn(async () => { throw new ApiError("disk full", 500); }) });
    render(<OpsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
    await flush();
    await flush();
    expect(screen.getByText("disk full").closest("[role=\"alert\"]")).toBeTruthy();
  });

  it("saves backup settings through the settings API", async () => {
    const api = makeApi();
    render(<OpsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("switch", { name: /Scheduled backups/ }));
    fireEvent.change(screen.getByLabelText("Copies to keep"), { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "Save backup settings" }));
    await flush();
    await flush();
    expect(api.putSetting).toHaveBeenCalledWith("backup", { enabled: true, time: "03:00", keep: 14 });
    expect(screen.getByRole("status").textContent).toBe("Saved.");
  });

  it("rejects an invalid time without calling the API", async () => {
    const api = makeApi();
    render(<OpsPanel api={api} />);
    await flush();
    // jsdom sanitizes an out-of-range time value to "", which fails the same HH:MM check.
    fireEvent.change(screen.getByLabelText(/Daily time/), { target: { value: "25:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save backup settings" }));
    await flush();
    expect(api.putSetting).not.toHaveBeenCalled();
    expect(screen.getByText("Time must be HH:MM (24-hour).")).toBeTruthy();
  });
});

describe("OpsPanel turn budget", () => {
  it("says the limits are per-day turn counts, not spending", async () => {
    render(<OpsPanel api={makeApi()} />);
    await flush();
    expect(screen.getByText(/Limit model turns per day/)).toBeTruthy();
    expect(screen.getByText(/do not measure spending/)).toBeTruthy();
  });

  it("saves both limits", async () => {
    const api = makeApi();
    render(<OpsPanel api={api} />);
    await flush();
    fireEvent.change(screen.getByLabelText("Turns per bot"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Unattended turns"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
    await flush();
    await flush();
    expect(api.putSetting).toHaveBeenCalledWith("limits", { maxTurnsPerBotPerDay: 50, maxUnattendedPerDay: 5 });
  });

  it("rejects a non-integer limit locally", async () => {
    const api = makeApi();
    render(<OpsPanel api={api} />);
    await flush();
    fireEvent.change(screen.getByLabelText("Turns per bot"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
    await flush();
    expect(api.putSetting).not.toHaveBeenCalled();
    expect(screen.getByText(/whole number from 0 to 100000/)).toBeTruthy();
  });
});

describe("OpsPanel health", () => {
  it("shows the not-configured hint and the counters", async () => {
    render(<OpsPanel api={makeApi()} />);
    await flush();
    expect(screen.getByText("Liveness ping").nextElementSibling?.textContent).toBe("Not configured");
    expect(screen.getByText(/Log rotations/)).toBeTruthy();
  });

  it("shows the last ping error when configured", async () => {
    const api = makeApi({
      getOps: vi.fn(async () => ({ ...OPS, healthcheck: { configured: true, lastOkAt: null, lastError: "HTTP 500" } })),
    });
    render(<OpsPanel api={api} />);
    await flush();
    expect(screen.getByText("Liveness ping").nextElementSibling?.textContent).toBe("Configured");
    expect(screen.getByText("HTTP 500")).toBeTruthy();
  });
});
