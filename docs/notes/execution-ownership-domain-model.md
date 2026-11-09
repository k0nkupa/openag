# Execution ownership and stopping

Status: owner-approved implementation contract following the audit at `7358d82`. Source acceptance is recorded in [execution ownership](execution-ownership.md); source changes do not establish deployment.

## Scope

Address three caller-traced gaps: App execution ignores cancellation, daemon exit can precede owned-process termination, and ordinary MCP connections that finish initialization after the manager's timeout are not closed. These are source findings, not live reproductions. No permission bypass was found in the capability paths reviewed; this is not a blanket security clearance.

Use the existing [glossary](../../GLOSSARY.md) for Cancellation, Turn, Tool action, Invocation completion, Effect confirmation and Action receipt. Daemon-owned execution and Execution stop sharpen the missing distinction. Generic resource, connection and cleanup terminology belongs here, not in the product glossary. No ADR is needed: this preserves existing authority and storage contracts and makes reversible lifecycle fixes.

## Domain rules

1. Cancellation is a decision to stop. Delivery of an abort signal alone is not evidence that local execution stopped.
2. Execution stop confirms that the activity OpenAg controls has ended. A completed execution can also be stopped; stopping says nothing by itself about success or rollback.
3. Before dispatch, cancellation means Not run. After dispatch, retain the existing evidence-based outcome; killing a process must not turn possible effects into Not run. Existing Unknown receipts and inspection/no-replay rules survive.
4. A returned App result can win a race with cancellation. Keep the already retained terminal evidence; late callbacks must not settle a second time or overwrite Unknown.
5. An unfinished connection setup has an owner even before a usable connection exists. Timing out the wait does not transfer or end that ownership.
6. A late connection may be closed, but may not be published as current or attached to a newer attempt. Cleanup must use the exact attempt/handle it owns.
7. Daemon shutdown stops admission before requesting cancellation. It must keep storage available while admitted jobs and resource cleanup settle.
8. Controlled shutdown preserves pending reviews for restart. It must not dispatch or replay them while draining. Ordinary turn completion and cancellation retain their existing approval-expiry rules.
9. Graceful shutdown means the required local drain completed. A forced stop is distinct: retain Interrupted/Unknown evidence and report the incomplete cleanup rather than claiming success.
10. Remote effects, remote cancellation acceptance and hosted-session release are separate evidence. Local shutdown cannot guarantee rollback or release when the provider is unreachable.

## Ownership

| Owner | Owned activity | Completion obligation |
| --- | --- | --- |
| Runner | Every admitted execution, including ordinary chat, direct runs, queued work, resumed turns and turn-related background work | Refuse new admission during shutdown; request cancellation and expose a barrier covering all admitted jobs, not just resumed/background jobs |
| App executor | The child process/group it starts, streams, timers and abort listener | Reject before spawn when cancelled; after spawn request termination, observe bounded local termination, release handlers and settle once |
| Shell executor | Its child process/group and termination escalation | Retain existing TERM→KILL behavior; its owner must remain alive until termination handling completes |
| ACP runtime | Adapter processes, per-room sessions and own-server token bindings | Retain cached sessions during normal reuse; on shutdown revoke owned bindings and await adapter closure |
| MCP manager/connector | Pending initialization attempts and acquired client/transport/stdio handles | Cancel or close abandoned attempts, including late results; no stale publication or unowned child after timeout/reload/shutdown |
| Daemon entrypoint | Admission sources, ordered shutdown and database lifetime | Invoke shutdown once, coordinate existing owners with a finite deadline, then close storage and exit |

Normal turn completion may retain idle ACP sessions and MCP connections for reuse. Cancelling one turn must not close unrelated rooms or integrations. Shutdown releases those retained resources through their existing owners.

The runner does not become a generic process manager. App/MCP/ACP owners keep their own termination mechanics. The daemon coordinates them through narrow completion promises.

## Scenarios that constrain the repair

- **Cancel before App spawn:** executor count stays zero, target absent, result Not run; no retroactive receipt of execution.
- **Cancel during App work:** a temporary App pauses before a second write. Cancellation must terminate its owned process before that write; any earlier effect remains recorded and may be Unknown.
- **App result/cancel race:** one terminal result, no double settlement, no post-settlement abort handler or timer. Read classifications do not grant new execution authority.
- **Permission downgrade:** an interactive Full App is running when the owner changes mode. The same cancellation path stops it; the new mode does not undo an earlier effect.
- **Daemon SIGTERM during a resistant command:** the runner is interrupted and aborts execution; the command ignores TERM. The daemon must allow its existing KILL path to complete before claiming a graceful stop.
- **Pending approval at shutdown:** no execution, review survives restart; explicit later owner action still passes all original authorization and stale-proposal checks.
- **MCP initializes after 15 seconds:** its old attempt remains failed/unavailable. Any eventual connection is closed exactly once, including ordinary stdio/HTTP providers; no tool call is replayed.
- **MCP reload or shutdown while connecting:** the old attempt cannot publish into the replacement catalogue. Production connectors should accept cancellation during initialization; eventual cleanup remains a fallback for connectors that cannot abort immediately.
- **Repeated shutdown signals:** the same shutdown operation is observed; no second database close, duplicate process kill sequence or new admission.
- **Uncooperative or unreachable resource:** stop waiting at the declared bound, preserve uncertainty and report a forced/incomplete stop. Do not silently widen permissions or start recovery actions.

## Source map

These pointers describe the audit baseline at `7358d82`. The completed repair and current behavior are recorded in [source acceptance](execution-ownership.md).

- [Apps](../../apps/daemon/src/apps.ts): executor-to-runner handoff at line 517 omits the signal; local runner has a pre-spawn authority check and timeout/group kill but no cancellation listener.
- [Runner](../../apps/daemon/src/runtimes/runner.ts): cancellation at lines 898–918 and shutdown at 956–965; existing idle barrier covers resumed runs/background only. Context signals already combine parent cancellation, turn end and input pause at line 454; preserve that behavior.
- [Daemon shutdown](../../apps/daemon/src/main.ts): closes runtimes and storage without a barrier for ordinary active dispatches.
- [Shell](../../apps/daemon/src/execution.ts): the existing forced-termination escalation needs its owner to remain alive.
- [MCP manager](../../apps/daemon/src/mcp.ts): initialization wait times out after 15 seconds; line 398 retains late-connection cleanup only for Composio.
- [Stdio transport](../../apps/daemon/src/mcp/exact-env-stdio.ts): close sends TERM and schedules KILL but returns before observing exit.
- [ACP](../../apps/daemon/src/runtimes/acp.ts): existing process closer awaits exit and makes a useful bounded-termination reference; this does not establish a universal descendant sandbox.

## Verification contract

Retain the owner-agreed gateway → runner/policy → actual target/process → receipt boundary. App cancellation uses actual disposable processes and the normal gateway cancel/mode routes. Shutdown adds the real daemon process boundary: send a host signal to a temporary installation and inspect child liveness, retained records and restart behavior. MCP uses actual local SDK transports with deliberately delayed initialization and observable closure. These additions are proposed for approval with the plan, not new tests run in this design step.

Cover API/Ollama and ACP forwarding where lifecycle propagation differs, including reused ACP sessions. Use controlled transports for the defect/race matrix and bounded real-adapter disposable journeys before wider integration coverage. No business effects or production service signals. Never run unit/Jest/Vitest.

## Exclusions and knowledge

No runtime replacement, generic lifecycle framework, new receipt states/store, schema migration, automatic retry/replay, model tuning, permission relaxation, UI redesign, merge or deployment. Existing finite backend release limits remain explicit; no claim of revoking already completed remote effects or controlling escaped/unowned processes.

This design adds no shipped capability. Delivered help/tool descriptions must be updated with observed behavior during implementation, especially App cancellation and controlled shutdown; packaged default-bot delivery must then be verified. No handbook capability change is appropriate yet.
