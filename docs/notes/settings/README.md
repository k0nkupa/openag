# OA-330 Settings integration

The remaining Settings presentation uses the existing shadcn controls and daemon APIs. Provider artwork is bundled locally with its source licences. Typesafe/Jev and OpenAI decisions are identified separately from their shared OpenRouter transport. Key presence, adapter installation, sign-in, model configuration and verified connectivity are distinct states.

Proactive saves are separated by existing setting key. Each write is read back before success is shown; failures or mismatches retain the draft. Bot instruction saves check the submitted fields against readback. Memory blocks bot changes while a draft is unsaved. Proposal and skill requests discard stale responses. Routing refresh preserves an in-flight save. Automation editing is in a responsive side sheet; Escape cannot discard drafts, and explicit Cancel still works. Typed automation credentials are cleared after submit.

Existing permissions, memory-only owner retry, env-only provider keys, reflection, push, operations, readiness, device pairing and RTC controls remain. The classic shell remains available with `?desk=classic`.

Verified locally:

- `pnpm build` — passed (TypeScript and Vite; existing large-chunk warning).
- `node scripts/verify-settings.mjs` (also used with `--keep` for browser acceptance) — public HTTP/real runner/storage/CLI checks passed. The fixed Hello App was installed using a fresh digest/machine-bound CLI review, enabled and executed as a real local child process.
- `node scripts/verify-desk-flow.mjs` — passed the existing authorization, decision, duplicate/stale review, restart/resume, redaction and pagination assertions.
- Browser acceptance passed at 1440×960 and 390×844 in both themes. All seven Settings pages fit their content area. The device-access select overflow was corrected. Automation sheet widths are 560px desktop / 390px phone with no horizontal overflow.
- Browser checks covered refused/lost saves, locked controls while saving, retained bot/memory drafts, limited-device restrictions, automation create/validation/credential clearing/Escape, proposal and instruction races, routing refresh during save, independent model status when `/router` fails, and the classic fallback.
- The joined browser flow went from conversation to saved proposal, exact file approval, completed receipt and zero waiting requests after reload. Public assertions also covered pending approval/result survival across an actual temporary daemon restart, installed connections, automation delivery/history, routing failure fallback and explicit @mention priority.
- Independent Standards and Spec reviews cleared after fixes. Built-in source reviews found additional refresh/readback races; these were fixed, with the final routing mismatch correction source-cleared.

Evidence: `http.json`, `browser.json`, `prerequisites.json`, and `screenshots/`. Temporary daemons use controlled providers; they do not establish live model/account connectivity. Deliberately blocked browser requests were restored after acceptance.

Manual acceptance remains open:

- Physical second-device pairing/reload/shared-state acceptance was explicitly deferred by the owner.
- A fresh installed-Codex run with one reviewed temporary file write awaits specific owner authorization. No real model/action was run for OA-330.
- Third-party account/provider health and real external delivery are not inferred from UI status or local connector acceptance.

Unit tests, Jest and Vitest were not run, per owner instruction. OA-330 stays unchecked until its remaining manual gates pass. The owner separately authorized updating the existing 4747 desk after local verification; that release does not close the manual gates or retire the fallback.

4747 release: source `a792ddf`, built in the original checkout after fast-forwarding the verified worktree commits. Health, 14 authenticated reads, unauthenticated-library refusal and exact served JS/HTML checks passed. Schema 19 and all 29 accessible database table snapshots were preserved. Service plist, settings and integration files are unchanged. Backup: `$OPENAG_DATA/backups/oa330-release-2026-11-01T05-43-49Z`. See `release.json`. No live model, connector installation or avatar mutation was used for release verification.
