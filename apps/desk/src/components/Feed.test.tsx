import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Feed } from "./Feed";
import type { LedgerEvent } from "../types";

vi.mock("../stream", () => ({ useStream: () => ({ status: "live", completedWork: new Map(), subscribe: () => () => {} }) }));

const ev = (id: number, type: LedgerEvent["type"], payload: unknown, actor = "user"): LedgerEvent => ({
  id,
  roomId: "main",
  ts: 1_700_000_000_000 + id,
  actor,
  type,
  payload,
});

const HOSTILE = "<img src=x onerror=alert(1)><script>alert(2)</script>";

describe("Feed", () => {
  it("renders hostile message and bot_output text as text", () => {
    const { container } = render(
      <Feed
        events={[
          ev(1, "message", { text: HOSTILE }),
          ev(2, "bot_output", { text: HOSTILE }, "coder"),
        ]}
      />,
    );
    expect(container.querySelectorAll("img").length).toBe(0);
    expect(container.querySelectorAll("script").length).toBe(0);
    const texts = [...container.querySelectorAll('[data-slot="bubble-content"]')].map((n) => n.textContent);
    // The user's text is shown verbatim; bot output is rendered as markdown, which drops raw HTML instead of executing it.
    expect(texts[0]).toBe(HOSTILE);
    expect(texts[1]).not.toContain("<img");
    expect(container.querySelector("[onerror]")).toBeNull();
  });

  it("hides plumbing events and keeps errors", () => {
    const { container } = render(
      <Feed events={[ev(1, "route", { targets: ["coder"] }), ev(2, "error", { message: "boom" }, "daemon")]} />,
    );
    expect(container.textContent).not.toContain("routed to");
    expect(container.textContent).toContain("boom");
  });

  it("shows a thinking row while a turn is running and removes it when it finishes", () => {
    const started = ev(1, "turn_started", {}, "boss");
    const { queryByRole, rerender } = render(<Feed events={[started]} />);
    expect(queryByRole("status", { name: "boss is working…" })).toBeTruthy();
    rerender(<Feed events={[started, ev(2, "turn_finished", {}, "boss")]} />);
    expect(queryByRole("status", { name: "boss is working…" })).toBeNull();
  });

  it("shows an empty state and exposes a live log region", () => {
    const { container } = render(<Feed events={[]} />);
    expect(container.querySelector('[role="log"][aria-live="polite"]')).toBeTruthy();
    expect(container.textContent).toContain("Start a conversation");
  });
});

describe("Feed inline approvals", () => {
  const approval = {
    id: "ap1", roomId: "main", botId: "coder", turnId: "t1", toolName: "write_file", toolClass: "act-local",
    payload: { path: "a.ts" }, status: "pending" as const, reviewVersion:"fixture-review",toolCallId:null,review:null,canEdit:true, createdAt: 1,
  };
  const requested = ev(1, "approval_requested", { approvalId: "ap1" }, "coder");

  it("shows the card for a pending approval and no ledger line", () => {
    const { container, getByText } = render(<Feed events={[requested]} approvals={[approval]} onDecide={async () => {}} />);
    expect(getByText("Waiting for you")).toBeTruthy();
    expect(container.textContent).not.toContain("approval requested:");
  });

  it("hides the row once the approval is no longer pending", () => {
    const { container } = render(<Feed events={[requested]} approvals={[]} onDecide={async () => {}} />);
    expect(container.querySelector("article")).toBeNull();
  });
});

describe("Feed tool plumbing", () => {
  it("shows tool calls and results in a collapsed activity trace", () => {
    const { container } = render(
      <Feed events={[ev(1, "tool_call", { tool: "x" }, "coder"), ev(2, "tool_result", { ok: true }, "coder")]} />,
    );
    expect(container.querySelectorAll('[data-slot="trace"]').length).toBe(1);
    expect(container.querySelectorAll('button[aria-expanded="false"]').length).toBe(2);
  });
});
