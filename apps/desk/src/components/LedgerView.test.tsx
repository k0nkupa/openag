import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LedgerView } from "./LedgerView";
import type { Api } from "../api";
import type { LedgerEvent } from "../types";

vi.mock("../stream", async () => {
  const actual = await vi.importActual<typeof import("../stream")>("../stream");
  return { ...actual, useStream: () => ({ status: "live", subscribe: () => () => {} }) };
});

const ev = (id: number, type: LedgerEvent["type"], actor: string, payload: unknown): LedgerEvent => ({
  id, roomId: "main", ts: 1_700_000_000_000 + id, actor, type, payload,
});

describe("LedgerView", () => {
  it("filters by type and shows the selected payload", async () => {
    const api = {
      listEvents: async () => ({ events: [ev(1, "message", "user", { text: "hello" }), ev(2, "error", "coder", { message: "boom" })] }),
      listBots: async () => ({ bots: [{ id: "coder", name: "Coder", runtime: "acp", model: null }] }),
    } as unknown as Api;
    render(<LedgerView api={api} rooms={[{ id: "main", name: "main", leadBotId: null, members: [] }]} />);
    await waitFor(() => expect(screen.getByText("hello")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "error" }));
    expect(screen.queryByText("hello")).toBeNull();
    fireEvent.click(screen.getByText("boom"));
    expect(screen.getByText(/"message": "boom"/)).toBeTruthy();
  });

  it("appends the router choice as text and never parses the reason as markup", async () => {
    const api = {
      listEvents: async () => ({
        events: [
          ev(1, "route", "primary", { targets: ["boss"], router: { strategy: "jev", reason: "fallback: <img src=x onerror=alert(1)>" } }),
        ],
      }),
      listBots: async () => ({ bots: [] }),
    } as unknown as Api;
    const { container } = render(<LedgerView api={api} rooms={[{ id: "main", name: "main", leadBotId: null, members: [] }]} />);
    await waitFor(() => expect(container.textContent).toContain("routed to boss (router fallback: <img src=x onerror=alert(1)>)"));
    expect(container.querySelector("img")).toBeNull();
  });
});
