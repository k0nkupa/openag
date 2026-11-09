export type BotId = "boss" | "researcher" | "coder";
export const bots = [
  { id: "boss" as BotId, name: "Boss", role: "Primary", model: "Claude · subscription", description: "Keeps the whole picture. Routes work, remembers decisions, and knows when you need to step in." },
  { id: "researcher" as BotId, name: "Researcher", role: "Specialist", model: "Codex · subscription", description: "Finds the useful signal. Reads sources, compares options, and brings back an answer you can inspect." },
  { id: "coder" as BotId, name: "Coder", role: "Specialist", model: "Codex · subscription", description: "Turns a clear brief into working software. Shows its changes and asks before taking action." },
];
export type Approval = { id: string; bot: BotId; title: string; summary: string; room: string; tool: string; external: boolean; body: string; status: "pending" | "accepted" | "edited" | "responded" | "ignored" };
export const initialApprovals: Approval[] = [
  { id: "a1", bot: "researcher", title: "Send the supplier reply", summary: "To Alex at supplier.example · Re: Updated quote", room: "main", tool: "gmail.send", external: true, body: "Hi Alex,\n\nThanks for the updated quote. The revised lead time works for us. Could you confirm whether delivery is included in the total?\n\nPlease hold the order until we confirm the final details.\n\nThanks,\nTony", status: "pending" },
  { id: "a2", bot: "coder", title: "Create the database migration", summary: "3 files · apps/daemon/src/db/", room: "openag", tool: "write_file", external: false, body: "Create the migration and its runner:\n\n+ apps/daemon/src/db/migrations/014_room_metadata.sql\n+ apps/daemon/src/db/room-metadata.ts\n+ docs/notes/room-metadata.md\n\nExisting room data will be preserved.\n\n+ CREATE TABLE room_metadata (\n+   room_id TEXT PRIMARY KEY REFERENCES rooms(id),\n+   purpose TEXT NOT NULL DEFAULT ''\n+ );", status: "pending" },
  { id: "a3", bot: "boss", title: "Post the weekly note", summary: "#team-updates · Weekly progress", room: "background", tool: "slack.post", external: true, body: "Weekly progress: the new desk foundation is ready for review.", status: "accepted" },
];
export type Automation = { id: string; name: string; trigger: string; bot: BotId; room: string; next: string; enabled: boolean; prompt: string };
export const initialAutomations: Automation[] = [
  { id: "morning", name: "Morning brief", trigger: "Schedule · weekdays 07:30", bot: "boss", room: "main", next: "Tomorrow, 07:30", enabled: true, prompt: "Summarise what changed overnight, what needs me, and what can wait." },
  { id: "prs", name: "Pull request watcher", trigger: "GitHub · repository events", bot: "coder", room: "openag", next: "On a new event", enabled: true, prompt: "Watch the repository for reviews or failed checks that need my attention. Be quiet otherwise." },
  { id: "prices", name: "Supplier price watch", trigger: "Watch · every 6 hours", bot: "researcher", room: "background", next: "Today, 14:00", enabled: true, prompt: "Review the supplier price list and flag a material change. Include a source." },
  { id: "weekly", name: "Weekly note", trigger: "Schedule · Friday 16:00", bot: "boss", room: "main", next: "Paused", enabled: false, prompt: "Draft a concise weekly note from the ledger. Ask before sending it." },
];
export type Entry = { id: number; time: string; room: string; bot: string; type: string; summary: string; detail: Record<string, unknown> };
export const initialLedger: Entry[] = [
  { id: 1849, time: "08:42:18", room: "main", bot: "researcher", type: "approval", summary: "Asked to send the supplier reply", detail: { tool: "gmail.send", class: "act-external", mode: "ask", status: "pending", recipient: "alex@supplier.example" } },
  { id: 1848, time: "08:41:53", room: "main", bot: "researcher", type: "tool", summary: "Read updated supplier quote", detail: { tool: "read_file", class: "read", mode: "auto", result: "Quote read. No order submitted." } },
  { id: 1847, time: "08:38:21", room: "openag", bot: "coder", type: "approval", summary: "Asked to create 3 migration files", detail: { tool: "write_file", class: "act-local", mode: "ask", files: 3 } },
  { id: 1846, time: "08:37:05", room: "openag", bot: "boss", type: "route", summary: "Delegated database work to Coder", detail: { from: "boss", to: "coder", reason: "Software implementation", turn: "t_0412" } },
  { id: 1845, time: "08:31:08", room: "main", bot: "owner", type: "message", summary: "Review the supplier quote and draft a reply", detail: { source: "desk", text: "Review the supplier quote and draft a reply. Don't send it yet." } },
  { id: 1844, time: "08:00:00", room: "background", bot: "boss", type: "wake", summary: "Heartbeat → silent · nothing worth interrupting", detail: { verdict: "silent", reason: "No new actionable change", urgency: "low" } },
  { id: 1843, time: "07:30:00", room: "main", bot: "boss", type: "brief", summary: "Morning brief · 3 things to know", detail: { digestItems: 3, pendingApprovals: 2 } },
  { id: 1842, time: "03:30:14", room: "background", bot: "boss", type: "memory", summary: "Proposed a memory note and a reusable skill", detail: { memoryProposals: 1, skillProposals: 1, applied: false, requiresApproval: true } },
];
export const memories: Record<BotId, string> = {
  boss: "# Memory: Boss\n\n## Standing notes\n- Alex prefers concise answers with enough context to make a decision.\n- host is the single brain. Other devices are clients.\n- Ask before sending, posting, paying or publishing.\n\n## Current work\n- Review the proposed OpenAg desk before changing the app.\n- Keep useful progress quiet until there is something worth sharing.",
  researcher: "# Memory: Researcher\n\n## Working style\n- Prefer primary sources.\n- Separate observed facts from assumptions.\n- Bring back the useful answer with sources.\n- Draft replies; ask before sending.",
  coder: "# Memory: Coder\n\n## Working style\n- Read the ticket and its dependencies first.\n- Make the smallest complete change.\n- Preserve unrelated work.\n- Explain what was checked and what remains unknown.",
};
