# Uncertain outcomes without blocking unrelated conversations

Research date: 5 November 2026. Scope: primary-source research and current OpenAg source inspection. This note recommends a design; it does not implement or deploy it. No unit/Jest/Vitest suites, model turns, provider requests or live receipt changes were performed for this research.

## Recommendation

**Keep uncertainty as durable evidence. Stop treating it as an installation-wide lock.** Separate the recorded result of an invocation from the scope of operations that could conflict with its unresolved effects. A conversation ID is not an effect boundary: two conversations can change the same order, while two operations in one conversation can affect independent resources. This is an OpenAg design recommendation, informed by the isolation and retry contracts below; none of the protocols prescribes OpenAg's lock policy.

The smallest useful first slice is to give local inspection a genuine daemon-owned read/list/search path, using bounded file APIs or fixed executable/argument construction rather than arbitrary shell text. Then a failed search cannot create an uncertain *write* and block a later skill installation. Keep native Claude/Codex execution disabled. Follow with scoped conflict checks for tool contracts that actually identify their effect targets. Do not build a general workflow engine or add Temporal as a dependency.

**Important limit:** an unconfined arbitrary shell command has no reliable bounded effect target. It can write files, spawn other programs and contact any service reachable with its credentials. Changing its room or command string does not prove independence. A safe solution cannot promise that every later arbitrary shell call always proceeds after an uncertain shell write. That requires restricting shell authority, an explicit owner decision to proceed despite uncertainty, or accepting a risk of repeated/conflicting effects. Do not hide that tradeoff behind narrower SQL.

## What primary sources establish

| Finding | Source and implication |
| --- | --- |
| A timeout or reported failure can occur after effects happened. APIs with effects need an idempotency contract before retries are safe. | [AWS: Timeouts, retries and backoff](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/). Changing every timeout to Failed would change the label, not remove ambiguity. |
| Duplicate-request identity should express one logical intent. Identical parameters alone cannot distinguish a retry from an intentional second operation. The server must enforce the identity with its effects. | [AWS: Making retries safe with idempotent APIs](https://builder.aws.com/content/3Ev0BENTyBr0XxzRk5FDZzgNYos/m). A new chat, new tool-call ID or new hash does not establish a new safe business operation. |
| Stripe treats HTTP 500 outcomes as indeterminate, and advises retrieving objects, inspecting requests and using webhooks to reconcile them before a new-key operation. | [Stripe: Advanced error handling](https://docs.stripe.com/error-low-level). This is a concrete provider example, not a universal guarantee about all HTTP status codes. |
| Stripe API v1 replays retained same-key results, checks parameters and can prune keys after at least 24 hours. API v2 differs. | [Stripe: Idempotent requests](https://docs.stripe.com/api/idempotent_requests). OpenAg must honor each provider's exact retention and retry semantics; merely saving a local key does not deduplicate a remote write. |
| A durable runtime can observe one completion while executing an activity more than once. A worker can finish an effect and crash before reporting it. External services must enforce idempotency. | [Temporal: Activity definition](https://docs.temporal.io/activity-definition#idempotency). A durable receipt alone does not provide exactly-once side effects. |
| Cancellation may arrive after completion; an MCP receiver can ignore cancellation when work cannot be cancelled. ACP cancellation support and propagation to nested work are optional. | [MCP 2025-11-25 cancellation](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation), [ACP v1 cancellation](https://agentclientprotocol.com/protocol/v1/cancellation). A cancelled turn is not proof that a payment, message or detached process was rolled back. These are protocol references, not a verification of a particular installed adapter's cancellation behavior. |
| Fault isolation partitions resources so a fault does not consume independent resources. Boundaries must match the actual technical/business requirements. | [Microsoft: Bulkhead pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/bulkhead). This supports independent effect domains, rather than one global fence. It does not prove that arbitrary commands in different chats are isolated. |

## What OpenAg currently does

These claims come from the checked-out source, not new live acceptance:

- Receipt states already distinguish `pending`, `completed`, `failed`, `unknown` and `not-run`. Recovery changes an unfinished started receipt to Unknown, and an unfinished not-started receipt to Not run. [Receipt definitions and recovery](../../apps/daemon/src/action-receipts.ts).
- `run_shell` is `act-external`. Its confirmer maps interruption to Unknown, zero exit to Completed and other exits to Failed. Its own failure detail warns that partial effects remain possible. Thus **Failed means the command invocation failed; it does not prove no writes or external effects happened**. Completed shell invocation likewise is not independent downstream effect confirmation. [Shell contract](../../apps/daemon/src/tools/execution.ts).
- The timeout path marks execution interrupted, sends process-group SIGTERM and later SIGKILL. This attempts local cleanup; it cannot undo a remote effect already submitted. [Command execution](../../apps/daemon/src/execution.ts).
- `blocked()` exempts daemon read/search/browse classifications. For external/secrets calls, it checks all started pending or uninspected Unknown external/secrets/legacy-shell receipts, without room/account/target scope. Other calls use a bot plus selected-argument action key. [Global blocker and key](../../apps/daemon/src/action-receipts.ts).
- The runner additionally fences non-read permission operations by room/Work Unknown state. `receipts.start()` repeats room/Work and global checks at dispatch. Fixing only one query leaves other blocking paths active. [Runner authorization](../../apps/daemon/src/runtimes/runner.ts), [dispatch check](../../apps/daemon/src/action-receipts.ts).
- Inspection is also global: `inspectionEpoch()` counts every inspected receipt; dispatch rejects older permission/external proposals after any inspection. `approvals.inspectReceipt()` expires all pending external/secrets or permission-session proposals. Those rules would still interrupt unrelated work after narrowing `blocked()`. [Epoch](../../apps/daemon/src/action-receipts.ts), [approval invalidation](../../apps/daemon/src/approvals.ts).
- Tool registry hooks already hold daemon-owned permission/review/confirmation behavior. The policy catalogue names `read_file`, `list_files` and `search_files`, but source searches found no matching current first-party definitions in this checkout. Their policy names alone do not establish available tools. Reuse bounded path/read helpers in `tools/files.ts` and skills loading where applicable, while checking their current scope; do not silently expand private-workspace reads to arbitrary host files. [Registry](../../apps/daemon/src/tools/registry.ts), [policy names](../../apps/daemon/src/policy.ts), [file helpers](../../apps/daemon/src/tools/files.ts), [skills implementation](../../apps/daemon/src/skills.ts).

## Proposed behavior

This table is a recommended OpenAg contract, not existing behavior:

| Operation and evidence | Record | What should block |
| --- | --- | --- |
| Refused or failed validation before dispatch | Not run | Nothing from this invocation |
| Enforced read/list/search times out | Failed/cancelled read invocation, with timeout evidence | No later action; there is no uncertain mutation to reconcile |
| Command exits nonzero | Failed invocation, preserving partial-effect warning | Do not automatically repeat an effectful command merely because the exit is known |
| Known write lacks final effect evidence | Unknown/unconfirmed effect | Same logical operation and overlapping effect targets, across all bots/chats/tool aliases |
| Known write in an independent effect domain | Its own normal receipt | Continue when independence follows from the daemon-owned contract |
| Opaque shell/App/MCP write lacks final evidence | Unknown effect with opaque scope | Retain conservative protection for potentially overlapping opaque activity; never use chat IDs as a safety claim |

Separate **operation identity** from **conflict scope**. A stable operation identity prevents duplicate execution of the same intent; a conflict scope protects other operations that affect the same resource. Neither the current selected-argument hash nor a model-supplied `readOnly`/`target` field is sufficient. The tool executor or reviewed daemon-owned provider contract must supply scope. Use only the narrow identities a concrete tool can prove: for example integration/provider account plus order ID, or a daemon-resolved file path with the appropriate overlap rules. Two tools that mutate the same order must share a scope. Same target with different parameters remains a potential conflict.

No automatic retry policy is needed in the first change. When a specific provider supports safe retries, reuse its stable key and unchanged parameters within its retention window, and check its exact response contract. Otherwise reconcile through readback or owner inspection. Preserve uncertain history even when the owner records an inspection; do not fabricate Completed or erase a receipt.

## Small implementation slices

1. **Stop ordinary file inspection going through general shell.** Add/reuse daemon-owned read/list/search operations, bounded outputs/time, explicit host path permissions, no arbitrary executable/command interpolation, and no inherited native tools. Treat symlinks, path changes, special files and traversal limits as trust boundaries. Deliver these through the existing first-party registry to both ACP adapters and other runtimes. Update capability diagnostics and delivered bot guidance to prefer them. This directly addresses the search-timeout incident without weakening write protection.
2. **Separate receipt status from conflict decisions.** Add only the effect metadata required by real supported tools. Use one shared resolver for authorization and dispatch. Replace global and room-wide Unknown checks only where the resolver proves independence. Make inspection invalidation scoped too; preserve version checks for affected proposals. Keep opaque operations explicit and conservative rather than silently exempting them.
3. **Make a refusal actionable.** Return a stable reason, blocking receipt identifier and allowed next step, with normal room/account access checks. Let the bot explain the block without credentials or cross-room content leakage. Keep inspection owner-controlled; a bot must not self-approve clearing its own uncertain action. The existing receipt UI/API should be reused.
4. **Migrate without rewriting history.** Existing receipts lack new effect scope. Retain outcome, evidence and inspection data. Do not backfill safe targets from old shell strings or mark old Unknown receipts as completed. Known contracts may have an explicit migration; otherwise historical opaque receipts need inspection or an owner-acknowledged risk decision. Avoid an automatic age-based unlock.

The opaque-operation policy is the one consequential product choice left: keep a conservative opaque lane (safer, but later opaque commands can still require inspection), constrain execution enough to prove narrower effects, or offer an explicit owner proceed-despite-uncertainty decision. Claiming complete cross-chat freedom while retaining unrestricted opaque shell and duplicate-effect safety is not supported by the evidence.

## Verification needed before implementation is called done

Use disposable data and standalone integration checks; no unit/Jest/Vitest suites. Cover timeout/cancel/error/not-started cases; fresh/reused/resumed Claude and Codex sessions; restart recovery; same target through different bots/chats/tool routes; independent targets; opaque commands with changed text; concurrent pending calls; inspection of one target while another approval is pending; stale proposal rejection; and unchanged historical evidence. The original journey must include list/read/search of an absent destination, a forced bounded read timeout, then managed skill installation and reference loading in a new chat. Assert the actual effect and nested outcome, not just transport success. Separate controlled checks from real adapter acceptance and deployment.

No implementation, provider acceptance or deployment is claimed by this research. The remaining risk is opaque execution: without enforceable effect boundaries, target independence cannot be inferred safely.
