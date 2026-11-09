# Durable automation outcomes

Implemented in the isolated `codex/desk-shell` worktree after OA-325. The owner approved the plan, including one installed Codex run on a real timer into a disposable local room. Existing authority permits updating the desk on 4747 once verified. No new dependency or scheduler replacement.

## Runs and delivery

Migration 019 adds `automation_runs`, independently retained after automation rename/deletion. Each actual accepted attempt records a stable ID, automation ID, frozen redacted purpose/owning bot/room, configured trigger (cron/timezone or repository/interval/events), permission flags, invocation source/event, start/end, outcome, summary and execution links. Secret values, raw payloads, poll cursor and ETag are not exposed in history. Existing last-run fields are preserved as legacy information; older runs are not fabricated from them.

One launch path reserves both the automation and its bot/room before asynchronous execution. Cron, manual, signed webhook and polling attempts share it. Paused, busy, backoff and unavailable starts return an explicit refusal without creating a successful run or overwriting the previous outcome. Manual runs keep the original unattended/no-tools/read-only/offline/approval restrictions. An in-flight attempt finishes if its automation is paused; pause prevents later starts.

Execution outcomes are `running`, `quiet`, `completed`, `incomplete`, `cancelled`, `failed` or `interrupted`. Work and receipt state take precedence over a model turn merely finishing. Pending/input-waiting Work cannot become Completed. A successful silent/no-change poll is Quiet; invalid verdicts and failed checks remain failures. Unknown action outcomes remain interrupted with their existing inspection/approval protections.

Delivery is separate evidence: none recorded, an actual conversation output, a digest item, a desk ping, or a suppressed wake decision. `referenceId` points to the actual delivery row; `wakeDecisionId` separately identifies the filter decision. A ping proves a message was recorded in the desk, not device receipt or downstream external delivery. Quiet background runs stay in history without becoming Needs you alerts. Existing configured room output is preserved; wake-mode output still passes the existing wake filter, including its dedupe/active-hours/urgency/budget rules. Wake parsing retains the final 20,000 characters across all output chunks, not a clipped beginning.

Startup marks unfinished attempts Interrupted and never replays them. Recovery retains any already-recorded message/digest delivery rather than claiming no delivery occurred. Shutdown closes admission, aborts provider fetches, fences queued work and late wake/cursor/timing writes, marks unfinished runs interrupted and waits boundedly before DB closure. Poll execution uses its launch-time target/configuration; cursor and timing writes require the same repository, so editing the target mid-request cannot seed the new target with old state.

## Timing and UI

The scheduler exposes its own next due time through a read-only interface. Cron retains five-field validation, existing overlap/no-catch-up behavior and the configured IANA timezone. Polling uses its persisted interval/backoff deadline directly as the scheduler input and reports that same deadline. It does not project future minute checks or label a skipped eligibility check as the next poll. Event-driven jobs show Waiting for an event; disabled jobs show Paused; unavailable/busy reasons are explicit. No browser-side `lastRunAt` estimate is used. A single deadline timer rechecks time-limited Run now restrictions when they expire. Refresh automations also allows an explicit recheck; neither opens another application stream or recurring poller.

The old separately fetched table and list now use one overview/editor reader. It shows purpose, owning bot, trigger, next run/check, last outcome, pause and supported existing editing/secret controls. Paged history includes quiet runs, retained snapshots, a detail sheet and valid public Work/results links. Hidden execution rooms/Work stay hidden. Stream completion/reconnect refreshes the overview/history while preserving an open editor's in-memory draft. The table scrolls locally at phone width; the page does not overflow.

## Missed schedules and start diagnostics (OA-372)

Automation history distinguishes executions from scheduling diagnostics. A diagnostic has an observation time, bounded reason and phase, and an optional scheduled instant/range. Its start time, turn and Work are absent. Outcomes are Missed, Skipped, Start failed or Coverage gap. Diagnostics do not overwrite the last execution outcome or create owner alerts; delivery remains None. Existing wake-mode results still use the wake filter.

Enabled cron configurations retain their next due instant and redacted configuration snapshot. On restart, overdue known opportunities form one bounded range record, then scheduling resumes at the next future instant. No historical invocation, action or notification is replayed. First upgrade starts an evidence baseline without reconstructing older schedules. Pausing ends that baseline; resuming starts another. A changed configuration with overdue old evidence records uncertain coverage under the old snapshot, never the new schedule projected backwards. Missing evidence does not certify business inactivity.

A late live tick admits at most one check, attributed to the latest due instant. Earlier opportunities are grouped; no per-period backlog is allocated. Forward cron traversal is capped at 256 opportunities per observation. Larger gaps become one Coverage gap through the observation time; no late execution is admitted in that case. Forward traversal preserves the scheduler’s daylight-saving behavior, including nonexistent local times. Busy overlap/approval ownership is a skip, not queued work. Retained execution, turn and approval intervals are checked as well as current availability. When older availability is restricted or uncertain, the range is Coverage gap rather than a definitive miss. Current registration/admission failures are retained once per known configuration/occurrence. Database failure can prevent recording; no durable guarantee is made while storage is unavailable. Repeated sync/restart cannot duplicate a committed diagnostic or admission. Cron interpretation and DST come from the installed cron parser; scheduled instants use epoch milliseconds, separately from observation/start.

GitHub polling keeps its existing persisted cursor, ETag, eligibility and backoff semantics. No artificial cron occurrences or missing source events are inferred for polling/webhooks. Manual paused/busy/backoff refusals remain current restrictions without generating scheduled-miss history. Already-admitted runs continue to recover Interrupted with their observed delivery references. No new alerts, push behavior, live connector monitoring or automatic catch-up are introduced.

The desk shows diagnostic reason/phase, Scheduled and Observed times and “Not started”; execution links appear only when actual evidence exists. Historical execution rows and paging sequences survive migration unchanged.

## Verification — 1 November 2026

No unit tests or Jest were run, directly or through scripts/hooks. Existing affected test fixtures/assertions were adjusted for truthful start results and the new view/outcome contract; they were not executed. The desk build typechecked its included test sources only.

Passed checks:

- `pnpm build` — daemon TypeScript, desk TypeScript and Vite. Existing entry-chunk size warning remains.
- `node scripts/verify-automations.mjs` — public HTTP/scheduler/runner acceptance with synthetic providers: quiet/completed/failed/interrupted outcomes; auth/redaction; actual delivery references; incomplete Work; pause and bot/room reservations; restart/no replay; cron timezone/DST and next due; valid/invalid signed hooks; private room isolation; polling cooldown/backoff; edit during held poll; queued/in-flight shutdown; crash after an already-delivered ping; long single/multi-chunk final verdicts; secret-bearing event metadata; frozen history after rename/delete and paging.
- `node scripts/verify-automation-real.mjs --authorized-codex` — one actual installed Codex run fired by a real cron timer. Its no-tools reply reached the empty temporary target's local room and linked Work completed; zero approvals/external actions. [Recorded evidence](real-trigger.json). Temporary target was stopped afterward; live desk/project files were untouched by this check.
- Existing standalone Work, Needs you and action-receipt checks passed. No model account was used by those controlled checks.
- Browser: actual configured next due/timezone and polling backoff; history filter/detail/frozen configuration; links to real Work; pause disables Run now and survives reload; daemon-accepted manual start; automatic cooldown expiry re-enables Run now without a click/reload; disconnect/reconnect retains editor draft; 390px page with local table scrolling and contained detail sheet; no captured console errors. [Desktop](run-details.jpg), [phone](history-phone.jpg).
- Standards/Spec reviews: initial snapshot/shutdown findings fixed and rechecks clear. Separate built-in Codex source review found output-tail/redaction, unfinished-Work, availability and delivery/timing issues. They were fixed and covered by controlled assertions. The final read-only `codex review --uncommitted` gate reported no substantive correctness or security regressions.
- A copy of the actual live schema-18 database migrated to schema 19 with integrity and historical counts/approval history preserved. No automation run history was fabricated.

## Existing desk release — 1 November 2026

Source commit `ff6f854` was fast-forwarded into `<repo>/`. The existing launchd job was stopped for a matching daemon/desk build and bootstrapped from its unchanged plist. PID changed from `51149` to `9481`; port 4747 and the data location were preserved. No installer/seed or live model/automation run was performed during cutover.

The actual database migrated from schema 18 to 19 and returned integrity `ok`. Historical table counts, event contents, approval rows, pending approvals, bot/settings configuration and service plist matched the pre-release snapshot. There were zero configured live automations and zero fabricated run records. The backup and prior runtime assets are retained at `$OPENAG_DATA/backups/oa326-release-2026-11-01T01-26-05-737Z`.

Authenticated automations/history, Work/results, attention, rooms/bots and approval reads returned 200. New history reads required authentication; missing records returned 404. Root HTML had `no-store`, matched the build, and its served JavaScript asset matched the local SHA-256. The live browser loaded sign-in without creating a device/credential. Temporary verification processes/listeners/tabs were closed and viewport overrides reset; unrelated project listeners were preserved. Machine-readable release record.

The schema change is additive. Retain the backup for recovery; restoring a database would discard later records and requires a separate decision.
