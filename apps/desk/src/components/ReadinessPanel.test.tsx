import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type Api } from "../api";
import type { ReadinessItem } from "../types";
import { ReadinessPanel, headline, orderItems } from "./ReadinessPanel";

const item = (over: Partial<ReadinessItem> & { id: string }): ReadinessItem => ({
  title: over.id,
  done: false,
  required: true,
  detail: `${over.id} detail`,
  how: `${over.id} how`,
  ...over,
});

const ITEMS: ReadinessItem[] = [
  item({ id: "heartbeat", title: "Heartbeat", done: false, required: false }),
  item({ id: "tokens", title: "Owner token", done: true, required: true }),
  item({ id: "push", title: "Push alerts", done: false, required: false }),
  item({ id: "backup", title: "Backups", done: false, required: true }),
  item({ id: "reflection", title: "Nightly reflection", done: true, required: false }),
  item({ id: "brief", title: "Morning brief", done: false, required: false }),
];

function makeApi(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getReadiness: vi.fn(async () => ({ ready: false, items: ITEMS })),
    applyReadiness: vi.fn(async () => ({ changed: ["heartbeat", "brief"], readiness: { ready: false, items: ITEMS } })),
    ...overrides,
  } as unknown as Api & { getReadiness: ReturnType<typeof vi.fn>; applyReadiness: ReturnType<typeof vi.fn> };
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

describe("ReadinessPanel helpers", () => {
  it("headline counts required steps left, or says ready", () => {
    expect(headline({ ready: false, items: ITEMS })).toBe("Always-on: 1 of 2 required steps left");
    expect(headline({ ready: true, items: [item({ id: "a", done: true })] })).toBe("Always-on: ready");
  });

  it("orders required items before optional ones and keeps daemon order", () => {
    const { required, optional } = orderItems(ITEMS);
    expect(required.map((i) => i.id)).toEqual(["tokens", "backup"]);
    expect(optional.map((i) => i.id)).toEqual(["heartbeat", "push", "reflection", "brief"]);
  });
});

describe("ReadinessPanel", () => {
  it("shows the headline, required first, an Optional group, and how text only for not-done items", async () => {
    render(<ReadinessPanel api={makeApi()} />);
    await flush();
    expect(screen.getByText("Always-on: 1 of 2 required steps left")).toBeTruthy();
    // Completed and optional items sit in collapsed disclosures; open both to see every row.
    fireEvent.click(screen.getByRole("button", { name: /Completed checks/ }));
    fireEvent.click(screen.getByRole("button", { name: /Optional setup/ }));
    expect(screen.getAllByLabelText("Done")).toHaveLength(2);
    const needs = screen.getAllByText("Needs setup");
    expect(needs).toHaveLength(4);
    expect(needs.every((badge) => badge.getAttribute("data-variant") === "attention")).toBe(true);
    expect(screen.getByText("backup how")).toBeTruthy();
    expect(screen.queryByText("tokens how")).toBeNull();
  });

  it("shows the enable button when a recommended item is not done and explains the scope", async () => {
    render(<ReadinessPanel api={makeApi()} />);
    await flush();
    expect(screen.getByRole("button", { name: "Enable recommended" })).toBeTruthy();
    expect(screen.getByText(/Push, Slack, WebRTC and the liveness URL need your own setup/)).toBeTruthy();
  });

  it("hides the enable button when heartbeat, reflection and brief are all done", async () => {
    const done = ITEMS.map((i) => (["heartbeat", "brief"].includes(i.id) ? { ...i, done: true } : i));
    render(<ReadinessPanel api={makeApi({ getReadiness: vi.fn(async () => ({ ready: false, items: done })) })} />);
    await flush();
    expect(screen.queryByRole("button", { name: "Enable recommended" })).toBeNull();
  });

  it("applies, lists what was switched on, and refreshes the list", async () => {
    const api = makeApi();
    render(<ReadinessPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Enable recommended" }));
    await flush();
    await flush();
    expect(api.applyReadiness).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Switched on: Heartbeat, Morning brief.")).toBeTruthy();
    expect(api.getReadiness).toHaveBeenCalledTimes(2);
  });

  it("maps a 403 on apply to the owner-only message", async () => {
    const api = makeApi({ applyReadiness: vi.fn(async () => { throw new ApiError("forbidden", 403); }) });
    render(<ReadinessPanel api={api} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Enable recommended" }));
    await flush();
    await flush();
    expect(screen.getByRole("alert").textContent).toBe("Only a Full access device can enable recommended settings");
  });

  it("shows a load error as text", async () => {
    render(<ReadinessPanel api={makeApi({ getReadiness: vi.fn(async () => { throw new Error("offline"); }) })} />);
    await flush();
    expect(screen.getByRole("alert").textContent).toBe("Could not load readiness: offline");
  });
});
