# Mastra: tools that await for a long time (verified for OA-008)

Checked on 2026-10-27 with `@mastra/core` 1.79.0, `ai` 7.0.154 (`ai/test` mock models), zod 4.6.7.

## Experiment
Agent with a mocked model (`MockLanguageModelV3`) that first emits a `write_file` tool call, then
text. The tool's `execute` awaits a timer standing in for a human approval.

- 3 s wait: tool result fed back, agent finished normally (2 model calls).
- 20 s wait: same result, no timeout, no retry, no duplicate tool call.
- `Agent.generate(prompt, { maxSteps })` drives the tool loop; the tool promise is simply awaited.

## Findings
- Mastra waits cleanly on a slow `execute`, so an approval can be awaited inside the tool.
  OA-008 is not blocked.
- The only "5 minute idle timeout" in `agent.types.d.ts` belongs to the background-task
  continuation stream option, not to tool execution. No per-tool timeout option found.
- Not tested: waits of minutes/hours. Pending approvals are durable in SQLite (OA-006), but the
  awaiting JS promise lives in the daemon process: a daemon restart drops it. OA-010 handles this
  by marking running turns `interrupted` and re-running on accept.
- `ai/test` in ai 7 exports `MockLanguageModelV3` / `MockLanguageModelV4`; Mastra 1.79 accepted V3.
  V3 results use `finishReason: { unified, raw }` and `usage.inputTokens/outputTokens` objects.
- Models can be given as a Mastra router string (`"openai/gpt-4o-mini"`, key from env) or an AI SDK
  model object (used in tests).
- Mastra also has its own tool approval feature; we do not use it. All approvals go through
  `approvals.ts` via `ctx.callTool` so the ledger and Inbox stay the single record.
