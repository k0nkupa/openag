# Chat avatar generation and library — 3 November 2026

## Delivered source behavior

An attended bot turn can validate and render a geometry-only draft with `avatar_preview`, then call `avatar_library_add` for that exact draft. Full access registers without Inbox approval; Read Only and Workspace Write show an Inbox review. Chat shows the rendered design in all modes, and the Inbox shows it when review is required. Immutable metadata binds the originating bot/conversation, UUID and geometry hash. Declining review retains the chat preview without a library write. Authorized registration adds a shared picker entry; it never changes a bot's selected avatar. Selection remains the existing separate appearance save.

Migration 031 adds the daemon-owned `avatar_designs` table. No runtime registration HTTP write route exists. Authenticated `GET /avatars` returns only registered entries with no-store caching; desktop and WebRTC readers refresh through the existing shared stream. Unknown/unapproved custom references are rejected by settings writes. Definitions pass bounded schema checks, upstream geometry validation, a render-frame preflight and redaction checks before persistence. Drafts and library geometry are bounded. No remote image URL, raw SVG markup or filesystem import is accepted.

## Full access correction — 5 November 2026

The unconditional avatar review requirement blocked Full access/Never before execution. `node scripts/verify-avatar-library.mjs` reproduced that exact denial before the fix. The tool now allows registration under the effective Full access filesystem mode and obtains the saved draft/hash metadata directly when no human review exists. Other modes retain Inbox review. The shared library still validates bot/conversation ownership and the exact geometry hash. The global Never policy is unchanged.

Controlled verification passed:

- `pnpm -r build`: daemon, desk and signin-relay dry-run passed; the existing desk chunk-size warning remains.
- `node scripts/verify-avatar-library.mjs`: fresh and existing draft registration under Full access/Never, second and repeated calls in the same conversation, completed receipts without human approval, persistence across actual restart, no appearance change, invalid/foreign draft and unattended refusal. Existing Ask accept/ignore, immutable review, geometry, privacy and selection checks also passed; Read Only still opens review.
- `node scripts/verify-permission-sessions.mjs`: three presets and global Never refusal passed, including automatic receipts and mode-change/restart guards.
- `node scripts/verify-avatar-desk.mjs`: existing Ask-mode Feed/Inbox/picker flow and renderer/editor checks passed (DOM only).
- `node scripts/verify-bot-knowledge.mjs`: four controlled delivery groups passed, including packaged help, API, Ollama, reused ACP/MCP context and replacement default bot. New assertions require the corrected Full access and Ask guidance.

Knowledge updated: delivered Bots and models handbook, avatar guide, product notes, glossary and avatar tool description. These checks use disposable data and controlled runtimes; neither real ACP adapter nor a live model was exercised for avatar registration. No unit/Jest/Vitest, deployment or live library write. Existing installs receive the fix and updated knowledge only after deployment; this change does not retry the failed call.

## Local main integration — 5 November 2026

Integrated local main `9f0bb51` without conflicts. The combined workspace build, avatar library integration and four bot-knowledge delivery groups passed. The broader `verify-permission-sessions.mjs` now fails at line 104, where an Unknown external receipt is followed by an unrelated shell write. An unchanged-main build reproduced the identical `false !== true` assertion at the same line. This is an existing mismatch with main's scoped receipt recovery; no receipt-policy change is included in the avatar fix. The earlier pre-integration permission-session pass above remains scoped to that source revision. No deployment or push.

## Original verification run — 3 November 2026

- `pnpm -r build`: passed daemon/desk and signin-relay dry-run. The existing large desk-entry warning remains.
- `node scripts/verify-avatar-library.mjs`: passed real temporary daemon/gateway/runner/approval flow. Checks authentication/no-store, invalid markup/geometry rejection, unattended refusal even with allowApprovals (including an existing draft add and read permission Ask, with no unusable approval created), forced Ask despite local Auto, preview-before-save, draft selection refusal, Ignore without registration, immutable-edit refusal, exact accepted registration, cross-agent/conversation refusal, shared Limited read/select, no appearance change during registration, pending approval recovery across an actual restart, registered/selected state after another restart, filtering of later-registered secrets from catalogue reads, no implicit Work and absence of a registration HTTP write API.
- `node scripts/verify-avatar-desk.mjs`: passed actual React renderer/editor plus actual Feed/ApprovalCard, real runner and gateway. Preview is visible with technical activity hidden; chat and approval display the same design. Add to library registers it, the stream refreshes the shared reader and existing preview badge, and the dynamic picker can select/save it. Existing geometry/animation, duplicate-save, failure and cleanup assertions also pass. DOM assertions do not prove browser pixels or performance.
- `node scripts/verify-avatars.mjs`: passed existing HTTP/runner/restart/stream/local-WebRTC regressions. The WebRTC helper additionally verifies GET /avatars and refusal of POST /avatars.
- `node scripts/verify-bot-knowledge.mjs`: passed all four integration groups, including the new approval/library explanation through packaged API/Ollama and cached ACP/MCP delivery. No real provider was used.
- Syntax checks for all changed standalone scripts and `git diff --check`: passed.
- Local Standards/Spec inspection: cleared. Built-in `codex review --uncommitted` reported no actionable defects and passed daemon/desk type checks. The focused review found a pre-approval context omission: unattended calls could create approvals that execution would refuse. Fixed the shared runner handoff of trusted turnPolicy/investigation metadata to review callbacks and added preview preflight. The focused follow-up cleared that finding and the approval/redaction paths. The new regression cases pass.

- `node scripts/verify-explicit-work.mjs`: passed existing ordinary-chat/Work creation, approval, recovery and migration assertions after the shared review-context change.
- `node scripts/verify-acp-continuity.mjs`: passed all eight controlled continuity groups. No real adapter/model or external action was used.

## Installed skill and local preview

The owner-authorized agent-owned generate-avatar skill on the installed default `bot` was updated to version 2 through the existing safe writer and private data-versioning helper. Live list/load readback passed. Its prior geometry prompt remains self-contained. The workflow calls the two new tools when offered, handles decline without retry and leaves selection separate. On an older daemon without the tools it explicitly returns only a JSON draft and reports the missing runtime support. Shared-library enablement, other skills and permission modes were not changed.

Only the owned temporary preview on `127.0.0.1:56575` was restarted with the new source and migration. Its temporary data and device access were preserved. A controlled generation runtime has posted a Robot preview and an unaccepted Add to library proposal in `#/room/dm-coder`; the design is absent from GET /avatars before approval. Served HTML/JavaScript match the built desk byte-for-byte. This is a controlled local demonstration, not real-model generation acceptance.

## Remaining gates

Local browser automation remains disabled in Work settings. Desktop/phone light/dark layout, actual pointer behavior and browser performance remain unverified. The earlier broader desk-flow script failure is unchanged: it expects empty room creation to return 201 while the current gateway requires a member and returns 400. That unrelated check is not claimed as passed.

OA-390 remains open. No unit tests, Jest or Vitest ran. No source commit, production deployment, live avatar write or live database migration was performed. The installed skill update is separate from deployment: the service on port 4747 still needs the new source deployed before it can offer the avatar tools.
