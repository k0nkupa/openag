# CopilotKit failure and recovery research

Date: 2026-11-05. Read-only upstream research. No application code, production data or provider operations changed. No tests or applications ran.

## Finding

The reviewed CopilotKit paths separate ordinary errors from deliberately requested human input. They do not make a generic target-and-findings inspection form part of ordinary tool-error handling. This is a bounded finding about the sources below, not a claim that no CopilotKit application can implement such a form.

An important qualification: the LangGraph backend explicitly recognises uncertain external writes. Removing mandatory owner paperwork does not make a lost acknowledgement proof that an external effect failed.

## Comparison

| Project / surface | Verified behavior | Implication for OpenAg |
| --- | --- | --- |
| CopilotKit v2 frontend execution | A thrown handler error becomes an error event, an `Error: …` tool result and an error field. The specific-tool path stores that tool message and does not request automatic follow-up when the handler failed. | A failed call can remain visible in history without demanding an inspection form. Do not claim every failure automatically continues the same turn. |
| CopilotKit v2 human input | A registered human-input tool pauses until the custom UI calls `respond`. | Human input is an explicit application choice for a decision or missing information. |
| AG-UI | A run has completion/error lifecycle events. An unrecoverable run error ends that run; interrupt completion is a separate state that resumes with addressed answers. | Failure and waiting for a human are distinct protocol outcomes. |
| OpenIntelligentUI (formerly OpenGenerativeUI) | Its documented meeting picker waits for a time selection or refusal, returns the choice as the tool result, then continues. | The form collects useful task input rather than requiring the user to rewrite existing error evidence. |
| Multi-Agent Canvas / CoAgents lineage | The legacy project points to the monorepo showcase. Its MCP example builds a ReAct agent over MCP tools, invokes it and returns messages. No custom generic receipt-inspection mechanism appears in this inspected agent file. | Useful comparison, but this small example delegates much behavior to LangGraph and does not prove production duplicate-write safety. |
| LangGraph backend | Configurable retries and recovery routes; known model-correctable errors can return to the agent, user-fixable problems can interrupt, unexpected errors fail the run. Lost acknowledgements of external writes remain uncertain. | Match recovery to the operation and available evidence. Avoid a universal owner-unblock form. |

## Primary evidence

### CopilotKit core implementation

Inspected upstream main commit `ef7de960e5c3a614213a57438e8b4fa962604324`.

- [run-handler.ts, handler failure](https://github.com/CopilotKit/CopilotKit/blob/ef7de960e5c3a614213a57438e8b4fa962604324/packages/core/src/core/run-handler.ts#L1430-L1483): catches the error, emits `TOOL_HANDLER_FAILED`, records the error text and reports execution end.
- [run-handler.ts, result and continuation](https://github.com/CopilotKit/CopilotKit/blob/ef7de960e5c3a614213a57438e8b4fa962604324/packages/core/src/core/run-handler.ts#L1551-L1565): inserts an attributed tool message; follow-up requires no handler error and `followUp !== false`.
- [official error documentation](https://docs.copilotkit.ai/teams/strands/troubleshooting/error-debugging): provider/chat `onError` callbacks and error codes for handler, parsing, connection and run failures. Its production example sends diagnostics to error tracking; no user inspection form is prescribed there.

### Human input and event protocol

- [CopilotKit HITL overview](https://docs.copilotkit.ai/human-in-the-loop): distinguishes model-invoked human-input tools from graph-enforced interrupts.
- [v2 useHumanInTheLoop reference](https://docs.copilotkit.ai/reference/v2/hooks/useHumanInTheLoop): explicitly registered tool, custom UI, one response, agent continuation after `respond`.
- [AG-UI events](https://docs.ag-ui.com/concepts/events): `RunError` ends an unrecoverable run; `RunFinished` can carry success or interrupt. `ToolCallEnd` completes tool specification, not proof of an external effect; `ToolCallResult` carries result data.
- [OpenIntelligentUI meeting-picker documentation](https://github.com/CopilotKit/OpenIntelligentUI/blob/main/docs/human-in-the-loop.md): application-specific time picker and refusal responses.

### Canvas and backend recovery

- [legacy Multi-Agent Canvas README](https://github.com/CopilotKit/open-multi-agent-canvas): identifies the LangGraph/CopilotKit stack and directs current work to `examples/showcases/multi-agent-canvas` in the monorepo.
- [current MCP agent example](https://github.com/CopilotKit/CopilotKit/blob/ef7de960e5c3a614213a57438e8b4fa962604324/examples/showcases/multi-agent-canvas/agent/mcp-agent/agent.py): bounded source inspection of the actual example, not runtime acceptance.
- [LangGraph fault tolerance](https://docs.langchain.com/oss/python/langgraph/fault-tolerance): retry policies rerun nodes and do not give external effects exactly-once semantics. It recommends stable, durable provider-honoured idempotency keys, status queries when acknowledgement is missing, and isolating non-idempotent effects from retryable nodes. Recovery choices include model correction, human input, configured recovery handlers or run failure. The application supplies those choices; the page does not prescribe a generic owner inspection form.

## Recommendation (design inference)

Remove OpenAg's mandatory inspection form and its generic owner-unblock contract. Keep errors and uncertainty as history. Report ordinary failures directly; ask for human input only when a concrete decision or missing fact is needed. For an uncertain write, first use available provider status or deduplication support; otherwise explain the uncertainty and avoid silently repeating that operation. Do not treat a tool error or timeout alone as proof of no external effect.

## Limits

Primary documentation and selected source paths were inspected. No CopilotKit, AG-UI or LangGraph runtime journey was executed; no exhaustive repository-wide absence claim is made. These frameworks are not themselves proof that arbitrary external writes can be safely retried. This note does not cover Grokbot or nightly-labs/OpenBot.
