# OA-346 controlled acceptance

3 November 2026. Source and disposable local data only. The owner approved the scoped OA-345 source dependency exception; OA-345's separate real-runtime gate remains open. No unit/Jest/Vitest, live data changes, inference or deployment.

| Before | After | Why |
| --- | --- | --- |
| Rooms had no creation action | Right-aligned plus opens the New room sheet on desktop and mobile | Makes named rooms accessible without requiring them |
| API picked the first member as lead | Sheet selects existing agents and explicitly chooses a member lead | Keeps identity, membership and lead separate |
| Duplicate IDs conflicted without creation reconciliation | Durable request receipt and Check creation status recover the original outcome | Prevents lost responses from causing another creation |
| Redacted readback could lock a known creation | Show saved room details and Open recorded room acknowledgement | Keeps redaction and allows explicit reconciliation |

## Browser evidence

Used the actual built desk and gateway from `scripts/bot-models-fixture.mjs` in its own temporary data directory. All adapter/model transports were controlled. The installed localhost:4747 service and its browser tab were untouched.

- Created `Room specialist` with the existing New bot flow; it appeared in the room member picker.
- Created `Planning 计划 / café` with exactly coder and Room specialist, explicitly choosing coder as lead. Navigation opened the created room; its context showed two agents and coder's Lead marker.
- Created a second room with the same name and only Room specialist. Readback showed two distinct room identities, both kind `room`, with the intended leads.
- Removed the selected lead from an unsaved draft: Create room disabled until a valid lead was selected.
- Search found the specialist by handle. Enter selected another member without submitting the form. Escape closed the sheet and focus returned to New room.
- Controlled validation failure retained name, member and lead. Controlled lost POST response plus status outage locked the draft and showed Check creation status. Restoring status and checking it opened the original room with no repeated POST.
- A synthetic registered secret as the room name was saved redacted. The sheet displayed the recorded name, members and lead; Open recorded room acknowledged it. A subsequent fresh draft was editable.
- At 390 × 844, the mobile sidebar action closed the sidebar and opened one full-width sheet. No document overflow; sheet bounds were 0–390. Phone creation opened the selected room. Viewport override was reset.
- Rapid double-click produced exactly one Rapid room, confirmed by read-only fixture storage inspection.
- A paired Limited device had New room disabled. Standalone gateway assertions separately verified 403 for creation and receipt reads, with owner/Full accepted.
- Opening coder twice reused the same direct-chat URL, distinct from the named coder room.
- Desk search retained separate command values for the two same-name Planning rooms, keyed by stable room identity.
- Final fixture counters: zero turns, zero prompts, zero Work. Room creation changed no proactive delivery/default-bot settings.

Screenshots: desktop sheet, created room, phone sheet.

## Commands and review

- `pnpm -r build`: passed, including daemon/desk typechecks and handbook packaging. Relay deployment was dry-run only.
- `node scripts/verify-room-creation.mjs`: passed gateway/storage assertions for strict input and access, duplicate names and IDs, exact membership/lead, request-content conflicts, reordered members, eight concurrent submissions, receipt status, redaction, rollback without publication, legacy omitted-lead behavior, one-agent room/direct distinction, direct reuse, restart and no execution/settings side effects. The deliberately injected SQLite failure logged its expected exception and returned 500; assertions verified rollback.
- `node --experimental-strip-types scripts/verify-bot-creation.mjs`: passed controlled discovery/creation compatibility.
- `node scripts/verify-conversation-model.mjs`: passed all conversation/delivery/direct-chat compatibility checks.
- `node scripts/verify-default-bot.mjs`: passed all default-bot checks.
- `node scripts/verify-bot-knowledge.mjs`: passed four integration groups after updating the fixed topic count and extending runtime retrieval assertions for the new room-creation topic. API/Ollama/cached ACP/MCP/default-bot delivery checked using temporary data. The initial authoring-fixture errors were corrected before the passing rerun.
- Changed Node scripts passed `node --check`; changed Markdown links, migration numbering and `git diff --check` passed.
- Independent Standards/Spec reviews and focused follow-ups are clear. Initial reviews found redacted-name acknowledgement and API-replacement lock defects; both were fixed. The API-generation guard preserves a pending draft as uncertain while releasing obsolete request locks; actual RTC reconnection was not simulated.
- Final `codex review --uncommitted` found no substantive remaining defect; it also ran daemon/desk typechecks, the standalone room check and whitespace validation. No unit runners were used. A final focused built-in follow-up also cleared explicit-null lead rejection; the affected standalone room and packaged-knowledge checks passed again.

Knowledge sources: GLOSSARY.md, docs/openag.md, docs/notes/conversation-model.md, docs/notes/room-creation.md, conversations/room-creation help and manifest. This is source/controlled acceptance, not deployment or real model acceptance.
