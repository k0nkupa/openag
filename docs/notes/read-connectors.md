# Read/search connectors

Source campaign authorised 2 November 2026; its source checks used no deployment or live connections. Later owner-authorised Apple-only live acceptance is recorded in [OA-354 evidence](apple-live-acceptance.md): Mail and Calendar passed after the native Calendar fix; Remaining Apple checks and blockers are recorded there; Google remains excluded.

## Apple dependency provenance

Verified npm package `mcp-icloud@2.1.3`, MIT, integrity `sha512-A0JPnrecGfMI4g/wgdbmsyg6V8r/TfnnNgbFqoXy9FKLRIqUz+dLSMfW54TS5jQ1VbIQUQ/1ssdIZXo30rNCig==`. Inspected the published tarball, local clients and input schemas. Pinned daemon dependency and workspace lockfile, installed with lifecycle scripts disabled. The bundled facade uses the daemon checkout dependencies; no runtime downloads. Like the existing reference MCP SDK, dependencies are trusted installed code, not a sandbox; a reviewed facade digest does not authenticate the whole checkout.

The facade never starts the upstream server registry. It selects explicit handler names and applies independent strict input schemas. AppleScript child execution uses a minimal environment, timeout and output cap. Local mode is forced and no cloud credential/mode-switch tools are exposed. No real app operation is performed during source checks.

## OA-348 checks

`pnpm -r build` passed (existing large desk chunk warning). `node scripts/verify-apple-connectors.mjs` passed: six read tools on real MCP transport with controlled handlers, rejected writes/extra arguments/invalid IDs, temporary owner CLI install/disable and digest checks. Launchd and real app permissions remain unverified.

## OA-349 checks

Twenty curated Apple read/search tools passed the same real MCP integration with controlled native handlers. Added explicit per-app prerequisites; detecting imsg is not evidence of Full Disk Access. Its published handler has a 15-second subprocess deadline; the facade inherits only the minimal MCP child environment. No Safari navigation, Messages send/reaction, Notes creation, contacts writes or reminder mutation is exposed. The adapter omits the upstream Safari source excerpt and Notes search snippets so registered secrets cannot be cut before daemon redaction. Notes reads/search use valid IIFE JXA; native execution is not verified.

## Google connection / OA-350

Official `google-auth-library@11.3.2` installed with lifecycle scripts disabled, version pinned in the lockfile. The library owns authorization-code exchange, PKCE support, refresh and revocation; only auth URL generation runs before an explicit owner action. Fixed Google identity/Gmail hosts; no arbitrary fetch tool. Auth state is single-use, five minutes, device-bound and invalidated by account changes; no OAuth GET callback API bypasses authentication. The configured callback is the static desk `/google-connect` page; code exchange requires owner authentication.

`OPENAG_GOOGLE_CLIENT_ID`, `OPENAG_GOOGLE_CLIENT_SECRET` and `OPENAG_GOOGLE_REDIRECT_URI` remain operator daemon configuration, never accepted over HTTP. The connector key is now generated/preserved automatically in private host state; an existing `OPENAG_CONNECTOR_KEY` is imported without changing its bytes. Missing original keys are not silently replaced. See [managed credential recovery](../composio.md#credential-storage-and-backup). Tokens are encrypted using Node AES-256-GCM under `$OPENAG_DATA/connector-google.enc` (600, symlinks/hardlinks refused); the key is separate from the file. This file is outside SQLite backups. Include the encrypted file and matching private key in a secured host backup. If the original key is unavailable, restore it or arrange a deliberate owner-controlled reset; ordinary reconnect cannot recover encrypted state. Same-user trusted code is not sandboxed.

`pnpm -r build` and the standalone Google verification passed: real temporary gateway/SQLite checks with controlled auth/HTTP, including owner/full/limited devices; no Google account was connected. Google read results are bounded, redacted and labelled untrusted; Gmail MIME plain text is decoded and attachment downloads/HTML omitted. A cursor field avoids treating pagination as a credential.

## OA-351 Drive

Drive uses the shared Google account with `drive.readonly`, independently enabled/paused from Gmail. Search returns bounded recent files or escaped full-text queries, an explicit nextCursor, and metadata. Reads accept file IDs only; fixed Drive hosts, redirect refusal, deadline and 2 MB response cap. Supported: text/plain, text/markdown, text/csv, application/json; Google Docs/Slides plain-text export; Google Sheets CSV of the first sheet only. PDFs, images, arbitrary URLs and binary downloads are refused. Verify checks metadata read access, not the ability to read every file.

Build and standalone controlled Google integration passed for these paths, missing scopes, export, unsupported formats, inaccessible files, response limits, pause and shared disconnect. No live acceptance.

## OA-352 source and browser checks

The existing App library now has Apple, Gmail and Drive cards. Google account details and controls are owner-only. Google UI sign-in requires a Full access device because temporary Owner actions authentication is memory-only and must not be persisted across browser navigation. The static `/google-connect` page is no-store/no-referrer, clears the query from history before render, and exchanges a code only through the authenticated completion route. Account state, macOS permission and actual read verification remain separate; verification is explicit and timestamps are reset on restart/connection changes. Read verification checks account/app access, not every item. Calendar exposes the upstream upcoming-event window, not historical event search.

OA-352 is complete. On 2 November 2026, restored browser access allowed desktop (1440×960) and mobile (390×844) acceptance against `node scripts/verify-connectors.mjs --serve`. Controls, status transitions, mobile wrapping, keyboard focus, restricted-device presentation and synthetic OAuth returns passed. Screenshots and exact coverage: [browser evidence](connectors-browser/README.md). The fixture and tabs were cleaned up. OA-353 regression and review completion is recorded below. OA-354 later received limited Mail/Calendar installation, permissions and read authority; see the separate live evidence. Google remains excluded.

Passed with temporary data and controlled adapters:

- `pnpm -r build` (existing large desk chunk warning).
- `node scripts/verify-apple-connectors.mjs`: real stdio facade, strict inputs and write refusal, package setup/disable/tamper detection; native module loading only, no app operations; Notes JXA compiled/executed against a simulated Application.
- `node scripts/verify-google-connectors.mjs`: controlled account/HTTP plus real temporary SQLite/gateway; SDK auth URL configuration, scope changes, encrypted storage, read/export limits, callback isolation/replay, refresh/restart/revocation, full-result redaction across cap boundaries, and bot environment stripping.
- `node scripts/verify-connectors.mjs`: actual HTTP, runner and scoped MCP round-trip; Apple search arguments preserved across the ACP-facing bridge, Google reads, unchanged policy denials, offline read denial, explicit owner probes, no reads/prompts on card/status requests.
- `node scripts/verify-integration-setup.mjs` and `node scripts/verify-app-library.mjs`: legacy setup/configuration and runtime checks passed. The library fixture expectation was extended for the three new listings.

`node scripts/verify-desk-flow.mjs` now passes. The prior line-78 failure (`201 !== 200`) came from requests omitting `kind: "direct"` after OA-344 made room kind explicit. Requests without a kind correctly create named rooms. The standalone script now requests direct chats explicitly, verifies direct reuse/concurrent creation, preserves the existing named one-bot room and counts the extra legitimate direct-chat audit. The full approval/restart/redaction/history checks also pass. No daemon behavior changed. Historical fixture JSON files are not replaced with this run's temporary-directory paths.

No unit tests, Jest or Vitest were run. No deployment, real account authentication, macOS permission prompt or personal-data read was performed. The Google encrypted credential file is not covered by database-only backup; preserve its key separately if an operator later authorises account setup. Google app registration/consent and restricted-scope verification remain operator/release prerequisites; Testing projects can issue seven-day refresh tokens. Sources: https://developers.google.com/identity/protocols/oauth2/web-server and https://developers.google.com/identity/protocols/oauth2#expiration.

## Source review

Final built-in `codex review --base fad2c56` reviewed committed and uncommitted connector source and reported no remaining substantive defects. Earlier findings were corrected: full-result redaction before caps; valid Notes JXA; MCP reload/session invalidation; offline Google read refusal; Full-access-device UI sign-in; and complete input schemas across the ACP-facing Apple bridge. The latter is verified by a real local scoped-MCP search carrying a nonempty query through both hops. Apple read stamps are tied to current tool definitions, so reconnect/reload cannot retain a stale verified badge.

Review was static and did not satisfy browser or live-provider acceptance. Source is on branch `codex/read-search-connectors`. OA-348..OA-351 are source-complete. OA-352 also passed separate browser acceptance; OA-353 is complete; final acceptance results are recorded below. OA-354 selected Apple authority and remaining limits are recorded in the separate live evidence.


## Operator setup and recovery (preparation only)

These steps describe future owner-authorised setup. They were not performed on the live daemon or real accounts during this campaign.

1. **Apple:** use App library → Apple apps → Review local setup. Review the machine, source, digest and access, then obtain the generated install command. A local administrator runs that exact command on the daemon host, then uses Check installation. It preserves unrelated MCP entries; there is no HTTP install or automatic tool approval. The entry pins the package digest only; the daemon derives the launch command (its own node and release) when it starts the connector and ignores any stored command, arguments or environment, so a redeploy cannot invalidate the pin (docs/adr/0003). Changed installed code is still refused. Ask for each selected app's access separately, then Check its read access. The UI makes no permission/read request merely by opening the card. Messages additionally requires `imsg` and Full Disk Access for the launching service; a CLI result does not establish launchd access.
2. **Google:** the administrator configures the three Google client/redirect variables above (an existing connector-key override remains supported). Register the exact `/google-connect` return URL in the Google client; OpenAg accepts HTTPS or `http://127.0.0.1`, with no query/hash. The browser must reach that daemon origin and retain its Full access device login through the redirect. Set up the client/consent and required APIs externally before connecting. Never paste provider credentials into the desk or a bot prompt.
3. **Consent and scope:** open Gmail or Drive → Connect Google/Grant read access from a Full access device. Gmail requests `gmail.readonly`; Drive requests `drive.readonly`; sign-in includes `openid email`. The account is shared by this daemon's bots, under each bot's existing tool policy. Add each service explicitly. Check read access after connecting; Connected alone does not prove a read, and a successful check does not prove all messages/files work.
4. **Pause and rollback:** Pause this service disables only Gmail or Drive, keeping the account. Disconnect Google account requires confirmation and removes both services locally before attempting provider revocation. If revocation is unconfirmed, inspect/remove the grant in the Google account separately. Apple rollback uses the reviewed local disable command with a fresh configuration digest, followed by MCP reload; do not delete unrelated configuration or user data.
5. **Recovery:** an expired/replayed/cancelled sign-in requires a fresh start from the connector. `needs_access` after a revoked grant requires owner sign-in again. Transient provider/refresh failure can be retried after checking connectivity; do not delete the encrypted credential file as a generic fix. An unreadable key/file or invalid configuration must be corrected on the daemon before reconnecting. A different account requires explicit disconnect first. Restore the matching encryption key and encrypted file together; if the original key is lost, restore it or arrange a deliberate owner-controlled reset before reconnecting; never attempt decryption with a replacement key.

Content returned by a tool can enter bot/model context. Results are redacted, bounded and marked untrusted; those protections do not make arbitrary email/document instructions authoritative. There is no ingestion index, mail send/label action, Drive write/share action, or Apple write tool in this campaign. Provider verification, native service permissions and actual known-record/restart checks remain OA-354, outside current authority.

## OA-353 final acceptance

On 2 November 2026 the following passed against temporary data and controlled adapters:

- `pnpm -r build` (existing desk bundle-size warning).
- `node scripts/verify-apple-connectors.mjs`.
- `node scripts/verify-google-connectors.mjs`.
- `node scripts/verify-connectors.mjs`.
- `node scripts/verify-integration-setup.mjs`.
- `node scripts/verify-app-library.mjs`.
- `node scripts/verify-desk-flow.mjs` (including real fixture-process restart/resume).
- `node --check scripts/verify-desk-flow.mjs` and `git diff --check`.

Local Standards and Spec reviews of the connector campaign against `fad2c56`, including the desk-flow repair and operator notes, passed with no actionable findings. Built-in `codex review --uncommitted` also found no actionable defects. Its unrelated MCP initialization/shutdown warnings (including HTTP 429) did not prevent local source review completion. Review output: `/tmp/openag-oa353-review.log`; build output: `/tmp/openag-oa353-build.log` (temporary local logs, not durable handoff artifacts).

OA-353 is complete. Unit/Jest/Vitest gates were skipped by owner instruction. No deployment or live account connections. Browser acceptance remains the separate OA-352 evidence linked above; this script/documentation repair needed no UI changes or new browser pass. OA-354's later Mail/Calendar acceptance passed and is recorded separately; Remaining Apple scope/results are in that evidence; Google remains outside authority.


## Local main integration (2 November 2026)

Merged the connector campaign with local main's model-routing, handbook/status and capability-catalogue work. Three conflict resolutions preserve both sets of first-party tools, the complete MCP schemas and immutable turn restrictions; offline turns still deny Google reads. Updated the packaged computer-connectors help topic and its authoritative source link. The pending hosted-model harness design ticket is OA-355 after resolving its OA-348 ID collision with the connector campaign.

On the combined tree, `pnpm install --frozen-lockfile --ignore-scripts` and `pnpm -r build` passed (existing desk bundle-size warning). All eight standalone scripts passed: `verify-apple-connectors`, `verify-google-connectors`, `verify-connectors`, `verify-integration-setup`, `verify-app-library`, `verify-desk-flow`, `verify-capabilities` and `verify-bot-knowledge` (`node scripts/<name>.mjs`). The extended knowledge check proves the exact connector help text reaches controlled API/Ollama prompts and the scoped ACP MCP response. This includes existing/default replacement configurations and preserves custom instructions and gates. Local Standards and Spec merge reviews passed with no substantive defects.

This is a local source merge and build. No push, service restart, account connection, macOS grant or unit/Jest/Vitest execution. OA-354 stays open. Unrelated `.claude/worktrees/` directories were preserved.


## Native Calendar reader

Calendar list-events/list-calendars use Apple's public EventKit API rather than Calendar.app AppleEvents. Diagnostics found Calendar's calendar-name enumeration itself stalled, before the date predicate/property reads. A read-only native EventKit probe in the same launchd Node context returned one valid in-window event in 375 ms. The old 25-second execution bound remains unchanged.

`pnpm -r build` on macOS builds the small Swift reader with the installed Xcode Command Line Tools (macOS 14+ target). No compiler, package or native code is downloaded at runtime. The executable and source/usage-description/compiler/architecture build record are ignored by Git but included in the reviewed whole-folder package digest and copied during setup. Review refuses a missing/stale/source-mismatched binary; unchanged builds retain the same artifact and digest. Rebuild before local package review on another machine.

Calendar requires EventKit Full Access. macOS has no read-only EventKit grant; the native helper contains no save/remove operations and the facade offers only the existing list tools. It checks existing permission before reads and only requests permission through the explicit owner action. Its embedded usage description explains the read-only connector purpose. A missing permission is an error, never a successful empty result. The Reminders extension is described below; other Apple app mechanisms and Google are unchanged.

Event queries use a native date predicate, expand recurring instances, retain upcoming starts in a half-open window, sort by start, and return at most 1–50 records across 1–365 days (defaults 25/30). Current ongoing events whose start predates now remain excluded, as with the earlier upcoming-start contract. Event text is still redacted and capped by the daemon and marked untrusted. The follow-up live results are in [OA-354 evidence](apple-live-acceptance.md). Official API references: [EKEventStore](https://developer.apple.com/documentation/eventkit/ekeventstore), [Calendar Full Access](https://developer.apple.com/documentation/eventkit/ekeventstore/requestfullaccesstoevents(completion:)).

### Remaining Apple read fixes (2 November 2026)

Reminders listing/search now use the existing pinned native EventKit executable. The AppleEvents batch attempt still timed out through the real bot and is not the final fix. Reads check existing Reminders Full Access and never prompt. The explicit owner permission action uses the native Reminders request; no permission grant was made during this run because access was already present. Incomplete-only listing uses the native predicate, sorts by due date (undated last), and returns at most the requested count; search includes completed items and matches titles/bodies case-insensitively. The native fetch has a 15-second deadline within the unchanged 25-second child bound. No save/remove API is used. Reminder references are now EventKit identifiers; tools consume list names, not reminder IDs. Notes listing batches IDs/modification dates and retrieves only the newest bounded details. Collection errors fail instead of silently presenting partial data as complete; a missing named Notes folder is an error. Minimal environment, strict read-only schemas and the 20-tool surface are preserved.

Serialized JSON is now redacted as decoded values and safely re-encoded, including nested MCP text envelopes. This fixes Notes content escaping at both MCP delivery and ledger storage without bypassing secret filters or pre-cap redaction. Registered secrets in JSON syntax/numeric values fail closed. The standalone Apple integration covers real MCP delivery plus persisted ledger readback, nested escaping, idempotence, unchanged benign JSON, special property names and numeric secrets. Controlled script checks cover Notes listing order/count, native argument refusal, passive permission status and explicit-only permission routing. Native Reminders semantics are checked with read-only host acceptance. No unit runner is used.

## Apple access panel

In App library, open Apple apps. The header names the executing machine and stays visible while the selected tab scrolls. **Overview** shows compact, expandable app rows. Expand a row to **Request permission** or **Check read access**. The Apple brand mark identifies this connector. Granted uses the success badge, Not checked and Needs setup use attention, and Not granted or Check failed use destructive. Granted means the OS permission was granted; only a completed read check produces Read verified. Permission results persist in `$OPENAG_DATA/apple-permissions.json` (mode 600, validated on load); Read verified is memory-only and resets on daemon restart. Runtime failures remain visible above the rows and prevent read checks. **Overview** holds runtime management, source, version and requirements. **Tools** holds expandable tool descriptions. **Local setup** holds the reviewed installation and disable commands. Opening tabs and rows does not request permission, run a read check or review a setup package.
