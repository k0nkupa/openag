# OA-360 controlled verification — 2 November 2026

Source implementation on `codex/automatic-owner-access`, starting at `10310ff`. No running-service change, live credential inspection/rotation, deployment, provider account operation, push or merge.

## Passed

- `pnpm -r build` and `pnpm --filter daemon exec tsc --noEmit`. Existing desk bundle-size warning remains.
- `node scripts/verify-owner-access.mjs`: temporary real filesystem, protected Unix socket and gateway; automatic private credential creation/import/restart, explicit-conflict/corrupt/unsafe/symlink refusal, existing-install git exclusion, long workspace paths and HTTP port 80, full/limited device authority, one-use/expired pairing, revocation, no credential/code in ledger, malformed socket requests and bounded grant creation. Real React Login/App checks use the gateway, including StrictMode, limited-session replacement, failed recovery retaining access, already-full session reuse and a delayed old-session 401 after successful recovery. Actual daemon starts/stops/restarts under an isolated HOME without an owner environment token; fresh seed provisions before the DB. macOS installer dry runs cover new automatic storage, no credential/seed creation in dry run, legacy service-token preservation and mode-600 plist output.
- `node scripts/verify-bot-knowledge.mjs`: packaged overview and authoritative source reference, plus owner-access instructions delivered through controlled API, Ollama, ACP/MCP and cached ACP/default-bot sessions. Policy/isolated/unattended restrictions remain checked. This does not claim an existing deployed bot has received a release.
- `node scripts/verify-composio-connect.mjs` and `node scripts/verify-google-connectors.mjs`: controlled connector lifecycle/encryption/policy regressions. No live provider calls.
- Real Chrome against the built desk and a temporary real socket/gateway: first host-link sign-in, Limited device readback, same-browser host-link recovery to Full, prior device retained, URL fragment removed, and phone-width layout at 390x844. The actual `OPENAG_DATA=<temporary workspace> pnpm desk:open` command then opened a fresh browser tab; confirming its form produced the visible Full access session. Browser tabs, viewport overrides and temporary servers were cleaned up.
- Script syntax, shell syntax and `git diff --check`.

Evidence: [phone recovery](recovery-phone.png), [actual launcher result](launcher-desktop.png). Screenshots show synthetic users/data, not the running installation.

## Reviews

Independent Standards and Spec reviews completed. Fixed their findings: long socket paths stopping valid installations; normalized HTTP port 80 rejection; stale old-session authentication failures clearing replacement access; obsolete required-token guidance. Both focused follow-ups found no substantive remaining defects.

Built-in `codex review --uncommitted` completed with exit 0 and no actionable defects. Scope: staged, unstaged and untracked changes from the source baseline, covering credential persistence, host pairing, browser recovery, installer compatibility and documentation. Reviewer was explicitly read-only and forbidden from running unit/Jest/Vitest suites or accessing live credentials/services. Final ticket/evidence bookkeeping follows that review.

## Limits

No unit/Jest/Vitest suites ran, including indirectly through hooks. Existing unit fixtures were adjusted for the changed default tab, explicit legacy UI and permission messages, but not executed; standalone integration/build checks are the approved replacement. Existing unrelated Base UI native-button warnings appeared in the controlled empty Home view; no related redesign was made.

No Linux desktop, physical phone, malicious-host security audit, live migration or deployment acceptance. Host recovery trusts the daemon's OS user; temporary pairing links remain bearer credentials, and browser device tokens retain the existing localStorage risk. Losing protected owner state still requires restoration; automatic rotation is intentionally refused.
