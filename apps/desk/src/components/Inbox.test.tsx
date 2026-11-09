import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApprovalCard } from "./ApprovalCard";

// Card checks stay synchronous; the daemon-backed queue is covered by verify-attention.mjs and browser acceptance.
function ApprovalCards({approvals,onDecide}:{approvals:Approval[];error:null;onDecide:(id:string,d:Decision)=>Promise<void>}){return <>{approvals.map(a=><ApprovalCard key={a.id} approval={a} onDecide={onDecide}/>)}</>;}
import type { Approval, Decision } from "../types";

const HOSTILE = { content: "<img src=x onerror=alert(1)>" };

function approval(id: string, payload: unknown = { path: "/tmp/a" }): Approval {
  return {
    id,
    roomId: "main",
    botId: "coder",
    turnId: "t1",
    toolName: "write_file",
    toolClass: "act-external",
    payload,
    status: "pending", reviewVersion:"fixture-review",toolCallId:null,review:null,canEdit:true,
    createdAt: 1_700_000_000_000,
  };
}

function setup(approvals: Approval[]) {
  const onDecide = vi.fn<(id: string, d: Decision) => Promise<void>>(async () => {});
  const utils = render(<ApprovalCards approvals={approvals} error={null} onDecide={onDecide} />);
  return { onDecide, ...utils };
}

function cardFor(id: string): HTMLElement {
  const article = document.getElementById(`approval-${id}`)?.closest<HTMLElement>("[role=\"article\"]");
  if (!article) throw new Error(`no card for ${id}`);
  return article;
}

describe("ApprovalCard", () => {
  it("renders cards with bot, tool, class and pretty payload", () => {
    setup([approval("a1", { path: "/tmp/a", n: 2 })]);
    const card = cardFor("a1");
    expect(within(card).getByText("coder wants to change a file")).toBeTruthy();
    expect(within(card).getByText("act-external")).toBeTruthy();
    expect(card.querySelector("pre")?.textContent).toBe(JSON.stringify({ path: "/tmp/a", n: 2 }, null, 2));
  });

  it("renders hostile payload as text with zero img elements", () => {
    setup([approval("a2", HOSTILE)]);
    const card = cardFor("a2");
    expect(card.querySelector("pre")?.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(document.querySelectorAll("img").length).toBe(0);
  });


  it("Accept calls decide with accept", () => {
    const { onDecide } = setup([approval("a3")]);
    fireEvent.click(within(cardFor("a3")).getByRole("button", { name: "Accept" }));
    expect(onDecide).toHaveBeenCalledWith("a3", { reviewVersion:"fixture-review", kind: "accept" });
  });

  it("Ignore calls decide with ignore", () => {
    const { onDecide } = setup([approval("a3")]);
    fireEvent.click(within(cardFor("a3")).getByRole("button", { name: "Ignore" }));
    expect(onDecide).toHaveBeenCalledWith("a3", { reviewVersion:"fixture-review", kind: "ignore" });
  });

  it("invalid JSON in Edit never calls decide and shows a message", () => {
    const { onDecide } = setup([approval("a4")]);
    const card = cardFor("a4");
    fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
    const box = within(card).getByLabelText("Payload (JSON)") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "{not json" } });
    fireEvent.click(within(card).getByRole("button", { name: "Approve edit" }));
    expect(onDecide).not.toHaveBeenCalled();
    expect(within(card).getByRole("alert").textContent).toContain("Not valid JSON");
  });

  it("valid JSON in Edit calls decide with the parsed payload", () => {
    const { onDecide } = setup([approval("a5", { path: "/a" })]);
    const card = cardFor("a5");
    fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
    const box = within(card).getByLabelText("Payload (JSON)") as HTMLTextAreaElement;
    expect(box.value).toBe(JSON.stringify({ path: "/a" }, null, 2));
    fireEvent.change(box, { target: { value: '{"path":"/b"}' } });
    fireEvent.click(within(card).getByRole("button", { name: "Approve edit" }));
    expect(onDecide).toHaveBeenCalledWith("a5", { reviewVersion:"fixture-review", kind: "edit", payload: { path: "/b" } });
  });

  it("Respond with empty text does nothing", () => {
    const { onDecide } = setup([approval("a6")]);
    const card = cardFor("a6");
    fireEvent.click(within(card).getByRole("button", { name: "Respond" }));
    fireEvent.change(within(card).getByLabelText("Reply to the agent instead"), { target: { value: "   " } });
    fireEvent.click(within(card).getByRole("button", { name: "Send reply" }));
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("Respond sends the typed text", () => {
    const { onDecide } = setup([approval("a7")]);
    const card = cardFor("a7");
    fireEvent.click(within(card).getByRole("button", { name: "Respond" }));
    fireEvent.change(within(card).getByLabelText("Reply to the agent instead"), { target: { value: "use /tmp/b" } });
    fireEvent.click(within(card).getByRole("button", { name: "Send reply" }));
    expect(onDecide).toHaveBeenCalledWith("a7", { reviewVersion:"fixture-review", kind: "respond", text: "use /tmp/b" });
  });

  it("an unrelated refresh keeps an open edit box and its typed text", () => {
    const a1 = approval("a8", { v: 1 });
    const a2 = approval("a9");
    const onDecide = vi.fn(async () => {});
    const { rerender } = render(<ApprovalCards approvals={[a1, a2]} error={null} onDecide={onDecide} />);
    const card = cardFor("a8");
    fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(card).getByLabelText("Payload (JSON)"), { target: { value: '{"typed":true}' } });

    // Refresh: a8 unchanged (new object, same data), a9 removed, a10 added.
    rerender(
      <ApprovalCards approvals={[{ ...a1 }, approval("a10")]} error={null} onDecide={onDecide} />,
    );
    const after = cardFor("a8");
    expect((within(after).getByLabelText("Payload (JSON)") as HTMLTextAreaElement).value).toBe('{"typed":true}');
  });
});
