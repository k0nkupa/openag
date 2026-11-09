# OA-363 automated test repair

2 November 2026. Branch `codex/repair-automated-tests`, created in the managed worktree from fetched `origin/main` at `0ab217801288fdd216b18db5c360e227f561cf06`.

The owner explicitly authorized unit/Vitest runs for this ticket only. The standing verification rule is unchanged. All changes and execution used local source and disposable test data. No running service, live data, owner credentials, devices or provider accounts were changed. Nothing was pushed or deployed.

## Baseline and diagnosis

Fresh `pnpm -r --no-bail test` reproduced:

| Package | Passed | Failed | Unhandled errors |
| --- | ---: | ---: | ---: |
| daemon | 1,400 | 100 | 8 |
| desk | 339 | 41 | 2 |

Full output: `/tmp/openag-repair-baseline.log`. All 141 full failing names are captured in `/tmp/openag-repair-baseline-failures.json` (100 daemon, 41 desk). Node 22.23.1, pnpm 10.28.1; frozen-lockfile installation succeeded without dependency changes.

The focused approval loop initially reproduced six failures in seven tests with `pnpm --filter daemon exec vitest run src/approvals.test.ts`. Most omitted the required review version. After repairing that fixture, late calls to `wait()` exposed a real lost-decision race.

## Changes and affected paths

- **Approval race:** `approvals.request` now creates and retains its waiter before publishing the request. A synchronous reviewer or expiry cannot leave a later `wait()` unresolved. Failed requests remove the waiter. Existing decision/expiry tests cover late waiting; added regressions cover a synchronous ledger reviewer and missing/stale review versions. The version, validation, transaction and receipt gates remain enforced.
- **Reflection status:** a non-successful turn, including watchdog interruption, records a failed reflection run instead of an empty night. The existing stalled-reflection regression now passes.
- **Approval fixtures:** shared test-only `resolveReviewed` reads the current proposal before submitting its version. Direct stale-version checks remain separate. Native file fixtures now include complete content and workspace-relative paths. Rejected edits remain pending and write nothing; first-party content edits stay on the reviewed target. Native edits without validators use Respond. Restart grants require the exact approved payload, with changed-content rejection explicitly asserted.
- **Recorded results:** ledger/API fixtures account for model reports, action receipts, room kind/router configuration and safe model revision fields. MCP status fixtures include passive requirements/tool summaries. An unconfirmed external MCP action is asserted Unknown, with its untrusted result and receipt checked separately; transport success is not treated as action completion. Redaction checks compare parsed JSON rather than whitespace. Optional Composio isolation checks prohibit importing the example app while allowing the separate hosted OAuth implementation.
- **Asynchronous fixtures:** the hook suite waits for automation-manager completion before closing SQLite. Heartbeat overlap waits for runtime entry. Watchdog tests use simulated time and distinguish interrupted from failed turns. These changes remove the unhandled rejections and timing assumptions without extending timeouts or suppressing errors.
- **Desk fixtures:** missing stream subscriptions and jsdom media-query support are supplied in tests. Queries use current accessible switch/checkbox roles. Mutable mock settings support the existing save/readback checks. Schedule tests save each independent section and retain validation checks. Automation-table tests follow its current owner/trigger/outcome columns and inspect poll configuration through Edit; retired last-poll badges are not product requirements. Memory and Skills queries follow the current UI.
- **Standalone fixture:** the disposable automation target explicitly selects `main` as its delivery destination. Before this change, the correct wake decision was Digest / `no_destination`, which contradicted the fixture's Ping expectation. Production delivery selection is unchanged.

No tests were skipped or deleted. No permission policy or production timeout was relaxed. No dependencies, APIs, exports, migrations or installed configuration changed. Production code changes are limited to approval waiting and reflection outcome classification; the other repairs update test infrastructure and assertions to the implemented contracts.

## Final verification

| Command/check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; lockfile unchanged |
| `pnpm -r --no-bail test` | Passed: daemon 1,502/1,502 across 108 files; desk 380/380 across 45 files; zero unhandled errors |
| `pnpm -r build` | Passed; existing desk bundle-size warning remains |
| `node scripts/verify-action-receipts.mjs` | Passed: real temporary HTTP/gateway/runner/SQLite seams; version/validation, restart uncertainty and repeat guards |
| `node scripts/verify-settings.mjs` | Passed; generated temporary-target evidence was restored to avoid unrelated changes |
| `node scripts/verify-automations.mjs` | Passed: delivery/history, quiet/failed/interrupted outcomes, signed hooks, polling/backoff and restart without replay |
| `node scripts/verify-bot-knowledge.mjs` | Passed all four groups after the final handbook build |
| Packaged `knowledge.load('proactive')` assertion | Passed: interrupted-reflection guidance present |
| `codex review --uncommitted` | Completed with no actionable regressions; reviewer also checked daemon/desk TypeScript and whitespace |
| `git diff --check` | Passed |

Final suite/build logs are `/tmp/openag-repair-full-2.log` and `/tmp/openag-repair-build-final.log`. Standalone logs use `/tmp/openag-repair-{receipts,settings,automations-2,knowledge-final}.log`; independent review is `/tmp/openag-repair-review.log`.

## Bot knowledge and limits

Updated authoritative `docs/notes/action-receipts.md` and `docs/notes/reflection.md`, plus `docs/help/proactive.md` and its manifest references. The shipped handbook explains that interrupted reflection is not a successful empty check. Delivery was verified through packaged assets and controlled API, Ollama, cached ACP/MCP, replacement-default and policy-restriction paths, including the existing-install cache path. Test-only changes require no additional product instructions.

Live-provider, live-service and physical-device acceptance were outside this repair. This is local automated acceptance, not deployment or historical live-data repair.
