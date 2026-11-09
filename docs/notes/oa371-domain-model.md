# OA-371 domain-modeling pass

2 November 2026. Baseline `6b36e97`, after OA-370 acceptance. This historical pass sharpens the request-retry model and its edge cases. Subsequent measured behavior and the current integration decision are in [Model-request retries](model-retries.md); source-only zero-retry inference below was not runtime proof. It changes no runtime, settings, ticket status or SDK retry configuration. At this modeling pass, the implementation plan and integration choice were still pending.

## Model

The glossary adds Model step, Model-request attempt and Turn continuation. Preserve Turn, Execution allowance, Turn outcome, Incomplete turn, Approval and Action receipt. Generic backoff and timeout mechanics belong here, not in the product glossary.

| Relationship | Meaning |
|---|---|
| Turn → model steps | A bounded agent execution can need several model responses and tool results. |
| Model step → request attempts | One logical generation can have an initial attempt plus at most two eligible retries. Three total submissions is the maximum, not three retries. |
| Model step → tool calls | Only accepted model output can propose tools. Retrying its transport cannot execute earlier tool calls again. |
| Attempt → retry owner | Exactly one layer decides whether and when another submission may happen. Nested SDK and application retries cannot multiply the allowance. |
| Provider delay → earliest attempt time | A usable Retry-After is a lower bound on when to resubmit, not permission to act or a promise that the next submission will succeed. |
| Request deadline → remaining wait | Each attempt and delay uses the same bounded remaining time. Retrying cannot reset that clock. |
| Turn continuation → retained evidence | Continuing from partial results preserves receipts, remaining same-turn allowances and any applicable provider wait. It does not restart an earlier action sequence. |

A model step and a physical request attempt have different counters. A successful retry can complete the last allowed model step. The two-retry allowance does not grant another model step or tool execution. Provider computation or billing can have occurred without a usable response; request attempts do not promise exactly-once provider processing.

## Retry eligibility and acceptance

The OA-371 target permits retries only for positively classified transient generation-transport, rate-limit or temporary server failures. An arbitrary exception or an unclassified server response is not enough. Authentication, invalid configuration/model/input, deterministic context overflow, cancellation and exhausted deadlines are terminal for this retry decision.

The retry scope is the individual generation request. Do not wrap ApiRuntime.runTurn, agent.generate's entire multi-step/tool loop, the runner, a tool executor or an automation run. Recall embeddings, capability probes, model discovery, ACP-owned loops and connector/provider actions do not acquire this retry policy through OA-371.

The acceptance boundary matters: once response content or tool-call output has been accepted downstream, a failed stream cannot simply be submitted again. The implementation must either prove that the failed attempt was buffered and discarded before any output/effect was accepted, or stop with an honest incomplete/interrupted report as appropriate. Do not concatenate responses from two attempts, treat a broken stream as a final answer, or dispatch duplicate tool calls. A model-request failure after an earlier tool completed can retry only the later request from the already-established context, including that tool's result.

Retrying the same request keeps its selected model, authorized input and tool-result snapshot. It does not re-run retrieval or rebuild the turn from scratch. A changed model, changed instructions or reduced input would be a new decision, not a transparent transport retry; provider failover and input repair are out of scope.

## Time and stopping

- Parse supported seconds/date Retry-After values using transport metadata. The final plan must settle invalid/past/conflicting values and any provider-specific variants through controlled cases. Do not infer delays from untrusted prose in a response body.
- Local backoff may impose a later attempt time. It must never shorten a valid provider delay. In particular, clamping a 90-second provider delay to 30 seconds would retry early.
- If the required wait leaves no time for another request, finish incomplete/provider_backoff and retain the earliest permitted next attempt time. It is informational; it does not schedule a run or authorize continuation.
- If execution time itself is exhausted, report a distinct deadline stop. Cancellation during a wait stops promptly with no next submission; it does not rewrite an action receipt as successfully cancelled.
- Remaining time is an absolute budget across attempts and waits. A fresh timeout for every attempt would silently extend the budget. Wall-clock provider dates and elapsed-time measurement need an explicit conversion rule.
- Shutdown/restart does not automatically replay a failed request, whole turn or action. Keep existing approval recovery and unknown-receipt safeguards. A later authorized continuation must respect the applicable recorded not-before time and remaining same-turn allowances.

The idle watchdog is not a total execution deadline: activity and pending approvals affect it. OA-370 did not introduce a shared request-retry deadline. The next plan must specify a finite retry-window clock and its relationship to existing request timeouts and cancellation, without adding the deferred investigation lifecycle or pretending a deadline already exists.

## Scenarios that test the model

| Scenario | Required result |
|---|---|
| Initial 429, then a normal response | One model step, two attempts, provider wait honored, tools from the successful response considered once. |
| Three eligible transient failures | Initial attempt plus two retries only. Retain a truthful failure or incomplete result according to the available output; no fourth submission or whole-turn rerun. |
| 401, missing model, invalid input or required context overflow | No retries. Keep the useful configuration/input error separate from temporary provider trouble. |
| Retry-After is later than the remaining deadline | Incomplete/provider_backoff with the earliest next attempt time; no early retry or automatic scheduled continuation. |
| Provider date is past, malformed or conflicts with another hint | Deterministic, documented handling; no arbitrary shortened valid delay. Exact supported precedence is an integration checkpoint. |
| Owner cancels or daemon shuts down during backoff | No subsequent attempt; prior action receipts retain their actual evidence. |
| A tool wrote a controlled file, then the next model request fails | Retry only that later generation request; the file-write invocation count stays one. |
| A completed model response already proposed a tool | Never replay its delivery or tool dispatch as part of retrying a later operation. |
| A stream emits accepted text/tool-call fragments and then breaks | No blind retry/concatenation. Stop visibly unless discard-before-acceptance safety is proven. |
| The last permitted model step needs one transport retry | A normal final response can complete within that same step; the tool cap and shared deadline still apply. |
| A provider wait becomes due after the turn ended | Becoming due grants no authority to start work. No new routine, alert or catch-up run is implied. |
| An earlier action receipt is unknown | Request retry does not settle it or bypass existing inspection/approval guards. |

## Current source agreement and gaps

Verified by read-only source inspection in this pass:

- `apps/daemon/src/runtimes/api.ts:78` calls Mastra's multi-step agent generation. It supplies no explicit maxRetries and must not become an outer retry boundary. Its catch at lines 79–83 replaces provider errors with a safe generic message, so retry classification belongs before that normalization.
- `apps/daemon/src/runtimes/ollama.ts:91` owns one chat fetch. Lines 98–106 establish a fresh per-call timeout and normalize fetch/HTTP failures. A retry decision needs the original bounded transport status, headers and error category before that information is discarded; raw response bodies must not be exposed.
- `apps/daemon/src/runtimes/hosted-execution.ts:16` accounts for model steps. Retries must not reset that persisted allowance or the runner's separately counted executor starts.
- `apps/daemon/src/runtimes/hosted-execution.ts:3` has no provider_backoff/deadline reason or next-attempt-time result field yet. The plan must carry these through existing turn, Work and automation reporting without hiding them behind completed/quiet.
- `apps/daemon/src/runtimes/runner.ts:548–558` uses activity-based watchdog time and exempts approval waits. It is not evidence of a shared retry deadline.
- `apps/daemon/src/automations.ts:982` already projects a bounded stop reason from the rooted execution tree. Keep new retry-stop details tied to that execution, not unrelated room activity.
- Installed packages remain `@mastra/core` 1.79.0 and `ai` 7.0.154. Mastra's bundle `dist/agent-tuAMgHe3.js:41714` defaults Agent retries to zero; `:31897` resolves effective settings. This is source tracing, not measured route conformance.
- The same bundle at `:29753` trusts APICallError.isRetryable and otherwise generally permits retries. At `:30005–30018` it applies a native retry loop and caps the provider delay using the 30-second constant at `:919`. Simply setting maxRetries to two does not prove this matches OA-371.

## Decisions still needed in the implementation plan

1. Prove the installed API/Ollama generation routes with controlled transports: actual submission counts, classification, delay handling, cancellation and stream acceptance. No real providers or unit/Jest/Vitest runners.
2. Use a native request-level retry hook only if that route satisfies the contract. Otherwise keep native retries at zero and use the smallest necessary request adapter. No framework fork or nested retry layer.
3. Specify the finite request/retry time window, measurement clock, accepted transient categories, delay precedence and conservative handling of partial responses. These are unresolved technical choices, not permission to broaden scope.
4. Decide how bounded attempt/stop details and next-attempt time travel through the existing outcome/reporting interface and remain visible after restart. No new auto-resume scheduler or retry-management UI is assumed.

No ADR is added: the request-only retry rule is already accepted in the harness design, and the SDK adapter choice remains unproven. Do not record a provisional integration choice as an accepted architecture decision.
