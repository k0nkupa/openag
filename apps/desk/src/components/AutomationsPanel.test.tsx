import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type Api } from "../api";
import type { Automation } from "../types";
import { AutomationsPanel } from "./AutomationsPanel";
import { chooseOption, openSelect } from "../test/select";

const AUTO: Automation = {
  id: "auto_1",
  name: "Morning digest",
  scheduleCron: "0 9 * * *",
  tz: null,
  botId: "boss",
  roomId: "main",
  prompt: "Summarise",
  enabled: true,
  allowApprovals: false,
  createdAt: 1,
  updatedAt: 1,
  lastRunAt: null,
  lastStatus: null,
  lastTurnId: null,
  triggerKind: "cron",
  hookSlug: null,
  hookPath: null,
  hookEvents: [],
  outputMode: "room",
  allowTools: false,
  lastVerdict: null,
  hasSecret: false,
  pollRepo: null,
  pollEveryMinutes: null,
  lastPolledAt: null,
  lastPollNew: null,
};

const HOOK: Automation = {
  ...AUTO,
  id: "hook_1",
  name: "Deploy hook",
  scheduleCron: null,
  roomId: null,
  triggerKind: "webhook",
  hookSlug: "h-abc123",
  hookPath: "/hooks/h-abc123",
  outputMode: "wake",
  hasSecret: true,
  lastVerdict: "suppressed",
};

const SECRET = "generated-secret-XYZ-987";

function makeApi(overrides: Partial<Record<keyof Api, unknown>> = {}, list: Automation[] = [AUTO]) {
  return {
    listAutomationRuns: vi.fn(async () => ({ runs: [], nextCursor: null })),
    listAutomations: vi.fn(async () => ({ automations: list })),
    listBots: vi.fn(async () => ({
      bots: [
        { id: "boss", name: "Boss", runtime: "api", model: null },
        { id: "coder", name: "Coder", runtime: "acp", model: null },
      ],
    })),
    listRooms: vi.fn(async () => ({
      rooms: [
        { id: "main", name: "Main", leadBotId: "boss", members: ["boss"] },
        { id: "_heartbeat", name: "heartbeat", leadBotId: "boss", members: ["boss"] },
      ],
    })),
    createAutomation: vi.fn(async (input: unknown) => ({
      automation: { ...AUTO, id: "auto_new", ...(input as object) },
    })),
    updateAutomation: vi.fn(async (id: string, patch: object) => ({ automation: { ...AUTO, id, ...patch } })),
    rotateAutomationSecret: vi.fn(async () => ({ secret: SECRET })),
    deleteAutomation: vi.fn(async () => undefined),
    runAutomation: vi.fn(async () => ({ started: true })),
    // Cron automations cannot be saved until the daemon's schedule preview answers.
    previewAutomationSchedule: vi.fn(async () => ({ evaluatedAt: Date.now(), timezone: "UTC", nextScheduledAt: Date.now() + 3_600_000, state: "scheduled" as const })),
    ...overrides,
  } as unknown as Api & {
    createAutomation: ReturnType<typeof vi.fn>;
    updateAutomation: ReturnType<typeof vi.fn>;
    rotateAutomationSecret: ReturnType<typeof vi.fn>;
    deleteAutomation: ReturnType<typeof vi.fn>;
    runAutomation: ReturnType<typeof vi.fn>;
  };
}

const flush = () => waitFor(() => expect(screen.getByText("Morning digest")).toBeTruthy());

const trigger = () => screen.getByRole("combobox", { name: "Trigger" });
/** Cron forms enable their submit button only after the schedule preview arrives. */
const previewReady = () => waitFor(() => expect((screen.getByRole("button", { name: "Create automation" }) as HTMLButtonElement).disabled).toBe(false));
/** Opens a row's actions menu and activates one item. */
async function rowAction(name: string, item: string) {
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
}
const editRoute = (editId: string) => ({ kind: "automations" as const, tab: "automations" as const, editId });

afterEach(() => cleanup());

describe("AutomationsPanel", () => {
  it("lists automations and hides internal rooms from the room picker", async () => {
    render(<AutomationsPanel api={makeApi()} />);
    await flush();
    expect(screen.getByText("Boss · #Main")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New automation" }));
    openSelect(await screen.findByRole("combobox", { name: "Room" }));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["Main"]);
  });

  it("create sends the form values as the request body", async () => {
    const api = makeApi();
    render(<AutomationsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "New automation" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Inbox check" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Check the inbox" } });
    await previewReady();
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }));
    await waitFor(() => expect(api.createAutomation).toHaveBeenCalledTimes(1));
    expect(api.createAutomation).toHaveBeenCalledWith({
      name: "Inbox check",
      scheduleCron: "0 9 * * *",
      tz: null,
      botId: "boss",
      roomId: "main",
      prompt: "Check the inbox",
      allowApprovals: false,
      enabled: true,
      triggerKind: "cron",
      outputMode: "room",
    });
  });

  it("uses the custom cron input when Custom is chosen", async () => {
    const api = makeApi();
    render(<AutomationsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "New automation" }));
    await chooseOption(await screen.findByRole("combobox", { name: "Schedule" }), "Custom");
    fireEvent.change(screen.getByLabelText("Cron expression"), { target: { value: " */20 * * * * " } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Custom" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "x" } });
    await waitFor(() => expect(api.previewAutomationSchedule).toHaveBeenCalledWith(expect.objectContaining({ scheduleCron: "*/20 * * * *" }), expect.anything()));
    await previewReady();
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }));
    await waitFor(() => expect(api.createAutomation).toHaveBeenCalled());
    expect(api.createAutomation.mock.calls[0]![0]).toMatchObject({ scheduleCron: "*/20 * * * *" });
  });

  it("cron + watch sends outputMode wake and no room", async () => {
    const api = makeApi();
    render(<AutomationsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "New automation" }));
    await chooseOption(await screen.findByRole("combobox", { name: "Output" }), "Notify when needed");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Watcher" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "watch" } });
    await previewReady();
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }));
    await waitFor(() => expect(api.createAutomation).toHaveBeenCalled());
    expect(api.createAutomation.mock.calls[0]![0]).toMatchObject({ outputMode: "wake", roomId: null, triggerKind: "cron" });
  });

  it("a cron automation cannot be saved until its schedule preview is available", async () => {
    const api = makeApi({ previewAutomationSchedule: vi.fn(() => new Promise(() => {})) });
    render(<AutomationsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "New automation" }));
    const create = await screen.findByRole("button", { name: "Create automation" });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    expect(api.createAutomation).not.toHaveBeenCalled();
  });

  it("shows a daemon validation error in an alert", async () => {
    const api = makeApi({
      createAutomation: vi.fn(async () => {
        throw new ApiError("schedule runs more often than every 5 minutes", 400);
      }),
    });
    render(<AutomationsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "New automation" }));
    await screen.findByRole("button", { name: "Create automation" });
    await previewReady();
    fireEvent.click(screen.getByRole("button", { name: "Create automation" }));
    expect((await screen.findByRole("alert")).textContent).toContain("schedule runs more often than every 5 minutes");
  });

  it("the enabled toggle sends PATCH {enabled}", async () => {
    const api = makeApi();
    render(<AutomationsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByLabelText("Enabled: Morning digest"));
    await waitFor(() => expect(api.updateAutomation).toHaveBeenCalledWith("auto_1", { enabled: false }));
  });

  it("run now starts the automation", async () => {
    const api = makeApi();
    render(<AutomationsPanel api={api} />);
    await flush();
    await rowAction("Morning digest", "Run now");
    await waitFor(() => expect(api.runAutomation).toHaveBeenCalledWith("auto_1"));
  });

  it("delete needs a second confirmation", async () => {
    const api = makeApi();
    render(<AutomationsPanel api={api} />);
    await flush();
    await rowAction("Morning digest", "Delete…");
    await screen.findByText("Delete automation?");
    expect(api.deleteAutomation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete automation" }));
    await waitFor(() => expect(api.deleteAutomation).toHaveBeenCalledWith("auto_1"));
  });

  it("the Edit action routes to the automation's editor", async () => {
    render(<AutomationsPanel api={makeApi()} />);
    await flush();
    await rowAction("Morning digest", "Edit");
    expect(window.location.hash).toContain("auto_1");
    window.location.hash = "";
  });
});

describe("AutomationsPanel webhooks and hooks", () => {
  it("hook kinds hide the room picker and the output choice", async () => {
    render(<AutomationsPanel api={makeApi()} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "New automation" }));
    await chooseOption(await screen.findByRole("combobox", { name: "Trigger" }), "Webhook");
    expect(screen.queryByRole("combobox", { name: "Room" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Output" })).toBeNull();
  });

  it("creating a webhook shows the secret once with the full URL, and it disappears after dismiss", async () => {
    const api = makeApi({
      createAutomation: vi.fn(async (input: unknown) => ({
        automation: { ...HOOK, ...(input as object), hookSlug: "h-abc123", hookPath: "/hooks/h-abc123" },
        secret: SECRET,
      })),
    });
    render(<AutomationsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "New automation" }));
    await chooseOption(await screen.findByRole("combobox", { name: "Trigger" }), "Webhook");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Deploy hook" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "handle" } });
    fireEvent.click(screen.getByRole("button", { name: "Create webhook" }));

    const box = await screen.findByLabelText("Webhook secret");
    expect(within(box).getByText("Shown once. It cannot be retrieved later.")).toBeTruthy();
    expect(box.textContent).toContain(`${window.location.origin}/hooks/h-abc123`);
    expect(box.textContent).toContain(SECRET);
    expect(api.createAutomation.mock.calls[0]![0]).toMatchObject({ triggerKind: "webhook", outputMode: "wake", allowApprovals: false });
    expect(api.createAutomation.mock.calls[0]![0]).not.toHaveProperty("roomId");

    fireEvent.click(screen.getByRole("button", { name: "I have saved it" }));
    expect(screen.queryByLabelText("Webhook secret")).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("github create requires events and a secret, and sends both", async () => {
    const api = makeApi();
    render(<AutomationsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "New automation" }));
    await chooseOption(await screen.findByRole("combobox", { name: "Trigger" }), "GitHub");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Repo" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "review" } });
    fireEvent.click(screen.getByRole("button", { name: "Create GitHub automation" }));
    expect((await screen.findByRole("alert")).textContent).toContain("at least one event");
    expect(api.createAutomation).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Events"), { target: { value: " issues, pull_request ,, push " } });
    fireEvent.change(screen.getByLabelText("Signing secret"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Create GitHub automation" }));
    expect((await screen.findByRole("alert")).textContent).toContain("8 to 256 characters");
    expect(api.createAutomation).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Signing secret"), { target: { value: "gh-signing-secret-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create GitHub automation" }));
    await waitFor(() => expect(api.createAutomation).toHaveBeenCalledTimes(1));
    expect(api.createAutomation.mock.calls[0]![0]).toMatchObject({
      triggerKind: "github",
      hookEvents: ["issues", "pull_request", "push"],
      secret: "gh-signing-secret-1",
      outputMode: "wake",
    });
  });

  it("signing secret is a password field and is cleared after submit", async () => {
    const api = makeApi({
      createAutomation: vi.fn(async () => {
        throw new ApiError("bad slug", 400);
      }),
    });
    render(<AutomationsPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "New automation" }));
    await chooseOption(await screen.findByRole("combobox", { name: "Trigger" }), "Slack");
    const secretInput = screen.getByLabelText("Signing secret") as HTMLInputElement;
    expect(secretInput.type).toBe("password");
    fireEvent.change(screen.getByLabelText("Events"), { target: { value: "app_mention" } });
    fireEvent.change(secretInput, { target: { value: "slack-signing-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Slack automation" }));
    await waitFor(() => expect(api.createAutomation).toHaveBeenCalled());
    await screen.findByRole("alert");
    expect((screen.getByLabelText("Signing secret") as HTMLInputElement).value).toBe("");
  });

  it("the list shows the trigger kind and waiting state, offers Rotate secret, and never shows the secret", async () => {
    render(<AutomationsPanel api={makeApi({}, [AUTO, HOOK])} />);
    await waitFor(() => expect(screen.getByText("Deploy hook")).toBeTruthy());
    expect(screen.getByText("Webhook")).toBeTruthy();
    expect(screen.getByText("Waiting for an event")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Actions for Deploy hook" }));
    expect(await screen.findByRole("menuitem", { name: "Rotate secret…" })).toBeTruthy();
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("rotate asks for confirmation, then calls rotateAutomationSecret and shows the new secret once", async () => {
    const api = makeApi({}, [HOOK]);
    render(<AutomationsPanel api={api} />);
    await waitFor(() => expect(screen.getByText("Deploy hook")).toBeTruthy());
    await rowAction("Deploy hook", "Rotate secret…");
    await screen.findByText("Rotate webhook secret?");
    expect(api.rotateAutomationSecret).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Rotate secret" }));
    await waitFor(() => expect(api.rotateAutomationSecret).toHaveBeenCalledWith("hook_1"));
    const box = await screen.findByLabelText("Webhook secret");
    expect(box.textContent).toContain(SECRET);
    fireEvent.click(screen.getByRole("button", { name: "I have saved it" }));
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("a rotate error from the server is shown inline", async () => {
    const api = makeApi(
      {
        rotateAutomationSecret: vi.fn(async () => {
          throw new ApiError("rotate is only for webhook automations", 400);
        }),
      },
      [HOOK],
    );
    render(<AutomationsPanel api={api} />);
    await waitFor(() => expect(screen.getByText("Deploy hook")).toBeTruthy());
    await rowAction("Deploy hook", "Rotate secret…");
    await screen.findByText("Rotate webhook secret?");
    fireEvent.click(screen.getByRole("button", { name: "Rotate secret" }));
    expect((await screen.findByRole("alert")).textContent).toContain("rotate is only for webhook automations");
  });
});

const POLL: Automation = {
  ...AUTO,
  id: "poll_1",
  name: "PR watcher",
  scheduleCron: null,
  roomId: null,
  triggerKind: "github_poll",
  outputMode: "wake",
  hookEvents: ["issues", "pull_request"],
  pollRepo: "owner/name",
  pollEveryMinutes: 60,
  lastPolledAt: Date.now() - 5 * 60_000,
  lastPollNew: 3,
  lastVerdict: "digest",
  hasSecret: true,
};

const POLL_TOKEN = "ghp_0123456789abcdef";

async function fillPollBasics() {
  fireEvent.click(screen.getByRole("button", { name: "New automation" }));
  await chooseOption(await screen.findByRole("combobox", { name: "Trigger" }), "GitHub (polling, no tunnel)");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "PR watcher" } });
  fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "triage" } });
}

describe("AutomationsPanel GitHub polling", () => {
  it("create sends the exact poll body and closes the form", async () => {
    const api = makeApi();
    render(<AutomationsPanel api={api} />);
    await flush();
    await fillPollBasics();
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: " owner/name " } });
    fireEvent.change(screen.getByLabelText("GitHub token"), { target: { value: POLL_TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "Create GitHub poll automation" }));
    await waitFor(() => expect(api.createAutomation).toHaveBeenCalledTimes(1));
    expect(api.createAutomation).toHaveBeenCalledWith({
      name: "PR watcher",
      triggerKind: "github_poll",
      botId: "boss",
      prompt: "triage",
      pollRepo: "owner/name",
      pollEveryMinutes: 15,
      pollToken: POLL_TOKEN,
      hookEvents: ["issues", "issue_comment", "pull_request"],
      allowTools: false,
    });
    await waitFor(() => expect(screen.queryByLabelText("GitHub token")).toBeNull());
  });

  it("the token field is cleared after a failed submit and the interval and events are sent as chosen", async () => {
    const api = makeApi({
      createAutomation: vi.fn(async () => {
        throw new ApiError("token rejected by the daemon", 400);
      }),
    });
    render(<AutomationsPanel api={api} />);
    await flush();
    await fillPollBasics();
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "owner/name" } });
    await chooseOption(screen.getByRole("combobox", { name: "Check every" }), "Every 6 hours");
    fireEvent.click(screen.getByRole("checkbox", { name: "issues" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "push" }));
    fireEvent.change(screen.getByLabelText("GitHub token"), { target: { value: POLL_TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "Create GitHub poll automation" }));
    expect((await screen.findByRole("alert")).textContent).toContain("token rejected by the daemon");
    expect((screen.getByLabelText("GitHub token") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("GitHub token") as HTMLInputElement).type).toBe("password");
    expect(api.createAutomation.mock.calls[0]![0]).toMatchObject({
      pollEveryMinutes: 360,
      hookEvents: ["issue_comment", "pull_request", "push"],
    });
  });

  it("client-side validation blocks a bad repo, no events, and a short token", async () => {
    const api = makeApi();
    render(<AutomationsPanel api={api} />);
    await flush();
    await fillPollBasics();
    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "owner/.." } });
    fireEvent.change(screen.getByLabelText("GitHub token"), { target: { value: POLL_TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "Create GitHub poll automation" }));
    expect((await screen.findByRole("alert")).textContent).toContain("owner/name");

    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "owner/name" } });
    for (const name of ["issues", "issue_comment", "pull_request"]) {
      fireEvent.click(screen.getByRole("checkbox", { name }));
    }
    fireEvent.change(screen.getByLabelText("GitHub token"), { target: { value: POLL_TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "Create GitHub poll automation" }));
    expect((await screen.findByRole("alert")).textContent).toContain("at least one event");

    fireEvent.click(screen.getByRole("checkbox", { name: "push" }));
    fireEvent.change(screen.getByLabelText("GitHub token"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Create GitHub poll automation" }));
    expect((await screen.findByRole("alert")).textContent).toContain("12 to 255 characters");
    expect(api.createAutomation).not.toHaveBeenCalled();
  });

  it("the list row shows the poll repo and trigger without a token; the editor preserves the interval", async () => {
    const view = render(<AutomationsPanel api={makeApi({}, [POLL])} />);
    await waitFor(() => expect(screen.getByText("PR watcher")).toBeTruthy());
    expect(screen.getByText("GitHub polling")).toBeTruthy();
    expect(screen.getByText("owner/name")).toBeTruthy();
    expect(screen.getByText("Schedule unavailable")).toBeTruthy();
    expect(document.body.textContent).not.toContain("ghp_");
    view.rerender(<AutomationsPanel api={makeApi({}, [POLL])} route={editRoute("poll_1")} />);
    expect((await screen.findByRole("combobox", { name: "Check every" })).textContent).toContain("Every hour");
  });

  it("a poll without runtime timing shows schedule unavailable and no new badge", async () => {
    render(<AutomationsPanel api={makeApi({}, [{ ...POLL, lastPolledAt: null, lastPollNew: null }])} />);
    await waitFor(() => expect(screen.getByText("PR watcher")).toBeTruthy());
    expect(screen.getByText("Schedule unavailable")).toBeTruthy();
    expect(screen.queryByText(/new$/)).toBeNull();
  });

  it("run now works for a poll automation", async () => {
    const api = makeApi({}, [POLL]);
    render(<AutomationsPanel api={api} />);
    await waitFor(() => expect(screen.getByText("PR watcher")).toBeTruthy());
    await rowAction("PR watcher", "Run now");
    await waitFor(() => expect(api.runAutomation).toHaveBeenCalledWith("poll_1"));
  });

  it("edit shows the repo and interval, and saving without a token sends no pollToken", async () => {
    const api = makeApi({}, [POLL]);
    render(<AutomationsPanel api={api} route={editRoute("poll_1")} />);
    expect(((await screen.findByLabelText("Repository")) as HTMLInputElement).value).toBe("owner/name");
    expect(screen.getByRole("combobox", { name: "Check every" }).textContent).toContain("Every hour");
    expect((screen.getByLabelText(/GitHub token \(leave blank/) as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Save automation" }));
    await waitFor(() => expect(api.updateAutomation).toHaveBeenCalledTimes(1));
    const [id, input] = api.updateAutomation.mock.calls[0]! as [string, Record<string, unknown>];
    expect(id).toBe("poll_1");
    expect(input).toMatchObject({ pollRepo: "owner/name", pollEveryMinutes: 60, hookEvents: ["issues", "pull_request"] });
    expect(input).not.toHaveProperty("pollToken");
    expect(input).not.toHaveProperty("triggerKind");
  });

  it("a server error on edit is shown inline", async () => {
    const api = makeApi(
      {
        updateAutomation: vi.fn(async () => {
          throw new ApiError("pollRepo must be owner/name", 400);
        }),
      },
      [POLL],
    );
    render(<AutomationsPanel api={api} route={editRoute("poll_1")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save automation" }));
    expect((await screen.findByRole("alert")).textContent).toContain("pollRepo must be owner/name");
  });
});

vi.mock("../stream", () => { const subscribe = () => () => {}; return { useStream: () => ({ subscribe }) }; });
