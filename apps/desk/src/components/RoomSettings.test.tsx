import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type Api } from "../api";
import type { BotInfo, Room } from "../types";
import { RoomSettings } from "./RoomSettings";
import { chooseOption, openSelect } from "../test/select";

const room: Room = { id: "main", name: "main", description: "", leadBotId: "boss", members: ["boss", "coder"], router: "lead", routerRevision: "r" };
const bots = [{ id: "boss", name: "Boss" }, { id: "coder", name: "Coder" }] as unknown as BotInfo[];
function setup(updateRoom = vi.fn(async (_id: string, patch: object) => ({ room: { ...room, ...patch } }))) {
  const api = { updateRoom, getRouterStrategies: vi.fn(async () => ({ strategies: [{ strategy: "lead", reason: null, providers: [] }] })) };
  render(<RoomSettings api={api as unknown as Api} room={room} bots={bots} />);
  return api;
}

describe("RoomSettings", () => {
  it("saves only the changed fields", async () => {
    const api = setup();
    const save = screen.getByRole("button", { name: "Save room details" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: " Team " } });
    await chooseOption(screen.getByRole("combobox", { name: "Lead" }), "Coder");
    fireEvent.click(save);
    await screen.findByText("Saved.");
    expect(api.updateRoom).toHaveBeenCalledWith("main", { name: "Team", leadBotId: "coder" });
  });
  it("lists only members as lead candidates and loads routing", async () => {
    setup();
    openSelect(screen.getByRole("combobox", { name: "Lead" }));
    expect((await screen.findAllByRole("option")).map(o => o.textContent)).toEqual([expect.stringContaining("Boss"), expect.stringContaining("Coder")]);
    await screen.findByRole("combobox", { name: "Routing for main" });
  });
  it("reports a rejected owner action and keeps the draft", async () => {
    setup(vi.fn(async () => { throw new ApiError("forbidden", 403); }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Save room details" }));
    await screen.findByText("Only the owner can change room settings.");
    await waitFor(() => expect((screen.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("hello"));
  });
});
