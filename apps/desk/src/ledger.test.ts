import { describe, expect, it } from "vitest";
import { mergeEvents, summarizeEvent } from "./ledger";
import type { EventType, LedgerEvent } from "./types";

const ev = (id: number, type: EventType, payload: unknown = {}, actor = "user"): LedgerEvent => ({
  id,
  roomId: "main",
  ts: 1_700_000_000_000 + id,
  actor,
  type,
  payload,
});

describe("summarizeEvent", () => {
  it.each<[LedgerEvent, string]>([
    [ev(1, "message", { text: "hi @coder" }), "hi @coder"],
    [ev(2, "bot_output", { text: "done" }, "coder"), "done"],
    [ev(3, "bot_output", { stopReason: "max_tokens" }, "coder"), "stopped: max_tokens"],
    [ev(4, "route", { targets: ["coder", "boss"] }, "primary"), "routed to coder, boss"],
    [ev(5, "route", { targets: [] }, "primary"), "routed to nobody"],
    [ev(6, "approval_requested", { toolName: "send_email", toolClass: "act-external" }), "approval requested: send_email (act-external)"],
    [ev(7, "approval_decided", { status: "accepted" }), "approval accepted"],
    [ev(8, "turn_started", {}), "turn started"],
    [ev(9, "turn_started", { resumed: true }), "turn resumed"],
    [ev(10, "turn_finished", { status: "completed" }), "turn completed"],
    [ev(11, "tool_call", { tool: "search" }), "tool call: search"],
    [ev(12, "tool_call", { title: "Read file" }), "tool call: Read file"],
    [ev(13, "tool_result", { ok: true }), "tool result: ok"],
    [ev(14, "tool_result", { ok: false, message: "timeout" }), "tool result: failed - timeout"],
    [ev(15, "error", { message: "boom" }, "daemon"), "boom"],
    [ev(16, "error", {}, "daemon"), "error"],
  ])("summarizes %#", (event, expected) => {
    expect(summarizeEvent(event)).toBe(expected);
  });

  it("falls back to JSON for unknown payload shapes and never throws on null payloads", () => {
    expect(summarizeEvent(ev(20, "message", null))).toBe("");
    expect(summarizeEvent(ev(21, "bot_output", "not-an-object"))).toBe("stopped: ");
  });
});

describe("mergeEvents", () => {
  it("dedupes by id and sorts ascending", () => {
    const a = [ev(3, "message"), ev(1, "message")];
    const merged = mergeEvents(a, [ev(2, "route"), ev(3, "bot_output")]);
    expect(merged.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(merged[2]?.type).toBe("message");
  });

  it("returns the same array when nothing new arrives", () => {
    const a = [ev(1, "message")];
    expect(mergeEvents(a, [ev(1, "message")])).toBe(a);
    expect(mergeEvents(a, [])).toBe(a);
  });
});

describe("summarizeEvent room lead change", () => {
  it("describes a lead change in plain text", () => {
    expect(summarizeEvent({ id: 1, roomId: "main", ts: 0, actor: "owner", type: "config", payload: { action: "room_lead_changed", from: "boss", to: "coder" } } as LedgerEvent)).toBe("Lead changed from boss to coder");
  });
});
