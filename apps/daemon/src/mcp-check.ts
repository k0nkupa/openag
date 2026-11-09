import { z } from "zod";
import type { Approval, Approvals } from "./approvals.js";
import type { Db } from "./db/index.js";
import { getDefaultBotId } from "./defaultbot.js";
import { resolveDeliveryRoom } from "./delivery.js";
import type { Ledger, LedgerEvent } from "./ledger.js";
import { ID_RE, validateServerItem, type McpCheckResult, type McpManager } from "./mcp.js";
import { McpServerError, originOf } from "./mcp-servers.js";
import { getDefaultRedactor } from "./redact.js";
import { newReferenceProblem } from "./secret-env.js";

/**
 * A server check is a tool action: the owner proposes a candidate, an approval carries the exact URL and header NAMES, and only
 * an accepted approval makes the daemon contact the endpoint. The stored payload is what runs, never anything a client sends later.
 *
 * It deliberately has no action-receipt `start`: the check only lists tools, so it must never mark an external action as running
 * (that would block every other external action) or leave an `unknown` receipt behind. The receipt is only ever finished.
 */

export const MCP_SERVER_CHECK_TOOL = "mcp_server_check";
/** Marks approvals this module created. Bots cannot set it, so a lookalike tool name from elsewhere is never run. */
export const MCP_SERVER_CHECK_SOURCE = "mcp-server-check";
const MAX_PENDING = 5;
const MAX_RESULTS = 20;
/** Shown for a candidate that is not saved under any name. */
const UNSAVED_ID = "candidate";

const headers = z.record(z.string().min(1).max(200), z.string().max(2048));
export const checkCandidateSchema = z.object({
  /** Names an existing custom server being edited (its current references are then not new). Display only otherwise. */
  id: z.string().regex(ID_RE, "id must match ^[a-z][a-z0-9_-]{0,31}$").optional(),
  url: z.string().min(1).max(2048),
  headers: headers.default({}),
  allowPrivateNetwork: z.boolean().default(false),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
}).strict();

// Stored as pairs, not a map: the redactor masks values under keys that look like Authorization/Token, and a template must stay readable.
const payloadSchema = z.object({
  serverId: z.string().regex(ID_RE).optional(),
  url: z.string().min(1).max(2048),
  headers: z.array(z.object({ name: z.string().min(1).max(200), template: z.string().max(2048) }).strict()).max(50),
  allowPrivateNetwork: z.boolean(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
}).strict();
type Payload = z.infer<typeof payloadSchema>;

export type McpCheckState =
  | { state: "pending" | "running" | "declined" | "expired" }
  | ({ state: "done" } & McpCheckResult);

export interface McpServerCheck {
  request(input: z.infer<typeof checkCandidateSchema>): { approvalId: string; expiresInMs: number };
  /** undefined for an unknown or forgotten id. */
  result(approvalId: string): McpCheckState | undefined;
  dispose(): void;
  idle():Promise<void>;
}

export function createMcpServerCheck(deps: {
  db: Db; ledger: Ledger; approvals: Approvals; mcp: McpManager;
  /** How long an unanswered check waits before it expires (default 5 minutes). */
  expiryMs?: number;
  /** How long a finished, declined or expired result stays readable (default 15 minutes). */
  resultTtlMs?: number;
}): McpServerCheck {
  const expiryMs = deps.expiryMs ?? 5 * 60_000, resultTtlMs = deps.resultTtlMs ?? 15 * 60_000;
  const states = new Map<string, McpCheckState>();
  const timers = new Set<NodeJS.Timeout>();
  const running=new Set<Promise<void>>();let disposed=false;

  const later = (ms: number, fn: () => void) => {
    if(disposed)return;
    const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms);
    timer.unref();
    timers.add(timer);
  };
  // A result is forgotten after its TTL. The map is bounded too, but only ever evicts finished entries: a pending check keeps its expiry.
  const remember = (id: string, state: McpCheckState) => {
    states.set(id, state);
    if (state.state !== "pending" && state.state !== "running") later(resultTtlMs, () => { if (states.get(id) === state) states.delete(id); });
    for (const [key, value] of states) {
      if (states.size <= MAX_RESULTS) break;
      if (value.state !== "pending" && value.state !== "running") states.delete(key);
    }
  };

  const ownCheck = (approval: Approval | undefined): approval is Approval =>
    approval !== undefined && approval.toolName === MCP_SERVER_CHECK_TOOL && approval.source === MCP_SERVER_CHECK_SOURCE && approval.turnId === null;

  const candidate = (id: string | undefined, url: string, headerMap: Record<string, string>, allowPrivateNetwork: boolean, timeoutMs: number | undefined) =>
    ({ id: id ?? UNSAVED_ID, transport: "http", url, headers: headerMap, allowPrivateNetwork, ...(timeoutMs !== undefined ? { timeoutMs } : {}) });
  const itemOf = (payload: Payload) => candidate(payload.serverId, payload.url, Object.fromEntries(payload.headers.map(pair => [pair.name, pair.template])), payload.allowPrivateNetwork, payload.timeoutMs);

  async function run(approval: Approval): Promise<void> {
    const current = states.get(approval.id)?.state;
    if (current === "running" || current === "done") return;
    const finish = (outcome: "completed" | "failed" | "not-run", detail: string) => {
      try { deps.approvals.receipts.finish(approval.id, { outcome, detail }); } catch { /* the check state is what the owner reads */ }
    };
    const refuse = (reason: string) => {
      remember(approval.id, { state: "done", ok: false, reason });
      finish("not-run", reason);
      deps.ledger.append("_system", "daemon", "config", { action: "mcp_server_check_failed", id: null, reason });
    };
    const payload = payloadSchema.safeParse(approval.payload);
    if (!payload.success) return refuse("the stored proposal is invalid; nothing was contacted");
    // Redaction rewrites anything that looks like a secret, so a proposal that contains a marker is no longer what was proposed.
    if (JSON.stringify(approval.payload).includes("[REDACTED")) return refuse("the stored proposal was altered by redaction; nothing was contacted");
    remember(approval.id, { state: "running" });
    // checkServer validates the item again before connecting, so a changed rule or a tampered stored row cannot slip through.
    const result = await deps.mcp.checkServer(itemOf(payload.data));
    remember(approval.id, { state: "done", ...result });
    finish(result.ok ? "completed" : "failed", result.ok ? `The daemon connected and listed ${result.tools.length} tool(s); nothing was registered.` : `The check did not complete: ${result.reason}`);
    deps.ledger.append("_system", "daemon", "config", result.ok
      ? { action: "mcp_server_checked", id: payload.data.serverId ?? null, toolCount: result.tools.length }
      : { action: "mcp_server_check_failed", id: payload.data.serverId ?? null, reason: result.reason });
  }

  const off = deps.ledger.subscribe("*", (event: LedgerEvent) => {
    if (event.type !== "approval_decided") return;
    const id = (event.payload as { approvalId?: unknown } | null)?.approvalId;
    if (typeof id !== "string") return;
    const approval = deps.approvals.get(id);
    if (!ownCheck(approval)) return;
    // Only an explicit accept runs it. Ignore, respond and expiry never contact the endpoint.
    if (approval.status === "accepted") { const job=run(approval).catch(() => remember(id,{state:"done",ok:false,reason:"the check failed"}));running.add(job);void job.then(()=>running.delete(job));return; }
    if (states.get(id)?.state !== "expired") remember(id, { state: "declined" });
  });

  const armExpiry = (approvalId: string, ms: number) => later(ms, () => {
    if (states.get(approvalId)?.state !== "pending") return;
    remember(approvalId, { state: "expired" });
    deps.approvals.expire(approvalId, "The server check was not approved in time. Request it again.");
  });
  // Checks proposed before a restart keep their approval row but lost their timer: finish them off or re-arm them, so none is stranded.
  for (const approval of deps.approvals.listPending()) {
    if (!ownCheck(approval)) continue;
    const left = approval.createdAt + expiryMs - Date.now();
    if (left <= 0) { remember(approval.id, { state: "expired" }); deps.approvals.expire(approval.id, "The server check was not approved in time. Request it again."); }
    else { remember(approval.id, { state: "pending" }); armExpiry(approval.id, left); }
  }

  return {
    request(input) {
      if(disposed)throw new McpServerError("the daemon is shutting down",503);
      const item = candidate(input.id, input.url, input.headers, input.allowPrivateNetwork, input.timeoutMs);
      const invalid = validateServerItem(item);
      if (invalid) throw new McpServerError(invalid, 400);
      // The same reference rule as saving: references already on the server being edited stay, unless the check points at a new origin,
      // in which case every reference is new (an existing variable must not be sent to a different host).
      let known: string[] = [];
      if (input.id) {
        try {
          const existing = deps.mcp.entries().servers.find(server => server.id === input.id && server.origin === "custom");
          if (existing && originOf(existing.url) === originOf(input.url)) known = existing.headers?.map(pair => pair.template) ?? [];
        } catch { /* an unreadable file just means no reference counts as already present */ }
      }
      const bad = newReferenceProblem(known, Object.values(input.headers));
      if (bad) throw new McpServerError(`a header can reference only OPENAG_MCP_ variables (${bad})`, 400);
      const payload = { ...(input.id ? { serverId: input.id } : {}), url: input.url, headers: Object.entries(input.headers).map(([name, template]) => ({ name, template })), allowPrivateNetwork: input.allowPrivateNetwork, ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}) };
      // The approval stores a redacted copy. If redaction would change it, what runs would differ from what was proposed: refuse now.
      if (JSON.stringify(getDefaultRedactor().redact(payload)) !== JSON.stringify(payload)) throw new McpServerError("the URL or a header looks like it contains a secret; reference a variable such as ${OPENAG_MCP_NAME} instead", 400);
      if (deps.approvals.listPending().filter(approval => approval.toolName === MCP_SERVER_CHECK_TOOL).length >= MAX_PENDING)
        throw new McpServerError("too many server checks are waiting for a decision; decide or wait for them to expire", 409);
      // The delivery room keeps a forgotten check visible and decidable in the Inbox (a hidden `_` room is only the fallback when there
      // is no destination, and such a check can only expire).
      const { approvalId } = deps.approvals.request({
        roomId: resolveDeliveryRoom(deps.db, deps.ledger) ?? "_system",
        botId: getDefaultBotId(deps.db) ?? "daemon",
        toolName: MCP_SERVER_CHECK_TOOL,
        toolClass: "act-external",
        source: MCP_SERVER_CHECK_SOURCE,
        payload,
      });
      remember(approvalId, { state: "pending" });
      armExpiry(approvalId, expiryMs);
      return { approvalId, expiresInMs: expiryMs };
    },
    result: id => states.get(id),
    async idle(){while(running.size)await Promise.all([...running]);},
    dispose() { disposed=true;off(); for (const timer of timers) clearTimeout(timer); timers.clear(); },
  };
}
