# Request provenance

Owner-approved implementation OA-434. Source acceptance is tracked below; this note does not establish deployment or live hosted-provider acceptance.

## Inspection and authority

Expand a turn-started entry in conversation or Work activity, then select Request details. Conversation entries require technical activity to be visible. The inspector reuses Sheet, Disclosure, Badge and EvidenceBlock. It shows bounded per-step summaries, source selection, attempts and expandable metadata. Live refresh preserves loaded earlier pages and catches up after bursts of new steps. Historical turns without original records show Not recorded.

`GET /turns/:id/request-manifests?before=<event id>` requires owner/Full access, returns no-store pages of up to 20 records, and refuses private investigation turns. The exact read-only route also works through authenticated WebRTC; the gateway still requires current Full device access. Ordinary room-event reads, WebSocket, WebRTC and Work activity publish only turn/manifest refresh references for the two private event types. The sheet links existing execution receipts for the turn. Viewing a trace changes no approval, receipt or action authority.

## Recorded evidence

- Ollama: assembled daemon `/api/chat` payload, after tools and attachment capability decisions.
- API providers: resolved SDK `doGenerate`/`doStream` input, including later tool-result steps, observed tool-call references and known help/skill source versions and digests. This is not a provider-native wire snapshot. Only supported scalar model/reasoning settings are retained; arbitrary provider options, headers and URLs are excluded.
- ACP: actual prompt handoff, selected source/history descriptors, fresh/reused session fingerprint, configured model, separate session-reported model/settings and names in the daemon allowlist. Those names are not child tool schemas. Child model steps, retained context, compaction, token usage and internal requests remain unavailable.

Requested settings and response-reported model/usage are separate. Missing usage is null/unavailable. Token counts are included only when the provider reports valid counts. Context counts use JavaScript string-length units; SDK tool text and serialized JSON values are counted without retaining their bodies. Provider framing and binary blocks are not text counts. Binary contents are excluded from fingerprints; attachment representation is recorded per file. Earlier source-reader clipping and mutable-source reconstruction are unavailable. Known package-reference sources retain the canonical package id, permitted relative path and known revision or null; bodies remain excluded.

History authorization and prompt admission retain the existing selection rules and budgets. Source descriptors carry selected text fingerprints and ledger message references where known; omissions distinguish database history limits, admission clipping, orphan replies and reused ACP history that was not reinjected. No unauthorized history is enumerated. Later hosted tool messages/results affect the observed request fingerprint; execution proof stays in existing receipts.

## Storage and failure behavior

Append-only `request_prepared` and `request_attempt` ledger events are authoritative. Migration 035 adds only lookup indexes, including indexed history participation for omission counts. The latest 20 eligible events are selected before an indexed count of their omitted prefix. There is no secondary execution store or backfill.

Prepared records are at most 16 KiB. Sources, messages and tool descriptors are bounded at 64 each with explicit overflow; complete metadata/catalogue fingerprints remain. Attempt events are bounded below 1 KiB by their fixed allowlist. At most 20 groups with eight evidence entries each fit below the 512 KiB response ceiling. Existing hosted step/retry and ACP follow-up limits apply. Retention follows the existing ledger; no new purge or snapshot feature exists.

Preparation and attempt-start evidence must persist before dispatch. Failure prevents that new request. Started means invocation initiated, not provider receipt. Settlement recording is best effort: a later failure leaves an explicit evidence gap and never retries an already-dispatched request. Cancellation, interrupted streams and restart can leave incomplete evidence. Unknown action outcomes and their guards remain unchanged.

## Verification

Passed source checks on 4 November 2026:

| Check | Evidence scope |
| --- | --- |
| `pnpm -r build` | Daemon/desk types and builds, packaged handbook; relay build is dry-run only. |
| `node scripts/verify-request-provenance.mjs` | Actual gateway/runner, 14 controlled provider formats, later tool steps, second conversation calls, requested/observed reasoning, absent usage, access, redaction, persistence and recording failures. |
| `node scripts/verify-request-provenance-edges.mjs` | Actual gateway/runner, duplicate-source recall, source mutation, known skill versions, history omissions, Unicode overflow, catalogue/response caps, mixed attachments, partial streams, cancellation/restart, Work projection and real local WebRTC privacy/Full inspection. A 6,000-turn conversation retains 20 events and reports exactly 5,980 omitted events; measured 82–262 ms for the bounded controlled gateway journey. |
| `node scripts/verify-request-provenance-desk.mjs` | Actual component/gateway, collapsed details, safe refresh, failed reads/retry without dispatch historical absence, retained earlier pages and a 51-step burst without gaps. Compiled-desk desktop/mobile browser scope is in the component audit. |
| `node scripts/verify-request-provenance.mjs --real-acp` | Both installed subscription adapters; discover/select a reported model, two no-tool prompts each, actual same-session continuity, stored fresh/reused handoffs and distinct requested/session-reported model evidence. |
| `node scripts/verify-hosted-context.mjs` | Existing selection, roles, scope, limits and approved-action recovery without replay. |
| `node scripts/verify-acp-continuity.mjs` | Both controlled adapters, reused/fresh context, history omission evidence, input pauses and restart. |
| `node scripts/verify-shared-skills.mjs` | Actual skill catalogue/gateway/runtimes, canonical reference identity/path, assignments, isolation and unchanged shared files. |
| `node scripts/verify-chat-receipt-recovery.mjs` | Existing Unknown guard, inspection authority and actual desk recovery. |
| `node scripts/verify-bot-knowledge.mjs` | Packaged chapter delivery to API/Ollama and cached ACP/MCP default-bot paths, including known chapter-version metadata. |

`node --check` covers changed scripts; `git diff --check` covers whitespace. Local Standards/Spec review and the final `codex review --uncommitted` are clear after fixes. Review findings on reasoning settings, ACP history/attachments/model identity, duplicate recall, history scaling, package-reference identity, live pagination, SDK tool-result counts and resolved-model admission evidence were fixed and checked. Cumulative `codex review --base d5cf402e56ba6e76d4735a38ed8d94debe52f324` also found no actionable regressions and passed daemon/desk TypeScript and whitespace checks. Merge and deployment remain separate owner actions.

Sanitized provider and real-ACP evidence was recorded during the release. Controlled transports are not live hosted-provider acceptance. The live installed service and its default bot are unchanged until a separately authorized deployment. No unit/Jest/Vitest (commit hooks bypassed under the owner rule), business effects, merge or deployment.


The first real ACP fixture assertion incorrectly counted Codex's failed own-server MCP startup notification as execution. Both turns had settled and retained their handoff records; no action/approval was present. The assertion now excludes only that exact transport-notification shape. It continues to reject every other tool call.
