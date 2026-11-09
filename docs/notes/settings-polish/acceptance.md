# OA-382 acceptance — 3 November 2026

Source and controlled local preview only. No deployment or live account changes.

## Verification

- `pnpm -r build`: passed for daemon, desk and sign-in relay (Wrangler dry-run only). Existing desk chunk-size warning remains.
- `pnpm --filter desk build`: passed after final day-selector and overflow refinements.
- `node scripts/verify-settings-polish.mjs`: passed backup success/failure through actual database reopen, retained-file uncertainty, existing Full/Limited HTTP boundaries, seven semantic navigation links, shadcn table labels and unloaded Server state.
- `node scripts/verify-devices.mjs`: passed real-gateway/React device, pairing, permission, sign-out, navigation, server extraction, error/retry and stale-session checks. Existing warnings from other link-rendering components remain; the changed Settings navigation uses explicit link semantics.
- `node scripts/verify-bot-knowledge.mjs`: passed four packaged integration groups (API/Ollama/cached ACP/MCP/default-bot delivery).
- `node scripts/verify-capabilities.mjs`: passed capability catalogue and knowledge integration checks.
- `node --check scripts/preview-settings.mjs`, `node --check scripts/verify-settings-polish.mjs`, `git diff --check`: passed.
- Self-review: traced existing callers, field handlers, permissions, one-time secrets, navigation and backup audit restoration; no outstanding defect found in the scoped change.

## Chrome verification

Actual built desk served by `node scripts/preview-settings.mjs` using a disposable loopback gateway, temporary SQLite database, synthetic agents/automations, local backup service and a synthetic provider configuration. Inference disabled; no connected accounts.

All seven Settings destinations inspected and captured: server.jpg, bots.jpg, connectors.jpg, automations.jpg, models.jpg, proactive.jpg, devices.jpg. Extra views: server-operations.jpg, server-mobile.jpg, appearance-light.jpg.

Verified backup settings save in the temporary database; backup and proactive drafts survive tab switches; automation creation in paused state, contextual menu, deletion confirmation, Responsibilities/History tabs; empty provider search feedback; bot switching; light/dark selection; active-day changes save and survive reload. Phone-width checks show no document or main-content overflow on all seven destinations; tables and navigation scroll within their own containers. Measurements: browser-checks.json. No application-origin console errors observed during the preview.

## Limitations

- `node scripts/verify-settings.mjs` was attempted and timed out at line 49 while waiting for Work completion. Its broad joined-flow acceptance did not pass; it is not counted as validation of this change. Focused Settings and device acceptance passed separately.
- Unit/Jest/Vitest runners were not run under the owner rule.
- The shadcn MCP was not exposed in this chat. Installed Base UI components were discovered/read through the shadcn CLI and official docs; six missing component source files were added through that CLI.
- Screenshots demonstrate the local controlled build, not the running user installation, real provider acceptance or physical-phone acceptance.

## Delivered knowledge

Updated docs/help/overview.md, proactive.md, bots-models.md and the help manifest; docs/notes/settings-polish.md explains navigation and controls; docs/backup.md explains audited backup status after restart. The workspace build packaged the handbook; verify-bot-knowledge checked delivery through API, Ollama, cached ACP/MCP and a replacement default bot.

Merge reconciliation: the Settings implementation originally used OA-381, now OA-382; its alignment follow-up originally used OA-382, now OA-383. Main retains OA-381 for the separately built chat-display preference. That preference is preserved in Server, Appearance using the shared shadcn Field/Switch composition.
