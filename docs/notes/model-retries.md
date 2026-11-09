# Model-request retries (OA-371)

## Integration decision

Controlled native conformance against installed Mastra 1.79.0 / ai 7.0.154 found three submissions on the unconfigured transient-error route. Agent maxRetries zero alone did not prevent the default stability error processors from retrying. Disabling errorProcessorDefaults and maxProcessorRetries as well as explicit request maxRetries zero produces one submission. Native retry mode also retries generic deterministic exceptions and clamps a 90-second Retry-After to roughly 30 seconds. `node scripts/verify-model-retries.mjs --native` reproduces these measurements without a real provider.

Decision: disable both native mechanisms and own retries at the resolved model's individual generation method, using the public model resolver and preserving its model interface. Ollama uses the same policy around fetch plus bounded complete response parsing. Do not wrap the agent/turn/tool loop. This supersedes earlier source-only assumptions about zero effective retries; installed source defaults alone did not establish observed runtime behavior.

## Policy and scope

One initial submission plus at most two retries is permitted for each generation request. Eligible failures are HTTP 429/500/502/503/504 unless explicitly marked nonretryable, and known ECONNRESET/ECONNREFUSED/ETIMEDOUT/EAI_AGAIN transport codes. Known semantic context/auth/config/input/quota/policy codes take precedence over HTTP status, including 5xx. Context overflow reports incomplete/context_limit. Generic exceptions, malformed responses, authentication/config/input errors, TLS errors, cancellation and deadlines are not retried. Recall embeddings, model discovery, capability probes and ACP do not inherit this policy.

The selected model/input snapshot stays fixed. Model steps and executed tools keep OA-370's distinct durable counters. Native default error processors, including automatic input repair, are disabled along with native request retries so no second layer changes or repeats a request. Provider configuration errors that were previously auto-repaired can now surface for review.

## Time, cancellation and partial output

The five-minute generation window covers every attempt, local delay and complete response reading. Ollama's existing lower configured timeout still bounds it. Remaining time uses elapsed time within the process; the original wall-clock deadline is retained in turn state. A delay or retry never refreshes the window. The idle watchdog remains separate, and approval waits are not part of a generation request window.

Local delays are one second then two seconds. Supported Retry-After values are nonnegative integer seconds or an HTTP GMT date; retry-after-ms supports nonnegative integer milliseconds. Header names are case-insensitive. Use the latest valid provider hint and the local delay; malformed hints are ignored and past dates do not shorten local backoff. A numeric hint outside the supported time range stops provider_backoff with an unknown next time rather than retrying early.

A wait that cannot fit returns incomplete/provider_backoff with nextAttemptAt when representable. Exhausted transient attempts without a future wait return failed/provider_error. Deadline expiry returns incomplete/deadline. Cancellation stops before further submissions and preserves actual receipt evidence. Known provider waits are retained in trusted question/recovery/delegation metadata, scoped by model revision; they survive linked continuations and restart. They do not create an account-wide throttle or schedule another run.

Returned API streams are guarded and never resubmitted after delivery. Broken streams with accepted content or transient stream errors return incomplete/provider_interrupted; deterministic configuration/auth errors delivered as stream chunks remain failed/provider_error, and semantic context errors remain incomplete/context_limit. Available partial text (up to a 100,000-character in-flight buffer) is retained separately from any normal completion claim. Ollama buffers and validates its bounded non-streaming body inside the request operation. Oversized/malformed bodies are terminal; a positively classified transport failure before that buffered body is accepted can retry safely. Neither path replays an earlier tool result or executor.

## Persistence and reporting

Turn state records the request window before an inherited provider wait begins and retains the request's model step, revision, attempt count, original deadline and status. Terminal outcomes carry bounded reason codes and nextAttemptAt. The runner persists that time in its outcome and turn_finished event and includes a readable not-before time in the partial notice and Work run reason. Automation summaries derive waits from the full rooted execution tree, including hidden wake runs. They retain the latest known linked provider wait and explicitly flag any linked wait with an unknown end, rather than letting an earlier step-limit result hide a later wait. Existing tables/DTO text fields suffice; no migration or retry-management UI is added.

Provider response bodies, request payloads, credentials and URLs are not copied into retry diagnostics. Ollama's known fixed model/HTTP error messages remain available; other provider errors use safe bounded categories. Existing unstarted approval-recovery calls are settled not-run on incomplete/failed termination, while started/unknown actions retain their receipts and guards.

## Verification

The standalone `verify-model-retries.mjs` exercises shared timing/classification plus actual API/Ollama request adapters and a temporary gateway/runner. It checks three-attempt limits, one model step, stable input, seconds/date/conflicting/invalid delays, cancellation/deadline, partial streams, no native retry multiplication at the installed physical HTTP transport, retained non-enumerable transport metadata, semantic 5xx refusals, a failure after one confirmed file write without replay, and durable Work wait times through restart and trusted continuation. Native conformance is separately reproducible with --native. Affected hosted-model transport fixtures cover the existing provider formats and reasoning settings. The automation fixture verifies public and hidden-run wait summaries; bot-knowledge checks verify guidance delivery.

Controlled acceptance passed: build, daemon typecheck, thirteen standalone checks, native conformance, Standards/Spec reviews and a separate built-in Codex review with focused follow-up. Configuration errors delivered as streams and mixed linked provider waits were corrected and rechecked. No deployment or real-provider acceptance is claimed.
