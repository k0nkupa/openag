> Current interaction model: Needs you and Recovery acknowledgements are removed. Questions and explicit decisions live in their originating conversation. See [conversation interactions](../chat-interactions.md). Historical acceptance below describes its recorded version.

# OA-325 Needs you

The owner approved implementation in `codex/desk-shell` and updating the existing desk on 4747 after verification. This slice adds All, Approvals, Questions, Recovery and Decided to the real desk. It uses existing Tailwind/shadcn components, shared stream, action review, receipts and saved-result readers. No dependency was added.

## State and continuation

Migration 018 adds durable questions, recovery acknowledgements and links between attempts. `/attention` pages canonical server-owned items with a timestamp/ID cursor; `/attention/summary` supplies the navigation and room counts. Work counts use that same query and include unique child blockers without creating parent queue rows. Internal rooms are excluded. Decided lists recorded approval decisions and never counts as active attention. Quiet/unattended Work failures and inherited parent failures do not create recovery alerts. Existing public reflection proposals still appear as genuine approvals.

`request_input` is daemon-owned control bookkeeping, exposed to API, Ollama and the scoped ACP MCP connection. It stores the exact bounded question and pauses the turn. It cannot be used by background/isolated/internal turns, during another tool execution or while an action review/execution is pending. Old report-only input needs remain explicitly labelled, using the recorded next step with no invented question text. Startup can capture old interactive delegated reports too; pending approvals retain priority.

An owner/full device answers the current question revision. The answer, one message and one prepared Work run commit together through normal ingress. The server fixes the original bot, room and Work; answer mentions do not route it elsewhere. Original restriction/delegation metadata is preserved, with no approval pregrant. A repeated identical answer returns the stored result; a changed/stale/cancelled answer cannot create another continuation. A committed but never-started continuation is recovered once. A started continuation is never replayed automatically. ACP cancellation retires the old room session and scoped token before its continuation starts.

Recovery shows the original outcome, saved results and links to Work/activity/receipts. A fresh attempt requires owner instructions and creates separate linked Work. Its restriction snapshot is frozen when the recovery action commits, rather than read from a later run. Failure history stays unchanged. Cancelled Work has no generic retry. Pending/unconfirmed tools block a fresh attempt; an uninspected Unknown requires the OA-324 receipt/target inspection first. Mark as reviewed acknowledges the current issue without changing outcomes or authorizing execution. Cancelled, inactive Work with a missing tool result remains interrupted and is visible in Recovery. Reviewing that issue releases only its historical missing-result model-configuration lock. Active runs, admissions, approvals, questions, pending receipts and uninspected Unknown receipts still block model changes. The issue key includes the cancellation timestamp and latest tool-call event while results are missing, so later evidence cannot reuse an older acknowledgement. Cancelled Work never offers or accepts a fresh attempt, including after receipt inspection.

Each category remembers its own selected request, but only a request still present in the loaded category can show details. A successful empty list renders one full-width Empty component with no old context row, error, request title or results panel. When a selected request leaves a non-empty list, the next available request is selected. Details are mounted once per canonical ID. Response/edit drafts, category and selection survive stream refresh, reconnect and a reload in the same browser tab using session storage. Successful submission clears its draft. Storage-disabled browsers retain in-memory drafts only. A missing recovery response removes stale action controls. On narrow screens the queue scrolls within a bounded area so the response panel remains reachable.

The title and each category show counts using the shared Badge component. Category tabs stay on one horizontally scrolling row on phones, like Settings navigation. The compact request list truncates long titles and readable conversation names; full request details remain available in the selected panel. Mobile lists are bounded to 32% of the viewport height; desktop keeps the side-by-side layout. A muted context row above the details uses the readable room name (or bot name for a direct chat) and a fixed View work link. Missing room metadata uses Conversation rather than an internal ID. This uses the installed shadcn Tabs, Badge and Button components with Tailwind layout utilities.

## Mobile layout follow-up — 2 November 2026

`pnpm -r build`, a final `pnpm --filter desk build`, `node scripts/verify-bot-knowledge.mjs` and `git diff --check` passed. Browser assertions used the real built desk and existing `scripts/work-view-fixture.mjs` with temporary data and controlled tools. At 320/390/768/1440px in both themes: no page overflow, one tab row, count badges, 44px tab targets, mobile stacked panels and desktop side-by-side panels. Empty Decided state, horizontal tab reach, category/reload response preservation, long room IDs and Ignore -> Decided receipt/count refresh passed. Home/End focus and activation passed with browser-dispatched DOM events; native key automation was unreliable. Mobile and desktop screenshots were visually inspected. No physical iPhone/Safari check, unit runners or deployment. The existing build chunk-size warning remains. Handbook verification checked delivery through controlled API/Ollama/cached ACP/default-bot paths; no live install was changed.

The compact context-row follow-up passed `pnpm -r build`, `node scripts/verify-bot-knowledge.mjs`, and built-desk browser assertions against the temporary Work fixture at 320/390/1440px. Named rooms and direct chats show readable labels, long names truncate, View work stays visible on the same row, and both links retain the correct room/Work destinations. No page overflow; phone screenshot visually checked. No unit runners, deployment or physical iPhone/Safari acceptance.

## Verification — 1 November 2026

No unit tests or Jest were run, including via hooks. Existing card checks were updated for the extracted card seam and typechecked only. Verification used the approved public HTTP/gateway/runner and controlled provider boundaries, with temporary data and synthetic effects; no live model account, external send/payment/publish or live computer action.

Passed:

- `pnpm build` — daemon TypeScript, desk TypeScript and Vite. Existing entry-chunk size warning remains.
- `node scripts/verify-attention.mjs` — question/answer/same Work, fixed routing, duplicate/stale/cancelled submissions, normal action approval after a budget answer, child deduplication, quiet/internal exclusion, old report-only/delegated history, startup with an existing pending approval, crash recovery of never-started answers/fresh attempts, no started replay, failure/interruption, restriction snapshots, Unknown guard, Decided and paged counts.
- `node scripts/verify-input-runtimes.mjs` — actual API/Ollama runtime tool loops and ACP permission plus scoped MCP transport, pause/answer, one continuation and no failed wrapper bookkeeping.
- Existing `verify-work.mjs`, `verify-work-view.mjs`, `verify-action-receipts.mjs`, `verify-desk-flow.mjs`, `verify-results.mjs`, `verify-uploads.mjs` controlled acceptance scripts.
- Browser: category changes, independent selected details, answer and recovery drafts across reload, disconnect → reconnect with response intact, answer → saved result/count update, fresh linked recovery attempt, durable Decided/Unknown receipt details, 390px layout with no horizontal overflow, and no captured console errors. [Screenshot](needs-you.jpg) uses a disposable target.
- Independent code-review skill Standards and Spec reviews: findings fixed and rechecks clear.
- Live database backup copied and migrated from schema 17 to 18. Integrity, historical table counts and approval history matched; no synthetic question/recovery/receipt history was inserted. Live target had zero active turns and Work before release preparation.

## Existing desk release — 1 November 2026

Source commit `71be129` was fast-forwarded into `<repo>/`. Its existing launchd job was stopped for the matching daemon/desk build, then bootstrapped from its unchanged plist. PID changed from `12038` to `51149`. Port 4747, data location, bot/settings configuration and existing pending approvals were preserved. The installer and seed were not run.

The database is now schema 18 with integrity `ok`. Historical table counts, approval rows and event contents matched the pre-release backup. The live state had no old report-only input needs to migrate into question records; no synthetic history was inserted. The canonical live summary returned zero active requests and three recorded approval decisions.

Authenticated rooms, bots, approvals, Work, results, attention list and summary returned 200. New reads returned 401 without credentials and missing question/recovery IDs returned 404 with credentials. Root HTML had `no-store`, matched the build, and the served JavaScript asset matched its local SHA-256. The live browser loaded sign-in; no live browser credential/device or model action was created. All controlled verification listeners/tabs were closed and viewport overrides reset. Unrelated project listeners were left alone.

Backup and prior runtime assets: `$OPENAG_DATA/backups/oa325-release-2026-11-01T00-45-52-340Z`. Migration 18 is additive. Retain the backup for recovery; restoring a database would discard later records and requires a separate decision. Machine-readable release evidence.

## Inbox mobile release — 2 November 2026

Owner authorised merging and deploying both Inbox changes. Local `main` fast-forwarded from `d5f7abb` through `179e946` to `7db5b73`. The existing service at `<repo>/` was stopped for a full build and restarted from the unchanged launchd plist (PID 94321 -> 65661). No installer, seed or migration change. Schema remains 23.

Health, authenticated rooms/bots/attention/approvals/Work reads, unauthenticated 401, no-store HTML and exact served HTML/JS/CSS byte comparisons passed. Integrity is `ok`; pre-existing bot/room/settings/approval/tool-mode/turn/event/Work/run rows and device configuration match the verified backup. Device `last_seen_at` changed during authenticated reads. Handbook integration delivery checks passed again using temporary controlled transports. Existing chunk-size warning remains; no unit runners or physical iPhone/Safari check.

Backup: `$OPENAG_DATA/backups/inbox-release-20261102T023717Z` (database plus previous runtime assets). GitHub publication was not performed: local main already contained 32 unrelated unpublished commits before this request. Release readbacks.

## Empty-state correction — 2 November 2026

A saved selection could outlive its canonical category row and display an obsolete recovery title/404 under an empty list. Selection now requires current list membership. Empty categories use one full-width shared Empty component; old panels remain hidden so other-category drafts are preserved. All shows All caught up. No Work history is deleted or retried.

`pnpm -r build`, `node scripts/verify-inbox-empty.mjs`, `node scripts/verify-bot-knowledge.mjs`, script syntax and diff checks passed. The standalone built-desk browser regression uses temporary HTTP/runner data: resolve selected -> next request, resolve last -> Empty only, reload with stale selection, retain a different category's draft, and cancel remaining temporary Work -> All caught up. Verified no page overflow at 320/390/1440px; phone screenshot inspected. No unit runners or physical iPhone/Safari check.

Deployed the correction from `f7970a3` to the same live desk after a verified backup (`$OPENAG_DATA/backups/inbox-release-20261102T025347Z`), idle-turn check and full build. Existing launchd configuration unchanged; PID 65661 -> 81529. Health/authenticated reads and exact served HTML/JS/CSS byte comparisons passed, including the new empty-state text. Database integrity `ok`, schema 23, pre-existing history/configuration preserved; device activity timestamps updated during authenticated reads. Readbacks. GitHub push remains excluded because local main contains earlier unrelated unpublished commits.
