# Permission modes: domain model

4 November 2026. Design only. The owner requested replacement of the current category-based permission model with DSH behavior, followed by a spec. The owner confirmed the verification boundary: desk selection through the actual gateway, policy and execution result, controlled edge cases, and both real ACP adapters including a second call in a reused session. No implementation is authorized by completion of this document alone.

## Model

The canonical terms are in [GLOSSARY.md](../../GLOSSARY.md). This model describes the desired replacement; the current category policy remains implemented until that replacement passes acceptance.

| Concept | Relationship and scope |
| --- | --- |
| Permission mode | A named pairing of filesystem boundary and approval policy. The three choices are Read Only, Workspace Write and Full access. |
| Permission session | One agent in one conversation. Its state survives turns, adapter reconnection and daemon restart; it is not the child adapter's transient session ID. |
| Filesystem boundary | Read-only, workspace-write or unconfined in a specified execution environment. Workspace roots and enforcement belong to that environment. |
| Approval policy | Ask permits an explicit review request; Never resolves that request as refused without waiting. Neither policy invents a reason for every tool to ask. |
| Workspace | A concrete file area, with explicit additional write roots and required temporary areas. A computer sandbox has a different workspace from the daemon host. |
| Escalation | A reviewed, single-operation exception to the filesystem boundary. It does not persistently widen the session or authorize a second operation. |
| Tool classification | Describes effects for display, trusted declarations and existing isolation rules. It no longer directly selects Auto/Ask/Deny. |
| Action approval | A single reviewed operation. A mode change does not accept a pending approval or establish an external effect. |
| Standing default | The initial mode for future permission sessions. Changing it leaves existing sessions unchanged. |
| Execution guard | An independent refusal such as unavailable confinement, revoked access, human takeover, invalid input, isolated ingress or an uncertain earlier action. Full access cannot turn a refusal into approval. |

## Core decisions

- Match DSH's shipped presets: Read Only = read-only + Ask; Workspace Write = workspace-write + Ask; Full access = unconfined + Never. Fresh installations default to Workspace Write. No Custom preset or experimental Auto review in this replacement.
- Read Only describes filesystem effects. It is not an offline mode or a promise that a tool cannot change a remote account. Network/process restrictions, when present, are independent and shown separately.
- Ask means the runtime can ask when a specific operation requires it. Confined workspace operations do not ask merely because they edit files or invoke a shell. Full access removes routine category-based prompts, including the current external/secrets Auto locks; any explicit remaining approval request is refused under Never.
- A known, enabled MCP/App tool is not forbidden merely because its legacy category is external. Trusted operation-specific review requirements can still ask; server-provided hints cannot grant authority. An unknown/unregistered tool is refused rather than executed speculatively.
- Mode changes require owner/Full-device authority. Full access does not mint owner credentials or remove authentication from protected configuration APIs. An unconfined host command may nevertheless read credentials accessible to the daemon's OS identity; environment filtering and API checks are not host-file isolation.
- Existing unattended, isolated and offline ceilings remain independent in this first replacement. An interactive Full access conversation cannot authorize a webhook or scheduled job. Additional unattended write authority would require a separately specified owner-controlled product flow.
- DSH parity applies to permission behavior, not adoption of Cordis, its event store or its entire runtime. All existing OpenAg execution paths must enforce the same selected contract or report unavailable; no unconfined fallback in confined modes.

## Concrete scenarios

| Scenario | Required meaning and result |
| --- | --- |
| Workspace Write edits a file and runs a command inside its workspace | Both proceed within enforced boundaries without routine action prompts. A shell is not forced to ask solely because it can use the network. |
| That command writes a sibling file or follows a symlink outside the allowed roots | Confinement prevents the write. An escalation may request the exact wider operation, not silently rerun the whole command. |
| A command partially changed the workspace before hitting a boundary | Denial does not prove no effects. Inspect/record evidence; never automatically retry with wider access. |
| Read Only runs a command that attempts a write | The write is blocked by actual execution enforcement. Required sinks and documented backend exceptions do not become general write roots. |
| A remote tool sends a message while filesystem mode is Read Only | The filesystem label alone does not decide it. The registered operation's explicit guards/review requirement determine allow, ask or deny; show the network/remote-effects limitation. |
| Full access executes a registered action with no explicit review requirement | No category-based approval prompt. Keep an action record and uncertain-outcome handling even without a human approval ID. |
| A tool explicitly asks for approval under Full access | Never refuses it deterministically; it is not auto-approved or left pending. |
| The owner changes Ask to Full access with an approval already open | The old approval is not accepted. Settle it as refused/cancelled, return that outcome and use the new mode for later operations. |
| Mode is tightened while a command is running | Do not claim prior effects were undone. Stop new dispatch, cancel where supported and report possible continuing/unknown effects. |
| Two members work in the same room | Each has its own permission session; the selector identifies its target. Full access for one cannot silently change the other. |
| A specialist is delegated work | The child receives no broader authority than the parent and its own configured session permit. Different workspaces require an explicit mapping; missing mapping refuses execution. |
| A sandbox backend or reused adapter cannot enforce the mode | The affected path is unavailable in that mode. Show the reason and do not silently change mode or launch unconfined. |
| An existing install has custom category rules, pending approvals and action receipts | Preserve records. Require an explicit migration selection; no silent conversion to Full access or newly allowed operations. |
| The daemon restarts or the adapter reconnects | Recover the same permission revision and workspace. Stale approvals, cached child settings and historical events cannot widen it. |
| An untrusted document says to enable Full access | Treat it as data. Only the protected owner action can change the mode. |
| Full access receives an uncertain provider result | Keep unknown and inspect the target before any repeat. Never means no prompts, not no receipts or unlimited retries. |

## Owning source and change reach

Current source inspected during this task:

- [policy](../../apps/daemon/src/policy.ts): per-bot category resolution, locked external/secrets Auto, unattended/offline/isolated checks and special tool asks.
- [gateway](../../apps/daemon/src/gateway.ts): category settings APIs and protected owner settings/actions.
- [runner](../../apps/daemon/src/runtimes/runner.ts), [approvals](../../apps/daemon/src/approvals.ts), [action receipts](../../apps/daemon/src/action-receipts.ts): gate wiring, persisted turns, approvals and effects evidence.
- [ACP runtime](../../apps/daemon/src/runtimes/acp.ts): adapter-specific safe modes, native permission requests, own-server MCP routing, cached sessions and mode-change reset. Its transport mode is not the new product mode.
- [file tools](../../apps/daemon/src/tools/files.ts): workspace containment and reviewed-file checks; no general process sandbox follows from these checks.
- [permission grid](../../apps/desk/src/components/PermissionGrid.tsx), [bot settings](../../apps/desk/src/components/BotSettings.tsx): existing category UI to replace.
- [capabilities](capabilities.md), [MCP lifecycle](mcp-lifecycle.md), [computer](cua.md), [reflection](reflection.md): diagnostic consistency and independent guards.

The replacement must reach API/Ollama, both ACP adapters, native file/command tools, first-party tools, MCP, Apps, managed computer backends, delegation, approvals/receipts, capability diagnostics, desk controls, migration, delivered help, fixtures and mirrored project guidance. A file-path validator is not confinement of subprocesses or a remote MCP server.

## DSH parity and OpenAg adaptations

[Research and pinned source links](deepseek-harness.md#follow-up-permission-modes-and-dangerous-access) establish the three presets, scope, approval semantics and unsupported ACP wire mode. The separate [spec](../specs/permission-modes.md) defines proposed OpenAg adaptations: owner-only selection, bot/conversation identity, legacy migration, action evidence without approval, and retained unattended ceilings. These are explicit OpenAg decisions rather than claimed DSH features. Adapter/backend enforcement remains to be proven.

No runtime checks were run. Glossary/design changes need no shipped-help update yet; implementation must update and verify delivered knowledge before it can be marked done.

## Approved execution-interface revision

4 November 2026, after the native compatibility checkpoint: the owner selected daemon-owned file/command execution over existing MCP for both ACP adapters and required the same permission behavior for Ollama, DeepSeek API and other API providers. Native effectful execution is disabled/refused; native inherited integrations cannot bypass the daemon. The model selects tools; the daemon authorizes, enforces the execution environment boundary, executes and records effects. This supersedes the initial assumption that native tool execution itself must be retained. Actual exclusive routing remains an acceptance requirement.
