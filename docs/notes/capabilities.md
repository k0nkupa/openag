# Shared capability catalogue

Implemented from the owner-approved plan on 2 November 2026. Scope: first-party search, computer and notification tools. This describes source behavior; it does not establish deployment or real-provider acceptance.

## Interface

`openag_capabilities({ family? })` is a read-class first-party tool. Family is `search`, `computer` or `notification`; omitting it returns all three. Arguments are strict and cannot supply another bot, room, credentials or turn permissions. The runner supplies trusted bot/room identity and a frozen per-turn `turnPolicy`; the corresponding persisted state flags are read-only to runtime code; a missing context returns unavailable.

Each entry comes from the existing ToolDef and includes its name, description, family, authoritative policy class, availability and permission projection. The response has an observation timestamp and `executionStillGated: true`. The catalogue never invokes authorize, creates approvals or executes a target tool. It is an observation, not an execution grant.

`ToolDef.capability.availability()` owns the selected tools' offered flag, reason code and safe next step. Their compatibility `enabled()` getters and registry filtering use that same information. Other tools retain their existing enabled behavior. The catalogue uses only the shared first-party definitions; third-party MCP/App discovery and runtime parity changes remain out of scope.

## Availability versus permission

- Search: `missing_configuration` or `configured`. Configuration checks the presence of a non-blank key without probing Brave or returning key material. It does not establish valid credentials or provider success.
- Notifications: `disabled`, `missing_configuration` or `configured`. The topic, server URL, last error and recipient information are never returned. `notify_user` remains effect-class act-external and uses its explicit daemon-owned HTTP contract; readiness neither sends a test nor proves device delivery. Rate limits still apply at execution.
- Computer: `disabled`, `missing_configuration`, `unsupported`, `not_observed`, `absent`, `stopped`, `running`, `unknown`, `busy`, `human_control` or `backend_switch_pending`. Offered describes tool exposure, not a guarantee that the last observed machine is ready now.

Permissions use the same effective policy resolution as execution. Environmental reasons are separate from execute/review/refuse and offline/unattended/isolated restrictions. `turnToolRestriction` is shared with the runner so the diagnostic does not invent a parallel permission engine. Receipt guards, argument validation, cancellation, later state changes and approval review still apply on actual execution. Default-bot identity adds no authority.

## Passive computer observations

Cua and generic drivers expose `peek()` with a bounded, secret-free snapshot: backend, requested backend if pending, declared shell support, configuration flag, last observed lifecycle state/time, current busy flag and whether input is blocked. No raw provider error, holder identity or viewer link is included.

The router reads the current instance without calling select, constructing a backend, refreshing status, locking, starting/stopping a session or applying a pending backend change. Declared shell support is available before backend construction. A pending change is shown as pending; a hosted session is not released by catalogue reads.

Before a lifecycle observation the snapshot says `not_observed`. Existing injected Computer implementations without peek are described conservatively; their shell support cannot be established from a passive snapshot. Screenshots are not blocked merely because a human holds the input lock. Input tools report human_control. Observations can be stale, so every computer action keeps its existing state and guard checks.

## Runtime wiring and maintenance

The tool is registered once in tools/firstparty.ts and exposed on API/Ollama and the scoped ACP MCP path, with an explicit read classification and MCP allow-list entry. Short prompt guidance is derived from the catalogue's actual names. Isolated turns do not receive that guidance and cannot invoke the tool; unattended turns retain existing read-mode restrictions.

When changing these tool families, update their availability callback and affected docs/help topics together. Do not copy configuration facts into bot memory or the static handbook. Add future families only after defining their visibility and passive state source.

## Verification

Acceptance commands for this slice:

```sh
pnpm -r build
node scripts/verify-capabilities.mjs
```

The standalone script uses temporary SQLite data, controlled computer drivers and synthetic notification transport. It checks dynamic search configuration and offering, strict scope, secret omission, effective modes, unattended/offline/isolation restrictions, computer observations, and preservation of a pending backend switch without probes or hosted-session release. A real runner call proves catalogue inspection creates no approval and a subsequent synthetic notification waits for exactly one approval.

It also runs the shared verify-bot-knowledge.mjs controlled runtime fixture, extended to exercise openag_capabilities over hosted API, Ollama and cached ACP/MCP. Those checks prove delivery and gate behavior, not real-model answer quality, provider authentication or actual notification delivery. Unit/Jest/Vitest runners and deployment are excluded by the owner.

Results: `pnpm -r build` and `pnpm --filter daemon exec tsc --noEmit` passed. `node scripts/verify-capabilities.mjs` passed four capability integration groups and four shared handbook/runtime integration groups. The existing desk bundle-size warning remains. No unit/Jest/Vitest runner, real provider/model, live data or deployment was used.

Review: local Standards and Spec reviews passed after freezing per-turn policy/state flags and preserving explicit failures from unrelated legacy enabled callbacks. Standalone acceptance also verifies attempted state/saveState escalation remains blocked. Built-in `codex review --uncommitted` reviewed an isolated copy of the intended diff against `25172d00cd79608677f36cecd94b1596dce59309` and found no actionable correctness, safety or approved-scope regressions. Reviews were source-only; they ran no tests, builds or live actions.

## Internal permission-session path (OA-400)

When the runner supplies the new permission service, diagnostics use the same trusted operation requirement and Ask/Never resolver as dispatch. Computer input and shell require interactive Full access until their world can enforce confinement; screenshots retain read/takeover behavior. Notifications use their explicit remote HTTP contract, so Read Only does not imply a remote-account write prohibition. Offline, background and isolation ceilings remain independent. From OA-402 this path is wired into main; upgrades require owner adoption. Category resolution is retired and previous rules are an immutable archive. This source change does not establish deployment. See [permission-worlds.md](permission-worlds.md).

Desk status refresh is also non-switching: GET /computer may query the current backend but cannot apply a pending backend change or release a hosted session. It is not the catalogue's cached-only peek. The explicit owner/Full backend-apply action is separate. See cua.md for status error and recovery behaviour.

## Local file search

`search_files` is an always-configured, offline-safe daemon search tool, offered through the shared registry and reported by the same passive catalogue. It uses bounded regular-file reads rather than shell execution. `read_file` and `list_files` are companion read tools. Their exact limits and conflict behavior are documented in [daemon-execution.md](daemon-execution.md#bounded-inspection-and-conflict-scope). Catalogue availability is not a grant; effective turn restrictions and permission adoption still apply.
## Provider-response notifications (OA-473)

New open MCP server interactions use the existing configured pusher through the live ledger subscription. They share its enablement, secret-topic, redaction and hourly-cap rules; they do not change the notification tool offering or its permission projection. Notification bodies carry only the bot and a generic response-needed message, never provider prompts, choices, response values or URLs. Closing a request, opening chat and restarting do not replay a push. See [MCP lifecycle](mcp-lifecycle.md#needs-you-server-input) for response behavior and limits.
