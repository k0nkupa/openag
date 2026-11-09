# ACP permission and instruction contracts — Claude and Codex

Research date: 5 November 2026. Scope: primary-source and installed-package inspection before another runtime fix. This note is research, not a specification, implementation, deployment or acceptance result. No adapter was launched, no provider request or write probe was sent, and no unit/Jest/Vitest runner was used for this research. The separate local incident evidence is added below by the investigating owner.

## Findings that change the proposed fix

1. **Both pinned adapters already support client-provided session instructions.** Codex 2.3.0 supports text-only `systemPrompt` in `append` mode and maps it to Codex developer instructions. Claude 0.97.0 supports `append` and `override`; append keeps its Claude Code preset. This supplies a supported instruction channel distinct from a normal user turn. It does not itself grant tool permission. [Codex prompt parser][codex-prompt], [Claude prompt implementation][claude-prompt].
2. **It is an unstable ACP feature, despite being present in these released adapters.** Capability negotiation and the SDK entrypoint matter. Installed SDK 2.0.2's default import selects stable v1; `/unstable` includes the session instruction field. Raw stdio requests are not categorically stripped by the default client's `request()` path, but stable receiving handlers do parse a schema that lacks the field. A TypeScript cast alone is not a complete integration. [Installed SDK inspection](#installed-sdk-wire-and-schema-inspection), [versioned migration guide][sdk-migration].
3. **Reused/resumed instruction changes are not equivalent to fresh sessions.** Claude documents delayed application until the next compaction when a resumed conversation receives changed instructions. Codex rejects certain busy/background-terminal changes and unloads/reopens eligible loaded threads. Resending lifecycle parameters and testing restart/reuse are necessary. [Claude prompt implementation][claude-prompt], [Codex session client][codex-client].
4. **An OpenAg Full access selection is not an instruction to select the adapter's native Full access mode.** Those native modes change enforcement and approval behavior. Keep daemon authorization independent; assess instruction placement without opening a native bypass. [Codex mode definitions][codex-modes], [Claude SDK permissions][claude-permissions], [OpenAg ADR](../adr/0004-permission-modes.md).
5. **The observed instruction conflict is a hypothesis about model behavior, not a proven denial.** Source documents where instructions are placed; it cannot prove why a particular generation stopped. A successful exact-command copy also does not establish a successful discovered skill-package installation. See the local incident section and required acceptance below.

## Pinned software, not remembered versions

The installed package manifests were read from this checkout's pnpm tree:

| Component | Installed | Declared relationship |
| --- | --- | --- |
| Claude ACP | `@agentclientprotocol/claude-agent-acp` 0.97.0 | pins ACP SDK `2.0.2`, Claude Agent SDK `0.3.310` |
| Claude execution SDK | `@anthropic-ai/claude-agent-sdk` 0.3.310 | execution and permission engine beneath Claude ACP |
| Codex ACP | `@agentclientprotocol/codex-acp` 2.3.0, OpenAg patched | declares ACP SDK `~2.0.2`, Codex CLI `^0.164.0` |
| Codex execution package | `@openai/codex` 0.164.0 | actual resolved CLI version in this checkout |
| ACP SDK | `@agentclientprotocol/sdk` 2.0.2 | default stable-v1 and explicit unstable-v1 entrypoints |

These are manifest observations, not a fresh runtime compatibility run. Codex ACP starts the Codex App Server and translates requests/events; Claude ACP uses Claude Agent SDK. Current upstream `main` documentation may describe later behavior; version-tagged source and the installed distribution take priority for this incident. [Codex v2.3.0 README][codex-readme], [Claude v0.97.0 source imports][claude-agent], [SDK 2.0.2 exports][sdk-package].

OpenAg's checked-in [Codex package patch](../../patches/@agentclientprotocol__codex-acp@2.3.0.patch) only preserves configured disabled inherited MCP entries while adding session MCP servers under `OPENAG_DAEMON_EXECUTION=1`. It is not an instruction-precedence or native-permission patch.

## The layers ACP does and does not unify

A normal v1 flow is initialization/capabilities → new/load/resume session with `cwd` and MCP configuration → `session/prompt` user interaction → streamed message/tool updates and optional permission requests → turn response. The protocol permits agent-specific modes; a common mode name is not a common enforcement contract. Session config options are the successor to dedicated mode methods. [ACP session setup][acp-setup], [ACP prompt turns][acp-turn], [ACP modes][acp-modes].

There are four separate contracts to trace:

| Contract | What establishes it | What it does not establish |
| --- | --- | --- |
| Model-facing instruction context | Agent preset, environment instructions, client `systemPrompt`, user-turn context | Permission to perform an operation |
| Native runtime configuration | Adapter mode/config → Claude SDK or Codex App Server | OpenAg daemon mode or an external provider's authority |
| ACP permission acknowledgement | Agent asks client to select an offered decision | Independent confirmation of the resulting effect |
| OpenAg execution authority | Scoped own-MCP call → runner/policy/requirement gate → executor/receipt | Native execution authority outside that path |

ACP agents execute their own tool calls and report them to the client; they can use client permission/file/terminal capabilities. Therefore interception of permission requests alone is not proof that every native effect is intercepted. [ACP tool calls][acp-tools]. OpenAg's own-server acknowledgement is deliberately narrower: its daemon remains authoritative. See [current MCP server contract](mcp-server.md) and [permission sessions](permission-sessions.md).

## Client-provided instructions: use the actual advertised contract

The currently published RFD says clients must feature-detect `agentCapabilities.sessionCapabilities.systemPrompt`, send only advertised modes and supported text blocks, and resend the session instructions on lifecycle reopening. Append is the baseline; override is optional and removes agent-authored default instructions rather than changing tools or permissions. The feature is explicitly outside stable schemas. These are protocol/RFD statements, not evidence that an arbitrary older adapter implements them. [Client-system-prompt RFD][acp-system-rfd].

Example shape supported by both pinned adapters, **subject to the advertised capability**:

```json
{
  "cwd": "/absolute/bot/workspace",
  "mcpServers": [],
  "systemPrompt": {
    "mode": "append",
    "content": [{ "type": "text", "text": "Trusted daemon-versus-native execution contract." }]
  }
}
```

This is a candidate carrier for a small trusted bridge, not permission to promote user requests, recalled history, tool output or arbitrary skill contents into trusted instructions. It must explain scopes consistently rather than say a native restriction can be ignored. No behavior improvement from this shape has been demonstrated in this research.

### Codex 2.3.0

- Advertises `systemPrompt: {}`: append only. Its parser rejects override and non-text content. `resolveSessionInstructions()` preserves the configured developer-instruction baseline, then appends the client text; new thread creation passes the result as `developerInstructions`. Native approval/sandbox values are separately passed on each turn. [Codex parser][codex-prompt]; installed bundle lines 39329–39351, 40074–40120, 40415–40432.
- Load/resume resolve client instructions again. A changed prompt on an already loaded thread requires idle, persisted state and no background terminals; the adapter unsubscribes and resumes, and checks that unloading actually occurred. It refuses instead of silently claiming success when these conditions fail. Open-session omission can preserve prior instructions; clients must not infer persistence across adapter restart from that in-memory behavior. [Codex session client][codex-client]; installed bundle lines 39953–40010, 40122–40170 and 48218–48242.
- The generated native read-only text broadly describes a read-only filesystem and restricted network access. It does not explain OpenAg's separately executing daemon. Its presence does not prove that an MCP invocation ran under that native filesystem sandbox. [Codex 0.164.0 read-only template][codex-readonly], [separate MCP handler route][codex-mcp-handler].

Important limit: placing additional developer instructions does not erase the generated native permission text or prove which instruction a model will apply in a free-form task.

### Claude 0.97.0

- Advertises both modes with `systemPrompt: {mode: {override: {}}}`. Append maps to the SDK's Claude Code preset plus appended text; override maps to a custom prompt string. The normal lifecycle field takes precedence over the legacy `_meta.systemPrompt` extension. The latter is not a portable Codex fallback. [Claude client prompt implementation][claude-prompt]; installed `client-system-prompt.js` lines 1–40, `acp-agent.js` lines 8710–8734.
- Its session fingerprint includes lifecycle `systemPrompt`, MCP configuration and session-defining options. Changed live-session parameters tear down/recreate the underlying SDK query, keeping the public session identity and resuming its conversation where possible. **That recreation is not a guarantee of immediate model-visible prompt replacement**: the versioned source explicitly documents that Claude Code records the first prompt and applies a changed resumed prompt at the next compaction. [Claude adapter][claude-agent]; installed `acp-agent.js` lines 490–512 and 8558–8595; [prompt lifecycle documentation in source][claude-prompt].
- Native tools, MCP configuration and permission callbacks remain separate SDK options. The adapter accepts an explicit tools array, forwards client options and then owns fields such as `permissionMode` and `canUseTool`. Existing `tools: []` and strict MCP isolation should remain in force for OpenAg; selecting `bypassPermissions` is not an equivalent instruction-only fix. [Claude adapter source][claude-agent]; installed lines 8846–8885; [SDK permission evaluation][claude-permissions].

There is another precedence edge to avoid: `_meta.claudeCode.options.systemPrompt` is an allowed session-defining option, and the SDK options spread `userProvidedOptions` after the computed `systemPrompt` value (`acp-agent.js:438,8846–8868`). Do not configure both carriers and assume the lifecycle field wins; inspect the actual SDK option. This is separate from the documented precedence over legacy `_meta.systemPrompt`.

Fresh versus resumed needs separate acceptance. A fresh public session can establish a new instruction baseline; a resumed query may retain the older baseline until compaction even when setup returned successfully.

## Installed SDK wire and schema inspection

These observations are from installed **SDK 2.0.2**, not an assumption based on newer documentation:

- `package.json` maps `@agentclientprotocol/sdk` to `dist/v1/stable/acp.js`; `/unstable` maps to `dist/v1/unstable/acp.js`.
- Stable `dist/v1/schema/zod.gen.js` omits `systemPrompt` in `zSessionCapabilities` (749), `zNewSessionRequest` (1673), `zLoadSessionRequest` (1686) and `zResumeSessionRequest` (1720). Unstable `dist/v1/unstable/schema/zod.gen.js` includes it in corresponding definitions at 854, 2421, 2435 and 2492. `zPromptRequest` is normal turn content, not this lifecycle field.
- Stable `ClientContext.request()` at `dist/v1/stable/acp.js:221–223` directly sends `params`; request specs at 573–585 supply no initialization response validator. **This raw outbound transport path does not establish stripping of extra fields or the returned capability.** Static typings still do not expose the unstable contract.
- A stable receiving `agent()` uses the request specs above. `dist/core/app-handlers.js:2–9,37` calls their parser before invoking the handler. Those `z.object` schemas omit the unstable field, and Zod objects strip unknown keys by default. Thus stable controlled receiving peers can drop a lifecycle instruction field even when a real unstable adapter accepts it. This is source-path analysis, not an executed parser experiment. [Zod object behavior][zod-objects].

The [versioned SDK migration guide][sdk-migration] instructs applications using unstable features to move apps, types, method constants and connected in-process peers consistently to the selected entrypoint. That is the sensible design baseline; transport pass-through should not become an undocumented cast-based compatibility mechanism. No major-protocol migration to ACP v2 is needed merely to use unstable v1 system prompts.

## Modes, approvals and external tools

Codex's native `read-only` mode uses on-request approval with read-only/network-disabled policy; `agent-full-access` uses Never with `dangerFullAccess`. Claude's mode IDs and semantics differ, and SDK allow/deny rules can decide calls before `canUseTool` runs. Mapping OpenAg's picker straight to these modes would change native execution authority. [Codex modes][codex-modes], [Claude permission evaluation][claude-permissions].

Codex routes MCP tool consent through its own MCP approval/elicitation handling; `allow_once` is converted into one accepted tool request. Claude's callback similarly converts an offered client response into SDK permission behavior. Neither is the OpenAg operation's receipt. OpenAg must continue allowing only exact tracked own-server tools at this transport layer and independently applying its daemon policy to the call. Installed Codex bundle lines 37237–37279 and 37420–37439; installed Claude `acp-agent.js:7852–7915`; [OpenAg own-tool matching](../../apps/daemon/src/runtimes/acp.ts).

Neither a normal v1 `stopReason: end_turn` nor a displayed completed tool proves a business effect. They report different lifecycle levels. In v2, even prompt insertion and foreground completion are explicitly different signals; OpenAg is currently v1. Maintain separate observations for adapter completion, nested tool error, daemon receipt and target-state verification. [ACP tool calls][acp-tools], [Claude turn contract][claude-turn-events], [Codex event translation][codex-events].

## Requirements for a later fix and its acceptance

These are research-derived recommendations, **not implemented or proven behavior**:

1. Use a small, trusted, capability-gated session instruction bridge that distinguishes native execution from daemon tools. Keep ordinary user intent, data and tool evidence out of that privileged channel. Preserve both adapters' native deny/isolation controls.
2. Prefer a stable bridge plus current per-turn effective-scope information over repeatedly mutating a persisted system prompt for every ordinary turn. A dynamic lifecycle policy needs its own complete identity: own/parent permission revisions **and** turn ceilings such as unattended, approval opt-in, isolated and offline state. OpenAg's existing `permissionContext` does not contain all those ceilings. [Runner](../../apps/daemon/src/runtimes/runner.ts), [ACP cache](../../apps/daemon/src/runtimes/acp.ts).
3. Establish the carrier across the actual SDK paths: both adapter capabilities, lifecycle requests and controlled peers; reject absent support explicitly. Record source-supplied text and its placement in controlled outgoing provider requests. Do not count a successful setup response as model-visible delivery.
4. Cover fresh new, unchanged reuse, process restart/resume, changed permission revision, changed turn ceiling and changed bridge version. For Claude, prove immediate behavior through a fresh session when a changed resumed prompt could wait for compaction. For Codex, cover busy/persisted/background-terminal refusals without retrying uncertain work.
5. First run one bounded discovery-and-install journey through each actual adapter, with a second call in the same session, without providing a ready-made copy command or naming the tool. Validate the application-level skill contract, dependencies/reference bundle and reloading. A copied directory alone is not valid installation evidence.
6. Retain readonly/Workspace/Full boundary negatives, native-only and inherited-MCP negatives, independent background/offline ceilings and Unknown/no-replay checks. Inspect receipts and target state; fail on nested/provider errors or false success prose.

Unknown outcomes remain a stop condition. No fresh retry or alternate native route is justified by a model's claim that its environment is read-only.

## Source locators and inspection limits

Versioned primary sources:

[acp-setup]: https://agentclientprotocol.com/protocol/v1/session-setup
[acp-turn]: https://agentclientprotocol.com/protocol/v1/prompt-turn
[acp-tools]: https://agentclientprotocol.com/protocol/v1/tool-calls
[acp-modes]: https://agentclientprotocol.com/protocol/v1/session-modes
[acp-system-rfd]: https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/rfds/client-system-prompt.mdx
[codex-readme]: https://github.com/agentclientprotocol/codex-acp/blob/v2.3.0/README.md
[codex-prompt]: https://github.com/agentclientprotocol/codex-acp/blob/v2.3.0/src/ClientSystemPrompt.ts
[codex-client]: https://github.com/agentclientprotocol/codex-acp/blob/v2.3.0/src/CodexAcpClient.ts
[codex-modes]: https://github.com/agentclientprotocol/codex-acp/blob/v2.3.0/src/AgentMode.ts
[codex-events]: https://github.com/agentclientprotocol/codex-acp/blob/v2.3.0/src/CodexEventHandler.ts
[codex-readonly]: https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/prompts/templates/permissions/sandbox_mode/read_only.md
[codex-mcp-handler]: https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/tools/handlers/mcp.rs
[claude-agent]: https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.97.0/src/acp-agent.ts
[claude-prompt]: https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.97.0/src/client-system-prompt.ts
[claude-turn-events]: https://github.com/agentclientprotocol/claude-agent-acp/blob/v0.97.0/src/turn-events.ts
[claude-permissions]: https://code.claude.com/docs/en/agent-sdk/permissions
[sdk-migration]: https://github.com/agentclientprotocol/typescript-sdk/blob/v2.0.2/MIGRATION_STABLE_UNSTABLE.md
[sdk-package]: https://github.com/agentclientprotocol/typescript-sdk/blob/v2.0.2/package.json
[zod-objects]: https://zod.dev/api#objects

Installed artifact locators (all under this checkout's `node_modules/.pnpm/`; inspect the versioned package directory, not a global CLI):

- Codex: `@agentclientprotocol+codex-acp@2.3.0_patch_hash=bfa197e902d4b92b668bd971b313c051288836db91b8066614c5a057fb3d8a7e/node_modules/@agentclientprotocol/codex-acp/dist/index.js`; SHA-256 `bfa6976e4233108b69dcc8033a6962aa5597ba049cf1df3827570d9201b151a6`.
- Claude: `@agentclientprotocol+claude-agent-acp@0.97.0_*/node_modules/@agentclientprotocol/claude-agent-acp/dist/`; `client-system-prompt.js` SHA-256 `d79ebfcc4ab1a1d9edb2a6cf5517d56ab8b25673f9621e63b5299e0a220fddc4`. The wildcard denotes pnpm's peer-dependency suffix, not a different adapter version.
- SDK: `@agentclientprotocol+sdk@2.0.2_zod@4.6.7/node_modules/@agentclientprotocol/sdk/`; stable `dist/v1/schema/zod.gen.js` SHA-256 `907d5eb507e01d06d302936f5f32d658a4df32d068fa26930af6ee04dfb673c4`.

The ACP RFD and online vendor docs above are moving references, checked on the research date; the version-tagged files and installed locators bound implementation claims. The RFD's lifecycle summary is not substituted for the pinned adapters' implementation, and no model-visible precedence, compaction or end-to-end installation result is claimed by static research alone.


## OpenAg evidence checked against this research

This section is operator evidence and source inspection, not an additional adapter experiment. The examined source/release is `57d7708`. OpenAg's connection is initialized with protocol v1 and empty client capabilities; it retains resume and prompt capabilities, but does not currently retain or use a client-system-prompt capability. New and resumed sessions pass the working directory, MCP servers and adapter metadata, then enforce Claude `default` / Codex `read-only`. Permission guidance is constructed by the runner and included in ordinary prompt content. [OpenAg connection/setup](../../apps/daemon/src/runtimes/acp.ts#L475), [session lifecycle](../../apps/daemon/src/runtimes/acp.ts#L514), [runner guidance](../../apps/daemon/src/runtimes/runner.ts#L421), [prompt construction](../../apps/daemon/src/prompt.ts#L16), [handoff](../../apps/daemon/src/runtimes/acp.ts#L570).

### What the repeated failure actually establishes

The reported request was message `1957`; turn `4213ef85-b73f-4680-933c-39ef7a290990` used a **fresh** Codex Terra session `01a1a801-4654-7ee0-9fc9-b578197d1a88`. Its native context recorded `read-only` / `on-request`. The updated OpenAg Full access / Never guidance was present in user-role content. The catalogue included `run_shell`, `write_file` and `skill_save`. The turn made three shell reads plus help/catalogue reads, all with automatic completed receipts at Full access revision 3. No copy/write command or `skill_save` invocation was attempted; no denied write was recorded. The first unbounded directory listing returned truncated output, which is a separate result-quality issue, not a filesystem refusal.

The sources for these observations are the daemon's private events/receipts for the turn above and the corresponding private Codex rollout `rollout-2026-11-05T08-20-18-01a1a801-4654-7ee0-9fc9-b578197d1a88.jsonl`. Raw user/session payloads and credentials are deliberately not copied into this note. The owning contracts for receipt results and the daemon MCP path are [MCP dispatch](../../apps/daemon/src/mcpserver.ts#L121), [runner dispatch](../../apps/daemon/src/runtimes/runner.ts#L517) and [command confirmation](../../apps/daemon/src/tools/execution.ts#L19).

**Conclusion:** tool-side Full access and deployment were not disproved by this refusal. A model decision/instruction conflict is a supported hypothesis, not a demonstrated causal result of an A/B experiment. Higher-priority native wording and lower-priority daemon guidance coexist in the observed turn, but the effect of moving the bridge must still be measured. The absence of a native `sandbox_permissions` argument does not prove that daemon `run_shell` requires it; OpenAg's command schema instead owns `escalation.reason`, which requests explicit review and is refused under Never. [Command schema and requirements](../../apps/daemon/src/tools/execution.ts#L6).

### Why earlier acceptance did not cover this request

The earlier disposable journey offered only `run_shell`, supplied exact shell commands, and checked file results, receipts and session identities. The live default-bot check also supplied exact copy commands. They establish that the daemon path can write, not that an agent can discover a source, choose a valid destination/skill format, plan an installation and complete it from an ordinary request among the real offered tools. [Harness tool set](../../scripts/verify-daemon-execution.mjs#L61), [request matrix](../../scripts/verify-daemon-execution.mjs#L92), [scoped acceptance record](permission-modes/acp-permission-guidance.json), [private live evidence]($OPENAG_DATA/inspections/oa458-full-access-f6d2adbff521/result.json).

### Skill installation is an additional contract

The inspected Accredo plugin `SKILL.md` has name/description front matter but no managed version field. OpenAg's agent-owned skill parser requires an integer version of at least one. Consequently, an unchanged directory copy into the agent-owned store alone would not establish catalogue recognition. This is a separately verified source-format mismatch; it is **not** established as the cause of the current read-only refusal, because no installation was attempted. [Managed parser](../../apps/daemon/src/skills.ts#L77), [managed renderer](../../apps/daemon/src/skills.ts#L93).

The managed `skill_save` tool handles metadata/body, redaction, versioning and data-repository commit; its inputs do not import an arbitrary directory/reference bundle. Agent-owned catalogue entries currently report an empty resource list, while `skill_load` path reads require a shared package. This does not mean copied resources could never be read through a separately authorized daemon filesystem tool. It means file-copy success, catalogue recognition and reference usability must be verified separately, using a supported route rather than assuming they are identical. [Skill-save contract](../../apps/daemon/src/tools/skills.ts#L44), [catalogue projection](../../apps/daemon/src/skills.ts#L328), [resource path contract](../../apps/daemon/src/skills.ts#L351).

## Acceptance requirements before another fix is called complete

These are proposed checks, **not checks run by this research**.

1. **Trace the actual model request for each pinned adapter.** Record negotiated capabilities, lifecycle system-prompt shape and effective instruction placement without logging credentials. Verify the same SDK surface on actual stdio and controlled peers; a type cast alone is not delivery evidence.
2. **Keep two distinct contracts.** A bounded daemon-owned integration bridge may explain native versus daemon execution at supported instruction priority. Current per-turn permissions/ceilings must still be derived by the runner and enforced at dispatch. Do not promote user text, history, skill instructions, provider data or tool output into privileged instructions. [Guidance/dispatch](../../apps/daemon/src/runtimes/runner.ts#L421).
3. **Cover lifecycle and authority changes.** Test new, reused and persisted resumed sessions; a fresh session after restart; permission revision/parent-scope changes; bridge-version changes; and independent unattended/offline/isolation changes. OpenAg's existing permission-context cache key includes session id/revision/parents, while turn restrictions are supplied separately, so a session-scoped prompt must not silently freeze per-turn authority. Claude's delayed resume semantics require explicit coverage. [Cache identity](../../apps/daemon/src/runtimes/runner.ts#L421), [ACP reuse](../../apps/daemon/src/runtimes/acp.ts#L672).
4. **Exercise a real decision journey.** Give an ordinary discover-and-install request for a small disposable package and references, without supplying a tool name or shell command. Offer the relevant production help/catalogue/tools. Check correct managed metadata, exact destination contents, catalogue listing/loading, reference usability, unchanged source and an honest final answer. Do not silently add a generic importer or hard-code Accredo as part of a permission bridge.
5. **Retain negative boundaries.** Read Only and outside-workspace writes remain refused; native-only effects/inherited integrations remain unavailable; unknown-effect fences, pending reviews and cancellation remain intact. Never turn native Full access on just to remove contradictory prose. [Mode decision](../adr/0004-permission-modes.md), [permission worlds](permission-worlds.md).
6. **Observe execution, not completion prose.** Correlate adapter/tool identifiers, nested MCP failures, command exit/interrupt/truncation, receipts and target state. An ACP end-of-turn response is not a skill-install receipt. On an uncertain effect, inspect the existing target/receipt before any new operation; do not replay the operation.
7. **Keep evidence levels separate.** Source/type inspection, controlled request capture, real subscription-adapter journeys, deployment and user-visible skill use are different claims. A passing exact-command probe must not stand in for the ordinary workflow.

No runtime code, installation, permission setting, adapter process or deployed service was changed for this research. No unit/Jest/Vitest or live acceptance turns were run. This note is research, not a new behavior claim or proof of a proposed fix.
