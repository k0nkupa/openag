import type { Approval, Approvals } from "./approvals.js";
import { commitMemory } from "./datagit.js";
import type { Ledger, LedgerEvent } from "./ledger.js";
import { appendMemoryNote } from "./memory.js";
import {
  MemoryPayloadSchema,
  REFLECTION_MEMORY_TOOL,
  REFLECTION_SKILL_TOOL,
  SkillPayloadSchema,
  type SkillPayload,
} from "./reflection-schema.js";

/**
 * Applies approved skill proposals and legacy memory approvals still pending from older releases.
 * New reflection memory notes are saved by reflection.ts, without creating approvals.
 */

export interface ReflectionApplierDeps {
  ledger: Ledger;
  approvals: Pick<Approvals, "get" | "receipts">;
  dataDir: string;
  /** Writes a skill (OA-204). Absent: skill proposals are refused with an error event, never half-applied. */
  saveSkill?: (botId: string, skill: SkillPayload) => Promise<void> | void;
}

export function createReflectionApplier(deps: ReflectionApplierDeps): { dispose(): void; idle(): Promise<void> } {
  let chain: Promise<unknown> = Promise.resolve();

  const fail = (approval: Approval, message: string) => {
    try {
      deps.approvals.receipts.finish(approval.id,{outcome:deps.approvals.receipts.get(approval.id)?.startedAt?"unknown":"not-run",detail:message});
      deps.ledger.append(approval.roomId, "daemon", "error", { approvalId: approval.id, message });
    } catch {
      // nothing else to do
    }
  };

  async function apply(approval: Approval): Promise<void> {
    // The edited payload replaces the stored one, but must pass the same strict schema as a proposal.
    const raw = approval.status === "edited" ? approval.edit : approval.payload;
    if (approval.toolName === REFLECTION_MEMORY_TOOL) {
      const parsed = MemoryPayloadSchema.safeParse(raw);
      if (!parsed.success) return fail(approval, "reflection memory proposal is invalid; nothing written");
      deps.approvals.receipts.start(approval.id,null,null);
      appendMemoryNote(deps.dataDir, approval.botId, parsed.data.text);
      await commitMemory(deps.dataDir, `memory: reflection apply (${approval.botId})`);
      deps.approvals.receipts.finish(approval.id,{outcome:"completed",detail:"The daemon wrote and committed the reviewed memory change."});
      return;
    }
    if (approval.toolName === REFLECTION_SKILL_TOOL) {
      const parsed = SkillPayloadSchema.safeParse(raw);
      if (!parsed.success) return fail(approval, "reflection skill proposal is invalid; nothing written");
      if (!deps.saveSkill) return fail(approval, "skills are not available; nothing written");
      deps.approvals.receipts.start(approval.id,null,null);
      await deps.saveSkill(approval.botId, parsed.data);
      deps.approvals.receipts.finish(approval.id,{outcome:"completed",detail:"The daemon saved the reviewed skill change."});
    }
  }

  const off = deps.ledger.subscribe("*", (e: LedgerEvent) => {
    if (e.type !== "approval_decided") return;
    const id = (e.payload as { approvalId?: unknown } | null)?.approvalId;
    if (typeof id !== "string") return;
    const approval = deps.approvals.get(id);
    if (!approval || (approval.toolName !== REFLECTION_MEMORY_TOOL && approval.toolName !== REFLECTION_SKILL_TOOL)) return;
    // Only an explicit accept/edit applies; ignore, respond and expiry (status ignored) never do.
    if (approval.status !== "accepted" && approval.status !== "edited") return;
    chain = chain.then(() => apply(approval)).catch((err: unknown) => fail(approval, err instanceof Error ? err.message : "apply failed"));
  });

  return { dispose: off, idle: () => chain.then(() => undefined) };
}
