# MCP contract audit — 3 November 2026

**Result: not ready for a general MCP compatibility claim.** The contract matrix has 22 passing probes and nine failing probes across eight gap areas. Both real ACP adapters reproduce the server-approval failure. The full workspace unit suite also has 18 failures. No production implementation was changed to make these checks pass.

## Scope and authority

The owner explicitly allowed unit tests for this audit, overriding the standing no-unit rule for this task. The source baseline is local deployed-source merge `f0fce62a4b2284408a44102c0e5b85ccddf970f6`, containing main's MCP fix plus the preserved room-question work. Audit changes are on `codex/mcp-contract-audit` and consist of test fixtures and this report.

The audit uses the installed `@modelcontextprotocol/sdk` 1.32.2 contract, whose newest supported revision is `2025-11-25`. It covers handshake acceptance for all five versions listed by that SDK; that is not a claim of full feature parity across historical revisions or newer release candidates. The probes exercise OpenAg's public manager/executor boundary over stateful loopback HTTP, scoped MCP through the real runner and approval/receipt gate, stdio through existing unit coverage, controlled OAuth/relay boundaries, and actual Claude/Codex subscription adapters. All tool operations use synthetic data and temporary stores. Live Outlook/provider execution, consent changes, receipt reconciliation, deployment and settings changes are excluded.

The local service advanced independently during the audit. Its observed revision was `e601aa58b084da4f0534789e2e71ce862a7d42b3`. The ten audited production MCP-boundary files were byte-identical to the baseline: manager, scoped MCP server, managed Composio client, ACP runtime, runner/types, registry, policy, approvals and action receipts. This does not establish that every unrelated file in that later release passed the baseline's full unit run.

## Results

| Layer | Result | Meaning |
|---|---|---|
| Workspace build and daemon typecheck | Passed | Includes relay dry-run, no deployment. |
| Full workspace unit suite | 1,866 passed; 18 failed (1,884 total) | Daemon: 1,493 passed / 9 failed. Desk: 373 passed / 9 failed. Not green. |
| Focused MCP/ACP unit suite | 116 passed; 1 failed | Eleven files. Sole failure expects the old MCP description prefix; no production behavior was changed to satisfy it. |
| New stateful HTTP contract matrix | 22 passed; 9 failed | Nine failures describe eight shared gap areas below. |
| Existing stateless full path, controlled adapters | 16 groups passed | Retains the earlier tool/gate/receipt and bounded-projection checks. |
| Stateful full path, controlled adapters | 18 groups executed; two approval-flow gaps | Includes ordinary positive and safe negative flows; this is not 18 successful workflows. |
| Stateful full path, real adapters | 14 groups executed; two approval-flow gaps | Two catalogue/projection groups plus twelve actual adapter flows. Ten existing flows passed; one elicitation workflow per adapter failed. |
| Real-adapter tool identity | Eight flows passed | Case preservation, generic/App-shaped names and collisions. |
| Real-adapter continuity | Four groups passed | Input pause, cached session, continuation and restart/history restoration. |
| Other controlled integration checks | Passed | Thirty identity flows; receipt execution/replay protection; hosted execution/context; encrypted Composio OAuth; remote callback; hosted-relay Worker module in Miniflare; knowledge delivery; ten continuity/render groups. |

Machine-readable evidence: [contract matrix](contract-results.json), [real adapters](real-adapter-results.json), [suite summary](suite-results.json). Detailed local logs are `/tmp/openag-contract-*.log`; they are not a substitute for the retained regression probes.

## Shared gaps

These are application compatibility requirements, not a claim that every optional MCP capability is mandatory for every client. Elicitation is optional in MCP but required by the active provider approval flow. Input/schema and catalogue diagnostics are host integration requirements. Cancellation is best effort and can never prove that an external operation did not happen.

| Priority | Gap and observed behavior | Production boundary |
|---|---|---|
| P1 | **Server-requested approval is unsupported in both client paths.** Generic and managed clients advertise no elicitation capability or handler. Each real adapter reaches the ordinary OpenAg approval once, then the remote server cannot request its additional user approval. Neither adapter completes the synthetic workflow. | `apps/daemon/src/mcp.ts:242`, `composio-connect.ts:238` |
| P1 | **Generic tool input contracts are lost.** Generic MCP tools receive an unrestricted object schema; only managed Composio and Apple tools use the remote schema. A tool requiring a string can be offered without that required field, and an invalid payload reaches a permissive remote executor. This is not an assertion that client validation replaces the server's own obligation to validate. | `mcp.ts:449-453` |
| P1 | **Structured-only results are silently discarded.** A valid reply with empty text content and `structuredContent` loses its marker; the invocation can appear successful with no useful data. Invalid structured output is correctly rejected when an output schema is advertised by the server. | `mcp.ts:489-510` |
| P1 | **Returned tool-error evidence is destroyed.** A short structured rejection is reduced to the first 120 characters of its text. The remote error's tail and structured fields are unavailable to the caller/receipt; the returned-error path differs from the preserved non-error Unknown-result path. Unconfirmed external effects must still remain Unknown. | `mcp.ts:131-132,492-493`; `runtimes/runner.ts:533-537` |
| P2 | **Caller cancellation is not forwarded to the remote invocation.** Aborting the executor context does not reach the cooperating server's request signal. The probe tests forwarding, not a guarantee that cancellation rolls back an effect. Existing approval-wait cancellation remains covered and passes. | `mcp.ts:461,472-473` |
| P2 | **Catalogue-change notifications are ignored.** A stateful server advertises and sends `tools/list_changed`, removes a tool, and the old tool stays offered. Explicit reload works, but automatic refresh/invalidation is missing. | `mcp.ts:398-468` |
| P2 | **Task-only tools are offered without task execution support.** A tool declaring `execution.taskSupport: required` is still projected as an ordinary synchronous tool. It needs either a supported task lifecycle or an explicit unavailable diagnostic before offering/execution. Task support is optional; silently offering an unusable tool is the integration gap. | `mcp.ts:445-463` |
| P2 | **Invalid pagination looks complete.** Twenty repeated empty pages with the same non-empty cursor become a connected empty catalogue without an incomplete/invalid diagnostic. The loop is bounded, so this is a catalogue-integrity issue, not an unbounded loop. | `mcp.ts:269-278` |

The elicitation failure is one shared daemon-client gap observed in two client paths and both ACP adapters; it is not four unrelated tool fixes. The generic input/schema gap likewise needs one shared path, not provider-name exceptions.

## What passed, and supported limits

The new matrix passed stateful initialization/session handling, all five supported handshake revisions, refusal of an unsupported negotiated revision, normal paginated listing, independent concurrent calls, JSON-RPC errors, malformed JSON responses, HTTP 401/403/404/503 without execution replay, output-schema rejection, timeout bounds without replay, explicit reload, and stale-executor refusal after disconnect. The current callers still keep unknown/write operations approval-gated and uncertain external effects protected against replay.

Remote images and resource links are explicitly replaced by omission markers, rather than delivered as usable media. Generic roots and sampling requests are refused without filesystem disclosure or model execution. Resources/prompts/completion APIs, URL-mode elicitation, progress UI, rich remote media and task lifecycle are not implemented as usable OpenAg capabilities. They must not be advertised as available. This audit is not an MCP certification suite and does not claim those optional features work.

## Blocked end-to-end scenarios

Successful elicitation review, explicit decline/cancel, multiple nested requests, review expiry and URL-mode consent cannot be exercised through OpenAg because there is no callback bridge or user interaction to drive. The real-adapter negative probes establish that boundary; they do not certify those missing workflows. A shared implementation needs positive and negative coverage for all of them, including unsafe URLs and disallowed credential fields, before advertising the capability.

Task polling, task cancellation and task recovery likewise have no implemented host path. The current probe establishes the incorrect offering of a task-required tool. It does not claim the missing task lifecycle was exercised. Optional unsupported resources/prompts/media/progress features remain explicit product limits, not successful workflows.

## Existing unit failures outside the new probes

Daemon failures: old MCP description assertion (one); settings defaults in `settings.test.ts` and `gateway.settings.test.ts` (two); prompt wrapping expectations (two); wake error reporting (one); delegation failure output (one); message-source indexing flags (one); vector recall (one).

Desk failures: missing `ResizeObserver` in model-settings fixtures (four); room-router model-list expectations (four); missing responsibilities API mock during an automation error case (one).

The description mismatch is directly explained by the current class-bearing prefix. The other failures remain separately untriaged; they are not all declared stale and were not weakened or fixed during this MCP audit.

## Reproduction commands

```sh
OPENAG_RELAY_DEPLOY_DRY_RUN=1 pnpm -r build
pnpm -r --no-bail test
pnpm --filter daemon exec tsc --noEmit

# Both intentionally exit 1 while the recorded compatibility gaps remain.
node scripts/verify-mcp-contract.mjs --report /tmp/openag-contract-matrix.json
node scripts/verify-remote-mcp.mjs --contract-audit --report /tmp/openag-contract-adapters-controlled.json
node scripts/verify-remote-mcp.mjs --real --contract-audit --report /tmp/openag-contract-adapters-real.json

node scripts/verify-acp-tool-identity.mjs
node scripts/verify-acp-tool-identity.mjs --real
node scripts/verify-acp-continuity.mjs --render
node scripts/verify-acp-continuity.mjs --real
node scripts/verify-action-receipts.mjs
node scripts/verify-composio-connect.mjs
node scripts/verify-remote-composio.mjs
node scripts/verify-one-click-composio.mjs
node scripts/verify-hosted-outcomes.mjs
node scripts/verify-hosted-context.mjs
node scripts/verify-bot-knowledge.mjs
```

Focused unit invocation, from `apps/daemon`:

```sh
pnpm exec vitest run src/mcp.test.ts src/mcp.gate.test.ts src/mcp.stdio.test.ts src/mcp.reserved.test.ts src/gateway.mcp.test.ts src/mcpserver.test.ts src/apps.composio.test.ts src/runtimes/acp-mcp.test.ts src/runtimes/acp-mcp.e2e.test.ts src/runtimes/acp-codex.test.ts src/runtimes/acp.test.ts --maxWorkers=4 --reporter=json --outputFile=/tmp/openag-contract-mcp-unit.json
```

The new `--contract-audit` mode uses stateful HTTP sessions and requests user elicitation at the remote server. Unexpected tool approvals are ignored before the fixture fails. No confirming helper is added to the remote tools. The audit returns a failing exit status while either adapter cannot complete the additional review flow; it does not label a safe refusal as a successful workflow.

## Follow-up boundary

One shared MCP compatibility implementation should address these failures with regression coverage at the same public boundaries. Preserve central classification and write/unknown approval gates, explicit user review for provider callbacks, bounded untrusted results/errors, cancellation uncertainty, and no automatic execution replay. Do not enable provider Always Allow or disable provider controls to turn the tests green. Do not reconcile historical uncertain receipts automatically.

No production behavior changed in this audit, so the delivered bot handbook was not changed. Source findings and controlled adapter results do not establish live provider acceptance. Browser/phone UI acceptance remains untested because browser access is disabled. Live connector calls since the audit began were checked read-only and counted zero; the existing Unknown receipt remains uninspected.

## References

- [MCP 2025-11-25 tools, schemas, output and catalogue notifications](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP elicitation capabilities, review and decline/cancel behavior](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
- [MCP cancellation semantics and races](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/cancellation)
- [Composio Enhanced Control client capability requirement](https://docs.composio.dev/kb/guide/mcp-tool-router-sessions#enhanced-control-requires-client-support-for-mcp-elicitation)
