# Hosted harness design

Owner-approved technical design for OA-355, 2 November 2026. Originally grounded in `10310ff`, refreshed against `c6aa061` after OA-342 acceptance. The owner approved the technical design and slice sequence in this conversation, then explicitly directed OA-342 acceptance before OA-355. This record authorizes the agreed source implementation sequence; deployment, account connection, live monitoring and external actions remain separate.

## Outcome and scope

Hosted API and Ollama bots should carry the authorized conversation forward, finish bounded work honestly and preserve evidence when interrupted. This is a foundation for the [personal-secretary spec](../specs/personal-secretary.md), not the entire secretary implementation. Keep the existing daemon, runtimes, gate, receipts and scheduler. Preserve ACP-owned context and all unattended/isolated restrictions.

## Current callers and behavior

| Observed seam | Source evidence | Consequence |
| --- | --- | --- |
| Runtime construction | `apps/daemon/src/main.ts:127` | API and Ollama share daemon-owned and connected tool definitions. |
| Prompt construction | `apps/daemon/src/runtimes/runner.ts:366`, `apps/daemon/src/prompt.ts:15` | Standing notes, up to four recall hits and the current body are combined; recent conversation is absent. |
| Hosted generation | `apps/daemon/src/runtimes/api.ts:50` | A new Mastra Agent receives minimal system instructions; the assembled context becomes user input. Generation defaults to five steps. |
| Ollama generation | `apps/daemon/src/runtimes/ollama.ts:156` | Initial messages contain system instructions and current input only. A capped loop ultimately removes tools; serialized tool output is sliced as text. |
| Completion | `apps/daemon/src/runtimes/types.ts:53`, `apps/daemon/src/runtimes/runner.ts:545` | Runtime completion is `Promise<void>`; returning without throwing is not a reliable signal that the objective was finished. |
| Work independence | `apps/daemon/src/runtimes/runner.ts:227`, `apps/daemon/src/work.ts:192` | OA-342 is accepted: ordinary turns create no Work; reviewed creation and separate Start are authoritative. Hosted context must preserve this. |
| Saved artifacts | `apps/daemon/src/results.ts:32`, `:117`, `apps/daemon/src/db/migrations/024_explicit_work.sql:1` | OA-342 permits null Work with genuine bot/room/turn/tool provenance. Preserve the separate chat and Work quotas, update scope and action gate. |
| Recall/indexing | `apps/daemon/src/runtimes/runner.ts:155`, `:588`, `apps/daemon/src/vectors.ts:278` | Normal completed conversation can be indexed. Isolated/noIndex turns are excluded from completed-turn indexing. Retrieval currently filters by bot, not an independently selected conversation scope. |
| Automation reporting | `apps/daemon/src/automation-runs.ts:7`, `apps/daemon/src/automations.ts:972` | Durable failure/interruption and delivery history exists. OA-342 traces delegated tool/receipt outcomes without Work. New incomplete outcomes must extend that rooted aggregation, not replace it with room-wide guesses. |

These are source observations, not claims about current service configuration or live model behavior.

## Context contract

Keep prompt assembly in one existing module. Introduce a structured input projection in TurnContext, rather than separate prompt builders in every runtime:

- Trusted operating instructions: daemon policy explanations, tool-use rules and owner-managed bot instructions. They describe permissions but cannot override the server gate.
- Conversation messages: bounded authorized user and final agent messages, in stable chronological order. Preserve their roles. Exclude the current message from the historical selection so it appears once.
- Context data: standing memory, recall, help, responsibility purpose, findings and source excerpts with explicit origin and trust labels. Recalled or external prose is never promoted into operating instructions.
- Current attachments: retain the existing model-support and size handling. Historical attachments contribute references and bounded metadata, not repeatedly embedded bytes or automatic refetches.

API/Ollama consume this projection directly. Preserve the existing text projection for ACP and its adapter-owned session history. Do not prepend full history to each ACP turn or force a second summarizer onto it.

Starting limits accepted with the technical design. They are initial bounded defaults, not measured optimal values:

| Budget | Starting recommendation |
| --- | --- |
| Recent conversation | Up to 20 eligible messages and 24,000 characters, whichever binds first; preserve latest user/agent context where possible. |
| Recalled data | At most four eligible hits, up to the existing 600-character excerpt size each, with provenance handles. |
| Individual tool data | At most 20,000 characters in the model-facing structured envelope; retain bounded truncation metadata and action evidence. |
| Model steps | Default 20 for interactive hosted turns; validated per-bot range 1–100. Responsibility investigations use a smaller default of 12. |
| Executed tool calls | Separate daemon-enforced cap of 40 interactive / 24 investigation calls per turn. One provider response can contain several calls. |
| Overall time | Keep the existing watchdog; impose a separately configured total deadline for investigations. An approval wait is not a stalled turn. |

Character limits bound application payloads; they are not a promise about tokens or model context capacity. Where verified model limits are available, reserve output, tool-schema and attachment space before allocating history. If mandatory input cannot fit or capacity is unknown and the provider rejects it, return a bounded incomplete/context-overflow result. Do not loop on the same oversized request or silently truncate operating rules/current instructions.

Read recent history with a new bounded descending query, then reverse the selected rows. The current ledger list starts at the oldest rows; fetching its first page is not recent context. Allow only the bot's authorized conversation and eligible participants; hidden runs and external ingestion rooms are excluded. Context-reset semantics and resumed-turn anchors must be explicit so old messages cannot be reintroduced after a reset.

Compatibility decisions for the first slice: API/Ollama currently expose no hosted conversation-reset control. A model change is not a history reset. The projection will honor a daemon-derived history floor when one exists; it will not accept a floor from model content or claim a reset UI exists. ACP session reset remains adapter-owned. Before the typed incomplete outcome lands in OA-370, a mandatory-input overflow fails closed with a bounded `context_limit` error and no provider request; it must never silently remove operating rules or report completion.

Start with recent messages and source references. No persistent conversation summaries, bulk re-embedding or vector-indexing policy changes are part of this slice. Keep normal conversation indexing as currently configured. The secretary design separately requires scoped retrieval for new investigations, rather than assuming all same-bot memories may enter every source scope.

## Honest completion contract

Add a typed runtime completion result that distinguishes completed, incomplete, failed and cancelled, with bounded stop reasons such as step_limit, tool_limit, context_limit, provider_backoff and deadline. Preserve interrupted as a runner-owned recovery outcome and unknown as an action-receipt outcome: neither is synonymous with incomplete work.

Migrate every consumer before enabling the new outcome: turn history, runner return types, Work/run reporting, automation history, attention projection and desk labels. Additive database changes must preserve old records; historical finished turns are not retroactively certified as business success. Ordinary ACP completion can retain the legacy mapping until its adapter reports a stronger stop reason; do not invent knowledge of its internal caps.

A step count reaching the configured maximum is not sufficient by itself to declare failure or success. A normal final answer at the last permitted step may complete the turn. Use the pinned SDK's recorded stop/finish evidence and unresolved tool calls, and verify the exact output shape through controlled adapters. Output-token truncation, pending calls and a cap-forced stop must remain visible. Never discard excess Ollama tool calls and then report the task complete.

For explicit Work, record progress and remaining work without marking it completed merely because a turn ended. For a chat-only investigation, deliver a usable partial result with the same stop reason. Neither continuation nor budget reset replays actions. Saved-result compatibility is part of OA-342: chat evidence must have a valid non-Work origin, not a fabricated Work row.

## Installed retry semantics

OA-371 controlled measurements supersede the earlier zero-effective-retry inference below: default stability error processors also retry. Both processor retries and native request retries must be disabled for a single application owner. See [measured integration decision](model-retries.md).

The original design inspected the canonical checkout. This worktree now has cached dependencies from OA-342. Fresh read-only inspection confirms `@mastra/core` 1.79.0 and `ai` 7.0.154 here, matching the lockfile. The bundle references below were rechecked in this installed copy; they are source evidence, not a measured retry-conformance result.

Selected installed source evidence, relative to this checkout:

- `apps/daemon/node_modules/@mastra/core/dist/agent-tuAMgHe3.js:41714`: Agent defaults its model retry count to zero when not configured.
- The same bundle at `:31897`: resolved per-call settings use explicitly configured model retries first, otherwise call-time settings, otherwise that model count.
- At `:30005`: the actual model-stream retry loop takes `modelSettings.maxRetries`, has cancellation support and honors Retry-After with a maximum delay of 30 seconds. At `:29753`, recognized API errors use their retryable flag; other error types can also qualify. This is not an inherently transient-errors-only policy.
- `apps/daemon/node_modules/ai/dist/index.js:2640` and `:2659` contain a different general retry helper defaulting to two retries. Its defaults do not prove the retry count used by Mastra's resolved route.
- `apps/daemon/src/runtimes/api.ts:73` supplies model settings but no explicit maxRetries. Source tracing therefore indicates zero retries on this configured Mastra route; this has not been measured with a live provider.
- Ollama uses its own fetch path and timeout; it does not inherit Mastra's retry loop.

Recommended retry policy: one retry owner at the individual model-request seam, at most two retries for eligible transient transport/rate-limit/server failures, bounded by cancellation and the remaining turn deadline. No retries for authentication, invalid configuration, invalid model input, abort or deterministic context overflow. Never retry the whole runtime turn or tool executor.

Do not simply enable two retries and assume conformance. The installed Mastra loop can retry broad error classes and clamp a longer provider delay. The retry slice must first prove eligibility and Retry-After behavior with controlled transports. Use the native per-request retry route if it can meet the contract; otherwise retain zero native retries and implement only the necessary request-level adapter. This is a required integration checkpoint before approving that slice's implementation, not permission to fork Mastra or add nested retry layers.

If Retry-After exceeds the remaining allowed wait, finish incomplete with the next permitted attempt time. Do not retry early because a library clamps the delay. A later continuation creates a new bounded request from persisted progress and rechecks permission; it does not replay a prior turn.

## Tool results and errors

Keep ToolDef validation, executor lookup and the existing ToolOutcome envelope. Extend it only where necessary with a stable error code, safe next step, truncation status and retry hint. A retry hint cannot grant execution or settle an action receipt.

Preserve Apps/MCP untrusted wrappers; do not nest redundant wrappers or relabel external content as trusted. Truncate data before JSON serialization. Never slice serialized JSON. Keep authorization/refusal status, receipt identity and known/unknown execution evidence intact even when the result body is shortened. Errors must not contain raw provider bodies, credentials, internal URLs or private account details.

The executor's cancellation/deadline propagation needs to reach actual network/long-running reads. An abort signal only ending the caller's wait does not establish that a remote action stopped. Preserve current unknown-outcome guards across runtimes.

## Ordered implementation slices

The approved dependent implementation slices are tracked locally as OA-369 through OA-372. The owner explicitly selected this harness campaign; unrelated tickets are unchanged:

1. **OA-369 — Two-turn continuity:** shared role-correct input, bounded recent history and overflow reporting through API/Ollama. Prove one second-turn reference works at the existing gateway/runner seam, and unrelated/isolated history stays absent.
2. **OA-370 — Honest bounded execution:** explicit completion reasons through turn, Work, automation and desk; valid structured tool truncation; preserve executed-call evidence and ordinary ACP compatibility.
3. **OA-371 — Request retry conformance:** pin the installed route, reproduce zero/default behavior with controlled transports, settle the adapter checkpoint above, then verify eligible retries and deadline behavior without repeated tools.
4. **OA-372 — Routine visibility:** add only genuinely missing missed/pre-launch outcomes, without catch-up, duplicate runs or owner alerts outside the wake filter.

Each slice updates affected release handbook/bot-facing guidance and verifies packaged delivery. OA-342 is independently required for chat without Work; no slice may conceal that dependency with a visibility heuristic. Approval is recorded above and executable acceptance is recorded in the local ticket entries (removed; see git history). OA-355 completes the design gate only; the child tickets remain open until their implementation and verification pass. No external tracker publication is implied.

## Verification and acceptance

Use the owner-approved full-loop seam: controlled inbound messages and model/transport adapters, real temporary gateway/runner/policy/persistence, and observable output/history/desk. Mirror existing standalone automation, Work, action-receipt and bot-knowledge fixtures. No unit/Jest/Vitest runner and no live model, account or deployment are authorized here.

Required controlled scenarios: two-turn recall; strict room/bot/reset separation; recent-history overflow; output truncation; a final answer exactly at the cap; pending calls at the cap; denied tools; injected tool results; background input request; eligible 429/transient failure; auth refusal; a Retry-After longer than the deadline; abort during backoff; restart after an executed action; and an uncertain response that never causes replay.

Planned commands, not executed or passed in this design task: `pnpm -r build`, `pnpm --filter daemon exec tsc --noEmit`, focused standalone harness assertions, and `node scripts/verify-bot-knowledge.mjs`. Use `node scripts/verify-capabilities.mjs` for any change touching its governed tool families. Source/fixture acceptance remains separate from separately authorized real-model/adapter acceptance.

## Limits and outstanding checkpoint

Defaults above are accepted starting choices, not measured optimal values. Runtime outcome shape and retry hooks must be verified against the pinned SDK through controlled transports before implementing the corresponding slices. OA-355 design refresh changed documentation and the local build queue only. OA-342 separately completed controlled, browser and real-Codex acceptance in temporary data. No OA-355 runtime change, live provider exercise or deployment is claimed. The [secretary design](personal-secretary-design.md) covers responsibility ownership, scoped sources, memory correction and product rollout beyond this harness foundation.

OA-372 routine outcome implementation extends existing automation history with missed/skipped/pre-launch/uncertain-coverage diagnostics and a durable cron evidence cursor. It does not change execution retries, polling deadlines or notification policy. See [automation outcomes](automations/README.md#missed-schedules-and-start-diagnostics-oa-372) for exact behavior and first-upgrade limits. Source implementation is separate from deployment and live scheduler acceptance.
