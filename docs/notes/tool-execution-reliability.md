# Tool execution reliability

OA-436: owner-approved local verification and contract hardening. No runtime defect has been reproduced by the checks below; no application execution path is replaced. Source verification does not establish deployment or business-provider acceptance.

Follow-up: OA-437 repairs the historical Work suite, reconciles current main and records the authorized combined local release. The optional-suite failure below is retained as historical evidence, not a current unresolved fixture defect.

## Path and ownership

API/Ollama tool selection → runner authorization and immutable proposal checks → permission/review gate → receipt start → executor/transport → observed result → receipt settlement and model-facing result.

ACP selection → exact offered own-server MCP forwarding → the same runner/gate/executor path. Child native effects and inherited integrations remain disabled. Session reuse grants no extra authority.

The runner retains invocation completion separately from execution outcome. A remote read error is Failed; an opaque external tool error can remain Unknown because it does not prove absence of partial effects. Cancellation before dispatch prevents the effect. Cancellation after a possible effect cannot establish Not run or clear Unknown. Work with an unknown effect remains Interrupted even after cancellation was requested. Receipt inspection never replays the action.

Authoritative user behavior remains in [permission sessions](permission-sessions.md), [execution worlds](permission-worlds.md), [Work lifecycle](work-lifecycle.md) and [Approvals help](../help/approvals.md). This note records verification coverage, rather than maintaining another behavior contract.

## Coverage inventory

| Contract | Existing integrated checks reused | Added coverage |
| --- | --- | --- |
| Same gate, confinement, exact own-server forwarding, native bypass refusal | `verify-daemon-execution.mjs --real`, `verify-permission-providers.mjs` | Installed adapter discovery selects a reported model; pending run list consumed per turn |
| Reviewed edits, stale/double decisions, target preconditions, ignore/respond | `verify-action-receipts.mjs`, `verify-permission-sessions.mjs` | No duplicate implementation |
| Nested command failures, output caps, direct provider wire result | `verify-permission-providers.mjs`, `verify-permission-worlds.mjs` | Actual HTTP MCP error → API/Ollama model envelope → retained receipt |
| Pending review cancellation and late decision refusal | Permission sessions; older Work suite is incompatible (see limits) | API and Ollama in both ordinary chat and explicit Work |
| Cancellation after a visible effect and lost response | Hosted outcomes and command timeout checks | Dispatch barrier after disposable marker; API/Ollama chat and Work; inspect target and Unknown fence |
| Restart/crash, receipt inspection, no replay and access controls | Action receipts and chat recovery | Existing checks reused; new cases preserve receipt IDs and request-manifest IDs |
| MCP cancellation/queue/transport lifecycle | `verify-mcp-contract.mjs` | Existing actual SDK transports reused |
| Default bot knowledge delivery | `verify-bot-knowledge.mjs` | Existing packaged API/Ollama and cached ACP/MCP delivery reused |

## New integrated acceptance

`node scripts/verify-tool-execution-reliability.mjs` uses the real loopback gateway, runner, permission sessions, real API/Ollama loops, retained receipts and a real local HTTP MCP server. The API model response is controlled at the SDK interface; Ollama responses are controlled at its HTTP interface. Separate provider-wire acceptance below covers installed SDK conversion formats.

Six cases per runtime: remote read error, opaque external error, pending approval cancellation in chat/Work, and post-dispatch cancellation in chat/Work. Every possible effect has a fixed disposable target, independent execution count and target readback. Dispatch/approval events provide barriers rather than timing guesses. Unknown cases demonstrate refused repeat, explicit inspection and unchanged historical outcome. Error evidence is redacted before retained/model-facing observation. Provider errors must produce a false model envelope tied to the same receipt, not merely contain an error word. Request provenance is retained for correlation.

Explicit Work is prepared in a controlled active runtime and started/cancelled through the actual gateway. That preparation is a fixture; it does not establish natural-language Work creation by a live model. No production routes, new persistent schema, dependencies or result vocabulary are added.

## Acceptance record

- Initial `pnpm -r build`: passed, including the relay's build dry-run only.
- Real installed Claude (`sonnet`) and Codex (`gpt-6.1-sol`): passed disposable writes/refusals, second-call Workspace session reuse, revision replacement and reused Full native-bypass refusal. Sanitized evidence.
- New lifecycle integration: all 12 cases passed. Sanitized identifiers/outcomes.
- `node scripts/verify-permission-providers.mjs`: passed all 14 controlled provider routes, including Ollama and DeepSeek. Real SDK transports consume actual confined command results; these are not live hosted-provider calls.
- `node scripts/verify-action-receipts.mjs`: passed, including the compiled desk receipt/inspection flow, process-crash persistence and no replay.
- `node scripts/verify-chat-receipt-recovery.mjs`, `node scripts/verify-hosted-outcomes.mjs`, `node scripts/verify-permission-sessions.mjs`, `node scripts/verify-permission-worlds.mjs`: passed against temporary gateways/runtimes and controlled transports.
- `node scripts/verify-mcp-contract.mjs`: 34 passed, zero gaps, through actual local SDK transports.
- `node scripts/verify-bot-knowledge.mjs`: four integration groups passed; packaged API/Ollama/cached ACP-MCP knowledge delivery and policy checked with controlled adapters.
- Local Standards/Spec review, JavaScript syntax, local links and whitespace: passed. Separate `codex review --uncommitted`: no actionable defects; reviewer independently ran all 12 lifecycle cases plus syntax/whitespace. Real ACP journeys were run by the primary agent, not repeated by review.
- Optional broader `node scripts/verify-work.mjs`: failed at the historical `ask` fixture, expecting Needs approval but observing Failed. That fixture supplies no permission requirement for its opaque synthetic writer; the current gate refuses it. Later assertions also expect native ACP approvals/execution, which the current contract prohibits. This older suite was not modernized or counted as passed. Current chat/Work cancellation is proved by the new actual-runtime gateway checks, not inferred from that legacy suite.

## Knowledge and limits

No default-bot behavior or tool description changes: this is verification-only work, and existing delivered help already explains returned versus confirmed effects, cancellation and Unknown inspection. Knowledge delivery is checked separately; the installed service/default bot is not updated by these source checks.

No unit/Jest/Vitest, production/business writes, live direct API-provider calls, new visual design, merge or deployment. Controlled checks do not establish arbitrary third-party tool semantics, uncooperative executor termination, or ACP child-internal model behavior. Context reduction and a generic teardown framework remain outside scope.
