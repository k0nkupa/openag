> Current interaction model: Needs you and Recovery acknowledgements are removed. Questions and explicit decisions live in their originating conversation. See [conversation interactions](chat-interactions.md). Historical acceptance below describes its recorded version.

# OA-324 exact action review and durable receipts

Implemented in the isolated `codex/desk-shell` worktree after OA-323. The owner approved implementation and the established verified update of the existing desk on 4747. No real model account, external send/payment/publish, or live computer action was used for this ticket's acceptance checks.

## Decision and execution

Migration 017 adds immutable proposal review versions and tool-call/review context to approvals, and an `action_receipts` table. A receipt records the original reviewed proposal, effective approved payload, decision, Work/room/bot/turn/tool-call identity, timestamps and bounded redacted evidence. Reflection approvals have no fabricated Work/turn; their actual memory/skill applier supplies execution evidence. Older decided approvals without a receipt explicitly show that execution is unconfirmed.

The decision API requires the version shown to the reviewer. The guarded pending-status update, receipt insertion and ledger events share one transaction; gate waiters settle only after commit. The request retains its decision promise even when a reviewer or expiry resolves it before the runtime starts waiting; a fast decision must not leave the turn waiting forever. A concurrent/stale/already-decided request cannot execute twice. Edits validate before the decision is stored. An edit whose shape or values change during validation is rejected rather than silently normalized into a different action. Tools without reliable local edit validation expose Respond instead. Execution checks the effective snapshot again. Restart permission reuse requires the complete exact payload, including content, rather than only the path/command.

Receipt outcomes are independent of approval and Work status:

- Pending: permission recorded, no final execution evidence.
- Completed: the owned tool's evidence confirms its stated action. Service acceptance does not imply downstream delivery.
- Failed: explicit evidence confirms failure.
- Unknown: execution may have affected the target, but its outcome is unconfirmed.
- Not run: ignore/respond/expiry, refusal or a failed precondition prevented execution.

Execution start is stored before invoking the action. A generic post-start exception or interrupted process becomes Unknown; a model's prose cannot complete a receipt. API/Ollama/MCP callers receive an explicit unknown response rather than a success when evidence is missing. MCP transport success alone is not confirmation of an external side effect. A native adapter completion alone cannot confirm an external action either. A known first-party notification may report service acceptance, with device delivery expressly unconfirmed.

Invocation completion and effect confirmation are separate. Trusted MCP queries complete when a non-error response returns; their payload remains untrusted and cannot grant permission. External and unknown tools still require approval and authoritative effect confirmation. When such an invocation returns without confirmation, the ledger records `invocationOutcome: returned`, the receipt stays Unknown and the caller receives its id, an explicit warning and retained untrusted evidence. This describes the current invocation, not an earlier block. Timeouts do not claim a return. See [MCP classification and completion](mcp.md#trusted-classification-and-completion-oa-379).

Work excludes Unknown from successful outcomes and shows its separate count. An otherwise settled Work item with Unknown execution is Interrupted with an inspection next step, not Completed. A late tool response cannot overwrite an already-Unknown receipt or make the Work count it as success.

## Scoped action conflicts

The earlier removal-only release is historical. The owner's subsequent merge instruction restores scoped conflict protection and owner receipt inspection. Bounded reads remain independent. Known filesystem targets conflict only on overlap across bots/chats; opaque and legacy unscoped writes remain conservative. Inspection preserves Unknown and invalidates only conflicting pending proposals. It does not replay an action or create a general permission grant. Model changes and agent-request admission remain independent; their actual tool actions pass through the shared scope check. The receipt page and owner-only inspection API provide recovery. See [daemon execution](daemon-execution.md#bounded-inspection-and-conflict-scope).

## File review and adapters

Daemon `write_file` exposes the complete current UTF-8 file and proposed content, subject to a 64 KiB file baseline and proposal-JSON limit, with a 128 KiB aggregate review snapshot cap. Paths stay inside the bot's workspace, symlink escapes are refused and reads use no-follow descriptors with bounded buffers. The before digest is rechecked before writing. Oversized/binary/uninspectable files require a smaller or separately inspectable proposal; omitted tails are never silently approved.

Native Write/Edit/MultiEdit and supported Codex ACP diff content receive the same complete baseline and proposed post-state. The baseline is checked before granting permission. After an adapter reports completion, the daemon reads the affected files and confirms the exact expected contents/deletions before marking Completed. A stale baseline is Not run; mismatched readback is Unknown. Unsupported native file formats fail closed. The existing gated `write_file` tool is also offered through first-party MCP as a safe fallback, with the same class and workspace checks. Native edits are not editable in place through the desk; Respond requests a fresh exact proposal.

Adapter format evidence came from the installed `@agentclientprotocol/codex-acp` 2.3.0 bundle (`FileChangeReporter` and permission renderer) and `@agentclientprotocol/claude-agent-acp` 0.97.0 diff implementation. Codex permissions may omit raw input and diffs already announced in the tool call, so OpenAg retains that call's diff content for review. Upstream context: [Codex ACP](https://github.com/agentclientprotocol/codex-acp), [Claude ACP](https://github.com/agentclientprotocol/claude-agent-acp).

## Desk

Inbox, conversation and Work use the same versioned review card and linked durable receipt page (`#/approvals/:id`). The review shows target/file/service fields, full payload, file comparison where supported, review version and source Work/message/tool-call/ledger links. Inbox decisions open their receipt. Work history and conversation activity link to it after the pending card disappears. Receipt reads refresh through the existing shared stream and reconnect; the browser stores no receipt database.

Conversation activity labels returned Unknown operations “returned; effect unconfirmed”, while missing responses remain “outcome unknown”. Unknown receipts retain their outcome and evidence without an inspection form or receipt-driven recovery requirement. Payloads/evidence render as inert React text. Authenticated no-store reads reuse `/approvals/:id` and `/work/:id/receipts`; the former inspection mutation is unavailable. RTC replies for bounded approval detail use the existing 2 MiB chunked ceiling.

## Verification

The build, standalone controlled assertions, browser checks and source-review results are recorded in the ticket log and release evidence below. Unit tests/Jest are excluded by owner instruction; the build only typechecks desk fixture declarations. Real model/provider/ICE acceptance is not claimed. The existing entry-bundle advisory remains.


Acceptance evidence:

- `pnpm -r build` passed: daemon/desk typechecks and builds. Existing Vite entry-size advisory only.
- `node scripts/verify-action-receipts.mjs` passed through a real temporary HTTP gateway, approvals, runner and SQLite. Covers exact edited payload/version, pre-decision validation, stale/double decisions, Ignore/Respond, explicit provider refusal, confirmed service acceptance, effect followed by lost response, SIGKILL/restart uncertainty, cross-bot repeat refusal, concurrent approved start refusal, owner-only/version-bound inspection, pending-proposal expiry and no replay, actual desk limited-device owner retry, stale file baseline and normalized-edit refusal, exact restart reapproval, authenticated reads and locked policy.
- `node scripts/verify-work.mjs` passed with added controlled ACP file cases: exact readback completes; changing the baseline before acceptance refuses permission; an adapter's mismatched write stays Unknown. Native command completion remains Unknown until owner inspection; its independent marker verifies that actual effect and receipt certainty are distinct.
- Standalone `verify-work-view.mjs`, `verify-desk-flow.mjs`, `verify-results.mjs`, `verify-uploads.mjs` passed. Script syntax, shell syntax and `git diff --check` passed. No unit tests, Jest or hooks ran.
- Browser: Inbox-to-receipt, conversation-to-receipt, receipt-to-Work and Work-to-same-receipt links; exact edited payload; rapid double action executing once; owner inspection retaining Unknown after reload and expiring the old proposal; fresh proposal and fresh approval; offline failed decision preserving its draft and no replay when online; actual shared-stream Reconnecting → Live preserving the unsent edit and route; 390 px light/dark and 1280 px desktop without document overflow passed. Temporary network/viewport overrides were reset and verification tabs closed.
- Standards and Spec source reviews passed after fixes. Built-in full source review findings were fixed, followed by clear focused owner-retry and inspection-epoch re-reviews. Reviewers ran no tests/builds/scripts/hooks/services or writes.


## Existing-desk release — 1 November 2026

Source `a358db1` was released on the existing 4747 desk. The existing checkout fast-forwarded from `d8eff20`; unrelated untracked `.agents/`, `AGENTS.md` and `skills-lock.json` were preserved. A verified online backup and both prior dist trees are retained under `$OPENAG_DATA/backups/oa324-release-2026-11-01T00-10-38-694Z`. A copy of the actual database migrated from schema16 to17 with integrity, table counts and existing approval payload/status history intact, and zero fabricated receipts.

With no running turns, the existing launchd job was stopped while the existing checkout built both daemon and desk. Its unchanged plist was then bootstrapped, avoiding a window with new UI and old backend. `pnpm -r build` passed; no dependency install, installer, seed, unit/Jest runner, hook, bot/settings change or new live browser credential was used. PID76317 →12038.

Readback passed: health; schema17 and SQLite integrity; preserved historical counts and approval payload/status hash; unchanged bot/settings/plist hashes and pending approvals. Authenticated rooms/bots/approvals/Work/results returned200; receipt/Work reads returned401 without credentials and missing IDs404 with credentials. Root HTML had no-store and matched the build; `/assets/index-BelXr2hw.js` matched its SHA-256. The browser loaded the live sign-in page; authenticated UI acceptance used disposable targets. All verification tabs/listeners were closed and temporary viewport/network overrides reset. Aggregate evidence: release record.

Prior assets are retained for runtime rollback. Migration17 is additive; do not restore the old database over newer user activity as a routine rollback. Unknown external outcomes conservatively pause external actions until the owner records target inspection; the original outcome still remains Unknown afterward.

Shared remote invocation, server-input review, catalogue validation and evidence behavior are documented in [MCP lifecycle](mcp-lifecycle.md). These rules apply across integrations; answering server input does not approve another tool or confirm a write. Task-only tools remain unavailable, and interrupted calls are never replayed automatically.

## Permission-session campaign revision (OA-399)

Operation receipts now have a stable `id` and a nullable `approvalId`. Existing receipt ids and evidence are preserved by migration. Reviewed operations retain the original approval id; automatic operations have no human approval row. Permission snapshots retain the selected preset, revision and effective execution boundary. The viewer and activity links accept either kind and explicitly label automatic authorization. Unknown automatic operations retain history and use the same scoped conflict/owner-inspection contract.

This service is wired into the source entry point. Upgraded installations require explicit owner adoption; legacy categories are archived and no longer action authority. This is not a deployment claim. The internal session/dispatch contract and controlled acceptance are documented in [permission sessions](permission-sessions.md).

## Part 3A: review hierarchy (OA-411)

The shared ApprovalCard used by Needs you, conversation and Work leads with a deterministic action label and literal target fields, then the exact payload and supported file comparisons. Ordinary Exact proposal is initially expanded. Known first-party names have fixed readable labels; unknown names remain exact, with no generated interpretation. Review details contains tool/review/source identifiers. Edit, Respond, Ignore, duplicate-submit/version checks and retained drafts are unchanged. Avatar/reflection previews remain; their exact payload can be inspected before approval. Integration input requests have a distinct label in both the request list and form. No new categories, counts or decision contracts are introduced.

Controlled acceptance: OA-411 evidence.

## Part 3A: receipt and recovery hierarchy (OA-412)

The receipt separates Your decision from Execution outcome. Evidence and unknown-outcome inspection remain prominent; effective/original payloads and Receipt details retain the exact stored review and provenance. Accepted, pending evidence, completed, failed, unknown and not-run remain distinct. Legacy decisions without receipts show Unconfirmed. An edited legacy decision uses the existing retained edit field when available; a missing edit shows only the explicitly labelled original proposal, without presenting its target as the accepted target. Chat-only receipts never acquire fabricated Work links. Inspection failures have their own error rather than being labelled receipt-load failures. Existing dirty/busy navigation protection covers the mounted inspection draft. A confirmed inspection response clears its draft and updates the recorded inspection; failures retain it without retry. The original outcome remains Unknown, with all server-side inspection/version/repeat protections unchanged.

Controlled acceptance: OA-412 evidence.
