# Nightly reflection (OA-203, OA-459)

A scheduled, unattended turn (setting `reflection`, off by default, 03:30 local) reads the bot's `MEMORY.md` and a digest of the last `lookbackHours` of conversation from non-hidden rooms. It returns strictly validated memory notes and optional skill drafts as JSON. The isolated model turn has no tools and cannot write files itself.

The daemon saves valid memory notes automatically through `appendMemoryNote` (redacted, dated, one line per fact) and `commitMemory`. It checks existing notes and the current batch for duplicates and keeps the configured per-run limit. New memory notes create no approval or Needs you item. Manual Run now requires owner/Full access, including when reflection is disabled; Limited devices can read reflection status but cannot start a run. Run history retains the existing `memoryProposals` field for compatibility: new runs count saved notes, older runs count proposals. History and reflection events record counts, never note text.

To remove a saved note, open the agent's Settings, Knows, Memories, delete the unwanted text from Saved memory and select Save. This requires owner/Full access. The save updates the memory search index; subsequent turns read the changed memory. Removal does not erase the original conversation, past prompts or change history, and does not prevent reflection from learning the fact again. There is no delayed save or pre-save cancellation.

Skill drafts still become pending Inbox approvals (`reflection_skill`, act-local). Only an accepted or validly edited approval reaches the skill writer in `reflection-apply.ts`; ignored, expired or responded approvals never apply. Existing pending `reflection_memory` approvals from older releases remain reviewable and are not automatically accepted. Reflection never changes the shared skills library.

The automatic save is a narrow daemon-owned reflection path, not permission for unattended tools to write. Interactive `memory_append`, permission sessions and other scheduled jobs retain their existing gates.

A reflection turn that fails, is cancelled, or is interrupted (including a watchdog stall) records a failed reflection run. Invalid output saves nothing. A filesystem failure also fails the run. If a note was saved but its history commit was not confirmed, the run is failed with its saved count retained; it is not retried or rolled back automatically. An empty run means the turn completed without new notes or skill proposals.

Graceful daemon shutdown waits for admitted reflection requests, automatic saves and queued approval application before closing storage. The existing shutdown deadline still bounds cleanup; a forced exit is not proof of a completed reflection.
