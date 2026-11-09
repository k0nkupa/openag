import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type Api } from "../api";
import type { SlackStatus } from "../types";
import { SlackPanel, parseUserIds } from "./SlackPanel";

const idle: SlackStatus = { enabled: true, inert: null, connected: true, received: 4, sent: 3, dropped: 1, lastError: null, lastEventAt: null };

function makeApi(status: Partial<SlackStatus> = {}, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getSlackStatus: vi.fn(async () => ({ ...idle, ...status })),
    getSettings: vi.fn(async () => ({
      settings: {
        heartbeat: {},
        slack: { enabled: true, roomId: "main", channelId: "C0123456789", allowedUsers: ["U0123456789", "U0987654321"] },
      },
    })),
    putSlack: vi.fn(async (value: unknown) => ({ key: "slack", value })),
    ...overrides,
  } as unknown as Api & {
    getSlackStatus: ReturnType<typeof vi.fn>;
    putSlack: ReturnType<typeof vi.fn>;
  };
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

describe("parseUserIds", () => {
  it("splits on commas and newlines, trims, drops blanks and duplicates", () => {
    expect(parseUserIds(" U1 , U2\n\nU1,  ,U3 ")).toEqual(["U1", "U2", "U3"]);
  });
});

describe("SlackPanel", () => {
  it("shows Connected, counters and the saved settings", async () => {
    render(<SlackPanel api={makeApi()} />);
    await flush();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Received")).toBeTruthy();
    expect((screen.getByLabelText("Channel id") as HTMLInputElement).value).toBe("C0123456789");
    expect((screen.getByLabelText("Allowed Slack user ids") as HTMLTextAreaElement).value).toBe("U0123456789\nU0987654321");
    expect(screen.getByText(/SLACK_APP_TOKEN/)).toBeTruthy();
  });

  it("shows the inert reason and last error as text", async () => {
    render(<SlackPanel api={makeApi({ connected: false, inert: "SLACK_BOT_TOKEN is not set", lastError: "socket closed" })} />);
    await flush();
    expect(screen.getByText("SLACK_BOT_TOKEN is not set")).toBeTruthy();
    expect(screen.getByText("socket closed")).toBeTruthy();
  });

  it("saves parsed user ids and blank ids as null", async () => {
    const api = makeApi();
    render(<SlackPanel api={api} />);
    await flush();
    fireEvent.change(screen.getByLabelText("Room id"), { target: { value: "  " } });
    fireEvent.change(screen.getByLabelText("Allowed Slack user ids"), { target: { value: "U1, U2\nU2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Slack settings" }));
    await flush();
    await flush();
    expect(api.putSlack).toHaveBeenCalledWith({ enabled: true, roomId: null, channelId: "C0123456789", allowedUsers: ["U1", "U2"] });
    expect(screen.getByRole("status").textContent).toBe("Saved.");
  });

  it("maps a 403 to the owner-only message", async () => {
    const api = makeApi({}, { putSlack: vi.fn(async () => { throw new ApiError("owner only", 403); }) });
    render(<SlackPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Save Slack settings" }));
    await flush();
    await flush();
    expect(screen.getByRole("alert").textContent).toBe("Only a Full access device can change Slack settings");
  });

  it("shows the daemon's 400 message", async () => {
    const api = makeApi({}, { putSlack: vi.fn(async () => { throw new ApiError("channelId must look like C0123456789", 400); }) });
    render(<SlackPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Save Slack settings" }));
    await flush();
    await flush();
    expect(screen.getByRole("alert").textContent).toBe("channelId must look like C0123456789");
  });
});
