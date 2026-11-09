# OA-354 Apple live acceptance

## Authority and scope

On 2 November 2026, the owner authorised Mail and Calendar permissions and small real read samples, then approved installation of the pinned facade and restart of `com.openag.daemon`. The owner allowed any existing records and requested no quoted private content. Google and other Apple app permission/read checks remain excluded.

The owner subsequently approved the reviewed Mail fix at facade digest `4eb00b77bfd64c4485983a54db64722efbb83c502c54889b7a10d2a317ecaefc`, a backed-up configuration replacement and MCP reload. This did not add tools or permissions. Full OA-354 remains open beyond this selected scope.

## Host and installation evidence

- Host: `the host machine`; user LaunchAgent `com.openag.daemon`.
- Entry: `$HOME/.local/bin/node <repo>/apps/daemon/dist/main.js`, working directory `<repo>/`, data `$OPENAG_DATA`, port 4747.
- Initial preflight: health 200, connector route 404, empty MCP inventory. No active turns or pending approvals; four backups listed.
- Local main had advanced from the connector merge `781e8cb` to `cd1cea8` with sidebar/model-page changes. Those changes were preserved and the current tree rebuilt before restart.
- Backup `openag-20261102-135136.db`: mode 600; independent read-only SQLite integrity check `ok`.
- Initial facade v1.0.0 digest `b5e947b0ce28493af602922f0bfd54c118eafcbb7fd1a569355591904e0a3aeb` was installed with the reviewed CLI and absent-config guard. Readback matched the pin; no bot permission modes changed.
- Restart produced PID 65443; health and connector routes became ready. The connected facade offered 18 tools; Messages tools were omitted because its prerequisite was absent.
- Both Mail and Calendar permission endpoints returned `granted`. Both explicit daemon-owned read probes returned verification timestamps. These probes use a tiny list; they do not prove message-body reads or all events.

## Defects found through the real bot path

1. The first Codex attempt used a metadata search requiring literal punctuation in `apple-apps`; exposed JavaScript tool identifiers normalize punctuation. It found no tools and executed none. Its false booleans were unattempted checks, not native failures. A visibility diagnostic and broader metadata search separated that issue from execution.
2. The next attempt reached the genuine Apple MCP tool but the ACP adapter suffix matcher accepted only letters/digits/underscores. Dotted/hyphenated facade names were misclassified as `codex.shell` and created a duplicate permission request. The request carried an MCP descriptor, not a shell command. That acceptance Work was cancelled; no shell executed. Source fix `7f4e12a`, promoted to local main as `f33c5b9`, permits dots/hyphens while retaining exact random-server identity, dynamic provenance for Claude, exact tool allow-list membership and the authoritative MCP gate.
3. After rebuilding/restarting with that fix, Codex successfully listed one real inbox message through the gate. Body read failed because upstream `mcp-icloud@2.1.3` uses a nonexistent root `Mail.messages` collection. The host's Mail scripting dictionary places messages on mailboxes. The bot stopped and did not attempt Calendar in that turn. Source fix `1a3b3b7`, promoted as `52df368`, overrides only read-email with strict numeric-ID and fixed-folder validation and a mailbox-scoped lookup. It performs no mutation and preserves complete body redaction/capping.

## Fix validation and promotion

- Both source fixes have controlled regressions that failed before the fix and passed afterward. No unit runner was used.
- `pnpm -r build`, `node scripts/verify-apple-connectors.mjs` and `node scripts/verify-connectors.mjs` passed; independent Standards and Spec source reviews passed for both fixes.
- The ACP fix was rebuilt on main and rechecked with the Apple script. Pre-restart backup `openag-20261102-135653.db` was verified by the daemon. No active turns/approvals were present at restart. Reconnection succeeded and in-memory verification stamps reset, as intended.
- Updated Mail facade pin was promoted only after the owner's separate digest approval. Original configuration was guarded by digest `2e88f9491a404c5561cfcd5f5393eb3923f1e90310514e1e1856b933af3ce816` and backed up as `setup-backups/mcp-oa354-52621d6d-a17a-4808-b7c7-4c9bf7cf5888.json`. Only the old Apple entry was temporarily removed before the reviewed CLI installed the new digest; unrelated fields/entries and old code files were preserved. Final configuration was read back against the expected reference entry.
- Current configuration digest: `1301fba32d528ab3073028fc5b8732eb917a577be2e552bec4e1ee8f59f23748`. Owner MCP reload returned connected, 18 tools, new digest `4eb00b77...7ecaefc`; no full daemon restart was required for this facade-only update.

## Readback before the Calendar fix

| Check | Observed result |
| --- | --- |
| Daemon and facade | Healthy after restart; current pin connected with 18 tools. |
| Mail permissions | Granted under the daemon service. |
| Mail bot read | Passed: one inbox record listed, then its body read successfully through the real Codex ACP → scoped MCP → policy gate → facade path. Ledger confirms both tool outcomes `ok:true`; bot reported one item and successful body read. |
| Mail desk evidence | Explicit owner read probe passed after the final reload and has a fresh timestamp. |
| Calendar permissions | Granted under the daemon service. |
| Calendar initial probe | Initially passed before the later source fixes/reloads. This was not sufficient to establish reliable event reads. |
| Calendar seven-day bot read | Failed after 25,016 ms at the native execution limit. |
| Calendar one-day bot read | Failed after 25,011 ms at the native execution limit. |
| Pre-fix Calendar status | Permission granted, no read-verification timestamp. Remains blocked; no events were confirmed. |
| Cleanup | No active turns or pending approvals at final readback. Cancelled acceptance Work was limited to the earlier misclassified MCP request. |

The 25-second timeout was not increased and the scripts did not fall back to another channel. The exact Calendar bottleneck is not established beyond the bound being reached. No Calendar performance fix has been installed. This was the initial blocker; the follow-up below diagnoses and resolves it.

At that stage, the selected checks had a partial result rather than a full pass. Google connection/refresh/restart acceptance and the other advertised Apple apps remain unauthorised and untested.

No message subjects, bodies, event names, attendees or locations are copied into this note. The normal bot tool path carries returned data in daemon/model context, under the owner's read authorisation. No Mail/Calendar writes, other Apple app reads or Google connections were performed. No unit/Jest/Vitest runners or remote push. The new user-facing behavior needs no separate handbook expansion: the authoritative read/search behavior and permission limits remain unchanged; this note records the implementation defects and live evidence.


## Calendar timeout resolved; selected acceptance complete (2 November 2026)

The owner authorised diagnosing/fixing Calendar and finishing Mail/Calendar checks, with Google and other Apple apps excluded. Diagnosis measured the Calendar.app AppleEvents calendar-name enumeration stalling for 16 seconds before any event predicate/property access. Merely reducing the repeated property reads would not address that stall. The exact internal Calendar.app cause was not established.

A native Swift EventKit probe in the same launchd Node context read a valid event inside the seven-day window in 375 ms. System Settings showed Node already had Calendar Full Access; the native probe saw that permission. The JXA/osascript EventKit probe reported write-only access instead. No System Settings permission toggle was changed by the agent. Temporary launchd diagnostics and their files were removed.

The Calendar list tools now use a small read-only EventKit executable. It has strict fixed commands and bounded count/date inputs, never saves or removes records, and requests permission only through the explicit owner permission action. The native executable and purpose description are built locally with installed Swift tools, validated against their source/build hashes and included in the reviewed whole-folder pin. The 25-second execution bound and existing daemon redaction/policy paths remain unchanged. Source `cbbea98`; promoted to local main as `609156b`.

Validation passed: `pnpm -r build`; standalone `verify-apple-connectors.mjs`, `verify-connectors.mjs`, `verify-integration-setup.mjs`, `verify-app-library.mjs`, `verify-desk-flow.mjs`, `verify-capabilities.mjs`, `verify-bot-knowledge.mjs`; source Standards and Spec reviews. The Apple check also verifies native argv rejection, executable installation and unchanged-build digest stability. The knowledge check confirms the new Calendar permission guidance reaches controlled API/Ollama/ACP contexts. Main was rebuilt and the Apple/knowledge checks passed there before promotion. Unit/Jest/Vitest runners were excluded.

Live promotion was guarded by idle-turn/pending-approval checks and verified backup `openag-20261102-141654.db` (independent SQLite integrity check `ok`). Only the Apple MCP entry changed; original config was backed up as `setup-backups/mcp-oa354-calendar-3ca41784-5e6e-4f99-9431-a225f2944ee3.json`. Old code files and unrelated configuration were preserved.

Installed facade digest: `bfe906f6cd6bd9bb8337241ac87a2dac79a6283fd1fe75483d9e8029e59ec6d1`. Configuration digest: `e37c5b6e0d96886f9415d976cb6f39e1f2f1003a5dd1823c1e5fd2715ac3badd`. Daemon restart loaded the native Calendar permission handler and the pin connected with 18 tools. The owner Calendar permission check returned granted in 42 ms; its read probe passed in 141 ms. Mail's read probe also passed.

The real Codex turn `d2d6c20a-214b-40a8-adb0-f471597445a2` (message 625) then completed all six scoped MCP/policy-gated reads. Canonical ledger tool-call IDs were matched to their result timestamps:

| Real bot check | Result | Tool duration |
| --- | --- | --- |
| Mail inbox list, limit 1 | Passed, one item | 540 ms |
| Mail body for exactly the listed reference | Passed | 300 ms |
| Calendar list | Passed, seven calendars | 48 ms |
| Calendar upcoming starts, one day, limit 1 | Passed, empty | 45 ms |
| Calendar upcoming starts, seven days, limit 1 | Passed, one item | 50 ms |
| Calendar upcoming starts, thirty days, limit 1 | Passed, one item | 44 ms |

The event counts are limited result sizes, not totals for those windows. No private content is quoted here. All six authoritative tool outcomes were `ok:true`; no model shell/file/browser tool or other connector was used.

A final persistence check took verified backup `openag-20261102-141906.db`, rechecked idle state, and restarted the same daemon again. Connection returned, verification stamps correctly reset, both permissions returned granted, and fresh owner probes passed (Calendar 69 ms, Mail 560 ms). Final health: 200; current pin connected; Mail and Calendar have fresh verification timestamps; no active turns or pending approvals. Google configuration remains absent.

**The authorised Mail/Calendar checks are complete and passed.** Full OA-354 stays open only for excluded Google and other Apple app acceptance. No live Google/other Apple reads, write tools or remote push occurred. The existing desk bundle-size warning remains. Operator/build and permission guidance is in [read-connectors.md](read-connectors.md); the packaged bot guide explains native Calendar Full Access without copying live installation state into static help.


## Remaining Apple apps: read-only acceptance (2 November 2026)

The owner authorised checks of Contacts, Reminders, Notes, Safari and Messages, keeping application operations read-only and Google excluded. No source implementation, app data, permission grants, dependency installation or service-configuration change was performed by the agent. Verification endpoints and bot turns created their normal daemon audit/history records. After the owner installed `imsg`, MCP discovery was refreshed while idle to expose its two already-declared read tools; the installed facade/configuration pin was unchanged.

| App | Read-only observations | Acceptance |
| --- | --- | --- |
| Contacts | Owner list probe passed (17,556 ms). Real Codex list, detail and search passed in 327/383/334 ms. | Passed for the sampled operations. |
| Safari | Owner tab-list probe passed (11,363 ms). Real bot tab listing and current URL metadata passed in 200/169 ms. No page-source fetch or navigation was used. | Passed for the sampled operations. |
| Reminders | Default/unscoped listing hit the 25-second limit (25,044 ms). List metadata passed (254 ms). A named-list read completed in 20,828 ms with zero incomplete results. No actual reminder item was returned for content verification. | Partial; default listing remains blocked. |
| Notes | Default/unscoped listing hit the 25-second limit (25,055 ms). Folder listing returned four folders (304 ms); a scoped listing returned one note (192 ms). Reading that exact reference returned a payload in 195 ms, but the redacted serialized envelope was invalid JSON. | Partial; content acceptance failed. |
| Messages | Initially unavailable. Owner installed executable `/opt/homebrew/bin/imsg` v0.20.0. Discovery refresh exposed 20 facade tools. Owner chat probe failed (74 ms); real bot chat listing failed (37 ms) with database authorization denied. History was not attempted after that failure. | Blocked on database access; Full Disk Access still needs verification in the daemon's process context. |

Real-bot evidence: remaining-app turn `aa41a0f7-81d5-4c98-a705-60f5f55042c6` (message 692) contains ten canonical read/search tool outcomes. The Messages-only turn is `42c928b6-1584-4313-b6f1-7c53feda9792` (message 787). No write, browser, shell, memory/configuration or other connector tool was executed by these turns. Independent families stopped on failure; failed default listings were not retried.

Notes detail: the requested note reference matches the listed reference. Its returned text has a plaintext field, redaction markers, a 2,101-character outer content string and no truncation flag. Parsing fails at the outer envelope; transport `ok:true` therefore is not sufficient to accept content retrieval. No raw note, ID or redacted payload is copied here. This points to the serialized-result/redaction boundary and needs a synthetic source-level reproduction before a fix; no implementation/deployment fix was made in this read-only run.

Messages detail: `imsg --version` returned 0.20.0 with exit 0; the daemon prerequisite check sees it. The bot classified the failure as Full Disk Access, while the independently inspected canonical error confirms permission/authorization denial. No Full Disk Access setting was changed and no direct database-read workaround was used. The presence of `chat.db` alone was not treated as permission or history evidence.

Final state: the existing facade digest `bfe906f6cd6bd9bb8337241ac87a2dac79a6283fd1fe75483d9e8029e59ec6d1` remains connected with 20 tools, no active turns and no pending approvals. Discovery refresh clears volatile verification stamps as designed; recorded successful calls remain in the ledger. Mail/Calendar acceptance above remains historical evidence and was not rerun for this scope.

**Remaining blockers:** Reminders unscoped timeout, Notes unscoped timeout and malformed content envelope, Messages database authorization. Google remains outside scope. No unit/Jest/Vitest, build, daemon restart, dependency install or permission change was performed in this run; no code change needed a new handbook build. These live-state findings belong in the acceptance log rather than static bot help.

## Reminders and Notes fixes (2 November 2026)

Owner authorised fixing both failures, rerunning read-only Apple checks and assisting with Messages access. Google remains excluded. Source commits `92fd4b1` / `a0410f2` were merged into local main as `c2ff976` / `95ec5ec`, rebuilt and installed under the same 20-tool read/search surface. No remote push or app-data write was performed.

The first Reminders batching attempt returned actual content in a direct launchd probe but still timed out through the bot (turn `69bef0f5-5c44-4faf-b759-9fc0ee9e51c3`, 25,010 ms). That attempt is superseded by native EventKit for Reminders lists/list/search in the existing pinned Swift executable. A passive native status check found existing Reminders Full Access; no grant or permission request was needed. A native fetch has a 15-second deadline, existing child execution/output limits remain, and reads never prompt. Only the explicit owner permission action can request access. No save/remove API or write tool was added.

Notes listing now batches identifiers/modification dates before selecting bounded detail reads. JSON-aware redaction safely decodes/re-encodes nested MCP content instead of consuming JSON escapes. It protects sensitive keys, known literal secrets (including numeric JSON), normal secret patterns and complete strings before caps. Both MCP delivery and persisted ledger readback are covered by a synthetic controlled integration; the original nested-envelope regression failed before the fix and passes after it. Small usage counters remain numeric, and benign JSON retains exact bytes.

Verified pre-change backups: `openag-20261102-145144.db` and `openag-20261102-145612.db`, with independent SQLite integrity checks. Config was backed up before each guarded pin change, with exact previous-entry/configuration-digest checks and unrelated fields/servers preserved. Prior installed code remains available. Final installed digest: `de8c1314aa99a2484ffae4e37896be5e385447d224ad79a736223062e626cfce`. The daemon restarted idle with no pending approvals and reconnected all 20 tools.

Final real Codex turn `bdca9549-2b3b-42d5-91a6-8a20decc9021` (message 848) passed all six canonical read/search calls:

| Operation | Result | Duration |
| --- | --- | --- |
| Notes default listing, limit 1 | One reference | 272 ms |
| Notes exact-reference content | Parseable plaintext | 343 ms |
| Reminders list discovery | Lists returned | 380 ms |
| Reminders default listing, limit 3 | Actual incomplete items | 143 ms |
| Reminders named-list read, completed included, limit 1 | Actual item from requested list | 139 ms |
| Reminders title-word search, limit 1 | Matching item | 233 ms |

All nine bot assertions passed. Independent ledger inspection confirmed bounded count, incomplete-only filtering, due-date ordering with undated items last, the exact scoped list, and parseable Notes content with a plaintext field and redaction markers, without truncation. No private names, references, titles, bodies, dates or queries are copied here. The earlier Notes transport-only success is not reused as acceptance.

Validation: source and local-main `pnpm -r build` passed. Final standalone `verify-apple-connectors.mjs`, `verify-connectors.mjs` and `verify-bot-knowledge.mjs` passed; integration setup also passed during the earlier batch slice. Native checks refuse malformed counts/flags/query arguments before app access, retain package build/pin stability and passive status, and route explicit Calendar/Reminders requests correctly through controlled handlers. Independent Standards and Spec reviews passed. No unit/Jest/Vitest runners were invoked. Existing desk bundle-size warning remains.

Messages permission handoff: System Settings Full Disk Access showed `node` off. The owner explicitly approved enabling it after being told this grants protected-file access beyond Messages. Clicking the toggle opened macOS authentication; the owner must complete that authentication. No password is requested or recorded by the agent. Messages listing/history acceptance remains pending until the grant is confirmed in the real daemon context.

## Messages grant and final Apple acceptance (2 November 2026)

Owner completed the macOS authentication prompt for the explicitly approved Node Full Disk Access grant. A fresh System Settings observation confirmed the `node` switch is on; the agent did not enter or receive the password. This OS grant covers protected files beyond Messages, as explained before approval. No other permission was changed.

Before restarting `com.openag.daemon`, active turns and pending approvals were both zero. Backup `openag-20261102-145947.db` passed an independent SQLite integrity check. After the idle restart, the same installed facade digest `de8c1314aa99a2484ffae4e37896be5e385447d224ad79a736223062e626cfce` reconnected with 20 tools. Owner Messages verification passed in 490 ms.

Real Codex Messages-only turn `4ad7a926-23c4-47ac-aa54-ef561177017d` (message 909) passed `list-chats(limit=1)` in 304 ms and `read-messages(limit=1)` in 288 ms. All four bot assertions passed: chat listed, history read, record found and content readable. Independent ledger decoding confirmed exactly one listed chat, the history request used that exact numeric reference, and one returned message belonged to it and contained nonempty text. The upstream single-message history result is an object, while chat listing is an array; the readback check accommodates both supported envelope shapes. No names, addresses, identifiers, message text, attachment details or timestamps are copied here.

Final sequential owner read probes after this restart also passed: Mail 644 ms, Calendar 75 ms, Contacts 366 ms, Reminders 220 ms, Notes 282 ms and Safari 2,958 ms. Together with Messages, all seven apps have fresh live verification stamps. Final checks: health 200, pinned facade connected with 20 tools, no active turns, no pending approvals, Google configured=false. Historical detailed bot acceptance for Mail/Calendar/Contacts/Safari and the corrected Reminders/Notes checks above complement these small restart probes.

The Apple portion of OA-354 is complete. The parent ticket remains unchecked only because live Google acceptance is explicitly excluded. No app-data writes, sent messages, Google connection/read, remote push or source-code change occurred in this final grant/readback step. No rebuild or unit/Jest/Vitest runner was needed; the running application source remains the already rebuilt local-main revision `95ec5ec`.
