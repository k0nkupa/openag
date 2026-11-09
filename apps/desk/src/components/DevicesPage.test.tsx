import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Api } from "../api";
import { DevicesPage } from "./DevicesPage";

function makeApi(who: unknown, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    whoami: vi.fn(async () => who),
    health: vi.fn(async () => ({ ok: true, vec_version: "v0" })),
    listDevices: vi.fn(async () => ({ devices: [] })),
    listBots: vi.fn(async () => ({ bots: [] })),
    getSettings: vi.fn(async () => ({
      settings: {
        heartbeat: { enabled: false, everyMinutes: 60, botId: null, prompt: null },
        activeHours: { start: "07:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6] },
        wake: { dailyPingBudget: 3, dedupeHours: 24, urgencyThreshold: "normal" },
        brief: { enabled: true, time: "07:30", days: [0, 1, 2, 3, 4, 5, 6] },
      },
    })),
    revokeDevice: vi.fn(async () => undefined),
    getMcpServers: vi.fn(async () => ({ servers: [], configPath: null })),
    listSkills: vi.fn(async () => ({ skills: [] })),
    listApps: vi.fn(async () => ({ apps: [], appsDir: "/data/apps" })),
    listRooms: vi.fn(async () => ({ rooms: [] })),
    getRouterStrategies: vi.fn(async () => ({ strategies: [] })),
    getSlackStatus: vi.fn(async () => ({ enabled: false, inert: "disabled", connected: false, received: 0, sent: 0, dropped: 0, lastError: null, lastEventAt: null })),
    getRtcStatus: vi.fn(async () => ({ enabled: false, inert: "disabled", subscribed: false, peers: 0, offers: 0, rejected: 0, lastError: null })),
    getComputer: vi.fn(async () => ({ name: "openag-main", exists: false, state: "absent", status: null, image: null, kind: null, runtime: null, busy: false, lastError: null })),
    getBackups: vi.fn(async () => ({ enabled: false, dir: "/data/backups", mirror: false, last: null, backups: [] })),
    getOps: vi.fn(async () => ({ startedAt: 0, healthcheck: { configured: false, lastOkAt: null, lastError: null }, logs: { lastRotatedAt: null, rotated: 0 } })),
    getReadiness: vi.fn(async () => ({ ready: true, items: [] })),
    getReflection: vi.fn(async () => ({ setting: { enabled: false, time: "03:30", botId: null, lookbackHours: 24, maxMemoryProposals: 5, maxSkillProposals: 3 }, running: false, runs: [] })),
    ...overrides,
  } as unknown as Api & { revokeDevice: ReturnType<typeof vi.fn> };
}

const flush = () => act(async () => { await Promise.resolve(); });

describe("DevicesPage sign out", () => {
  it("revokes this device on the daemon before signing out", async () => {
    const api = makeApi({ kind: "device", deviceId: "me", name: "Mac" });
    const onSignOut = vi.fn();
    render(<DevicesPage api={api} onSignOut={onSignOut} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await flush();
    await flush();
    expect(api.revokeDevice).toHaveBeenCalledWith("me");
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("still signs out locally when the daemon is unreachable", async () => {
    const api = makeApi({ kind: "device", deviceId: "me", name: "Mac" }, { revokeDevice: vi.fn(async () => { throw new Error("offline"); }) });
    const onSignOut = vi.fn();
    render(<DevicesPage api={api} onSignOut={onSignOut} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await flush();
    await flush();
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("does not call revoke for the owner token", async () => {
    const api = makeApi({ kind: "owner" });
    const onSignOut = vi.fn();
    render(<DevicesPage api={api} onSignOut={onSignOut} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await flush();
    await flush();
    expect(api.revokeDevice).not.toHaveBeenCalled();
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
