# OA-328 — reviewed local setup

The App library reviews the target machine, local repository source, version, exact SHA-256, requirements, expected tools and machine access before exposing a local administrator command. The browser does not install files, run commands, accept package URLs/keys or write MCP configuration. Hello (App) and Local reference MCP are the first supported packages. Composio remains optional manual setup. No dependency download is performed; the reference MCP uses OpenAg's installed MCP SDK 1.32.2 through its standard stdio transport/server interfaces.

`GET /app-library/setup/:id` is owner-only (full devices retain their existing owner equivalence). Its generated command contains the actual daemon Node executable, setup entry point, target data directory, hostname and reviewed package digest. MCP commands also carry the reviewed configuration digest. Limited devices can browse public catalogue/status but cannot fetch commands or perform reload/review/enable operations. Commands contain no daemon token, provider key or existing configuration value.

Package inspection is shared with Apps: ordered file-content hashing preserves existing approval hashes; `data/` is excluded; symlinks and special files are rejected; code is capped at 200 files / 5 MiB, with bounded directory traversal. Captured file bytes, parsed manifest and digest use the same snapshot. Setup stages those bounded bytes, validates again and publishes with exclusive file creation, manifest last. Existing different installations are refused. An identical installation is idempotent and does not enable a paused App. App readiness still requires the existing fresh owner whole-folder review after daemon detection; missing required runtime/environment is not Ready. Installed code is not sandboxed and bot approval settings are never changed.

Ordinary manually configured MCP servers retain their existing runtime file ownership/permission checks, including deployments using symlinked or shared data directories. Stronger setup-directory guards apply only to the new setup/pinned-package paths; unsafe setup targets are Unavailable rather than fabricated installed packages.

MCP setup merges one fixed recipe into the administrator-owned `mcp.json`, retaining unrelated entries and top-level metadata. It refuses unsafe ownership/permissions, symlinks/hardlinks, oversized/invalid configuration, conflicting IDs and stale configuration digests. The local command serializes its writes with an exclusive target-directory lock, creates a mode-600 configuration backup, and replaces configuration atomically after a second digest check. It never accepts arbitrary command/URL/environment input. Only explicit administrator `openagPackage` pins invoke package validation in the MCP manager; ordinary manually configured servers remain supported. The pinned reference command/path/digest is checked before starting and while available, so missing or changed code cannot remain Connected.

## Administrator procedure

1. In App library, choose Add to machine and Review setup. Confirm the machine/source/version/digest, required runtime and declared tools. A local checkout source is labelled signature not verified; a digest pins contents, not publisher authenticity.
2. Acknowledge the review and copy the command. Run it in a terminal **on the named daemon machine** as the OS user who owns the displayed data directory. The target must already exist. The command uses only curated package IDs and checks hostname, data-directory ownership and expected digest. It does not use an owner token, contact a provider or change the service configuration.
3. Back in the desk, Check installation. App checking scans folders; MCP checking reloads configured servers and performs a real handshake/tool discovery. Command success alone is not runtime readiness. The review is refreshed after checking so follow-up configuration digests are current.
4. For an App, Review and enable the newly detected folder. For MCP, an actual Connected status proves handshake/discovery, not downstream account access or an external action. The reference clock retains MCP's conservative `act-external` default: it asks; its generic action receipt remains unknown without authoritative action confirmation even when a clock reply was received.

The CLI entry point is `apps/daemon/dist/setup.js` after `pnpm build`. Its supported actions are `install hello`, `install local-reference` and `disable local-reference`, with the exact flags supplied by the owner-only review. Commands are shell-quoted; they contain no credentials. Do not replace the pinned digest with a guessed or blank value.

## Rollback and failure recovery

- App: use Disable in the desk. Code and `data/` remain. No destructive uninstall is provided.
- MCP: refresh the review and use its local disable command (bound to the current configuration digest), then reload MCP. This changes only the supported connector's `enabled` flag; package files, unrelated config and user data remain. A fresh reviewed install command can explicitly resume the same pinned connector.
- Backups are under `$OPENAG_DATA/setup-backups/`, mode 600. Do not blindly restore an old file over later administrator edits. Review and merge only the intended change, then reload.
- Failed/aborted setup grants no App approval. Failed publication removes only unchanged code files and empty directories created by that invocation. A clean failure can be retried; if user files were added or edited during setup, they are preserved and the operator must inspect that destination. No existing different folder is removed. An interrupted local command may leave `.integration-setup.lock`; confirm no setup process is active before removing that lock locally. The CLI never steals it automatically.
- `setup-audit.jsonl` records static package ID/version/digest, operation, time and started/completed/failed outcomes, with no configuration or secret values. It is mode 600 and capped at 256 KiB; archive a full log locally before retrying. A lock or write failure is surfaced rather than treated as success.

## Verification

Passed on 1 November 2026:

- `pnpm build`: daemon TypeScript and desk TypeScript/Vite. The existing large-chunk warning remains.
- `node scripts/verify-integration-setup.mjs`: public CLI/HTTP assertions, actual App execution and MCP stdio handshake/tool execution; guards, conflicts, backup/disable/resume, injected publication failure cleanup, package limits, data preservation and legacy MCP compatibility. Sanitized result: [http-cli.json](http-cli.json).
- `node scripts/verify-app-library.mjs`: existing HTTP/runner and real local WebRTC assertions, including large tool responses.
- `node scripts/verify-desk-flow.mjs`: existing conversation/approval/restart assertions.
- Browser: review/acknowledge/copy, no install from Check, real temporary local setup, separate fresh App enable, actual MCP Connected then Paused, refreshed rollback digest, limited-device refusal, desktop and 390px phone containment. Captured console had no warnings/errors. Screenshots use temporary verification data: [App ready](app-ready.png), [MCP connected](mcp-connected.png), [MCP paused](mcp-paused.png), [phone setup](setup-phone.png).
- Independent Standards and Spec reviews cleared after corrections. Final built-in read-only Codex review found no actionable defects.

No unit tests, Jest or Vitest were run, under the owner's rule. No provider account connection or live integration installation was performed. Temporary verification processes were stopped. Service release is recorded separately below.


## Release on 4747

Released source commit `d64378c` to the existing launchd service on 1 November 2026. The original checkout was fast-forwarded and `pnpm build` passed before restarting. The served HTML and JavaScript match that build; unauthenticated library access is 401, authenticated inventory/settings/work reads and both owner setup reviews are 200. Schema remains 19 and database integrity is OK. Historical conversation/approval/bot/room/settings/tool-mode/automation/result/question/receipt snapshots, service configuration and integration files are preserved. The live library has three catalogue entries and zero installed integrations; setup review made no filesystem installation or account connection. Temporary verification listeners were closed; OpenAg uses only 4747.

Backup: `$OPENAG_DATA/backups/oa328-release-2026-11-01T02-52-37Z` (prior daemon/desk builds, mode-600 service plist and SQLite backup). Rollback requires stopping the service and restoring the prior builds; no database migration was added by this ticket. Inspect newer user state before any database/configuration restore.
