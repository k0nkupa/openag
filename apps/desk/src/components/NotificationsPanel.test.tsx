import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Api } from "../api";
import { ApiError } from "../api";
import { NotificationsPanel } from "./NotificationsPanel";

const TOPIC = "openag-abcdefghijklmnopqrstuv";
const status = { enabled: true, configured: true, sentThisHour: 2, dropped: 1, lastSentAt: null, lastError: null };

function makeApi(push: Record<string, unknown> | null = null, overrides: Partial<Record<string, unknown>> = {}) {
  let stored = push;
  return {
    getSettings: vi.fn(async () => ({
      settings: {
        heartbeat: {},
        activeHours: {},
        wake: {},
        brief: {},
        ...(stored ? { push: stored } : {}),
      },
    })),
    getPushStatus: vi.fn(async () => status),
    putSetting: vi.fn(async (_key: string, value: Record<string, unknown>) => { stored = value; return { key: "push", value }; }),
    generatePushTopic: vi.fn(async () => ({ topic: TOPIC })),
    sendPushTest: vi.fn(async () => ({ ok: true })),
    ...overrides,
  } as unknown as Api & {
    putSetting: ReturnType<typeof vi.fn>;
    generatePushTopic: ReturnType<typeof vi.fn>;
    sendPushTest: ReturnType<typeof vi.fn>;
  };
}

const flush = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

describe("NotificationsPanel", () => {
  it("shows the public-service notice and defaults to off with no details", async () => {
    render(<NotificationsPanel api={makeApi()} />);
    await flush();
    expect(screen.getByText(/ntfy.sh is a public service/)).toBeTruthy();
    expect((screen.getByRole("switch", { name: /Enable push notifications/ })).getAttribute("aria-checked")).toBe("false");
    expect((screen.getByRole("switch", { name: /Include details in pings/ })).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Off: notifications only say that something needs you.")).toBeTruthy();
  });

  it("saves the form to PUT /settings/push with the stored topic", async () => {
    const api = makeApi({ enabled: false, server: "https://ntfy.sh", topic: TOPIC, publicUrl: null, includeDetail: false, maxPerHour: 20 });
    render(<NotificationsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("switch", { name: /Enable push notifications/ }));
    fireEvent.change(screen.getByLabelText(/Public URL/), { target: { value: "https://mini.tailnet.ts.net" } });
    fireEvent.change(screen.getByLabelText(/Max notifications per hour/), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save notifications" }));
    await flush();
    expect(api.putSetting).toHaveBeenCalledWith("push", {
      enabled: true,
      server: "https://ntfy.sh",
      topic: TOPIC,
      publicUrl: "https://mini.tailnet.ts.net",
      includeDetail: false,
      maxPerHour: 5,
    });
    expect(screen.getByText("Saved.")).toBeTruthy();
  });

  it("generating a topic shows it once and offers a copy button", async () => {
    const api = makeApi();
    render(<NotificationsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Generate topic" }));
    await flush();
    expect(api.generatePushTopic).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Topic").textContent).toBe(TOPIC);
    expect(screen.getByText("Install the ntfy app and subscribe to this topic.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("regenerating is two-step: confirm, then replace", async () => {
    const api = makeApi({ enabled: true, server: "https://ntfy.sh", topic: TOPIC, publicUrl: null, includeDetail: false, maxPerHour: 20 });
    render(<NotificationsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Generate a new topic" }));
    expect(api.generatePushTopic).not.toHaveBeenCalled();
    expect(screen.getByText(/Devices subscribed to the old one/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.generatePushTopic).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Generate a new topic" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace topic" }));
    await flush();
    expect(api.generatePushTopic).toHaveBeenCalledTimes(1);
  });

  it("send test shows the result", async () => {
    const api = makeApi({ enabled: true, server: "https://ntfy.sh", topic: TOPIC, publicUrl: null, includeDetail: false, maxPerHour: 20 });
    render(<NotificationsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    await flush();
    expect(api.sendPushTest).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Test sent. Check your phone.")).toBeTruthy();
  });

  it("send test shows a failure reason", async () => {
    const api = makeApi(null, { sendPushTest: vi.fn(async () => ({ ok: false, reason: "HTTP 500" })) });
    render(<NotificationsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    await flush();
    expect(screen.getByText("Test not sent: HTTP 500.")).toBeTruthy();
  });

  it("a daemon error from the test goes to the alert region", async () => {
    const api = makeApi(null, {
      sendPushTest: vi.fn(async () => {
        throw new ApiError("push is not enabled or has no topic", 409);
      }),
    });
    render(<NotificationsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toBe("push is not enabled or has no topic");
  });

  it("shows the status line from GET /push/status", async () => {
    render(<NotificationsPanel api={makeApi()} />);
    await flush();
    expect(screen.getByText(/Sent this hour: 2\. Dropped: 1\. Last error: none\./)).toBeTruthy();
  });
});
