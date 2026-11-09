import type { Approvals, Decision } from "./approvals.js";

/** Simulate a reviewer reading the current proposal before deciding. */
export function resolveReviewed(approvals: Approvals, id: string, decision: Decision) {
  const proposal = approvals.get(id);
  if (!proposal) throw new Error("approval not found");
  return approvals.resolve(id, decision, proposal.reviewVersion);
}
