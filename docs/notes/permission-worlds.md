# Permission execution worlds

Status: execution-world contract is wired in this source release from OA-402. Upgrades require owner adoption; fresh databases start in Workspace Write. This note describes controlled source acceptance, not deployment.

All API routes, including Ollama and DeepSeek, and both ACP adapters use the daemon gate. The selected session and inherited delegation scope reach operating instructions and each tool invocation. Native ACP effect tools remain disabled on this internal path. A mode controls filesystem writes; it does not isolate reads, network access or process visibility, or establish provider consent.

| Path | Enforced boundary |
| --- | --- |
| Daemon shell | macOS Seatbelt Read Only or Workspace Write; Full access is unconfined. Unsupported confinement refuses execution. |
| `write_file` | Same OS boundary, fixed writer, redacted content and readback; exact Read Only escalation requires review. |
| Pure help, status, skill reads and screenshots | Explicit daemon-owned read contracts; existing scope and takeover checks apply. |
| Reviewed remote HTTP operations | Explicit contracts can run in confined modes. Read Only is not an account-wide read restriction. |
| Managed Composio | Only existing reviewed discovery/read request shapes qualify; exact supported read batches exclude workbench synchronization. Hints never grant authority. |
| Opaque MCP, Apps, computer input/shell, managed memory/skill writes | Confined modes refuse them because this path cannot enforce their filesystem world. Full access permits interactive invocation with existing validity, consent and takeover checks. |
| Work creation and shared avatar additions | Explicit operation review; Never refuses rather than approving silently. |

Opaque processes remain unavailable in unattended turns even if a manifest calls them read-only. Offline turns require an explicit offline-safe contract. Isolated turns have no tools. Background writes with approval opt-in still require genuine review; an interactive preset does not authorize them. These ceilings apply independently of filesystem mode.

Delegation carries immutable ancestor session references. Its effective boundary is the intersection of parent and child scopes, including Never. Writable workspace delegation requires an explicit overlapping root that contains the child's entire workspace; absent that mapping, the effective filesystem boundary becomes Read Only so read operations remain usable. No writable mapping is invented. A parent revision change expires dependent pending requests and refuses delayed dispatch, including when the new parent mode is broader. Scoped escalation cannot exceed an inherited ceiling.

The executor rechecks authority after asynchronous preparation. Apps check immediately before spawn; MCP checks before transport dispatch; computer drivers check after their queue and lifecycle work, before input or shell. Existing takeover guards remain independent. A mode change does not undo already admitted effects. Interrupted commands or uncertain nested results retain Unknown evidence and require target inspection. Command exit is not remote business-effect confirmation.

Capability diagnostics use the same trusted operation requirement, effective mode resolver and turn restrictions as execution. Inspection remains passive. Automatic operations have independent receipts and no fabricated human approval; reviewed remote reads store their daemon-verified effect class, so an unrelated unresolved write does not prevent evidence gathering or become silently cleared by it.

`node scripts/verify-permission-worlds.mjs` uses a temporary real gateway, runner and gate, actual local files, App and stdio/HTTP MCP processes, a controlled managed Composio endpoint, shared computer drivers and delegation. It checks confinement, explicit unavailability, misleading read hints, exact request classification, guarded queued dispatch, takeover, nested failures, offline/background/isolation ceilings and revision-bound delegation. Computer/provider transports are controlled fixtures, not live remote backend acceptance. `verify-permission-providers.mjs` covers fourteen SDK routes and operating-context delivery. Real subscription adapter journeys are separate. No unit/Jest/Vitest runner is allowed.

Controlled acceptance passed for the execution-world suite (including unsupported-host simulation and read-only delegation without a writable mapping), fourteen-provider matrix, actual session/receipt React flow, capabilities, MCP contracts/lifecycle/interactions, managed Composio contracts, App library, automations, hosted outcomes, action receipts, ACP continuity and identity. Both real subscription adapters completed four daemon operations plus a native-only negative in one reused session each; sanitized scope is in [permission-worlds.json](permission-modes/permission-worlds.json). The App-library fixture now supplies required MCP input schemas; its initial schema-less catalogue was correctly unavailable. Workspace build (relay dry-run only), daemon typecheck, syntax, whitespace and packaged default-bot knowledge delivery passed. Local Standards/Spec review and built-in review identified the overly broad unmapped-delegation refusal; it now preserves read operations under an inherited Read Only boundary. Final source review is recorded in the ticket Log.
