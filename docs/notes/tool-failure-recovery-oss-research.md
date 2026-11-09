# Tool failure recovery: Grok Bot and OpenBot

Research date: 5 November 2026. Scope: the owner's request to compare OpenAg's mandatory Unknown-receipt inspection form with other agent products. Research only; no product behavior or live receipts changed.

## Finding

The inspected products support a simpler user experience than OpenAg's generic target/reference plus findings form. Grok Bot documents ordinary retry and task-specific recovery. OpenBot returns correctable tool failures to the agent and uses idempotency for specific internal operations. Neither source establishes a general guarantee that an external write did not happen after a timeout.

The recommendation is to remove mandatory manual inspection bookkeeping, retain useful diagnostic history, and handle genuine ambiguous writes in the affected task with a concrete next step. This is a product recommendation, not a claim that an error proves absence of effects.

## Grok Bot: documented user behavior

Primary source: [official troubleshooting](https://docs.x.ai/grok-bot/troubleshooting), retrieved 5 November; page says updated 28 October 2026. Firecrawl returned cached content from 4 November, not a fresh deployment observation.

- The section “A run fails with an error” tells the user to retain the request ID, try again, and report a persistent failure. It does not prescribe a target/evidence inspection form.
- Expired approvals are described as actions that do not run; the user can ask the bot to try again. An unusable approval can be rejected/cancelled and regenerated with a corrected scope.
- Connector problems have concrete actions: Authenticate, Reopen, Retry, Reconnect, or send a new message after connection succeeds.
- Stuck tasks direct users to inspect the current status/computer, answer a specific question or approval, redirect, or stop.
- Computer recovery is more cautious: do not run concurrent recovery operations, and stop after a failed bounded retry. Cloud work can continue while the client is disconnected.

These are documented UX patterns. Grok Bot's private implementation was not inspected. No claim is made about hidden reconciliation, deduplication, or every side-effecting operation. Grok Bot is a comparison product here, not an asserted OSS repository.

## OpenBot: inspected implementation

Repository: [nightly-labs/openbot](https://github.com/nightly-labs/openbot). Source inspected at commit `3d9a8f21b3d30831cdf2de974e273a2a53ced934` using an isolated shallow checkout. No dependencies installed and no code executed.

1. [Correctable tool failures](https://github.com/nightly-labs/openbot/blob/3d9a8f21b3d30831cdf2de974e273a2a53ced934/src/backend/agent/openbot-tool-router.ts#L568-L596): profile/channel/attachment errors and selected workflow argument errors are returned as failed tool results with a redacted reason. The source explicitly aims to let the calling agent correct its request, instead of losing detail behind Codex's generic dynamic-tool error. This is a scoped rule, not all errors.
2. [MCP result bridge](https://github.com/nightly-labs/openbot/blob/3d9a8f21b3d30831cdf2de974e273a2a53ced934/src/backend/local-mcp-bridge.ts#L350-L362): a dynamic tool result becomes MCP content with `isError: !result.success`.
3. [Abandoned-call cancellation](https://github.com/nightly-labs/openbot/blob/3d9a8f21b3d30831cdf2de974e273a2a53ced934/src/backend/local-mcp-bridge.ts#L79-L101): the bridge tracks cancellation or a closed response stream and stops waiting for the user. This is cancellation plumbing, not proof that an external effect was rolled back.
4. [Internal message idempotency](https://github.com/nightly-labs/openbot/blob/3d9a8f21b3d30831cdf2de974e273a2a53ced934/src/backend/agent/tool-call-idempotency.ts): thread, turn and call identity form a stable mailbox key so a repeated call can enqueue its message once. The router uses it for internal messaging. This must not be generalized to arbitrary provider writes.
5. [Current access model](https://github.com/nightly-labs/openbot/blob/3d9a8f21b3d30831cdf2de974e273a2a53ced934/README.md): the preview documents full local access and no per-action confirmations after initial consent. Its lower friction is partly a deliberate authority choice; that is not a reason to change OpenAg's selected permission mode.

Searches across `src/` and `packages/` and inspection of these paths found no equivalent mandatory Unknown-receipt target/findings form. This is a bounded negative finding, not proof that the entire product has no specialized recovery flow. Current OpenBot describes itself as source-available with a noncommercial license; do not casually call all current releases permissively licensed OSS.

## CopilotKit-related research

See [CopilotKit failure and human-input research](copilotkit-failure-recovery-research.md) for separately gathered official documentation and source evidence.

## Implications for OpenAg

- Distinguish explicit failure, read failure, and uncertain completion in diagnostics; do not require the user to fill out a generic inspection record after a failed invocation.
- Return actionable error details to the agent so it can correct arguments or explain missing access.
- Keep approval/consent before an action separate from failure recovery after an invocation.
- For ambiguous external writes, use provider IDs, readback or idempotency when available. Otherwise explain the uncertainty in the task and ask a concrete question only when needed.
- Do not treat retry UX in another product as proof that replaying any write is safe.
- Removing only the form leaves OpenAg's backend inspection gate intact. Removal must cover both the UI and mandatory gate, caller guidance, delivered help and verification. The other active permissions chat currently retains inspection while narrowing conflicts; its scope differs from this request.

## Verification limits

Read-only source and documentation research. No live provider journey, product launch, unit/Jest tests, deployment, receipt inspection write, or retry was performed. No broad claim about exactly-once external execution is supported.
