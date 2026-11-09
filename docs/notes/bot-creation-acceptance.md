# OA-345 source acceptance — 3 November 2026

Scope: approved New bot plan, source and controlled checks only. The existing detached checkout was preserved. No unit/Jest/Vitest runner, live daemon, provider account, real model turn, deployment or publication was used. Temporary gateway/data fixtures were stopped and removed.

## Implemented

Owner/Full creation, shared pre-creation model discovery and validation, stable generated handles with duplicate display names, durable request receipts/readback and atomic bot/receipt/audit publication. The desk adds a right-side New bot sheet, keeps drafts on failures, guards duplicate submissions and reconciles uncertain responses. Bots and shared navigation refresh on `bot_created`; handles disambiguate names. Creation does not add rooms/membership, dispatch turns, create Work, change default designation or grant extra permissions.

Updated knowledge: `GLOSSARY.md`, `docs/openag.md`, `docs/notes/bot-creation.md`, `docs/help/bots-models.md` and its manifest. The bot-knowledge assertion was updated to the new implemented capability. Delivery is exercised through the packaged API, Ollama, cached ACP/MCP and replacement-default paths, including existing custom instructions and unchanged policy restrictions.

## Commands and results

- `pnpm install --frozen-lockfile` — passed. This worktree initially had no dependencies. pnpm retained its configured build-script restrictions.
- `pnpm -r build` — passed; signin-relay uses `wrangler deploy --dry-run`, no deployment. Existing desk chunk-size warning remains.
- `pnpm --filter daemon build` and `pnpm --filter desk build` — passed after subsequent affected source changes.
- `pnpm --filter daemon exec tsc --noEmit` and `pnpm --filter desk exec tsc --noEmit` — passed.
- `node --experimental-strip-types scripts/verify-bot-creation.mjs` — passed: strict input/access restrictions, duplicate names and reserved-actor/non-Latin handle fallback, eight concurrent submits → one creation, lost-response readback, conflicting content including secrets that redact identically, HTTP-compatible client UUIDs, snapshot expiry/request binding, management-route coexistence, redaction, locked/default policy modes, rollback and restart replay without a snapshot. Controlled real ACP protocol and hosted/Ollama discovery passed across six targets, no prompts/turns/rooms/memberships/Work from creation, ACP scratch cleanup and unavailable setup without orphan bots.
- `node scripts/verify-bot-models.mjs` — passed existing model selection, policy-gate and recovery groups with controlled transports.
- `node scripts/verify-default-bot.mjs` — passed.
- `node scripts/verify-conversation-model.mjs` — passed seven groups. Its schema assertion previously expected 21 although the checkout already had migrations through 27; it now derives the latest migration number.
- `node scripts/verify-bot-knowledge.mjs` — passed all four delivery/policy groups after the handbook update.
- `node --check` for changed standalone scripts and fixture; `git diff --check` — passed.

## Reviews

Separate Standards and Spec source reviews were completed. Standards found one retry-content defect: differing secrets could hash identically after redaction. The receipt now hashes normalized submitted content while stored bot text stays redacted; a regression assertion passes. The same reviewer cleared the focused correction. Spec found no remaining substantive source defect when the outstanding acceptance gates below remain explicit.

Built-in `codex review --uncommitted` covered staged, unstaged and untracked changes. Its successive findings were: generated handles colliding with built-in ledger actors, `crypto.randomUUID()` breaking plain-HTTP desk access, and the creation-status route shadowing management reads for a bot named Creation. All were corrected and checked: actor names now use fallback handles, the client uses an HTTP-compatible UUID generator accepted by the gateway even with `crypto.randomUUID` unavailable, and status reads use `/bots/creation/requests/:requestId` with the Creation bot’s settings/model/permissions/skills endpoints checked. Final full-scope built-in re-review exited 0 with no actionable correctness defects. Review restrictions explicitly prohibited unit/Jest/Vitest suites and live actions.

## Open acceptance gates

- **Browser (completed in the 3 November follow-up):** the in-app browser became available. Read-only inspection confirmed live localhost:4747 still serves the earlier desk; it was left unchanged. Temporary controlled previews verified the right-aligned Agents plus and Bots-page plus action, one shared draft across triggers, creation from desktop and phone entry points, rapid submission yielding one bot, unavailable-provider feedback with draft retention, a lost creation response plus failed status read that locks retries, then status recovery opening the single created bot. Database readback recorded zero turns, prompts and Work. Keyboard Tab stayed in the sheet; Escape returned focus to the active trigger or stable sidebar toggle, and route navigation closed the mobile sidebar. Layout stayed within 320px and 390px viewports. Limited-device controls were disabled. The sidebar action also opened from Work. Final console error check was clear. The earlier browser-access limitation is resolved; no live bot was created.
- **Real runtime:** the ticket's isolated real-runtime/policy turn was not authorized and was not run. Controlled discovery and existing controlled policy checks do not establish this manual acceptance.
- **Room picker:** shared bot listing includes new bots. The actual New room sheet/member picker is OA-346 and remains outside this source change.

OA-345 remains unchecked. No merge, push, release or live acceptance is claimed.

## Agents plus follow-up

The sidebar’s Agents heading now uses a quiet ghost plus aligned to the right. The Bots page keeps a labelled New bot button with the same plus. Both are detached Base UI triggers bound to one sheet handle; the explicit handle prevents the mobile sidebar’s own Sheet from taking ownership of the trigger. The active trigger is tracked for focus return, with the persistent sidebar toggle as fallback. The draft lives above route content so switching entry points does not discard it. Existing house controls supply focus, touch-target, press and reduced-motion behavior; no additional animation was introduced.

Validation: desk TypeScript/Vite build, `node --experimental-strip-types scripts/verify-bot-creation.mjs`, `node scripts/verify-bot-knowledge.mjs`, actual in-app-browser checks above, and `git diff --check`. The fixture’s new lost-create mode affects controlled transport only. Local Standards and Spec reviews are clear. The built-in follow-up review identified stale access state after promoting a device; the sheet now receives the workspace’s refreshed identity instead of fetching its own once. Actual browser verification started Limited with both buttons disabled, promoted only the synthetic device through the temporary gateway, navigated normally without reloading, and confirmed both buttons enabled and the sidebar trigger opened the sheet. Final `codex review --uncommitted` re-review exited 0 with no actionable defects; it also passed desk TypeScript checking and whitespace checks. No unit/Jest/Vitest suites or live actions were performed.

| Before | After | Why |
| --- | --- | --- |
| Creation available only on Bots | A quiet plus beside Agents and a labelled plus action on Bots | Reach creation from the current workspace without duplicating the form. |
| A mobile trigger could bind to the sidebar’s Sheet | Both triggers use the creation sheet’s explicit Base UI handle | Open the intended sheet inside the mobile sidebar. |
| A persistent sheet cached its own device-access snapshot | Use the workspace’s refreshed identity | Honor access changes without a reload. |
| A mobile trigger may disappear after navigation | Restore the active trigger, or the stable sidebar toggle | Keep keyboard focus predictable. |

The handle pattern follows the installed Base UI API and its [Dialog documentation](https://base-ui.com/react/components/dialog). Existing house Button/Sheet behavior supplies press feedback and reduced-motion support.
