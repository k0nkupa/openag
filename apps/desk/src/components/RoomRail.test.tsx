import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RoomSummary } from "./RoomRail";
import type { Api } from "../api";
import type { BotInfo, BotModelState, Room } from "../types";

vi.mock("../stream", () => { const subscribe = () => () => {}; return { useStream: () => ({ subscribe }) }; });
const bot: BotInfo = { id: "bot", name: "Bot", runtime: "acp", model: "codex", adapter: "codex", modelRevision: "r1" };
const room: Room = { id: "d1", name: "Bot", leadBotId: "bot", members: ["bot"], kind: "direct" };
const state: BotModelState = {
  revision: "r1", runtime: "acp", target: "codex", model: "gpt-6-astra", reasoning: { reasoning_effort: "medium" }, override: null, effectiveModel: "gpt-6-astra",
  reports: [{ roomId: "_heartbeat", at: 1, turnId: "t", revision: "r1", source: "session", sessionId: "s", modelName: "6 Astra", model: "gpt-6-astra", effort: "medium", freshness: "last-reported" }],
};
const render_ = (api: Partial<Api>) => render(<RoomSummary api={api as Api} room={room} bots={[bot]} approvals={[]} events={[]} />);

it("shows configured badges without reports from another room", async () => {
  render_({ getBotModel: async () => state });
  expect(await screen.findByText("gpt-6-astra")).toBeTruthy();
  expect(screen.getByTitle("Configured effort: medium")).toBeTruthy();
  expect(screen.queryByText(/Last reported/)).toBeNull();
  expect(screen.queryByText(/Room _heartbeat/)).toBeNull();
  expect(screen.queryByText(/See Brain settings/)).toBeNull();
});

it("uses configured badges without a report and shows Unavailable when the read fails", async () => {
  const { unmount } = render_({ getBotModel: async () => ({ ...state, reports: [] }) });
  expect(await screen.findByTitle("Configured model: gpt-6-astra")).toBeTruthy();
  unmount();
  render_({ getBotModel: async () => { throw Error("down"); } });
  expect((await screen.findAllByText("Unavailable")).length).toBeGreaterThan(0);
});
