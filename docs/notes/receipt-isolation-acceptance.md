# Receipt isolation acceptance — 5 November 2026

Scope: OA-475 source implementation and disposable acceptance. Native execution stays disabled for Claude and Codex. No unit/Jest/Vitest runner, installed-data mutation, commit, merge or deployment was performed.

## Observed behavior

Bounded daemon read/list/search no longer requires general shell execution. Invocation deadline/cancellation is separate from the eventual completion of an in-flight operating-system read. No read timeout becomes an uncertain mutation. Daemon-owned scopes protect overlapping writes across chats, bots and tool aliases; independent targets continue. Opaque operations and historical unscoped writes remain conservative. Owner inspection preserves outcome history and invalidates only conflicting proposals. The authoritative behavior and limits are in [daemon-execution.md](daemon-execution.md#bounded-inspection-and-conflict-scope).

## Controlled acceptance

`verify-effect-isolation.mjs` passed through the real runner, executors, approvals and temporary SQLite/filesystem: same-chat and cross-chat independent writes, same-target cross-bot alias refusal, opaque protection, read timeout followed by an independent write, missing directory reads, symlink/hard-link and escape refusal, bounded listing/search, scoped inspection, preserved unrelated approvals, stale dispatch, read recovery, legacy migration, restart, redaction-changed automatic/reviewed scopes, opaque tools with misleading read classification, whole-file multiline-secret redaction, filesystem-error redaction, missing-file case aliases, and a deliberately stalled filesystem deadline/cancellation. Stalled I/O is simulated in a separate process; no network mount was required.

Other standalone checks passed: action receipts and chat receipt recovery; permission worlds (including actual disposable App and stdio/HTTP MCP execution); capability catalogue; packaged bot knowledge and cached/replacement-default delivery; trusted ACP lifecycle and eight continuity groups; sixteen controlled remote-MCP groups. These establish controlled behavior, not real connector/provider acceptance. Workspace build passed with hosted relay dry-run only; subsequent daemon builds covered review fixes. Whitespace/syntax checks apply to the final change.

## Real subscription adapters

Both real Claude and Codex passed a disposable fixture skill install, managed discovery/loading, a second call in the same session and persisted resume after closing/recreating the adapter process. Both then passed an independent-chat journey with an earlier synthetic scoped Unknown left uninspected: fresh/reused/resumed calls loaded the installed reference and wrote independent workspace files. Both also passed complete Accredo package installation with unchanged source, resource-byte equality and fresh/reused/resumed reference use. No Accredo service or production connector was contacted; only local package files were copied into disposable data.

Those paired-provider passes preceded the final safety hardening (explicit read contracts, redaction, hard read deadlines and alias handling). Final hardened-source Codex acceptance is recorded separately in the JSON evidence. A final Claude subscription rerun was blocked by its session quota, reporting a reset at 12:50pm Pacific/Auckland. It stopped after two completed directory reads, before any write; it produced no Unknown or pending approval. This is a verification limitation, not a final Claude provider pass. No quota workaround or action replay was attempted.

Actual installed-adapter request captures after hardening passed for both Claude and Codex: the complete bridge reached privileged model input, user data stayed separate and native execution tools were absent. Those captures use loopback model endpoints and do not substitute for subscription acceptance.

## Review and retained evidence

Independent Standards and Spec reviews identified scope-redaction, classification-trust and deadline/epoch defects, all addressed with integration regressions. Built-in review identified multiline-secret search leakage, case aliases and raw filesystem errors; all addressed. The final built-in review result and exact sanitized logs/temporary evidence directories are recorded in [receipt-isolation.json](permission-modes/receipt-isolation.json).

Research: [unknown-outcome-isolation-research.md](unknown-outcome-isolation-research.md). Final Claude subscription re-verification remains quota-blocked. Opaque shell uncertainty can still block overlapping writes; a new chat is not an independence guarantee. No deployment is claimed.
