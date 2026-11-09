# DeepSeek Harness: benefits for OpenAg

Researched 4 November 2026 (Pacific/Auckland). Upstream revision: [`8bd073392eef6f54e921a093b95076248eb08cbb`](https://github.com/deepseek-ai/deepseek-harness/tree/8bd073392eef6f54e921a093b95076248eb08cbb). Scope: primary-source comparison with this OpenAg checkout. Recommendations below are proposals, not implemented or accepted product behavior.

## Subsequent owner decisions

The permission comparison below is historical research. The owner subsequently approved daemon-owned permission sessions and retired category Auto locks; current behavior is documented in [permission sessions](permission-sessions.md). The next selected harness slice is request provenance and context visibility, now [domain-modeled](request-provenance-domain-model.md) and [specified](../specs/request-provenance.md), with the owner-confirmed end-to-end verification boundary. Its implementation plan is now approved; see [source acceptance and limits](request-provenance.md). Deployment is separate. No wholesale DSH runtime replacement is authorized by these documents.

## Recommendation

Borrow its request provenance and context accounting ideas. Keep OpenAg's daemon, ACP runtimes, policy gate, durable approvals, action receipts and bounded execution. Replacing those with DeepSeek Harness would duplicate existing responsibilities and require a separate security and compatibility project.

DeepSeek Harness is a general agent runtime, not merely a wrapper for DeepSeek models. Its Cordis architecture makes the model adapter, tools, session log and loop replaceable plugins. That makes it useful reference material, but does not establish a need for a plugin framework in OpenAg. [Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/docs/architecture.md#L7-L25)

## Ranked opportunities

Next owner-approved slice after local OA-434 acceptance: [tool execution reliability domain model](tool-execution-domain-model.md), [spec](../specs/tool-execution-reliability.md) and [verification record](tool-execution-reliability.md). This reuses existing execution and receipts and starts with a coverage inventory. Context reduction remains conditional on measured need. Merge and deployment remain separate.

| Priority | Borrow | Benefit for OpenAg | Existing overlap and smallest useful scope |
| --- | --- | --- | --- |
| 1 | Durable request provenance | Explain which context and tools an agent received when it made a mistake. | Start with a bounded, redacted API/Ollama request manifest tied to turn/model step; record selected history boundaries, tool-schema revision/digest, context sources, omissions and model settings. This is provenance, not exact request replay. |
| 2 | Explicit context projections and pressure accounting | Make long conversations easier to inspect and reduce avoidable loss of relevant evidence. | OpenAg already bounds input and tool output. First report what was omitted and why; consider measured, source-linked context reductions only after that evidence shows a need. |
| 3 | Tool lifecycle contract checks | Catch disagreements between adapters about cancellation, permissions and uncertain results. | Preserve existing receipts and outcomes. Use the upstream pipeline as a checklist for fresh and reused sessions, denied calls, cancellation before/after dispatch and nested provider errors. |
| 4 | Clear capability boundaries and teardown ownership | Reduce changes that accidentally diverge between runtimes or leave stale sessions/tools behind. | Reuse OpenAg's existing BotRuntime, ToolDef, computer-driver and MCP boundaries. Extract a new interface only for a concrete second implementation. |

The ranking and proposed scope are engineering judgments from the evidence below. No measured cost, speed or reliability improvement is claimed.

## 1. Make model decisions explainable

Upstream derives model-visible history from durable session events. It distinguishes committed assistant messages from failed/retried attempts, and defines model-visible changes as logged changes. Its architecture also acknowledges that a hard process loss before settlement can lose an attempt stream. [Session log contract](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/docs/architecture.md#L119-L125)

Its request-header utility records canonical settings and tool schemas, compares those snapshots and folds the latest header from the log. That is a concrete, small mechanism worth studying independently of Cordis. [Request-header source](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/core/session/src/request-header.ts#L1-L64)

OpenAg already persists conversation boundaries, tool calls/results, output, model-step counts, retry state and action evidence. API requests are nevertheless assembled from current instructions, selected history, tool schemas, attachments and recall; the inspected API request seam does not persist that complete selected projection. A ledger transcript alone therefore should not be advertised as an exact reconstruction of every provider request. [Runner](../../apps/daemon/src/runtimes/runner.ts), [prompt assembly](../../apps/daemon/src/prompt.ts), [API runtime](../../apps/daemon/src/runtimes/api.ts), [retry policy](model-retries.md)

Recommended first slice: a redacted manifest explaining context selection at the daemon-owned request seam. Do not log raw credentials, private provider bodies or unrestricted attachments, and do not introduce automatic replay. Digests and source references help identify a request but cannot recover mutable content. Exact reconstruction would require retained redacted snapshots and explicit privacy/retention decisions beyond this first slice. ACP should report only what OpenAg actually observed or supplied; the child CLI owns its internal model context.

## 2. Improve context visibility before adding summarization

Upstream's tool-result pruner preserves the original event, appends a source-linked replacement, and keeps a bounded beginning and end. It runs under confirmed context pressure, makes no model call and remeasures pressure before deciding whether summarization is needed. It explicitly says character budgets are approximate and that syntactic pruning can remove meaningful middle content. [Pruner contract](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/compaction/compaction-tool-result-pruner/README.md#L8-L10), [replacement and limits](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/compaction/compaction-tool-result-pruner/README.md#L60-L113)

OpenAg's current hosted prompt admits at most 20 recent messages within declared text budgets, clips supporting data and avoids an orphan assistant reply. Its output projection keeps JSON valid and records output_truncated as incomplete. These protections already exist; the useful next step is visibility into selected/omitted context and actual provider usage where available. [Prompt](../../apps/daemon/src/prompt.ts), [hosted execution](../../apps/daemon/src/runtimes/hosted-execution.ts)

Do not silently replace current incomplete outcomes with a summarize-and-continue loop. Any future compaction must preserve current instructions, action receipts, unresolved approvals and uncertainty. OpenAg may retain only already-capped connector evidence; an upstream-style projection cannot recover data never retained.

## 3. Strengthen shared contracts without replacing safety

Upstream's pipeline snapshots and freezes arguments, tracks caller cancellation separately from wrapper state, distinguishes cancellation before dispatch, and treats undeclared/invalid concurrency safety as exclusive. Its source also has an allow fallback when no pre-execute policy intervenes. OpenAg must retain its own fail-closed classification and locked action classes rather than adopt that fallback. [Pipeline source](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/core/tools/src/pipeline.ts#L80-L216)

Upstream's loop repairs missing results differently for calls recorded as started versus not started. Its documented limits include no built-in turn budget and a root-shutdown persistence gap. Those are reasons to borrow narrowly, not evidence that it is a more complete replacement. [Loop failure and limits](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/core/agent-loop/README.md#L116-L120), [known limits](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/core/agent-loop/README.md#L190-L197)

OpenAg already has explicit completed/incomplete outcomes, request-level retries, execution signals passed into daemon executors, and unknown-result guards. Therefore this comparison does not propose adding those again. The incremental work would be proving that every adapter preserves the same contract, particularly on the second call of a reused session. [Runtime interface](../../apps/daemon/src/runtimes/types.ts), [runner](../../apps/daemon/src/runtimes/runner.ts), [outcomes](../../apps/daemon/src/runtimes/hosted-execution.ts), [request retries](model-retries.md), [receipts](../../apps/daemon/src/action-receipts.ts)

## ACP compatibility: useful candidate, not a drop-in adapter

The path would be: OpenAg runner → ACP client → dsh ACP server → dsh tool pipeline → daemon MCP transport → OpenAg policy/approval gate → provider → result/receipt reporting. Native dsh tools could follow another path, so connecting the server is not proof that every action reaches OpenAg's gate.

Upstream supports persistent ACP sessions, MCP attachment and one-shot permission requests, but explicitly omits modes, client filesystem operations and elicitation. It treats clients as trusted controllers and does not expose raw provider deltas or retry attempts. [ACP contract](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/acp/acp/README.md#L49-L86)

OpenAg currently calls session/set_mode when a response lacks modes and refuses adapters it cannot put in the safe asking mode. A generic dsh connection would therefore hit a known contract mismatch; removing that guard is not a valid integration fix. A separate adapter proposal would need an equivalent enforceable contract, controlled fresh/reused-session checks through both existing real adapters where affected, and proof that native tools cannot bypass OpenAg. No such integration was attempted. [Permission-mode enforcement](../../apps/daemon/src/runtimes/acp.ts)

## Follow-up: permission modes and dangerous access

DeepSeek does have user-facing permission modes. Its lack of ACP `session/set_mode` support does **not** mean its own product lacks them. In the shipped Web composition the names and bundles are:

| Web label | Stored preset | Filesystem mode | Approval policy |
| --- | --- | --- | --- |
| Read Only | `read-only` | `read-only` | `ask` |
| Workspace Write | `workspace-write` | `workspace-write` | `ask` |
| Full access | `danger-full-access` | `danger-full-access` | `never` |
| Auto review (experimental, optional) | `auto` | `danger-full-access` | `ask`, plus model review |

The base composition defaults fresh sessions to Workspace Write plus ask unless an environment/configuration or saved default changes it. The generic preset service's two-entry defaults differ from this shipped three-entry composition; the bundle is the source for what normal users get. [Shipped bundle](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/bundle/base/cordis.patch.yml#L219-L254), [preset source](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/interaction/permission-presets/src/index.ts#L160-L175)

The composer and `/permission` picker change the current session; General settings changes only future sessions. Visible Full access selection asks for risk acknowledgement. An explicitly typed `/permission danger-full-access` command switches directly. These are product controls, distinct from ACP transport modes. [Web permission UI](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/client/ui-permission-presets/README.md#L8-L33)

**Full access removes filesystem confinement.** Read Only denies file writes apart from required sinks; Workspace Write allows the workspace, explicitly added roots and backend temporary areas. These modes do not restrict network access or process visibility. A confined mode fails if no suitable sandbox exists rather than silently running unconfined. Full access bypasses the sandbox provider entirely. [Sandbox contract](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/docs/subsystems/sandbox.md#L6-L24), [failure behavior](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/docs/subsystems/sandbox.md#L141-L143)

**`never` means never prompt, not approve every request.** The approval service rejects an action that actually asks under `never`. Full access lets ordinary unconfined paths run without an escalation request; it does not turn explicit approval requests into grants. Workspace restrictions can instead produce a scoped escalation request for one wider execution. [Approval semantics](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/docs/subsystems/approval.md#L25-L39), [Bash escalation](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/shell/bash-sandbox/README.md#L48-L53)

Full access is not a global bypass of independent tool denials: the shared pipeline still handles a pre-execute denial and checks registered guards after an allow decision. This is a source-level statement about that pipeline, not a complete audit of all plugins. [Guard enforcement](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/core/tools/src/pipeline.ts#L184-L210)

**Auto review is an additional, experimental policy.** It is off by default and only offered for current sessions when enabled. The current model reviews supported calls; allowed calls execute with full host access, while denials normally ask the user. Invalid reviews fail without execution. It adds model cost and may make unsafe decisions; it is not filesystem confinement. A lifecycle limit deserves attention: removing the live Auto plugin migrates its active sessions to Full access. [Auto review](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/experimental/auto-review/README.md#L8-L10), [behavior and lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/experimental/auto-review/README.md#L49-L75)

Implication for OpenAg: a named permission selector can be implemented over OpenAg's own authoritative settings without changing the child ACP safety mode. A genuine dangerous mode would require an explicit product decision about which current OpenAg action locks it overrides; merely naming a preset Full access cannot change them. Likewise, an OpenAg Read Only label must say whether it means denied write tools or an enforced filesystem boundary. They are different guarantees. This follow-up researches those choices and implements none of them.

## Decision and limits

Start with request provenance if it addresses a current debugging need. Keep context reduction and a dsh runtime adapter as later decisions supported by measurements. Do not add Cordis, migrate persistence, enable automatic recovery or change tool concurrency from this research alone.

The upstream README labels the project a rapidly changing developer preview; its safety notice says it has not had a security audit and is not production-ready. These are upstream's stated limits, not a security assessment performed here. [README](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/README.md), [safety notice](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/SAFETY.md#L8-L18)

Verification: inspected pinned upstream documentation and source plus current local runtime/prompt code. No packages installed, unit/Jest/Vitest tests run, live provider calls made, runtime integrated, deployment performed or ticket marked complete. This research note changes no product behavior, so delivered bot knowledge needs no update; the note is not claimed to be packaged for the default bot.
