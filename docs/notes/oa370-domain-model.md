# OA-370 domain-modeling pass

2 November 2026. Baseline: `47d8d47`, after OA-369 acceptance. This is a design record for the requested planning pass. At this modeling pass OA-370 was unimplemented. Current implementation and acceptance status are tracked in ROADMAP.md.

## Model and distinctions

The glossary adds Turn outcome, Incomplete turn and Execution allowance. Preserve existing Turn, Work, Investigation, Result, Evidence and Action receipt definitions.

| Concept | Meaning and relationship |
|---|---|
| Runtime outcome | Proposed typed report: completed, incomplete, failed or cancelled, with a bounded reason. A completed execution is not proof of business success. |
| Interrupted execution | Runner-owned recovery state: execution did not settle safely. It must not be reduced to ordinary incomplete or clean cancellation. |
| Action outcome | Existing receipt evidence: pending, completed, failed, unknown or not-run. An incomplete turn cannot rewrite an action outcome. |
| Work status | Aggregates linked runs, delegated results, questions, approvals and receipts. One completed turn cannot override incomplete children or uncertain actions. |
| Automation outcome | Describes the rooted execution tree independently from delivery. A partial answer being delivered is not a completed check. |
| Stop reason | Explains why processing stopped, such as step_limit, tool_limit, context_limit or output_truncated. It is not authority to resume or retry. |

Completion means the runtime has a normal final response and no unresolved calls or known forced/truncated stop. It does not certify the correctness or completeness of the model's reasoning. Preserve the legacy ACP mapping explicitly rather than claiming insight into its private loop.

## Concrete scenarios

| Scenario | Required observation |
|---|---|
| The last allowed model response is a normal final answer | Completed is possible at the exact cap; a count alone is insufficient evidence of incompleteness. |
| The last response requests another tool or ends because of output length | Incomplete with a stable reason and retained partial text; no extra request to manufacture a final answer. |
| Ollama requests six tools | No silent four-call slice. Process calls in order within the allowance; record any unexecuted remainder and stop incomplete if the allowance binds. |
| Two API tool calls compete for the last execution slot | At most one begins execution. Authorization alone is not an executed call. Persist the reservation before effects. |
| A call is refused or ignored | Preserve its permission outcome. It consumes no executed-tool slot and does not become a successful action through a later prose answer. |
| A result exceeds the model-facing data limit | Retain valid structured JSON, permission status, provenance and action evidence, plus truncation metadata. Do not declare fully processed evidence when required data was omitted. |
| An external action returned an uncertain result before the cap | Preserve unknown and existing receipt guards. Neither incomplete nor a continuation authorizes repeating the action. |
| The owner cancels while an action may still be running | Cancellation is a request; use interrupted/unknown until actual execution settles. Earlier effects are not undone. |
| A specialist or a no-Work automation stops incomplete | Rooted aggregation retains that outcome without creating Work or hiding it behind a parent's final response. |
| A run waits for request_input or approval | Waiting is not completion failure or allowance exhaustion. Preserve the existing question/approval lifecycle and restart behavior. |
| An incomplete turn resumes after restart | Same-turn counters and limit snapshot survive. No automatic replay or fresh allowance for the same turn. |
| A historical database is opened | Old statuses, IDs, receipts, links and sequence order survive. No retroactive certification of old finished turns. |

## Current source evidence

- `apps/daemon/src/runtimes/types.ts:57`: BotRuntime returns Promise<void>; it cannot express an incomplete stop.
- `apps/daemon/src/runtimes/api.ts:73`: Mastra defaults to five steps and writes output without classifying finish evidence.
- `apps/daemon/src/runtimes/ollama.ts:155`: the loop has an extra final request; later code slices calls to four and serialized results to 20,000 characters.
- `apps/daemon/src/runtimes/runner.ts:461`: toolCalls counts attempted calls before authorization; it is not an executed-call counter.
- `apps/daemon/src/runtimes/runner.ts:522`: finished is the default turn status; completion handling and Work propagation need the typed report.
- `apps/daemon/src/work.ts:95`: uncertain receipts and interruption already override completion. Preserve that ordering when adding incomplete.
- `apps/daemon/src/automations.ts:970`: aggregation follows rooted turns and delegated execution. Extend this rather than inspecting unrelated room activity.
- `apps/daemon/src/db/migrations/014_work.sql:11` and `019_automation_runs.sql:10`: CHECK constraints exclude incomplete. A migration must preserve the full existing graph.
- `apps/daemon/src/attention.ts:16`, `apps/desk/src/types.ts:596` and `components/WorkView.tsx:471`: status filters and presentation currently omit incomplete.
- `apps/daemon/src/botsettings.ts:39` and `gateway.ts:746`: existing validated owner settings are the smallest configuration seam for per-bot maxSteps.
- Installed Mastra `dist/stream/base/output.d.ts:165` exposes steps, finishReason, toolCalls and toolResults. Exact stop behavior remains a controlled-transport verification checkpoint, not a verified runtime claim.

## Scope decisions for the proposed plan

Use the existing runner, gate, receipts and runtime adapters. Add one hosted completion/reporting contract and one shared model-facing result formatter; preserve Apps/MCP untrusted labels. Keep full retained evidence separate from the bounded model projection.

Propose maxSteps as an owner-only bot setting, default 20 and validated 1–100, snapshotted at admission. Keep executed-tool limits fixed at 40 for current interactive hosted turns. Reserve the approved 12-step/24-tool investigation profile for a future trusted investigation entry point; unattended, cron or hidden rooms are not automatically investigations. Do not create a new responsibility runner in OA-370.

Both generated-answer truncation and known omitted required tool data must remain visible; conservative incomplete reporting is preferable to an unsupported completeness claim. Retain permission-denied and unknown-action evidence even if a model returns normal final prose.

No retries, new investigation deadlines, connectors, memory changes, automatic continuation, deployments or external actions are introduced. OA-371 owns request retries. Do not add an ADR: these refine the accepted harness design and are reversible within the existing modules.
