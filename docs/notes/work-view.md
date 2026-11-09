# OA-323 Work view and contextual inspector

Implemented on 1 November 2026 in `codex/desk-shell`, following OA-315 (`394507c`) and OA-322 (`bd03a21`). The owner approved updating the existing desk on 4747 after verification.

## Behavior

Work has global search, all seven durable states, sequential cursor paging and details selected by URL independently of the loaded list. Conversation cards use actual room Work. Group context is room-scoped; direct-chat context belongs only to its selected bot across public rooms, with origin labels. Hidden rooms remain excluded. No sample Work or fabricated historical results are inserted.

The inspector provides Work, Files, Computer and Activity on desktop and through Work & results on phones. A single kept-mounted room inspector retains selection, active tabs and unsent approval edits across responsive transitions. Composer remains mounted. Stream updates use existing StreamProvider subscriptions and coalesced reads. Reconnect drains forward activity pages before declaring catch-up complete; older paging has its own cursor. No second WebSocket or Work polling loop was added. Approval links also refresh on approval events and reconnect even if Work status/turn counts do not change. Refresh reads through the oldest loaded approval cursor so paging and keyed unsent edits remain intact.

Recorded execution, model-reported plans, approvals and saved proposals have separate labels. Accepting an approval or reporting a completed plan does not mark execution complete. Cancel posts the current revision, shows requested while execution settles, and reads the resulting durable state. A stale response cannot overwrite a newer revision. Linked approvals use the existing ApprovalCard and decision API; Files uses OA-322 versions, authorization and inert text previews.

`GET /work/:id/activity` includes only that public Work's source message, turn-linked events and own lifecycle events. Large ledger payloads are projected inside SQLite before JavaScript reads them, with an explicit truncation flag; full details remain in Ledger. Search is bounded to 300 characters and applied before paging. Work lists use 20 records per page to fit the existing 2 MiB Work/results RTC reply cap. RTC also permits the exact revision-checked Work cancellation route; other Work/results writes remain blocked. The desk omits empty query delimiters so canonical RTC URLs work.

Computer context uses the existing shared backend, control lock, authenticated viewer and handback. It does not imply exclusive ownership by one Work item. Status errors remain visible and unknown control never appears available. Polls do not overlap and stop while the mobile inspector is closed. Pending operations clear busy state even if hidden. Closing clears/revokes screenshots; reopening requires an explicit fresh screenshot. Real unmount also revokes the URL.

## Verification

- `pnpm -r build`: daemon/desk builds and typechecks passed. Existing large-entry-chunk advisory remains.
- `node scripts/verify-work-view.mjs`: actual temporary gateway/runner/SQLite with a controlled runtime; all seven states, global search beyond the first page, literal search bounds, room/bot/private isolation, scoped before/after activity, more than 100 missed events, bounded large payloads, delegated Work, saved results, real control guard, authenticated viewer and handback passed. The fixture kills/restarts its child to establish interrupted state. No model account or external computer is used.
- `node scripts/verify-results.mjs`: result/version/security assertions passed, including actual desk API and RTC client modules through the controlled RTC bridge, encoded search, empty queries, strict paths/methods, revision-gated cancellation response and bounded reply frames.
- `node scripts/verify-work.mjs`, `node scripts/verify-uploads.mjs`, `node scripts/verify-desk-flow.mjs`: standalone regression assertions passed. Script syntax and `git diff --check` passed. Unit tests/Jest were not run, per owner instruction.
- Browser: all state filters, global search, an old URL-selected item outside loaded cards, actual requested-to-cancelled transition, direct-bot origins, linked result preview and Escape, phone layout/light/dark, responsive tab/selection/composer/approval draft retention passed. Offline/reconnect retained drafts and the selected item; 120 missed tool call/result rows caught up exactly once. A completed reported step remained Working until the actual runner settled. A parallel third approval appeared with unchanged Work state; a fourth created offline appeared on reconnect, retaining the unsent JSON edit in both cases. With 52 pending approvals, an edit on the older page survived a 53rd live approval and a 54th offline approval on reconnect.
- Browser computer checks: valid authenticated screenshot; screenshot cleared on hide; delayed takeover response while hidden recovered enabled controls on reopen; actual guard paused input; bearer-authenticated viewer displayed the controlled screen without logging its URL; handback restored agent input. Hidden panel produced zero extra computer/control reads and retained one shared WebSocket. Temporary network emulation was reset.
- Standards and Spec source reviews passed after fixes. Built-in source review found an approval-link refresh gap; it was fixed and verified with same-state parallel approvals and reconnect. The focused source re-review reported no actionable defects after the loaded-page retention fix.

The disposable fixture is `scripts/work-view-fixture.mjs`; interactive mode is `node scripts/verify-work-view.mjs --serve`. It refuses a data directory outside its owned temporary prefix, strips provider environment variables, and uses only synthetic data. Temporary pairing codes/viewer tickets must not be reused for the live desk.

## Limits

No unit tests/Jest, live WebRTC/ICE device, or real computer provider was exercised. Native file drag/drop was inspected through its shared handler; OA-315's real Claude and Codex checks independently read the synthetic text and image. The existing launchd Claude issue remains a separate known issue. OA-324 exact execution receipts and OA-325 question continuation are still open.


## Existing-desk release

Released source `8a19eeb` on 4747 on 1 November 2026, including the OA-315/OA-322 dependencies. The existing checkout fast-forwarded without changing its untracked `.agents/`, `AGENTS.md` or `skills-lock.json`. Its `pnpm -r build` passed. Before restart, the service target/plist and zero running turns were verified; an online database backup and both previous dist trees were retained under `$OPENAG_DATA/backups/oa323-release-2026-10-31T14-18-04-514Z`. A copy upgraded from schema14 to16 with integrity/history checks before the live restart.

The same launchd job received SIGTERM and restarted through its graceful KeepAlive path: PID92571 →76317. No installer, seed, bot/settings change or new live browser credential was used. Readback verified health, schema16, SQLite integrity, nondecreasing historical table counts, unchanged bot/settings/plist hashes and preserved pending approvals. Upload/result tables start empty; historical messages were not fabricated into new records.

Rooms/bots/approvals/Work/results returned200 with existing owner authority; Work/results returned401 without it. Invalid pagination returned400 and missing activity404. Root HTML matched the build and had no-store; `/assets/index-DBcXkZSH.js` matched the built SHA-256. The browser loaded the live sign-in page. Authenticated visual flows were verified in disposable targets, not by creating a live browser device. Temporary fixture listeners were closed. Aggregate evidence: release record.

The backup contains previous runtime assets for rollback. The old daemon can ignore the additive upload/result tables; do not restore the older database over newer user data as a routine rollback. The focused built-in source re-review found no actionable approval-refresh defects after cursor retention was added.

## Part 3A: compact summaries (OA-410)

The global Work page uses one compact row per item, stacked on phones. Contextual summaries keep the same title, next step, agent, state and updated-time hierarchy. Technical identifiers and execution counts are retained in Execution details; runs remain in Turn history. Pending approvals and existing Start/Cancel controls remain outside those optional disclosures. Existing list readers, paging, stream refresh and URL-selected detail behavior are unchanged. Empty Work explains explicit accepted proposals, rather than implying all conversation requests create Work.

Controlled build/browser acceptance and remaining device/live limits: OA-410 evidence.
