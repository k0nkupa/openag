# Tool execution reliability — domain model

Status: domain model for the owner-approved tool execution reliability slice. See [source acceptance and limits](tool-execution-reliability.md); this document does not establish deployment.

## Purpose

Make an action's reported result agree with the evidence, regardless of which runtime requests it. This extends the existing execution contract; it does not replace the daemon, permissions or receipts.

## Existing language

Use the terms in [GLOSSARY.md](../../GLOSSARY.md): **Offered tool**, **Tool action**, **Invocation completion**, **Effect confirmation**, **Action receipt**, **Receipt inspection** and **Cancellation**. No new glossary terms or ADR are needed.

- An offered tool is available, not authorized.
- One tool action has particular inputs and scope. Adapter forwarding does not create a separately authorized action.
- Invocation completion establishes what returned. Effect confirmation establishes what happened at the target. These are separate facts.
- An action receipt retains the reviewed proposal, authorization and observed execution outcome where the existing receipt contract applies. A denied request need not create a new receipt; it must remain observable without dispatch.
- Cancellation stops requested activity where supported. It does not prove that a dispatched action had no effect.
- Receipt inspection records evidence. It neither replays the action nor rewrites its historical outcome.

## Outcome constraints

| Situation | Required interpretation |
| --- | --- |
| Permission refusal, ignored review or response instead of approval | No execution; observable refusal/review decision |
| Cancellation or changed permission before dispatch | Not run; target unchanged |
| Authoritative rejection without the intended effect | Failed, with bounded evidence |
| Authoritative evidence of the intended effect | Completed within that evidence's stated scope |
| Response returned without authoritative external-effect evidence | Invocation returned; effect remains Unknown |
| Dispatch started, then response lost or process interrupted | Unknown unless retained authoritative evidence establishes an outcome |
| A nested provider result reports failure | Preserve that failure; a successful transport envelope is insufficient |
| A later successful read or receipt inspection | New evidence, not retrospective proof that every action succeeded |

Do not classify every nested error as a confirmed no-effect failure. A provider may report an error after a partial effect; that action can remain Unknown.

## Scenarios

1. A tool is refused in a confined mode. The executor counter and disposable target remain unchanged across API, Ollama and ACP.
2. An owner edits a proposal. Only the immutable reviewed inputs may dispatch; a stale schema, permission revision or target precondition requires a fresh proposal.
3. Cancellation happens while approval is pending. Approval cannot subsequently dispatch that cancelled operation.
4. Cancellation happens after a disposable target changes but before its response returns. Retain Unknown and do not repeat it.
5. A transport returns success with a nested provider error. The model, desk and acceptance script must not report a confirmed successful effect.
6. An ACP session is reused. Exact own-server forwarding still reaches the same daemon gate; native tools cannot bypass it.
7. The daemon restarts after dispatch. Recovery preserves uncertainty and blocks an unsafe repeat. It must not infer success from the model's prose.
8. A pending connection closes. The component that owns the operation settles or retains its state and releases its owned resources; unrelated turns/sessions remain intact.

## Current source ownership and evidence

- [Runner](../../apps/daemon/src/runtimes/runner.ts): authorization, immutable dispatch checks, execution start, result settlement and permission cancellation.
- [Action receipts](../../apps/daemon/src/action-receipts.ts): retained outcomes, start guards, inspection and repeat prevention.
- [Runtime contract](../../apps/daemon/src/runtimes/types.ts): separates returned invocation evidence from execution outcome.
- [ACP runtime](../../apps/daemon/src/runtimes/acp.ts) and [MCP server](../../apps/daemon/src/mcpserver.ts): exact offered-tool forwarding into the daemon gate.
- Existing standalone checks cover substantial parts already: action receipts, chat receipt recovery, daemon execution, permission providers and hosted outcomes. Their presence is not proof of complete cross-runtime coverage.

## Verification boundary

Reuse the owner-approved permission boundary: desk → real gateway/runner/policy → observable effect, approval or refusal → retained receipt/result. Cover API and Ollama with controlled provider transports, and both installed real ACP adapters with fresh and reused sessions. Observe the target as well as the returned envelope. Inject difficult races through controlled transports at the same daemon boundary.

Use only disposable local targets. Real provider business writes are outside this slice. Stop on an unexpected Unknown; report the stage, invocation/receipt IDs and sanitized evidence before any new effectful attempt.

See the [spec](../specs/tool-execution-reliability.md) and [DSH research](deepseek-harness.md). Request provenance supplies correlation evidence, not action authority or effect confirmation. No delivered bot capability changes in this design slice.
