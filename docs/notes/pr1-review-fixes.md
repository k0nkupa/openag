# PR #1 Codex review fixes

Owner requested fixes for the two unresolved GitHub Codex code-review findings on 2 November 2026. The reviewed head was `12ac240`; both findings are in inherited connector/desk changes included in the PR. No review-thread replies/resolutions, deployment or live account changes are authorized by this fix.

## Numeric JSON redaction

The redactor parsed JSON before checking numeric leaves. IEEE-754 conversion rounded unsafe integers; returning the original JSON when its parsed representation appeared unchanged could retain the registered secret. Serializing a changed field could also round unrelated identifiers.

The Node 22 JSON reviver's source context and native raw JSON values now retain numeric lexemes through the existing redactor walk. Known numeric secrets and sensitive numeric fields are replaced as valid JSON strings; unrelated large integers, decimal/exponent spelling and negative zero survive. Already-parsed ordinary numbers keep the previous behavior. Original JSON containing a known secret is not returned merely because duplicate properties disappeared during parsing. No dependency or data migration was added.

This is internal security behavior; the bot receives the same redacted/untrusted results and gains no new action permission. No additional user-facing instructions are needed for the numeric fix.

## Routing reset

The model-discovery effect depended only on the catalogue. Cancel cleared controls and their snapshot while leaving the catalogue unchanged, so an unchanged non-lead strategy did not rediscover its stored model. Reset now has an explicit effect trigger when the strategy is unchanged; a changed strategy first reloads its catalogue through the existing effect. It reloads once per explicit reset, can recover after a failed discovery, and leaves save/readback confirmation behavior intact. Authoritative editor behavior is in [provider-routing.md](provider-routing.md); the packaged conversations help links to it.

## Controlled verification

`node scripts/verify-review-fixes.mjs redaction` failed before the fix with `Registered unsafe integer leaked into the ledger`. `node scripts/verify-review-fixes.mjs routing` failed before the fix because Cancel did not issue the required discovery (2 calls instead of 3). Both now pass together under `node scripts/verify-review-fixes.mjs`.

The standalone redaction check uses actual temporary SQLite/ledger persistence and MCP-shaped JSON, and checks large registered numeric secrets, preservation of unrelated numeric lexemes, nested string escaping, sensitive numeric fields, duplicate keys, valid JSON and idempotence. The standalone routing check mounts the actual React editor with controlled APIs and checks repeated unchanged-strategy Cancel, restored reasoning, fresh snapshot on save, preserved save confirmation, failure without automatic retry loops, explicit reset recovery and changed-strategy reset waiting for its catalogue. The last sequence reproduced a local-review race (10 requests instead of the expected 9 at the check point) before the unchanged-strategy guard was added.

Passed checks: `pnpm -r build`, `pnpm --filter daemon exec tsc --noEmit`, `node scripts/verify-review-fixes.mjs`, `node scripts/verify-apple-connectors.mjs`, `node scripts/verify-composio-connect.mjs`, `node scripts/verify-bot-knowledge.mjs` and `git diff --check`. The existing desk bundle-size warning remains. The expanded help fixture verified the routing reset explanation through API, Ollama and cached ACP/default-bot paths; it respects Ollama's four-tool-call response limit by requesting the extra help topic in a second model step. Local Standards and Spec reviews found no remaining issue after the changed-strategy reset guard; `codex review --uncommitted` reviewed this focused change against `12ac240` and found no actionable defects. Its independent daemon typechecking, script syntax and whitespace checks passed. Unit/Jest/Vitest runners, physical browser/device checks and live-provider acceptance are excluded. Previously recorded visual acceptance remains blocked by disabled local browser access; this DOM check does not establish layout.
