# Harness and main reconciliation

3 November 2026. Local source integration only. Main baseline `a7b0b7f`; harness baseline `fd21070`. Reconciliation ticket: OA-373.

## Ticket identities

Main already published connector work under OA-364 through OA-367. Those identities stay unchanged. The harness campaign now uses these unique IDs:

| Historical harness ID | Current ID | Meaning | Original commit |
| --- | --- | --- | --- |
| OA-364 | OA-369 | Hosted conversation continuity and trust roles | `47d8d47` |
| OA-365 | OA-370 | Honest bounded hosted execution | `6b36e97` |
| OA-366 | OA-371 | Model-request retry conformance | `89ceb85` |
| OA-367 | OA-372 | Missing routine outcomes without catch-up | `2c82f41` |

OA-342, OA-355 and OA-368 retain their IDs. Historical commit messages are not rewritten. The current queue, dependencies, domain-model filenames, links, notes and acceptance labels use the new harness IDs. The owner-selected sequence is OA-342 → OA-355 → OA-369 → OA-370 → OA-371 → OA-372 → OA-368. Numeric order does not replace dependency order.

## Reconciliation decisions

- Preserve both glossaries in one vocabulary, with access/integration definitions alongside responsibility and execution definitions.
- Keep main's persistent owner credential, protected host sign-in, device recovery and managed Composio routes, alongside the harness responsibility lifecycle and scoped investigation tools.
- Reserve both `responsibilities` and `composio-connect` API segments against static-file shadowing.
- Preserve main's fail-closed reflection outcome check: only `finished` can be successful. Incomplete, interrupted, cancelled and failed turns cannot be treated as successful reflection.
- Deliver and verify both sets of bot help: owner/device recovery and connector setup, plus hosted context, honest outcomes, routine diagnostics and responsibility limits.
- Preserve migration numbers 024–027: main ends at 023, so no schema renumbering or already-applied migration rewrite is needed.

## Verification

Combined verification passed on branch `codex/reconcile-harness-main`:

- `pnpm -r build`: daemon, desk and sign-in relay; relay deployment was dry-run only.
- `pnpm --filter daemon exec tsc --noEmit`.
- Twenty-two standalone commands, all exit 0 after the fixture correction below: `verify-secretary`, `verify-routine-outcomes`, `verify-model-retries`, `verify-hosted-context`, `verify-hosted-outcomes`, `verify-explicit-work`, `verify-work`, `verify-action-receipts`, `verify-automations`, `verify-input-runtimes`, `verify-results`, `verify-uploads`, `verify-bot-knowledge`, `verify-capabilities`, `verify-owner-access`, `verify-connector-isolation`, `verify-managed-onboarding`, `verify-composio-connect`, `verify-google-connectors`, `verify-one-click-composio --browser`, `verify-remote-composio --browser`, and `verify-devices`. Each is `node scripts/<name>.mjs` with flags after the filename. The two Composio browser checks exercise controlled browser navigation; Devices runs its actual routed UI through controlled DOM acceptance. Its optional `--browser` mode only serves a manual preview and was closed without claiming visual acceptance.
- Unique current ticket IDs and reconciled dependencies; 27 unique migration versions; changed Markdown file links; syntax and staged whitespace checks.
- Independent Standards and Spec reviews found no reconciliation defects; both reviewers cleared the focused result-fixture follow-up.

The first build found missing relay dependencies in this older worktree; a frozen-lockfile install with scripts disabled supplied them without changing dependency manifests or versions. The merged help manifest initially exceeded the existing eight-source limit; removing a redundant capability reference preserves that bound and both sets of authoritative help. Bot-knowledge acceptance proves packaged delivery through API/Ollama and cached ACP/MCP paths.

The broader result acceptance initially failed because its single-turn 101-save fixture now correctly stops at the harness's 40-tool allowance. The fixture now fills one Work's quota across three bounded turns, asserts the specific 100-version quota denial, and retains the existing pagination, conversation-quota isolation, receipt, auth, RTC routing and fresh-process persistence assertions. Runtime limits are unchanged. The corrected standalone command passed.

Both parent histories are preserved. This branch contains main baseline `a7b0b7f`; the local main checkout, remote branches and deployed daemon are unchanged. Git hooks are skipped for the reconciliation commit to avoid indirectly running prohibited unit suites.

No deployment, live account consent, real Outlook monitoring or physical-phone acceptance is established. The normal daemon still has no live investigation source; ACP investigations remain unsupported. No unit/Jest/Vitest suite is authorized.
