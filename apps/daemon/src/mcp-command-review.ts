import { z } from "zod";
import type { Approval, Approvals } from "./approvals.js";
import type { Db } from "./db/index.js";
import { getDefaultBotId } from "./defaultbot.js";
import { resolveDeliveryRoom } from "./delivery.js";
import type { Ledger, LedgerEvent } from "./ledger.js";
import { ID_RE, type McpManager, type ServerStatus } from "./mcp.js";
import { buildReview, type ReviewDisplay, type ReviewRecord } from "./mcp-command-review-core.js";
import { McpServerError, type McpServerService } from "./mcp-servers.js";
import { getDefaultRedactor } from "./redact.js";
import { newReferenceProblem } from "./secret-env.js";

/**
 * A command review is a tool action (OA-456): the owner proposes a local command, an approval carries exactly what would run (the
 * resolved program, arguments, environment NAMES and templates, working directory, content hash), and only an accepted approval writes
 * the entry. The stored payload is what is written, never anything a client sends later, and the entry is rebuilt and re-hashed at
 * write time, so a program or script that changed in between is refused.
 *
 * Like the server check it has no action-receipt `start`: it only writes configuration, so it must never block other external actions
 * or leave an `unknown` receipt behind.
 */

export const MCP_COMMAND_REVIEW_TOOL = "mcp_command_review";
/** Marks approvals this module created. Bots cannot set it, so a lookalike tool name from elsewhere is never applied. */
export const MCP_COMMAND_REVIEW_SOURCE = "mcp-command-review";
const MAX_PENDING = 5;
const MAX_RESULTS = 20;

const envMap = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "env names must be identifiers"), z.string().max(2048));
export const commandProposalSchema = z.object({
  id: z.string().regex(ID_RE, "id must match ^[a-z][a-z0-9_-]{0,31}$"),
  command: z.string().min(1).max(500),
  args: z.array(z.string().max(2000)).max(100).default([]),
  env: envMap.default({}),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  offerToAgents: z.boolean().default(true),
  /** Left out, an edit keeps the server's current setting (a new server is enabled). */
  enabled: z.boolean().optional(),
}).strict();

// Stored as pairs, not a map: the redactor masks values under keys that look like Authorization/Token, and a template must stay readable.
const payloadSchema = z.object({
  id: z.string().regex(ID_RE),
  command: z.string().min(1).max(500),
  args: z.array(z.string().max(2000)).max(100),
  env: z.array(z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), template: z.string().max(2048) }).strict()).max(50),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  offerToAgents: z.boolean(),
  enabled: z.boolean(),
  replacesHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  review: z.object({
    hash: z.string().regex(/^[a-f0-9]{64}$/), executable: z.string(), binding: z.string().regex(/^[a-f0-9]{64}$/),
    files: z.array(z.object({ arg: z.string(), path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(3),
  }).strict(),
  /** Shown to the owner; derived from the fields above. */
  display: z.object({ argv: z.array(z.string()), cwd: z.string(), hash: z.string() }).passthrough(),
}).strict();

export type McpCommandReviewState =
  | { state: "pending" | "running" | "declined" | "expired" }
  | { state: "done"; ok: true; status: ServerStatus | null; action: "added" | "updated" }
  | { state: "done"; ok: false; reason: string };

export interface McpCommandReview {
  request(input: z.infer<typeof commandProposalSchema>): { approvalId: string; expiresInMs: number; review: ReviewDisplay; replaces: boolean };
  /** undefined for an unknown or forgotten id. */
  result(approvalId: string): McpCommandReviewState | undefined;
  dispose(): void;
  idle():Promise<void>;
}

export function createMcpCommandReview(deps: {
  db: Db; ledger: Ledger; approvals: Approvals; mcp: McpManager; service: McpServerService;
  expiryMs?: number; resultTtlMs?: number;
}): McpCommandReview {
  const expiryMs = deps.expiryMs ?? 5 * 60_000, resultTtlMs = deps.resultTtlMs ?? 15 * 60_000;
  const states = new Map<string, McpCommandReviewState>();
  const timers = new Set<NodeJS.Timeout>();
  const running=new Set<Promise<void>>();let disposed=false;
  const later = (ms: number, fn: () => void) => { if(disposed)return;const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timer.unref(); timers.add(timer); };
  const remember = (id: string, state: McpCommandReviewState) => {
    states.set(id, state);
    if (state.state !== "pending" && state.state !== "running") later(resultTtlMs, () => { if (states.get(id) === state) states.delete(id); });
    for (const [key, value] of states) {
      if (states.size <= MAX_RESULTS) break;
      if (value.state !== "pending" && value.state !== "running") states.delete(key);
    }
  };
  const ownReview = (approval: Approval | undefined): approval is Approval =>
    approval !== undefined && approval.toolName === MCP_COMMAND_REVIEW_TOOL && approval.source === MCP_COMMAND_REVIEW_SOURCE && approval.turnId === null;

  async function run(approval: Approval): Promise<void> {
    const current = states.get(approval.id)?.state;
    if (current === "running" || current === "done") return;
    const finish = (outcome: "completed" | "failed" | "not-run", detail: string) => { try { deps.approvals.receipts.finish(approval.id, { outcome, detail }); } catch { /* the review state is what the owner reads */ } };
    const refuse = (reason: string) => {
      remember(approval.id, { state: "done", ok: false, reason });
      finish("not-run", reason);
      deps.ledger.append("_system", "daemon", "config", { action: "mcp_command_review_failed", id: null, reason });
    };
    const payload = payloadSchema.safeParse(approval.payload);
    if (!payload.success) return refuse("the stored proposal is invalid; nothing was written");
    // Redaction rewrites anything that looks like a secret, so a proposal that contains a marker is no longer what was proposed.
    if (JSON.stringify(approval.payload).includes("[REDACTED")) return refuse("the stored proposal was altered by redaction; nothing was written");
    remember(approval.id, { state: "running" });
    const { display: _display, ...proposal } = payload.data;
    try {
      const change = await deps.service.upsertCommand({ ...proposal, review: proposal.review as ReviewRecord });
      remember(approval.id, { state: "done", ok: true, status: change.status ?? null, action: change.action === "updated" ? "updated" : "added" });
      finish("completed", `The reviewed command was saved (hash ${proposal.review.hash.slice(0, 12)}).`);
      deps.ledger.append("_system", "daemon", "config", { action: "mcp_command_review_applied", id: proposal.id, hash: proposal.review.hash, change: change.action });
    } catch (err) {
      const reason = err instanceof McpServerError ? err.message : "the reviewed command could not be saved";
      remember(approval.id, { state: "done", ok: false, reason });
      finish("failed", `Nothing was changed: ${reason}`);
      deps.ledger.append("_system", "daemon", "config", { action: "mcp_command_review_failed", id: proposal.id, reason });
    }
  }

  const off = deps.ledger.subscribe("*", (event: LedgerEvent) => {
    if (event.type !== "approval_decided") return;
    const id = (event.payload as { approvalId?: unknown } | null)?.approvalId;
    if (typeof id !== "string") return;
    const approval = deps.approvals.get(id);
    if (!ownReview(approval)) return;
    // Only an explicit accept writes anything. Ignore, respond and expiry never do.
    if (approval.status === "accepted") { const job=run(approval).catch(() => remember(id,{state:"done",ok:false,reason:"the review failed"}));running.add(job);void job.then(()=>running.delete(job));return; }
    if (states.get(id)?.state !== "expired") remember(id, { state: "declined" });
  });

  const armExpiry = (approvalId: string, ms: number) => later(ms, () => {
    if (states.get(approvalId)?.state !== "pending") return;
    remember(approvalId, { state: "expired" });
    deps.approvals.expire(approvalId, "The command review was not approved in time. Request it again.");
  });
  // A review proposed before a restart keeps its approval row but lost its timer: finish it off or re-arm it, so none is stranded.
  for (const approval of deps.approvals.listPending()) {
    if (!ownReview(approval)) continue;
    const left = approval.createdAt + expiryMs - Date.now();
    if (left <= 0) { remember(approval.id, { state: "expired" }); deps.approvals.expire(approval.id, "The command review was not approved in time. Request it again."); }
    else { remember(approval.id, { state: "pending" }); armExpiry(approval.id, left); }
  }

  return {
    request(input) {
      if(disposed)throw new McpServerError("the daemon is shutting down",503);
      let existing;
      try { existing = deps.mcp.entries().servers.find(server => server.id === input.id); }
      catch { throw new McpServerError("MCP configuration cannot be read safely; fix the file first", 409); }
      // An operator-written entry, a remote server or a built-in connection is never replaced by a proposal.
      if (existing && !(existing.transport === "stdio" && existing.managedBy === "desk")) throw new McpServerError("an entry with this id is managed in mcp.json or is a remote server; choose another name", 409);
      // Only an OPENAG_MCP_ variable or a stored secret may be named in the environment.
      const bad = newReferenceProblem([], Object.values(input.env));
      if (bad) throw new McpServerError(`an environment value can reference only OPENAG_MCP_ variables or stored secrets (${bad})`, 400);
      const built = buildReview({ id: input.id, command: input.command, args: input.args, env: input.env });
      if ("problem" in built) throw new McpServerError(built.problem, 400);
      const payload = {
        id: input.id, command: input.command, args: input.args, env: Object.entries(input.env).map(([name, template]) => ({ name, template })),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}), offerToAgents: input.offerToAgents, enabled: input.enabled ?? existing?.enabled ?? true,
        replacesHash: existing?.review?.hash ?? null, review: built.review, display: built.display,
      };
      // The entry would be refused at load for any other reason (a reference rule, a secret-looking literal): refuse it now, before a review is requested.
      const probe = deps.service.previewCommand(payload);
      if (probe) throw new McpServerError(probe, 400);
      // The approval stores a redacted copy. If redaction would change it, what is written would differ from what was reviewed.
      if (JSON.stringify(getDefaultRedactor().redact(payload)) !== JSON.stringify(payload)) throw new McpServerError("a value looks like it contains a secret; reference a variable such as ${OPENAG_MCP_NAME} instead", 400);
      if (deps.approvals.listPending().filter(approval => approval.toolName === MCP_COMMAND_REVIEW_TOOL).length >= MAX_PENDING)
        throw new McpServerError("too many command reviews are waiting for a decision; decide or wait for them to expire", 409);
      let approvalId: string;
      try {
        ({ approvalId } = deps.approvals.request({
          roomId: resolveDeliveryRoom(deps.db, deps.ledger) ?? "_system",
          botId: getDefaultBotId(deps.db) ?? "daemon",
          toolName: MCP_COMMAND_REVIEW_TOOL, toolClass: "act-external", source: MCP_COMMAND_REVIEW_SOURCE, payload,
        }));
      } catch { throw new McpServerError("the proposal is too large to review", 400); }
      remember(approvalId, { state: "pending" });
      armExpiry(approvalId, expiryMs);
      return { approvalId, expiresInMs: expiryMs, review: built.display, replaces: existing !== undefined };
    },
    result: id => states.get(id),
    async idle(){while(running.size)await Promise.all([...running]);},
    dispose() { disposed=true;off(); for (const timer of timers) clearTimeout(timer); timers.clear(); },
  };
}
