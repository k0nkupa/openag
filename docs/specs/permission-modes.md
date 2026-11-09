# DSH-style permission modes

Status: owner-approved implementation baseline, 4 November 2026. The owner selected replacement of OpenAg's current permission model with DSH behavior and requested domain modeling followed by this spec. The owner confirmed the end-to-end verification boundary below. The approved campaign is implemented in local source; current acceptance evidence and supported boundaries are recorded in [permission sessions](../notes/permission-sessions.md). This is not a deployment claim.

Publication: project guidance does not configure an external issue tracker or triage-label mapping. The to-spec skill requires `/setup-matt-pocock-skills` before external publication with `ready-for-agent`. This spec has not been published or labelled externally. The owner subsequently approved the local OA-398 through OA-403 campaign ahead of the existing queue. ROADMAP.md tracks current implementation status.

## Problem Statement

The owner cannot select a clear operating mode for an agent. OpenAg exposes independent per-bot category settings, but local Auto still leaves native shell commands asking, external actions and secrets have immutable Auto locks, and backend boundaries are separate from what the permission grid implies. A category setting does not establish actual filesystem confinement.

The owner wants the familiar DSH interaction: Read Only, Workspace Write or Full access for the current session, with a default for future sessions. The setting must describe the boundary actually enforced across supported runtimes. The old category system must be replaced rather than hidden behind three new labels.

## Solution

Provide DSH's three named presets and separate their two constituent concepts: filesystem boundary and approval policy.

| Mode | Filesystem boundary | Approval policy | Ordinary behavior |
| --- | --- | --- | --- |
| Read Only | Read-only | Ask | Run permitted operations within the enforced boundary; request a scoped escalation when supported. |
| Workspace Write | Workspace, explicitly allowed roots and documented temporary areas | Ask | Edit and run commands within the boundary without routine action prompts; ask when a specific operation needs wider authority. |
| Full access | Unconfined | Never | Run permitted operations without routine prompts; refuse any operation that still explicitly requires an approval. |

Workspace Write is the default for a fresh installation. The composer selects the current agent's permission session; `/permission` provides the same owner-controlled picker. General settings selects the initial mode for future sessions. All surfaces read and write the same daemon-owned state. Full access selection includes acknowledgement that commands and connected tools can have destructive or remote effects without individual prompts.

The filesystem boundary does not restrict network access or process visibility. In particular, Read Only does not promise read-only remote accounts. The UI and delivered help state this. The mode is not provider consent, installation ownership or proof that an external action succeeded.

The existing category grid and independent Auto/Ask/Deny authority are retired after migration. Effects classifications remain available for descriptions, trusted operation requirements and separately stated isolation rules. They do not silently recreate the old class-based prompt matrix. There is no Custom preset in this replacement.

Domain definitions are in the project glossary. The accompanying [domain model](../notes/permission-modes-domain-model.md) contains concrete scenarios and source navigation; the [decision record](../adr/0004-permission-modes.md) records why this replaces the current model. The [DSH research](../notes/deepseek-harness.md#follow-up-permission-modes-and-dangerous-access) pins the upstream behavior being copied.

## User Stories

1. As an owner, I want three understandable permission modes, so that I can choose how an agent works without configuring a category matrix.
2. As an owner, I want Workspace Write as the fresh-install default, so that ordinary workspace work proceeds without repeated prompts.
3. As an owner, I want the composer to display the current mode, so that I know the authority of the agent I am addressing.
4. As an owner, I want the selector to identify the target agent in a shared room, so that changing one agent does not change another.
5. As an owner, I want a `/permission` picker, so that I can change the same setting from the conversation.
6. As an owner, I want the default for new sessions separated from existing sessions, so that a default change does not silently widen ongoing work.
7. As an owner, I want Full access acknowledgement, so that I understand that individual actions may proceed without prompts.
8. As an owner, I want Read Only enforced where commands execute, so that a tool cannot evade the boundary by using a shell.
9. As an owner, I want Workspace Write to cover normal edits and commands, so that shell tool names do not create extra prompts.
10. As an owner, I want the workspace and additional write roots explained, so that the writable area is concrete.
11. As an owner, I want an explicit warning that filesystem modes do not restrict network effects, so that I do not mistake Read Only for read-only provider access.
12. As an owner, I want a single scoped escalation, so that one exceptional operation does not permanently widen the conversation.
13. As an owner, I want escalation proposals tied to the exact operation and target, so that an approval cannot be reused with changed arguments.
14. As an owner, I want Full access to remove the old category-based prompts, so that the selected mode delivers the promised behavior.
15. As an owner, I want explicit approval requests refused under Never, so that unavailable approval cannot become automatic consent.
16. As an owner, I want independent tool refusals and owner access controls retained, so that selecting Full access does not itself issue owner credentials or remove authentication.
17. As an owner, I want limited devices refused when changing permission modes, so that device pairing cannot silently grant action authority.
18. As an owner, I want mode changes to survive restarts and adapter reconnections, so that the desk does not display a setting different from execution.
19. As an owner, I want stale child sessions invalidated or safely reconfigured, so that cached adapter behavior cannot retain broader access.
20. As an owner, I want unsupported confinement shown as unavailable, so that an unsupported backend does not run unconfined under a safe-looking label.
21. As an owner, I want each execution environment's boundary identified, so that a remote computer workspace is not confused with the daemon host.
22. As an owner, I want connected tools and Apps to follow the declared mode contract, so that an alternate transport does not create an unintended bypass.
23. As an owner, I want missing or unknown tool requirements handled explicitly, so that tool metadata cannot grant itself authority.
24. As an owner, I want delegated work to receive no wider authority, so that delegating cannot escape a boundary.
25. As an owner, I want scheduled and isolated activity to keep its explicit execution ceilings, so that changing an interactive conversation does not authorize background writes.
26. As an owner, I want tightening a mode to block new dispatch promptly, so that future calls cannot use the prior broader revision.
27. As an owner, I want running or uncertain operations reported honestly during mode changes, so that a permission change is not described as undoing effects.
28. As an owner, I want pending approvals settled explicitly when moving to Never, so that they are neither accepted implicitly nor left waiting forever.
29. As an owner, I want automatic actions recorded without a human approval, so that Full access remains inspectable and uncertain effects still prevent replay.
30. As an owner, I want old settings reviewed during upgrade, so that migration does not silently remove my previous denials or enable Full access.
31. As an owner, I want historical approvals and receipts preserved, so that changing the permission model does not rewrite action evidence.
32. As an agent, I want the effective mode, filesystem boundary and remaining restrictions in my context, so that I can explain refusals and request the correct escalation.
33. As an owner, I want the default bot's delivered help updated, so that its advice matches the new settings on existing installations.
34. As an owner, I want the same behavior in API, Ollama and both ACP adapters, including reused sessions, so that switching models does not change permissions silently.

## Implementation Decisions

### One authoritative permission contract

- Replace per-category mode resolution with one daemon-owned permission-session service used by invocation, owner controls, passive diagnostics and prompt delivery. Reuse the current gate, runner and persistence boundaries. Avoid a general plugin framework or a second permission engine.
- Scope a permission session to the installation, agent and conversation. Its identity survives child adapter session replacement. Retain an immutable workspace binding per execution environment and a monotonic permission revision. Resetting conversation context does not silently reset permission authority or grant Full access.
- Persist the preset, its resolved filesystem boundary and approval policy, revision, actor and source of selection. All reads derive from the same state. Server-side validation accepts only the three presets; clients cannot supply arbitrary approval-policy/boundary pairs, claim enforcement or choose another turn's scope.
- Protect default changes, session changes, write-root changes and escalation decisions with existing owner/Full-device authority. Bots, Limited devices, webhook payloads, provider interactions and remote metadata cannot select a mode. Authentication and management APIs retain their own access rules.
- A fresh permission session copies the current standing default once. Subsequent default changes affect only future sessions. Expose whether a session was initialized from a default or changed explicitly without making it a live inheritance link.
- The mode is evaluated for each operation at a serialized dispatch boundary. Never upgrade an already proposed operation merely because the current session became broader. A changed revision invalidates old grants/proposals and requires the agent to make a new call if still appropriate; this is not an automatic replay.
- Full access deliberately retires external/secrets Auto locks and category-specific always-ask overrides. Independent guards must be enumerated and documented, not hidden replacements for that matrix. Retain protected ownership/configuration routes, tool/package availability and integrity checks, input validation, isolation/offline/unattended ceilings, human takeover, cancellation, secret redaction and uncertain-effect guards.
- Preserve secret withholding from child processes and redaction from logs/results. Full access is not a credential-distribution API. Equally, do not claim secret-file isolation for an unconfined host process: files readable by that host identity may be accessible to it.

### Filesystem enforcement and tool requirements

- Enforce confinement at the actual filesystem/subprocess execution boundary, including descendants. Direct-file containment checks, a working directory, an instruction or a tool-name classifier alone do not establish confinement. Resolve symlinks and target identities safely; test writes through aliases, outside roots and from subprocesses.
- Use an installed/supported sandbox or adapter enforcement facility where its measured contract suffices. Make local enforcement support an explicit implementation checkpoint before selecting a dependency. Do not claim cross-platform support by analogy. Missing confinement or partial enforcement that does not satisfy the promised boundary makes that execution path unavailable; it never causes automatic Full access or unconfined passthrough.
- Workspace Write permits the bound workspace, owner-approved extra roots and documented temporary areas. Read Only permits only required non-file sinks/backend exceptions that are explicitly documented. OpenAg's own ledger/receipt writes are daemon bookkeeping, not agent file-write permission; do not solve that distinction by exposing the daemon's data directory as writable to child commands.
- Full access removes the permission sandbox; it does not remove a tool's schema, purpose, integrity rules or unavailable target. An existing workspace-only tool may retain its stated purpose, but a general file/command execution route must honor the selected boundary. Do not let a relative-path-only tool become the sole alleged implementation of Full access.
- Registered operations have a trusted execution requirement: allowed within their declared boundary, explicit one-operation review, or denied/unavailable. Retain current trusted registration sources. Untrusted server hints and model input cannot alter that requirement. Unknown/unregistered tools are unavailable. A registered legacy external-class tool is not automatically an explicit review request solely because of that class.
- Remote service effects are outside filesystem confinement. A registered remote operation with no independent review requirement may run in any preset; if it explicitly requires review, Ask opens that review and Never refuses it. Display this limit in the selector help. This is the proposed OpenAg mapping of DSH's separate concepts, not a verified claim about every DSH connector. Inventory actual DSH tool requirements and OpenAg registrations at the first implementation checkpoint; do not invent an undocumented remote-read-only or pay/send category lock.
- Out-of-process Apps and MCP servers are not confined merely because the daemon validated their tool inputs. Inventory each process/remote execution world and either enforce the relevant filesystem boundary there or refuse affected file/process operations in confined modes. Already-running servers cannot be relabelled confined after a mode change. Passive catalogue reads do not start, probe or reconfigure processes.
- Managed computers retain their own execution world. Host confinement does not confine a remote shell or browser. Backend-specific input/shell support must declare and prove how the mode applies. Unsupported opaque input is unavailable in a confined mode; keep human takeover and lifecycle controls independent.

### Approval, escalation and effects evidence

- Ask delegates explicit approval requests to the existing review flow. No handler, a revoked authority, cancellation, timeout or invalid response refuses the action. Never settles an explicit request as refused immediately, without opening an unresolved Inbox item. Persist the reason and return a usable refusal to the agent.
- Escalation is a single-operation approved exception: bind arguments, target/workspace identity, permission revision and the proposed wider execution boundary. Existing edited-review validation and changed-file checks remain applicable. Acceptance does not change the session mode or standing default and cannot be reused for another call.
- Do not automatically rerun a process after sandbox denial. It may already have produced effects. An agent can propose a new scoped operation after retained evidence establishes what happened; uncertain outcomes continue to require inspection before another effectful attempt.
- Separate action evidence from human approval. Record automatic dispatch, start and outcome with a stable operation identity even when no approval exists. Extend existing receipts rather than inventing fake human approvals. Preserve not-run, failed and unknown distinctions and historical approval links. Apply the same no-replay guards to automatic effects.
- When changing to Never, settle outstanding not-yet-dispatched review requests as refused/cancelled. Mode changes never accept them. When tightening the filesystem boundary, stop new dispatch under the old revision and cancel running activity where supported; report continuing/unknown effects honestly. Serialize concurrent selectors and dispatch, using revision conflicts rather than last-response-wins UI behavior.
- Delegation cannot widen authority. Derive the child boundary from the parent and child permission contexts; Ask/Never composition must not create an approval channel absent from either. Pin the resolved child grant and workspace mapping. A missing mapping or incomparable execution boundary refuses the affected action with an explanation. Do not silently give a specialist its broader standalone session authority.
- Keep current unattended, isolated and offline ceilings authoritative. Scheduled jobs use a distinct bounded context, not the interactive conversation's mutable authority. Supporting unattended writes or relaxing reflection/hook restrictions is outside this spec.

### Runtime, API and desk integration

- Owner-approved execution revision after OA-398: file and command execution belongs to the daemon and is exposed over its existing MCP endpoint to ACP models. Disable native tools where supported, refuse all native effect requests, keep child adapters in their safe asking/read-only control modes and exclude inherited native integrations. Do not depend on optional/fail-open hooks. Exclusive effect routing must be measured before accepting an adapter; unavailable suppression blocks that path rather than weakening the contract. API providers (including DeepSeek) and Ollama use the same executor through the existing tool gate. The earlier native execution acceptance is superseded by daemon execution plus explicit native-bypass refusal checks.

- Apply the contract to API/Ollama tools, both ACP adapters, native adapter tools and own-server MCP tools. Keep one OpenAg approval per operation. Own-server transport allowances cannot grant authority to other tools.
- Adapter safe asking modes are implementation controls, separate from the product selector. Do not simply pass Full access to a child CLI and lose OpenAg's gate. A supported adapter must either keep calls observable/authorizable while executing the requested confinement or supply an equivalently enforceable, measured contract. If its safe mode hard-denies instead of requesting a call, resolve that compatibility gap explicitly; do not claim product parity. Old unconditional mode-reset code must not fight the selected execution boundary.
- Verify fresh and reused child sessions, reconnect and restart. Refresh or invalidate cached child context and grants on revision changes. Historical prompts, native config files, native tools or resumed sessions must not restore a broader boundary. Native tools that cannot meet the contract must not be offered as supported.
- Expose protected reads/changes for standing defaults and current agent/conversation permission state through the normal gateway. Responses include effective revision, mode, workspace/environment, support and restriction reasons. Mode mutation must be transactional/audited and reject stale revisions. Audit secrets and private paths through existing redaction.
- Remove the grid and its write authority. Deprecated category-write APIs must return an explicit replacement/migration error, not succeed ineffectually. Existing read clients may receive a clearly labelled legacy view during transition; they cannot treat it as effective policy. Update all internal clients and fixtures together.
- Place the current-session selector by the composer, with target agent, three exact labels, current enforcement/support state and concise scope help. `/permission` is an authenticated owner command handled outside model interpretation; typed Full access selection uses the same acknowledgement flow as the picker. This acknowledgement is an explicit OpenAg choice that is stricter than DSH's direct typed command.
- General settings edits future-session defaults. Full access selection acknowledges unconfined filesystem access, possible access to host-readable credentials and unprompted connected-tool effects. Protected APIs still require authentication; this is not isolation from a command that can obtain a readable credential. A Limited device sees the current mode/support but cannot change it. Surface loading, conflicts, failed saves and unavailable backends truthfully; do not optimistically show a grant the daemon rejected. Use semantic status badges consistently.
- Capability diagnostics, model context and delivered help read the same effective permission contract used by execution. They distinguish mode, enforcement support, environmental availability, explicit review requirements and independent turn restrictions. Preserve passive reads; no sandbox launch, provider probe, approval or configuration side effect from inspection.

### Migration and knowledge

- Preserve historical category settings as an archived migration record, including explicit denials, approvals, receipts and pending/unknown operations. Do not map any legacy combination automatically to Full access or silently discard a denial. Existing active operations retain their original evidence until settled.
- On upgrade, mark legacy permission contexts as requiring owner selection before new tool dispatch. The owner sees a summary of existing restrictions and deliberately chooses a new default/current mode. Do not automatically resume old approvals under a new mode. A choice to adopt the new model explicitly replaces the old rules; archived settings no longer participate in resolution. Fresh installations use Workspace Write without legacy migration.
- Update product concepts, permission/setup help, authoritative runtime and capability notes, prompt/tool descriptions and all conflicting project guidance in the implementation change. In particular, replace the old hard-lock language in both mirrored guidance files only when the implementation contract is ready. Design documents do not presently repeal runtime instructions.
- Verify packaged help reaches the configured default bot and existing installations, including cached ACP sessions. Explain filesystem-only Read Only, Never refusal, Full access remote effects, migration and unsupported backends. Static prose must not claim current installation support; obtain that through passive scoped diagnostics.

## Testing Decisions

- Owner-confirmed primary seam: select a mode in the desk, send an ordinary conversation request through the real gateway/runner/policy, execute an offered tool and observe the result, approval/refusal, receipt and visible mode. Reuse this flow for API/Ollama, native ACP tools and ACP-to-daemon MCP. Verify external behavior, not private helper implementation or snapshots that repeat the code.
- Use temporary daemon data, isolated workspaces, a sibling sentinel and synthetic remote effects. Instrument the target itself to prove whether an operation ran. A returned wrapper with a nested failure must fail acceptance. No real payment, publishing, customer communication or production account write is needed or authorized by this spec.
- Reuse standalone gateway/runtime and receipt verification fixtures. Keep uncertain-effect scenarios sequential; one unresolved operation must not block or contaminate another. Do not introduce a second production gate merely to make it testable.
- Use both real installed ACP adapters for one bounded journey each, with a second call in the same session, before broadening controlled coverage. Use disposable local targets. Check native file/command operations and own-server MCP routing without alternate native-tool bypass. Record adapter versions, invocation IDs, selected mode/revision, permission events and target observations. Missing adapter/provider access is an acceptance blocker for that path, not a passing fixture substitute.
- Stop on an unknown outcome: preserve invocation IDs, approval/receipt state and sanitized returned evidence. Inspect current target state before any repeat. Do not automatically start a fresh session to get a cleaner result.

Required externally observed cases:

| Case | Acceptance evidence |
| --- | --- |
| Fresh session/default changes | Workspace Write on fresh install; a changed default affects only later sessions. |
| Read Only command/direct write | Sentinel unchanged under real confinement; no unconfined fallback. |
| Workspace edits and shell | Intended workspace target changes without routine action approval. |
| Sibling, symlink, child process and temp paths | Boundary enforced at execution; allowed temp behavior documented and bounded. |
| Full access | Disposable outside-workspace write and synthetic remote action complete without category prompts; automatic action evidence retained. |
| Explicit review under Never | Immediate refusal, no effect, no pending Inbox item. |
| Explicit review under Ask | One review; accept permits only exact operation, reject/edit/timeout behave correctly. |
| Escalation | One exact wider grant; second call and changed arguments receive no reused authority. Partial prior execution is not retried automatically. |
| Registered remote effects | Demonstrate that filesystem Read Only is not a remote-effects restriction, and trusted review/deny declarations still apply. |
| Unknown tools/untrusted metadata | No speculative execution and no authority from provider hints. |
| Mode changes and concurrent calls | No old-revision dispatch after committed tightening; running effects reported honestly; pending reviews never implicitly accepted. |
| Adapter reuse and restart | Same effective authority on second call, reconnect and restart; stale child settings cannot broaden it. |
| Unsupported confinement/backend | Unavailable with a clear reason and unchanged sentinel. |
| MCP/App/computer alternate paths | Boundary enforced or affected path refused; no host/remote conflation or hidden bypass. |
| Multiple agents/delegation | Selector affects only target session; delegated operation cannot exceed parent/child authority or switch roots silently. |
| Owner/Limited authority and prompt injection | Only owner/Full-device mutation; model/tool text cannot switch modes. |
| Unattended/offline/isolation/takeover | Existing ceilings still refuse forbidden work even when interactive mode is Full access. |
| Migration | Preserve legacy denials/evidence; new dispatch requires explicit adoption; old API writes cannot change effective policy. |
| Unknown automatic effect | Stable action identity and receipt guard stop replay without requiring a fabricated approval. |
| Desk/help delivery | Accessible selector, clear target/default distinction, support/refusal states and consistent bot explanation after an existing-install refresh. |

During implementation run the workspace build, daemon TypeScript check, focused standalone permission-flow verification, relevant existing receipt/runtime/migration verification, capability verification and packaged bot-knowledge verification. Run no unit tests, Jest or Vitest, directly or through scripts/hooks. Exact commands and observed results belong in the implementation ticket Log; this drafting task has run none of those checks.

## Out of Scope

- Experimental Auto review, model-based permission decisions and automatic fallback to Full access.
- A Custom preset, a second per-category authority matrix or user-defined preset framework.
- Adopting DSH/Cordis as OpenAg's runtime, persistence migration to DSH logs or general harness replacement.
- Network/process isolation guarantees implied by a filesystem preset.
- A new unattended-write feature or relaxation of isolated webhook/reflection rules.
- Automatically connecting provider accounts, changing installation ownership, handing owner tokens to agents or exposing private credentials through new APIs.
- Replaying uncertain operations, repairing historical external effects, production deployment or live account writes.

## Further Notes

DSH parity is grounded in the upstream revision pinned by the research note. OpenAg adaptations are explicit: owner-only selection, agent/conversation session identity, full acknowledgement for typed commands, preserved independent unattended ceilings, automatic-action evidence and deliberate legacy migration. These choices must not be described as verified DSH implementation details.

Implement in dependent slices after the design is accepted: establish enforceable boundaries through both real adapters; replace shared resolution and action evidence; integrate all execution worlds and diagnostics; add the desk/default controls and deliberate migration; finish delivered help and acceptance. Choose concrete sandbox backends during the first technical checkpoint. If either adapter cannot preserve the gate while honoring the boundary, resolve that architecture before declaring implementation-ready rather than weakening the contract.

Publication remains pending project tracker/label setup. No issue ID, `ready-for-agent` label, implementation ticket completion or runtime acceptance is claimed.
