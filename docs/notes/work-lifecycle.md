# OA-321 — durable Work records

Current verification refresh: OA-437 suite repair and combined harness release. The standalone suite now adopts its disposable permission state explicitly and asserts native ACP refusal in all modes. Historical native-effect acceptance below predates daemon-only execution; it is not the current permission contract.

Work is owned by the daemon. One assignment per `(room, bot, request event)` keeps a stable ID across turns and approval recovery. Delegations create child Work; result turns remain linked to the parent's Work. Existing conversation history is retained without manufacturing historical Work records.

Migration `014_work.sql` adds Work, its queued/executing/draining turn associations, and tool-call aliases for one-shot approved resumes. Canonical aliases correlate actual daemon/native ACP call IDs across restart; they do not grant permission. Existing policy, pregrant target matching, unattended limits, hop/fan-out rules and redaction remain authoritative.

States: `working`, `needs_input`, `needs_approval`, `completed`, `failed`, `interrupted`, `cancelled`. Status follows runner, tool, approval and child evidence. Reported plan steps are explicitly **not execution evidence**. `TurnContext.reportWork` accepts bounded next-step/input/plan metadata; ACP plan notifications feed it. Runtimes without structured plans keep an empty plan. Question/answer UX is OA-325; Work screens are OA-323. A rejected or failed tool never becomes a successful action because the model says it finished.

Work changes and their redacted `work_updated` events commit in one SQLite transaction; publication follows commit. Streams use the existing ledger/StreamProvider. List ordering uses immutable sequence cursors, not mutable update times. Internal rooms are excluded from public Work reads. There is no browser database or generic public status setter.

## HTTP contract

- `GET /work?roomId=&botId=&parentId=&status=&before=&limit=` — authenticated, newest-created first, default 50/max 100, `nextCursor` for another page.
- `GET /work/:id` — current Work, revision, reported plan and execution progress.
- `GET /work/:id/runs?before=&limit=` — paginated message/turn associations and outcomes.
- `GET /work/:id/approvals?before=&limit=` — paginated approval links and decision status.
- `POST /work/:id/cancel` with optional `{ "revision": number }` — owner/full-device only. Stale revisions return 409; repeated cancellation is idempotent. A confirmed stop returns 200, a pending/unconfirmed stop 202. Clients must read status rather than interpreting 202 as cancellation confirmation.

Cancellation covers only the selected Work tree. It blocks queued execution, future tools, delegation and approval-driven resumption; expires blocked approvals; uses a session-specific ACP cancellation notification and AbortSignals for Mastra/Ollama. It does not use the watchdog's bot-wide adapter kill. An executing daemon tool must settle before cancellation can be confirmed. Unknown tool outcomes stay interrupted and require target inspection. Cancellation does not undo prior side effects. Exact delivery receipts/reconciliation UI remain OA-324.

Graceful shutdown persists interruption before runtime/database teardown. Startup reconciles queued/running work and finished turns draining delegation; a missing delegated return is not silently treated as completed. Pending approvals keep their IDs. Accept/Edit can resume through the existing one-shot gate; Ignore/Respond after restart record the known unexecuted old call. Nothing is automatically replayed on startup.

## Verification

No unit runner/Jest was invoked. Existing event-order assertion sources were adjusted to exclude the new Work control events, but those tests were not run.

- `pnpm -r build` — passed; the existing approximately 706 kB desk entry warning remains.
- `node scripts/verify-work.mjs` — passed against a disposable loopback daemon and controlled runtime/ACP/provider adapters. Covers migration from the prior schema and history retention; authentication, invalid requests/references and paginated reads; all seven states; concurrent approval/cancel decisions; redacted storage; rollback without publication; delegation/return linkage; reported-plan versus execution evidence; native ACP terminal notifications; cancellation while queued, awaiting approval, generating, ignoring the signal, and executing a held tool; another ACP room remains active; Mastra/Ollama abort signals; real child-process restart and SIGKILL recovery without replay; stable native and daemon tool-call identity; restarted Ignore/Respond; draining-parent recovery; persisted graceful shutdown state; shutdown between turn completion and delegation/memory bookkeeping; watchdog expiry with an unresponsive cancelled runtime stays interrupted.
- `node scripts/verify-desk-flow.mjs` — OA-314/OA-320 HTTP/runner regression checks passed.
- `node --check scripts/verify-work.mjs`, `node --check scripts/work-fixture.mjs`, `git diff --check` — passed.

The fixtures scrub inherited credentials, use fresh temporary data, and stop their ephemeral listeners on completion. They call no live model/account and leave no preview server running. Verification of real-provider cancellation is not claimed from these controlled adapters.

## Review and release gate

Standards and Spec source reviews passed. Built-in Codex review found recovery/cancellation edge cases; fixes and targeted standalone regressions were added for rejected approvals after restart, draining delegation, terminal initial ACP notifications, memory-await shutdown and an unresponsive cancelled runtime reaching its watchdog. The final `codex review --uncommitted` source review found no remaining actionable defects. Reviewers ran no tests, builds, scripts, hooks or live queries.

A verified online backup and prior dist trees were saved before rollout. Migration 014 was also applied to a copy of the actual live database: integrity passed, existing bot/room/event/approval/turn/device counts were unchanged, and no historical Work was created. The authorized 4747 release passed readback, as recorded below.

## Existing-desk release — 1 November 2026

Source commit `a838b6b` was fast-forwarded into `<repo>/`, built with `pnpm -r build`, and started through the existing launchd service after a second zero-running-turns check. The installer/seed was not rerun. Existing untracked guidance files were preserved.

The fresh verified backup and previous daemon/desk dist trees are under `$OPENAG_DATA/backups/oa321-release-2026-10-31T13-03-38-413Z` (UTC timestamp; 1 November in Pacific/Auckland). The database copy-upgrade verification preceded this release.

Readback: PID 50383 → 92571, `/health` ok, schema version 14, SQLite integrity ok. `/work` returns 401 unauthenticated and 200 authenticated; invalid pagination returns 400 and a missing Work returns 404. Rooms/bots/approvals still return 200. Existing configuration/settings hashes and pending approvals were unchanged; prior table counts were preserved. Work reads start empty because old messages are not backfilled. The served `/assets/index-B9kdg6Sr.js` matches the build. Aggregate evidence: release record.

Only the existing desk on 4747 remains running among this task's desk servers; all temporary verification processes/listeners exited. No live model request, external action, device creation or provider-setting change was used for release verification. Real-provider cancellation is not claimed from the controlled adapter checks. The Work screen remains OA-323; OA-315 is next because OA-322 needs uploads.

Rollback can restore the prior dist trees and restart the service; schema 14 is additive and can remain in place for a code-only rollback. Do not restore the database merely to roll back code, because doing so would discard newer user data. No rollback was required.
