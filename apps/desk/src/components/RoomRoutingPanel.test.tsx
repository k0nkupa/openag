import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type Api } from "../api";
import type { Room, RouterOption, RoutingInput } from "../types";
import { RoomRoutingPanel } from "./RoomRoutingPanel";
import { chooseOption } from "../test/select";

// cmdk (the model selector list) needs these browser APIs, which jsdom lacks.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.scrollIntoView ??= () => {};

const strategies: RouterOption[] = [
  { strategy: "lead", reason: null, providers: [] },
  { strategy: "jev", reason: "OPENROUTER_API_KEY is not set", providers: [{ id: "typesafe", name: "Typesafe" }, { id: "openrouter", name: "OpenRouter", configured: false }] },
  { strategy: "openai-decision", reason: null, providers: [{ id: "openai", name: "OpenAI" }, { id: "openrouter", name: "OpenRouter" }] },
  { strategy: "cheap-same-model", reason: null, providers: [{ id: "google", name: "Google" }, { id: "groq", name: "Groq" }] },
];
function fixture() {
  let rooms: Room[] = [{ id: "main", name: "Main", leadBotId: "boss", members: ["boss", "coder"], router: "lead", routerRevision: "initial" }, { id: "_system", name: "Hidden", leadBotId: null, members: [] }];
  const api = {
    listRooms: vi.fn(async () => ({ rooms })),
    getRouterStrategies: vi.fn(async () => ({ strategies })),
    discoverRoomRouter: vi.fn(async (_room: string, input: { provider: string }) => ({ target: input.provider, model: `${input.provider}/fixture`, models: [{ id: `${input.provider}/fixture`, name: "Fixture" }], reasoning: {}, controls: [], revision: "initial", snapshotId: "snapshot", source: "Controlled provider model list", reason: null })),
    setRoomRouting: vi.fn(async (_id: string, input: RoutingInput) => {
      rooms = [{ ...rooms[0], router: input.strategy, routerConfig: input.provider ? { provider: input.provider, model: input.model!, reasoning: input.reasoning! } : null, routerRevision: "saved" }];
      return { room: rooms[0] };
    }),
  };
  return { api, typed: api as unknown as Api };
}
const routing = () => screen.getByRole("combobox", { name: "Routing for Main" });
const modelButton = () => screen.getByRole("button", { name: /^Model:/ });
async function chooseJev(api: Api) {
  render(<RoomRoutingPanel api={api} />);
  await screen.findByText("Main");
  await chooseOption(routing(), "Jev");
  await waitFor(() => expect(modelButton().hasAttribute("disabled")).toBe(false));
  fireEvent.click(modelButton());
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "Fixture" }));
  // The selected model is confirmed once the review choices load and Save becomes available.
  await waitFor(() => expect((screen.getByRole("button", { name: "Save routing for Main" }) as HTMLButtonElement).disabled).toBe(false));
}
describe("RoomRoutingPanel", () => {
  it("lists models from every configured compatible provider in one selector and saves after explicit review", async () => {
    const { api, typed } = fixture();
    render(<RoomRoutingPanel api={typed} />);
    await screen.findByText("Main");
    expect(screen.queryByText("Hidden")).toBeNull();
    expect(screen.queryByRole("button", { name: /Refresh/ })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /Provider/ })).toBeNull();
    await chooseOption(routing(), "Chat model");
    await waitFor(() => expect(api.discoverRoomRouter).toHaveBeenCalledTimes(2));
    expect(api.discoverRoomRouter.mock.calls.map(c => (c[1] as { provider: string }).provider).sort()).toEqual(["google", "groq"]);
    await waitFor(() => expect(modelButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(modelButton());
    expect(await screen.findAllByRole("menuitemradio", { name: "Fixture" })).toHaveLength(2);
    expect(screen.getByText("Google")).toBeTruthy();
    expect(screen.getByText("Groq")).toBeTruthy();
    expect(api.setRoomRouting).not.toHaveBeenCalled();
  });
  it("skips providers that are not configured, and saves the chosen provider and model", async () => {
    const { api, typed } = fixture();
    await chooseJev(typed);
    expect(api.discoverRoomRouter.mock.calls.some(c => (c[1] as { provider: string }).provider === "openrouter")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save routing for Main" }));
    await screen.findByText(/Saved\. Service acceptance/);
    expect(api.setRoomRouting).toHaveBeenCalledWith("main", expect.objectContaining({ strategy: "jev", reasoning: {}, revision: "initial", snapshotId: "snapshot" }));
  });
  it("keeps the draft and reports a rejected owner action", async () => {
    const { api, typed } = fixture(); api.setRoomRouting.mockRejectedValue(new ApiError("forbidden", 403));
    await chooseJev(typed);
    fireEvent.click(screen.getByRole("button", { name: "Save routing for Main" }));
    await screen.findByText("Only the owner can change routing.");
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("recovers an uncertain save by readback without a retry", async () => {
    const { api, typed } = fixture(); const save = api.setRoomRouting.getMockImplementation()!;
    api.setRoomRouting.mockImplementation(async (...args) => { await save(...args); throw new Error("lost response"); });
    await chooseJev(typed); fireEvent.click(screen.getByRole("button", { name: "Save routing for Main" }));
    await screen.findByText("Save confirmed by readback. No retry was sent.");
    expect(api.setRoomRouting).toHaveBeenCalledTimes(1);
  });
  it("cancel restores the stored configuration", async () => {
    const { typed } = fixture(); await chooseJev(typed);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(routing().textContent).toContain("Room lead"));
    expect(screen.queryByRole("button", { name: /^Model:/ })).toBeNull();
  });
});

it("recovers room controls when routing availability refreshes after an initial failure", async () => {
  const { api, typed } = fixture();
  api.getRouterStrategies.mockRejectedValueOnce(Error("Temporary routing failure"));
  const view = render(<RoomRoutingPanel api={typed} />);
  await screen.findByText(/Temporary routing failure/);
  view.rerender(<RoomRoutingPanel api={typed} routerOptions={strategies} />);
  await screen.findByText("Main");
  expect(routing()).toBeTruthy();
  expect(screen.queryByText(/Temporary routing failure/)).toBeNull();
});
