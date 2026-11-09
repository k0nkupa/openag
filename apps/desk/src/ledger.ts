import type { LedgerEvent } from "./types";

const PROMINENT = new Set(["avatar_preview", "avatar_library_updated", "result_saved", "message", "bot_output", "error"]);

export function isProminent(type: LedgerEvent["type"]): boolean {
  return PROMINENT.has(type);
}

function fields(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** One-line, plain-text description of an event. Returned as a string, so callers render it as text only. */
export function summarizeEvent(e: LedgerEvent): string {
  const p = fields(e.payload);
  switch (e.type) {
    case "result_saved":
      return `Saved result: ${text(p.name) ?? "Untitled"} · version ${String(p.version ?? "")}`;
    case "message":
      return text(p.text) ?? "";
    case "bot_output":
      return text(p.text) ?? `stopped: ${String(p.stopReason ?? "")}`;
    case "route": {
      const targets = Array.isArray(p.targets) ? p.targets.map(String) : [];
      return `routed to ${targets.join(", ") || "nobody"}`;
    }
    case "approval_requested":
      return `approval requested: ${String(p.toolName ?? "")} (${String(p.toolClass ?? "")})`;
    case "receipt_updated":return `${p.activityTool ? String(p.activityTool) : 'execution'}: ${String(p.outcome??"pending")}`;
    case "approval_decided":
      return `approval ${String(p.status ?? "")}`;
    case "turn_started":
      return p.resumed ? "turn resumed" : "turn started";
    case "turn_finished":
      return p.reason === "awaiting_input" ? "awaiting input" : `turn ${String(p.status ?? "")}`;
    case "mcp_interaction_updated":
      return `server input: ${p.status === "open" ? "awaiting your response" : String(p.status ?? "updated")}`;
    case "tool_call":
      return `tool call: ${String(p.tool ?? p.title ?? "")}`;
    case "tool_result": {
      const status = p.executionOutcome === "unknown" ? (p.invocationOutcome === "returned" ? "returned; effect unconfirmed" : "outcome unknown") : String(p.status ?? (p.ok ? "ok" : "failed"));
      return `${p.activityTool ? String(p.activityTool) : 'tool result'}: ${status}${p.message ? ` - ${String(p.message)}` : ""}`;
    }
    case "error":
      return text(p.message) ?? "error";
    case "config":
      if (p.action === "room_lead_changed") return `Lead changed from ${text(p.from) ?? "nobody"} to ${text(p.to) ?? "nobody"}`;
      return JSON.stringify(e.payload) ?? "";
    default:
      return JSON.stringify(e.payload) ?? "";
  }
}

/** Dedupes by id and sorts ascending. Returns the same array when nothing new arrived, so React can skip work. */
export function mergeEvents(list: readonly LedgerEvent[], incoming: readonly LedgerEvent[]): LedgerEvent[] {
  const known = new Set(list.map((e) => e.id));
  const fresh = incoming.filter((e) => !known.has(e.id));
  if (fresh.length === 0) return list as LedgerEvent[];
  const byId = new Map<number, LedgerEvent>();
  for (const e of [...list, ...fresh]) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * Muted suffix for a route event that the router chose, e.g. " (router: jev)" or " (router fallback: <why>)".
 * Empty when the payload carries no router info. Plain text only; callers render it as text.
 */
export function routerSuffix(e: LedgerEvent): string {
  if (e.type !== "route") return "";
  const router = fields(fields(e.payload).router);
  const strategy = text(router.strategy);
  const reason = text(router.reason);
  if (!strategy || !reason) return "";
  if (reason.startsWith("fallback")) {
    const why = reason.replace(/^fallback:?\s*/, "");
    return ` (router fallback: ${why || "unknown"})`;
  }
  return ` (router: ${strategy})`;
}
