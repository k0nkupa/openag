import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BotEditor } from "./BotEditor";
import { ApiError } from "../api";
import type { Api } from "../api";

vi.mock("../stream", () => { const subscribe = () => () => {}; return { useStream: () => ({ subscribe }) }; });
const getBotModel = async () => ({ revision: "fixture", runtime: "acp", target: "claude", model: null, reasoning: {}, override: null, effectiveModel: null, reports: [] });

const bot = { id: "coder", name: "Coder", runtime: "acp", model: "claude-code", adapter: "claude code" };

describe("BotEditor", () => {
  it("saves only the avatar when text fields are owner-locked", async () => {
    const put = vi.fn(async () => ({ bot }));
    const api = {
      getBotModel,
      getBotSettings: async () => {
        throw new ApiError("owner token required", 403);
      },
      putBotSettings: put,
    } as unknown as Api;
    render(<BotEditor api={api} bot={bot} onSaved={() => {}} />);
    await screen.findByText(/owner-only/);
    fireEvent.click(screen.getByRole("button", { name: "Change avatar" }));
    fireEvent.click(screen.getByRole("radio", { name: "Barbell" }));
    fireEvent.click(screen.getByRole("radio", { name: "Pink" }));
    fireEvent.click(screen.getByRole("button", { name: "Save avatar" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("coder", { avatar: { shape: "barbell", color: "pink" } }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).disabled).toBe(true);
  });

  it("owner edits send only what changed", async () => {
    const put = vi.fn(async () => ({ bot }));
    const api = {
      getBotModel,
      getBotSettings: async () => ({ id: "coder", name: "Coder", description: "d", instructions: "i", avatar: null }),
      putBotSettings: put,
    } as unknown as Api;
    render(<BotEditor api={api} bot={bot} onSaved={() => {}} />);
    await screen.findByDisplayValue("d");
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Instructions" }) as HTMLTextAreaElement).value).toBe("i"));
    fireEvent.change(screen.getByRole("textbox", { name: "Instructions" }), { target: { value: "new" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("coder", { instructions: "new" }));
  });
});
