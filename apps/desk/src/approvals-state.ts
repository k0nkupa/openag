import type { Approval } from "./types";

/**
 * Keeps object identity for approvals that did not change, so an unrelated refresh does not re-render (or reset)
 * cards whose data is the same. Cards are keyed by id, so their local draft state survives regardless.
 */
export function mergeApprovals(prev: readonly Approval[], next: readonly Approval[]): Approval[] {
  const before = new Map(prev.map((a) => [a.id, a]));
  const out = next.map((a) => {
    const old = before.get(a.id);
    return old && JSON.stringify(old) === JSON.stringify(a) ? old : a;
  });
  const unchanged = out.length === prev.length && out.every((a, i) => a === prev[i]);
  return unchanged ? (prev as Approval[]) : out;
}
