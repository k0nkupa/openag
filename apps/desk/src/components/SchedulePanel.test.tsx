import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type Api } from "../api";
import type { DaemonSettings } from "../types";
import { SchedulePanel } from "./SchedulePanel";
import { chooseOption } from "../test/select";

const DEFAULTS: DaemonSettings = {
  heartbeat: { enabled: false, everyMinutes: 60, botId: null, prompt: null },
  activeHours: { start: "07:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6] },
  wake: { dailyPingBudget: 3, dedupeHours: 24, urgencyThreshold: "normal" },
  brief: { enabled: true, time: "07:30", days: [0, 1, 2, 3, 4, 5, 6] },
};

function makeApi(settings: DaemonSettings = DEFAULTS, overrides: Partial<Record<string, unknown>> = {}) {
  let stored = structuredClone(settings);
  return {
    getSettings: vi.fn(async () => ({ settings: stored })),
    listBots: vi.fn(async () => ({
      bots: [
        { id: "boss", name: "Boss", runtime: "api", model: null, isDefault: true },
        { id: "coder", name: "Coder", runtime: "acp", model: null },
      ],
    })),
    putSetting: vi.fn(async (key: string, value: unknown) => { stored = { ...stored, [key]: value }; return { key, value }; }),
    getDigest: vi.fn(async () => ({
      items: [{ id: 1, ts: 1, botId: "boss", text: "x", dedupeKey: "k" }],
    })),
    sendBriefNow: vi.fn(async () => ({ sent: true })),
    getWakeDecisions: vi.fn(async () => ({
      decisions: [
        {
          id: 2,
          ts: Date.parse("2026-10-27T09:00:00Z"),
          source: "heartbeat",
          botId: "boss",
          verdict: "ping",
          urgency: "high",
          dedupeKey: "deploy",
          reason: "Deploy failed <b>now</b>",
          decision: "digest",
          suppressedBy: "budget",
        },
      ],
    })),
    ...overrides,
  } as unknown as Api & {
    getSettings: ReturnType<typeof vi.fn>;
    putSetting: ReturnType<typeof vi.fn>;
  };
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

/** A day toggle inside one of the two day groups ("Notification days" or "Brief days"). */
const dayButton = (group: string, day: string) =>
  within(screen.getAllByRole("group", { name: group }).find((g) => g.querySelector("button"))!).getByRole("button", { name: day });

describe("SchedulePanel", () => {
  it("shows the defaults when nothing is configured", async () => {
    render(<SchedulePanel api={makeApi()} />);
    await flush();
    expect(screen.getByRole("switch", { name: "Enable scheduled checks" }).getAttribute("aria-checked")).toBe("false");
    expect((screen.getByLabelText("Check every (minutes)") as HTMLInputElement).value).toBe("60");
    expect(screen.getByRole("combobox", { name: "Agent" }).textContent).toContain("Default bot (Boss)");
    expect((screen.getByLabelText("Notification hours start") as HTMLInputElement).value).toBe("07:00");
    expect((screen.getByLabelText("Notification hours end") as HTMLInputElement).value).toBe("22:00");
    for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      expect(dayButton("Notification days", day).getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("shows the waiting digest count and sends the brief now with a result note", async () => {
    const api = makeApi(DEFAULTS, { sendBriefNow: vi.fn(async () => ({ sent: false, reason: "empty" })) });
    render(<SchedulePanel api={api} />);
    await flush();
    expect(screen.getByText("Waiting digest items: 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send brief now" }));
    await flush();
    await flush();
    expect(api.sendBriefNow).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toBe("Nothing to send.");
  });

  it("saves the brief settings with the schedule", async () => {
    const api = makeApi();
    render(<SchedulePanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("switch", { name: "Enable morning brief" }));
    fireEvent.change(screen.getByLabelText("Brief time"), { target: { value: "08:15" } });
    fireEvent.click(dayButton("Brief days", "Sat"));
    fireEvent.click(screen.getByRole("button", { name: "Save morning brief" }));
    await flush();
    await flush();
    expect(api.putSetting).toHaveBeenCalledWith("brief", { enabled: false, time: "08:15", days: [0, 1, 2, 3, 4, 5] });
  });

  it("toggling the heartbeat and saving sends the right bodies", async () => {
    const api = makeApi();
    render(<SchedulePanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("switch", { name: "Enable scheduled checks" }));
    fireEvent.change(screen.getByLabelText("Check every (minutes)"), { target: { value: "15" } });
    await chooseOption(screen.getByRole("combobox", { name: "Agent" }), "Coder");
    fireEvent.change(screen.getByLabelText("Notification hours start"), { target: { value: "08:30" } });
    fireEvent.click(dayButton("Notification days", "Sat"));
    fireEvent.click(screen.getByRole("button", { name: "Save checking frequency" }));
    await flush();
    await flush();

    expect(api.putSetting).toHaveBeenNthCalledWith(1, "heartbeat", {
      enabled: true,
      everyMinutes: 15,
      botId: "coder",
      prompt: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save notification hours" }));
    await flush();
    expect(api.putSetting).toHaveBeenNthCalledWith(2, "activeHours", {
      start: "08:30",
      end: "22:00",
      days: [0, 1, 2, 3, 4, 5],
    });
    expect(screen.getAllByRole("status").map(node => node.textContent)).toEqual(["Saved.", "Saved."]);
  });

  it("the default bot option saves botId as null and keeps the stored prompt", async () => {
    const api = makeApi({ ...DEFAULTS, heartbeat: { ...DEFAULTS.heartbeat, botId: "boss", prompt: "custom" } });
    render(<SchedulePanel api={api} />);
    await flush();
    const agent = screen.getByRole("combobox", { name: "Agent" });
    expect(agent.textContent).toContain("Boss");
    await chooseOption(agent, "Default bot (Boss)");
    expect(screen.queryByRole("option", { name: /Lead bot/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save checking frequency" }));
    await flush();
    await flush();
    expect(api.putSetting.mock.calls[0]).toEqual(["heartbeat", { enabled: false, everyMinutes: 60, botId: null, prompt: "custom" }]);
  });

  it("an out-of-range interval shows an inline error and sends nothing", async () => {
    const api = makeApi();
    render(<SchedulePanel api={api} />);
    await flush();
    fireEvent.change(screen.getByLabelText("Check every (minutes)"), { target: { value: "2" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save checking frequency" }).closest("form")!);
    await flush();
    expect(screen.getByText(/5 to 1440/)).toBeTruthy();
    expect(api.putSetting).not.toHaveBeenCalled();
  });

  it("a daemon validation error is shown and the second save is not attempted", async () => {
    const api = makeApi(DEFAULTS, {
      putSetting: vi.fn(async () => {
        throw new ApiError("everyMinutes: Too small", 400);
      }),
    });
    render(<SchedulePanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Save checking frequency" }));
    await flush();
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("everyMinutes: Too small");
    expect(api.putSetting).toHaveBeenCalledTimes(1);
  });

  it("shows a load error when settings cannot be read", async () => {
    const api = makeApi(DEFAULTS, { getSettings: vi.fn(async () => { throw new Error("offline"); }) });
    render(<SchedulePanel api={api} />);
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("offline");
  });

  it("shows recent wake decisions as text with the downgrade reason", async () => {
    render(<SchedulePanel api={makeApi()} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Recent notification decisions" }));
    expect(screen.getByText("digest")).toBeTruthy();
    expect(screen.getByText("downgraded: budget")).toBeTruthy();
    expect(screen.getByText("deploy")).toBeTruthy();
    expect(screen.getByText("Deploy failed <b>now</b>")).toBeTruthy();
    expect(document.querySelector("b")).toBeNull();
  });

  it("saves the wake settings and refreshes the decisions", async () => {
    const api = makeApi();
    render(<SchedulePanel api={api} />);
    await flush();
    fireEvent.change(screen.getByLabelText("Daily notification limit"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Suppress repeated alerts (hours)"), { target: { value: "12" } });
    await chooseOption(screen.getByRole("combobox", { name: "Minimum urgency" }), "High");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save notification limits" }));
    });
    await flush();
    expect(api.putSetting).toHaveBeenCalledWith("wake", { dailyPingBudget: 5, dedupeHours: 12, urgencyThreshold: "high" });
    expect(api.getWakeDecisions).toHaveBeenCalledTimes(2);
  });

  it("rejects a daily ping budget above 50 without saving", async () => {
    const api = makeApi();
    render(<SchedulePanel api={api} />);
    await flush();
    fireEvent.change(screen.getByLabelText("Daily notification limit"), { target: { value: "51" } });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Save notification limits" }).closest("form")!);
    });
    expect(screen.getByRole("alert").textContent).toContain("Budget must be 0–50");
    expect(api.putSetting).not.toHaveBeenCalled();
  });
});
