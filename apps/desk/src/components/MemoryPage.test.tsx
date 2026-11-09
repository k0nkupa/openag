import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryPage } from "./MemoryPage";
import type { Api } from "../api";

const bots = [{ id: "coder", name: "Coder", runtime: "acp", model: null }];

function makeApi(over: Record<string, unknown> = {}) {
  return {
    listBots: async () => ({ bots }),
    listPending: async () => ({ approvals: [] }),
    getBotMemory: async () => ({ botId: "coder", text: "- repo: open-ag\n", maxBytes: 16384, headTokens: 4, headCap: 1500 }),
    listSkills: async () => ({ skills: [] }),
    ...over,
  } as unknown as Api;
}

describe("MemoryPage", () => {
  it("loads MEMORY.md and saves only after an edit", async () => {
    const put = vi.fn(async (_id: string, text: string) => ({ botId: "coder", text }));
    render(<MemoryPage api={makeApi({ putBotMemory: put })} />);
    const box = (await screen.findByLabelText("MEMORY.md")) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toContain("open-ag"));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: "- repo: open-ag\n- new fact\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("coder", "- repo: open-ag\n- new fact\n"));
  });

  it("explains when search needs embeddings", async () => {
    const { ApiError } = await import("../api");
    render(<MemoryPage api={makeApi({ searchMemory: async () => { throw new ApiError("embeddings unavailable", 503); } })} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Search memory" }), { target: { value: "repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText(/needs embeddings/);
  });
});

it("keeps embedded memory bound to its bot without another bot selector", async () => {
  const listBots = vi.fn();
  const getBotMemory = vi.fn(async () => ({ botId: "coder", text: "Coder only", headCap: 1500 }));
  render(<MemoryPage api={makeApi({ listBots, getBotMemory })} bot={{ id: "coder", name: "Coder", runtime: "acp", model: null }} />);
  await waitFor(() => expect((screen.getByLabelText("MEMORY.md") as HTMLTextAreaElement).value).toBe("Coder only"));
  expect(getBotMemory).toHaveBeenCalledWith("coder");
  expect(listBots).not.toHaveBeenCalled();
  expect(screen.queryByRole("combobox", { name: "Bot" })).toBeNull();
});

vi.mock("../stream", () => { const subscribe = () => () => {}; return { useStream: () => ({ subscribe }) }; });
