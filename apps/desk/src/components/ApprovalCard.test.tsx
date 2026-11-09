import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApprovalCard } from "./ApprovalCard";
import type { Approval, Decision } from "../types";

const HOSTILE = "<script>alert(1)</script><img src=x onerror=alert(2)>";

function approval(id: string, toolName: string, payload: unknown): Approval {
  return {
    id,
    roomId: "main",
    botId: "boss",
    turnId: "t1",
    toolName,
    toolClass: "act-local",
    payload,
    status: "pending", reviewVersion:"fixture-review",toolCallId:null,review:null,canEdit:true,
    createdAt: 1_700_000_000_000,
  };
}

function setup(a: Approval) {
  const onDecide = vi.fn<(id: string, d: Decision) => Promise<void>>(async () => {});
  const utils = render(<ApprovalCard approval={a} onDecide={onDecide} />);
  return { onDecide, ...utils };
}

describe("ApprovalCard reflection payloads", () => {
  it("renders a memory proposal as readable text; the raw JSON stays in the collapsed exact-proposal disclosure", () => {
    const { container } = setup(approval("m1", "reflection_memory", { text: "Prefers metric units" }));
    const card = within(container.querySelector("[role=\"article\"]") as HTMLElement);
    expect(card.getByText("Remember this")).toBeTruthy();
    expect(card.getByText("Prefers metric units")).toBeTruthy();
    const raw = container.querySelector("pre");
    expect(raw?.closest('[data-slot="collapsible-content"]')?.hasAttribute("hidden")).toBe(true);
  });

  it("renders a skill proposal's name, description and body in a pre", () => {
    const { container } = setup(
      approval("s1", "reflection_skill", {
        slug: "weekly-report",
        name: "Weekly report",
        description: "Builds the weekly summary",
        body: "1. Collect\n2. Summarise",
      }),
    );
    const card = within(container.querySelector("[role=\"article\"]") as HTMLElement);
    expect(card.getByText("Proposed skill: Weekly report")).toBeTruthy();
    expect(card.getByText("Builds the weekly summary")).toBeTruthy();
    expect(container.querySelector("pre")?.textContent).toBe("1. Collect\n2. Summarise");
  });

  it("renders hostile reflection text as inert text", () => {
    const { container } = setup(approval("m2", "reflection_memory", { text: HOSTILE }));
    expect(container.querySelector('[data-slot="reflection-text"]')?.textContent).toBe(HOSTILE);
    expect(container.querySelectorAll("script").length).toBe(0);
    expect(container.querySelectorAll("img").length).toBe(0);
  });

  it("keeps the generic JSON view and Edit for other tools", () => {
    const { container, getByRole } = setup(approval("g1", "write_file", { path: "/tmp/a" }));
    expect(container.querySelector("pre")?.textContent).toBe(JSON.stringify({ path: "/tmp/a" }, null, 2));
    fireEvent.click(getByRole("button", { name: "Edit" }));
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      JSON.stringify({ path: "/tmp/a" }, null, 2),
    );
  });

  it("Edit still edits the raw JSON payload for a reflection proposal", () => {
    const { container, getByRole, onDecide } = setup(approval("m3", "reflection_memory", { text: "old" }));
    fireEvent.click(getByRole("button", { name: "Edit" }));
    const box = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(box.value).toBe(JSON.stringify({ text: "old" }, null, 2));
    fireEvent.change(box, { target: { value: '{"text":"new"}' } });
    fireEvent.click(getByRole("button", { name: "Approve edit" }));
    expect(onDecide).toHaveBeenCalledWith("m3", { reviewVersion:"fixture-review", kind: "edit", payload: { text: "new" } });
  });

  it("falls back to the JSON view when a reflection payload is malformed", () => {
    const { container } = setup(approval("m4", "reflection_memory", { note: 3 }));
    expect(container.querySelector("pre")?.textContent).toBe(JSON.stringify({ note: 3 }, null, 2));
  });
});

describe("reflection_skill slug", () => {
  it("shows the slug the skill will be saved under", () => {
    const { container } = render(
      <ApprovalCard
        approval={{ id: "a1", roomId: "main", botId: "boss", turnId: null, toolName: "reflection_skill", toolClass: "act-local", payload: { slug: "deploy-prod", name: "Tips", description: "d", body: "b" }, status: "pending", reviewVersion:"fixture-review",toolCallId:null,review:null,canEdit:true, edit: null, responseText: null, createdAt: 0, decidedAt: null } as never}
        onDecide={async () => undefined}
      />,
    );
    expect(container.textContent).toContain("deploy-prod");
  });
});

describe("ApprovalCard Slack source", () => {
  function withSource(source: string | null | undefined): Approval {
    return { ...approval("src", "write_file", { path: "/tmp/a" }), source };
  }

  it("shows the Slack user id for a slack:<id> source", () => {
    const { container } = setup(withSource("slack:U0123456789"));
    expect(container.querySelector('[data-slot="approval-source"]')?.textContent).toBe("From Slack user U0123456789");
  });

  it("shows plain 'From Slack' for an unknown Slack user", () => {
    const { container } = setup(withSource("slack"));
    expect(container.querySelector('[data-slot="approval-source"]')?.textContent).toBe("From Slack");
  });

  it("shows nothing for desk (null) or missing source", () => {
    expect(setup(withSource(null)).container.querySelector('[data-slot="approval-source"]')).toBeNull();
    expect(setup(withSource(undefined)).container.querySelector('[data-slot="approval-source"]')).toBeNull();
  });

  it("renders a hostile Slack source as inert text", () => {
    const { container } = setup(withSource("slack:<img src=x onerror=alert(1)>"));
    expect(container.querySelector('[data-slot="approval-source"]')?.textContent).toBe("From Slack user <img src=x onerror=alert(1)>");
    expect(container.querySelectorAll("img").length).toBe(0);
  });
});
