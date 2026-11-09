import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HeldBack } from "./HeldBack";
import type { Api } from "../api";
import type { WakeDecision } from "../types";

const d = (o: Partial<WakeDecision>): WakeDecision => ({ id: 1, ts: Date.now(), source: "heartbeat", botId: "researcher", verdict: "ping", urgency: "high", dedupeKey: "k", reason: "Quote arrived", decision: "digest", suppressedBy: "budget", feedback: null, ...o });

describe("HeldBack", () => {
  it("lists today's downgraded pings and records feedback", async () => {
    const sendWakeFeedback = vi.fn(async () => ({ id: 1, feedback: "should_have_pinged" as const }));
    const api = { getWakeDecisions: async () => ({ decisions: [d({}), d({ id: 2, decision: "ping", suppressedBy: null }), d({ id: 3, ts: 1 })] }), sendWakeFeedback } as unknown as Api;
    render(<HeldBack api={api} />);
    await screen.findByText("Quote arrived");
    expect(screen.getAllByRole("button", { name: "Should have pinged" }).length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Should have pinged" }));
    await waitFor(() => expect(sendWakeFeedback).toHaveBeenCalledWith(1));
    await screen.findByText("Noted");
  });
});
