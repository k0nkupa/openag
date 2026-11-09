import { useStream } from "./stream";
import type { Approval, LedgerEvent, WorkItem } from "./types";
import type { AvatarMood } from "./components/BotAvatar";

/** Work already reconciles turns, delegation, approvals and unknown tool outcomes. */
export function useAvatarMoods(events: readonly LedgerEvent[], approvals: readonly Approval[]) {
  const { status, completedWork } = useStream();
  const work = new Map<string, { bot: string; status: string }>();
  for (const event of events) {
    const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
    if (event.type === "work_updated" && typeof payload.workId === "string" && typeof payload.status === "string") {
      work.set(payload.workId, { bot: event.actor, status: payload.status });
    }
  }
  const moods = new Map<string, AvatarMood>();
  if (status !== "live") return moods;
  for (const [id, item] of work) {
    if (item.status === "completed" && completedWork.get(id)?.celebrating) moods.set(item.bot, "happy");
    else if (["failed", "interrupted", "incomplete", "cancelled"].includes(item.status)) moods.delete(item.bot);
  }
  for (const item of work.values()) {
    if (item.status === "working") moods.set(item.bot, "thinking");
    else if ((item.status === "needs_approval" || item.status === "needs_input") && moods.get(item.bot) !== "thinking") moods.set(item.bot, "waiting");
  }
  for (const approval of approvals) if (approval.status === "pending" && (!moods.has(approval.botId) || moods.get(approval.botId) === "happy")) moods.set(approval.botId, "waiting");
  return moods;
}

export function useWorkAvatarMood(item: WorkItem): AvatarMood {
  const { status, completedWork } = useStream();
  if (status !== "live") return "idle";
  const completion = completedWork.get(item.id);
  if (completion && (item.status === "completed" || completion.revision >= item.revision)) return completion.celebrating ? "happy" : "idle";
  if (item.status === "needs_approval" || item.status === "needs_input") return "waiting";
  if (item.status === "working") return "thinking";
  return "idle";
}
