# Direct chat and live conversation migration

OA-314/OA-320 were implemented and verified in the isolated `codex/desk-shell` checkout. The owner then authorized updating the existing desk on port 4747 on 1 November 2026; that release is recorded below. Original isolated verification records remain historical evidence.

## OA-314

The owner/full-device `POST /rooms` validates a public slug, bounded name and known members. SQLite creates the room, membership and redacted `config/room_created` audit together. Direct requests must explicitly include `kind: "direct"` (OA-344); they reuse that bot's direct chat. Requests without a kind create named rooms, even with one member. Existing named rooms, hidden rooms and rooms led by another bot are excluded from direct reuse. Existing duplicate IDs return 409. No schema migration or history mutation is needed.

Bots has “New chat with …”. Sidebar/search agent actions use the same create/open behavior. Existing conversations remain available to limited devices; creating one requires owner authority. Browser IDs use `getRandomValues`, which also works on plain-HTTP LAN origins. Room navigation refreshes after creation and reconnect.

Verification:

- `pnpm -r build`: passed (existing large-entry-chunk warning remains).
- `node scripts/verify-desk-flow.mjs`: standalone HTTP assertions passed. Includes 401/403, malformed/reserved IDs and inputs, unknown/duplicate members, no partial room, group lead, empty membership, named one-bot room preservation, explicit direct reuse, hidden/wrong-lead exclusion, eight concurrent requests producing one direct room, redaction and creation audit.
- `node scripts/verify-desk-flow.mjs --serve`: browser fixture on loopback :5193 with fresh temporary data and short-lived pairing codes. The current fixture uses the real runner with a controlled runtime, as described under OA-320; it starts no model adapter.
- Browser: New chat with Writer rapid double click created one conversation; a second visit reused the same URL; reload retained it. Direct-bot settings rendered and 390×844 had no document overflow. Screenshot: [direct chat](oa314-direct-chat.jpg).
- Browser also created a conversation for the valid multiline bot name `Line\nBreak`; its derived room name was normalized. Room lists refresh on route changes, so creation does not depend on hidden `_system` audit delivery (RTC intentionally filters those events). Full RTC transport/device acceptance remains separate.
- Code-review skill: Standards passed; Spec passed after the RTC refresh fix. Built-in `codex review --uncommitted`: first review found RTC refresh and multiline room-name issues; both fixed. Final source-only re-review reported no remaining actionable defects. No test runner or build was invoked by reviewers.

Unit tests/Jest were not run under the owner's rule. Browser fixture records and pairing credentials belong only to disposable temporary data.

## OA-320

The conversation and Needs you views now use the reviewed shadcn Message/Bubble, Trace, MessageScroller, InputGroup, Field, Empty, Tabs and Sheet components. Both approval surfaces share ApprovalCard and the existing server decision API. Approval decisions remain separate from confirmed tool results. Existing API/auth/StreamProvider/runner contracts are retained. The reference prototype is unchanged.

History drains the existing 500-event HTTP pages and backfills on reconnect without letting newer stream events skip older history. Requests can be retried without discarding loaded data. A failed or unconfirmed send keeps its draft; it is never replayed automatically. Composer and approval drafts survive unrelated stream updates; Inbox drafts also survive switching the selected approval. Room navigation and reload are not draft persistence boundaries. Incoming remote messages preserve a reader's position; Jump to latest resumes bottom following.

Verification:

- `pnpm -r build`: passed (entry chunk approximately 706 kB; Vite size warning remains). Both script `node --check` commands and `git diff --check` passed. No unit runner, Jest or hooks were run.
- `node scripts/verify-desk-flow.mjs`: passed against temporary SQLite and the actual HTTP gateway, approvals and runner. The controlled runtime requests one gated `fixture_write`; its validated executor writes only temporary result files, exclusively after approval. Accept and a valid edit write the expected text once; Respond/Ignore do not write. Concurrent duplicate/stale decisions produce one 200 and one 409. Schema-invalid edit and controlled tool failure produce actual error results without a file.
- The fixture actually terminates and relaunches its daemon child with the same temporary database. A pending approval keeps its ID; accepting it resumes the interrupted turn once without another approval. Browser reload/restart also retained a pending approval and showed the resumed tool result after acceptance.
- Browser at loopback :5193: all four decisions, rapid send/decision, invalid JSON, successful edited outcome, unsent composer/JSON/reply drafts through an unrelated approval update, Inbox selection switching and refresh, failed-send draft/focus, room/history retries, Reconnecting→Live with sending disabled then restored, revoked device returning to sign-in, redacted hostile markup rendered as text with no injected DOM image, 506 loaded history rows, bottom jump and preserved scrollTop when a remote message arrives.
- Keyboard Enter success/failure keeps focus in the composer. Classic fallback's history viewport was 600 px with the composer inside a 960 px screen. Desktop 1440×960 and phone 390×844 had no document overflow. Direct chats show Agent settings, and the phone opens a padded detail Sheet. Light/dark appearance and reduced-motion behavior were checked.
- Standards and Spec reviews passed. Built-in source review found and prompted fixes for Inbox selection drafts, room retry, remote-message scroll anchors, classic viewport sizing and send focus. The final source-only re-review found no remaining actionable blockers. Existing Feed/Inbox/ApprovalCard assertions were updated for the new labels and markup, but were not run under the owner rule. Reviewers did not run tests, builds or scripts.

Evidence: [conversation](oa320-conversation.jpg), [Needs you](oa320-inbox.jpg), [phone agent context](oa320-phone.jpg).

Reproduce with `pnpm -r build`, `node scripts/verify-desk-flow.mjs`, then optionally `node scripts/verify-desk-flow.mjs --serve` for the disposable loopback browser desk. Pair using its printed short-lived code. Interactive controls: `pending`, `restart`, `disconnect`, `connect`, `reconnect`, `codes`, `revoke-browser` (device named Flow browser). Ctrl-C stops the temporary daemon; it never starts or stops the live service. The fixture scrubs inherited credentials and disables Ollama probing. It uses no external account or model.

### Authorized real-adapter acceptance

The owner approved the installed Codex subscription adapter, a separate temporary daemon and an empty temporary workspace for one reviewed `oa320-check.txt` write. A one-off harness on loopback :5194 used the production `openDb`, `createAuth`, `createLedger`, `createApprovals`, `createAcpRuntime`, `createRunner`, `createGateway` and `attachStream` modules from this worktree. Only the Codex ACP runtime was registered; no live daemon, app, computer or model-provider settings were loaded. The child environment contained PATH/HOME/LANG/TMPDIR only; the existing ACP profile selected read-only mode and removed API-key overrides. Installed adapter: `@agentclientprotocol/codex-acp@2.3.0`.

Through the new desk, the request asked for one temporary file with the text `OA-320 real adapter check` and a newline, explicitly prohibiting unit tests, Jest, scripts, builds, hooks and external actions. The actual `codex.shell` permission request showed the `printf` write and its temporary working directory. Before Accept the workspace was empty and the file did not exist. After Accept, the tool completed, the turn finished, and independent filesystem assertions confirmed exactly the expected file bytes and no other workspace files. Read-only SQLite assertions confirmed one approval request, one accepted decision, one completed result, a finished turn and zero pending approvals. Reload retained the result; Full ledger showed the accepted decision, completed tool and finished turn. The temporary daemon and adapter were then stopped.

Evidence: [real approval](oa320-real-approval.jpg), [real result](oa320-real-result.jpg), [assertion record](oa320-real-check.json). No tokens, pairing codes or adapter logs are committed. OA-320's manual gate passed, so it is marked complete. This verifies one real Codex action, not every provider or tool.

Attachments await OA-315; Work/results and durable receipts remain OA-321/OA-322/OA-324. No live service, full RTC/device or cutover verification is claimed.

## Existing-desk update — 1 November 2026

The owner authorized updating the existing desk and prioritizing all redesigned-desk tickets. `<repo>/` was fast-forwarded from `75bc701` to `2ed3a46`, bringing OA-319/OA-314/OA-320 onto the existing service source. Pre-existing untracked `.agents/`, `AGENTS.md` and `skills-lock.json` were preserved.

Before the update, the live database reported zero running turns and zero pending approvals. An online SQLite backup and copies of both previous dist trees were saved under `$OPENAG_DATA/backups/desk-cutover-2026-10-31T12-16-41-046Z` (UTC timestamp; 1 November in Pacific/Auckland). Backup integrity passed. No database migration was added by these changes.

`pnpm install --frozen-lockfile --ignore-scripts` and `pnpm -r build` passed in the existing checkout. Unit tests/Jest/install scripts/git hooks were not run. The existing launchd job received SIGTERM after a second zero-running-turns check; its graceful shutdown/KeepAlive path restarted it from the same service configuration. The installer/seed was not rerun. No new preview listener was opened.

Readback: service PID changed from 37163 to 50383; `/health` returned ok; authenticated rooms, bots and pending approvals returned 200 (one room, four bots, zero pending). Service plist, bot configuration and settings hashes were unchanged. The root HTML matched the new local build byte for byte, and the served `/assets/index-RqBbikUK.js` matched its local SHA-256. The browser reached the live sign-in page; authenticated visual flows were previously verified in the isolated fixtures, and no new live browser credential/device was created for this release. Vite's approximately 706 kB entry-chunk warning remains.

The source commit deployed was `2ed3a46`. To roll back runtime assets, use the saved prior daemon/desk dist trees and gracefully restart the same service; a database restore is unnecessary for this release and would discard newer data. The full database backup is retained for recovery. Next work is OA-321; OA-315 must precede OA-322.


## OA-353 regression repair (2 November 2026)

The standalone desk-flow script still assumed the pre-OA-344 member-count model and failed with `201 !== 200` on reuse. It now includes `kind: "direct"` for direct and concurrent requests and proves a pre-existing named one-bot room is preserved rather than reused. The full HTTP/runner checks pass again, including process restart and pending-approval resume. Production room behavior was unchanged; no unit runner or live service was used.
