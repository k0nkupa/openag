# OA-361 verification — 2 November 2026

Source work on `codex/devices-settings-page`, based on owner-access commit `fcf8978`. Temporary data and synthetic devices only. No running-service, real device, credential or provider changes; no push, merge or deployment.

## Acceptance

- `pnpm -r build`: passed. Existing large desk-bundle warning remains. No new UI dependency or preset change.
- `node scripts/verify-devices.mjs`: passed. Real Hono gateway/SQLite plus real React DevicesPage/SettingsLayout/App verify route round-trip, active navigation, current Full-device marker, passive page/dialog reads, access save/readback, pairing defaults/creation/copy/reopen/expiry, cascade/default removal and current-device sign-out, permission updates, revoked/empty/error/retry states. Server extraction has a static component check and a separate real-browser navigation check. A public hostname beginning with 127 is not misclassified as loopback. Client expiry uses a deliberately short controlled response lifetime; server expiry/replay remains covered by owner-access acceptance.
- Added delayed-response acceptance at the real App/HTTP interface: an old Full `/whoami` response held during self-demotion cannot restore Full profile text or enable the access selector after the new Limited identity is applied.
- `node scripts/verify-owner-access.mjs`: passed. Existing automatic credential lifecycle, socket/HTTP pairing, migration, real daemon startup/restart, seed and installer dry-run checks remain intact.
- `node scripts/verify-bot-knowledge.mjs`: passed. Devices route/help delivered through controlled API, Ollama, ACP/MCP and cached ACP/default-bot sessions. Updated overview/manifest, authoritative Devices and owner-access guides, README and aligned AGENTS/CLAUDE guidance. This proves local packaged delivery, not deployment to the live default bot.
- TypeScript, script syntax and `git diff --check`: passed.

## Browser evidence

Chrome loaded the real built desk against a temporary gateway. Verified profile → Devices, Server → Manage devices, active Settings navigation, current-device ordering, device dialog and separate removal confirmation, pairing Limited default, real creation/countdown/loopback guidance, and Escape/focus restoration. After creation, focus moves to Copy code. Only synthetic test access was removed.

Desktop 1147px and phone widths 320/390px checked. Light and dark views checked. At 320px, document width equals viewport width, active Devices navigation is visible, and a 64-character unbroken name stays within the dialog. Pairing dialog bounds were left 16/right 304 within the 320px viewport. Browser viewport overrides, test tabs and temporary server were cleaned up.

- [Desktop, light](desktop-light.png)
- [Phone, light](phone-light.png)
- [Phone, dark](phone-dark.png)
- [Long name, 320px](long-name-320.png)

## Review

Independent Standards and Spec reviews identified the delayed identity-read race. The revision guard and real-App regression resolved it; both focused follow-ups found no substantive remaining defects. The design rationale uses the required Before/After/Why table in [Devices](../devices.md).

Built-in `codex review --uncommitted` completed with exit 0 and no actionable defects, covering staged, unstaged and untracked routing, identity, access, pairing, revocation and documentation changes. Reviewer was read-only and explicitly prohibited from running unit/Jest/Vitest suites, starting services or inspecting live credentials. A focused built-in follow-up also cleared the final loopback predicate and public-hostname assertion. Final evidence/ticket bookkeeping follows those reviews.

## Limits

No unit/Jest/Vitest suites ran. Existing fixtures were adapted for moved session controls and dialog interactions; build/typechecking and standalone integration are the approved gates. Existing unrelated Base UI native-button warnings in the empty Home view appeared in controlled App acceptance; no Home redesign was made.

No physical phone/touch, LAN/Tailscale QR scan, deployed-installation or live provider acceptance. Browser streaming was not the target of the temporary gateway fixture. Permissions, pairing limits, revocation and host recovery retain their existing daemon rules.
