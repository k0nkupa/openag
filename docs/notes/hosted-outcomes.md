# Hosted execution outcomes

OA-370 source behavior. API and Ollama use a typed completed/incomplete/failed/cancelled report. The runner retains interrupted for execution that did not settle safely; action receipts independently retain unknown. A completed response does not prove business success. ACP retains its legacy void-to-finished mapping; its private loop is not measured by hosted limits.

## Limits and configuration

Owner-only `PUT /bots/:id/settings {maxSteps}` accepts an integer from 1 to 100 for API bots, including Ollama, default 20. The desk exposes Maximum model steps in Bot settings. No runtime switch or new provider call is involved. New hosted turns snapshot limits; same-turn recovery keeps that snapshot and counters. Model steps count requests admitted by the runtime, including the request that ended at approval. Existing historical turns without counters begin counting at their next resumed request; old requests cannot be reconstructed reliably.

The runner reserves an executed-tool slot synchronously after authorization/validation and before starting an executor. There are at most 40 starts per current hosted turn, including reads and executions that fail after starting. Refused/ignored proposals do not consume slots. request_input is lifecycle control, not a tool execution for this cap. Concurrent model calls cannot both claim the last slot. The existing watchdog and approval waits remain unchanged. This release does not add an investigation runner; the approved future 12-step/24-tool profile is not applied merely because a turn is unattended, hidden or scheduled.

## Completion evidence

API uses installed Mastra prepareStep admission and final step/finish evidence. A normal final stop at the last permitted step may complete. Unresolved calls, length stops, missing/unknown finish evidence and locally forced stops remain incomplete. Ollama uses the same step allowance without an extra final request; all requested calls are considered in order, with no silent four-call slice. It requires a completed response with a known normal done_reason for completion.

Reasons include step_limit, tool_limit, context_limit, output_truncated, unresolved_calls and unknown_stop. Required input overflow stops incomplete before embedding/probe/chat requests. A model request error remains failed unless a known local stop or cancellation explains it. A forced stop is rechecked after approval waits, before any executor starts. If approval recovery has no model steps left, the original unstarted call is recorded as not-run and its receipt is settled without another request. OA-371 adds request-only retry behavior; see [Model-request retries](model-retries.md). No whole-turn or action retry is enabled.

Tool projections preserve the ToolOutcome envelope, permission status, available receipt identity and execution evidence. At most 20,000 serialized characters reach the model. Large data is replaced by an escaped excerpt with truncation metadata; JSON is serialized after shortening, never cut afterward. Apps/MCP untrusted source labels remain. Known upstream truncation is retained and stops the turn incomplete. Retained executor-result ledger events and receipt evidence are not replaced by this shortened projection; Apps/MCP can have already bounded remote data.

## Reporting and recovery

Eligible incomplete replies and their notices remain in bounded conversation history, so follow-ups can use partial findings without erasing their stop reason. They are not indexed as completed conversation. Turns persist an outcome and reason; incomplete turns append a plain partial-result notice. Explicit Work aggregates incomplete only after active/waiting/uncertain/failed conditions have been considered. Chat turns create no Work. Attention includes incomplete explicit Work. Automation history follows its rooted execution tree, retaining incomplete separately from delivery or quiet; it does not inspect unrelated room turns.

Cancellation does not undo effects. Interrupted execution and unknown receipts continue to require inspection; neither an incomplete result nor a new allowance authorizes action replay. A delegated partial result carries its status and partial findings back. Reflection proposals are not applied from incomplete turns.

Migration 025 rebuilds only Work, Work runs and automation-run status constraints in a transaction, with foreign keys disabled outside that transaction and checked before commit. It restores enforcement afterward and preserves columns, IDs, links, indexes and AUTOINCREMENT high-water values. Historic finished records are not relabelled as proof of successful work.

## Verification scope

Standalone controlled checks exercise actual API/Mastra and Ollama adapters, public gateway/runner behavior, settings validation, final-at-cap and unfinished responses, tool batches/caps, structured truncation, explicit Work and attention, approval recovery without replay and a populated v24 migration. Existing Work, action-receipt and automation checks cover denied/unknown actions and cancellation. The automation fixture checks incomplete public-room and hidden wake runs. Bot knowledge checks verify the new topic reaches the configured default bot through API/Ollama and cached ACP/MCP help. These are controlled checks, not live-provider acceptance or deployment. Unit/Jest/Vitest runners are excluded by project policy.
