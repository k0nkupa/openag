# OA-398: permission adapter compatibility checkpoint

4 November 2026. **Historical native-mode approach: blocked and not accepted.** See the approved daemon-owned resolution below. The approved permission campaign is first in the queue. No production permission behavior, standing owner authority, installed daemon or provider business records changed. This checkpoint made twelve tiny subscription turns across disposable local native-tool targets. The current OpenAg category gate remains active in application code.

## Finding

Direct mapping to the installed adapters' native modes does not preserve OpenAg's per-action authorization interface. Successful native operations skip the ACP permission callback in Claude Full access and Codex Workspace Write/Full access. This is expected native-mode behavior, not an upstream defect. It conflicts with the proposed design's requirement that OpenAg's current guards remain authoritative for each operation.

A normal Claude pre-tool hook can refuse a Full access operation, but a hook process that exits with an error allows that operation to run. Therefore ordinary pre-tool hooks alone are not a fail-closed replacement for the gate. The tested Codex configurations did not invoke the hook; no conclusion about Codex hook denial/failure semantics is justified from these runs.

This establishes incompatibility of the measured approaches, not impossibility of implementing DSH-style permissions. The next architecture checkpoint needs an enforcing execution interface that does not depend on optional/fail-open callbacks. Do not change category locks or add a selector based on these results.

## Layers and coverage

Intended product path: desk selection → owner-authenticated gateway → permission session/revision → runner and policy gate → adapter/native execution or daemon MCP → execution environment → receipt/result → desk.

This diagnostic exercises only **real ACP adapter/native execution and its permission callback**, using a small raw ACP client. It has no MCP tools and no fixture approval handler that executes commands itself. The actual native tool must change the observed temporary target; prose success is not evidence. It does **not** exercise the desk, gateway, runner, action receipts, OpenAg policy integration, Read Only confinement, outside-write denial, escalation or connector/provider business actions. It deliberately exits nonzero when the candidate cannot meet the shared-gate contract.

All prompts request exactly one `printf` command against a named file beneath an owned temporary directory, prohibit other tools/paths and prohibit retries after refusal. The permission handler refuses every request. Each adapter uses the same session for both calls. Every model prompt settled normally; no invocation remains unknown. Evidence directories were retained. Normal CLI session/transcript bookkeeping may occur in the subscription CLI's own profile; this is not an isolated-profile or filesystem-confinement claim.

## Native-mode observations

Pinned packages restored by `pnpm install --frozen-lockfile`: Claude ACP **0.97.0**, Claude SDK **0.3.310**, Codex ACP **2.3.0**, bundled Codex **0.164.0**. These are the restored package versions, not assumed global CLI versions.

| Adapter/mode | Native calls | ACP approval requests | Target marker observed | Meaning |
| --- | --- | --- | --- | --- |
| Claude `default` | 1 | 1, refused | No | The asking callback prevented this operation. No filesystem confinement is established. |
| Claude `bypassPermissions` | 1 | 0 | Yes, disposable sibling target | Native Full access executed without the callback. |
| Codex `workspace-write` | 1 | 0 | Yes, inside workspace | Native permitted workspace work executed without the callback. |
| Codex `agent-full-access` | 1 | 0 | Yes, disposable sibling target | Native Full access executed without the callback. |

Both adapters reused their session on the second call. Full action/call identifiers, stop reasons and target observations are in [native-modes.json](permission-modes/native-modes.json). Those are sanitized observation records, not replayable grants or provider-response transcripts. The callback was configured to refuse; an action that never reached it must not be described as overriding a returned refusal.

## Pre-tool hook observations

| Adapter/configuration | Explicit hook denial | Hook failure | Scope |
| --- | --- | --- | --- |
| Claude Full access with explicit settings hook | Hook audit recorded; target unchanged | Hook audit recorded an intentional exit 1; target was written, no approval callback | Explicit denial works in this case; process failure is not fail-closed. |
| Codex Full access with inline hook configuration | No hook audit; target written | No hook audit; target written | Hook activation unverified; no claim about an activated hook. |
| Codex with startup `hooks`/`codex_hooks` flags and inline hooks | No hook audit; target written | No hook audit; target written | Same unverified activation; each prompt settled, no uncertain operation was retried. |

See [native-hooks.json](permission-modes/native-hooks.json) and [Codex activation attempt](permission-modes/codex-hook-activation.json). Both hook experiments reused sessions. After diagnostic review changes, a focused [Claude follow-up](permission-modes/claude-hook-followup.json) repeated the explicit-denial and intentional-failure observations in one fresh disposable session. These are distinct settled operations, not retries of unknown effects. Exported JSON normalizes the callback-observation field name and removes host temporary-directory prefixes; target observations and invocation identifiers are unchanged. The second call uses a different target and an intentionally failing guard; it is not a retry of an uncertain write. No provider-token or hook-trust state was changed.

The bundled Codex app-server generated schema exposes `preToolUse` and command hooks, but that is interface discovery rather than proof of active enforcement. Its pinned [configuration schema](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/config.schema.json) describes inline hooks and their feature controls. Further activation/trust diagnosis would not remove the separately measured Claude fail-open problem and is not treated as acceptance.

## Owning source evidence

- [Lockfile](../../pnpm-lock.yaml) and restored package manifests pin the versions above. Installed Codex ACP `dist/index.js` defines `read-only`, `workspace-write`, `agent` and `agent-full-access`; `sendPrompt` submits each mode's bundled approval and sandbox policy to the app server. The confined presets also disable network access, which differs from DSH's filesystem-only vocabulary.
- Installed Claude ACP `dist/session-mode.js` advertises `default`, `acceptEdits`, `plan`, `auto` and `bypassPermissions`; there is no DSH-style Read Only filesystem mode. Installed `dist/acp-agent.js` explicitly says that bypass is applied before `canUseTool`; asks that still reach it are bypass-immune. JSON options allow sandbox/settings but reject callback/hook functions.
- [OpenAg ACP runtime](../../apps/daemon/src/runtimes/acp.ts) fixes Claude to `default` and Codex to `read-only`, then resets unexpected mode changes. [Gate](../../apps/daemon/src/runtimes/gate.ts) only decides operations that reach it. [Runner](../../apps/daemon/src/runtimes/runner.ts) and [action receipts](../../apps/daemon/src/action-receipts.ts) still bind reviewed effects to human approvals.
- DSH's pinned [tool pipeline](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/core/tools/src/pipeline.ts) owns synchronous pre-execute decisions and guards before body dispatch; its no-listener fallback allows. Its [MCP bridge](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/mcp/mcp-client/README.md) registers external tools in that registry. The shared registry/executor is materially different from asking a separate native ACP loop to call back optionally.

## Required architecture decision

Recommend a daemon-owned file/command execution interface, exposed through OpenAg MCP to both subscription adapters, with native effectful tools disabled using measured supported controls. That concentrates confinement, revisions, explicit approval and effect records at an interface OpenAg controls. This recommendation is not implemented; exclusive tool routing must itself be proved before it can replace native execution. It also changes which native coding capabilities remain available and requires revisiting the first slice's native-tool acceptance.

The alternative is a maintained adapter extension with a required, fail-closed pre-dispatch interface for all native effects. Ordinary native permission presets and optional command hooks are insufficient evidence for that guarantee. Do not silently choose a weaker contract that checks only at turn start or observes effects after execution.

At this historical checkpoint, OA-398 remained blocked and OA-399–OA-403 had not started. The owner subsequently approved the daemon-owned resolution below.

## Verification and knowledge

- PASS: frozen dependency restore; workspace build including relay **dry-run only**; daemon `tsc --noEmit`; standalone script syntax; whitespace and local evidence-link checks.
- FAIL, intentional compatibility assertions: `node scripts/verify-permission-adapter-checkpoint.mjs --real`; `node scripts/verify-permission-adapter-checkpoint.mjs --real --hooks`; `node scripts/verify-permission-adapter-checkpoint.mjs --real --hooks --adapter codex`; focused follow-up `node scripts/verify-permission-adapter-checkpoint.mjs --real --hooks --adapter claude`. Failure is not a passing product gate. Observed native effects are scoped to the named disposable files.
- NOT RUN / NOT ESTABLISHED: unit/Jest/Vitest runners (owner prohibition), Read Only/confinement acceptance, gateway/desk permission journey, general sandbox backend selection, real provider business reads/writes, new production mode behavior or deployment.
- Knowledge: glossary, domain model, proposed ADR, spec, upstream research and this checkpoint are design/evidence sources. No implemented product behavior changed, so no delivered handbook/tool-description update is needed in this blocked checkpoint. Packaging the existing handbook during build does not deliver the proposed permission modes.
- Review: local Standards/Spec pass identified and corrected diagnostic naming/coverage ambiguity. Initial built-in review found a gate-check predicate that could miss execution after a returned refusal; the diagnostic now rejects any observed execution under the refusing callback and checks call-ID correlation. Generated hook audit separators are now explicit LF character codes, avoiding nested-escape ambiguity. The focused real Claude follow-up confirmed the same known fail-open result after these changes. Final built-in `codex review --uncommitted` completed with no substantive defects after the diagnostic corrections. Reviewed scope: staged/unstaged/untracked campaign design, queue, script and evidence only; source-only review, no tests or providers. The explicit multiline launcher removes source-display ambiguity; the prior real Codex launcher already had valid LF separators.

## Approved daemon-owned resolution

The owner approved daemon-owned execution after the native checkpoint. OA-398 now proves the shared executor and exclusive ACP routing described in [daemon execution](daemon-execution.md). The earlier BLOCKED findings above concern native presets/hooks; they do not describe acceptance of this revised path. Public permission state, picker and migration remain dependent work.
