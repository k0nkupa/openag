# Composio read receipt and unanswered provider prompt

## Saved attempt, 5 November 2026

Read-only inspection of the installation database located the screenshot's receipt `206d67aa-f862-444a-b41f-31423f4c4ba1`, turn `81236a83-70e6-4083-a3b1-1efa6212949c`, daemon tool call `6dcdd9a8-97fe-4daf-9bb5-b1d323a506f7`, and provider log `log_lKJdJOUN_oEf`. No provider call was repeated and no live receipt was changed.

The bot adapter forwarded a single `OUTLOOK_GET_PROFILE` read with `user_id: me`, selected profile fields and `sync_response_to_workbench: false` through OpenAg's MCP server, permission gate and managed Composio client. The permission session was Full access/Never and the OpenAg decision was automatic. Composio separately requested a form decision: `allow_once`, `allow_session`, or `deny`. OpenAg permission does not answer provider consent.

Times are Pacific/Auckland:

| Evidence | Time / result |
| --- | --- |
| Provider form saved open | 12:34:14.884 |
| OpenAg's saved local expiry | 12:36:14.884 |
| Form saved cancelled | 12:34:44.894, after 30.010 seconds |
| Saved response | `{"action":"cancel"}`; no accepted decision |
| Returned provider envelope | `successful: false`, one requested operation, zero successes, one error |
| Provider error | `No response to elicitation prompt within the allowed time.` |
| Historical receipt | Unknown, invocation Returned |

The tool returned the provider failure, and the bot continued its turn. OpenAg's two-minute expiry was not reached. The cancellation record does not identify whether cancellation came from the provider callback or a device; there is no browser visibility or response-attempt telemetry. The provider reported its unanswered-prompt timeout, but the stored evidence cannot establish whether the owner saw the form, attempted an answer, or why its response window was thirty seconds. No profile or mail content was returned by this operation.

## Receipt classification

The deployed `composioResult` returned early on MCP `isError`, so the explicit provider failure never received `providerDiagnostic: provider_error`. The shared read-only confirmer consequently returned no verdict, and the generic external-action fallback recorded Unknown. An offline replay through the deployed parser reproduced this. With only the outer error flag removed from the replay, the same body classified as Failed.

The fix inspects known managed Composio envelopes even when `isError` is already true. It preserves that flag. Only the existing reviewed read-only request contract can settle the returned explicit failure as Failed. Writes, unreviewed operations, other servers, malformed envelopes and success-looking error replies stay unconfirmed. Historical receipts are retained unchanged. Both ACP adapters, API bots and Ollama use this shared daemon boundary; no adapter-specific change is needed.

The separate connection-inventory receipt `00a478f3-6f8c-492b-9641-b3ed1b13ffb6` follows the general external-action contract for `COMPOSIO_MANAGE_CONNECTIONS`. Its successful inventory response is not covered by the read-batch exception. That classification is unchanged.

## Prompt delivery and attention

The daemon emits `mcp_interaction_updated` and includes open forms in the Questions attention query. Desk subscriptions refresh the Needs you badge and Questions list. The form itself is mounted only in the Needs you detail panel, not inline in chat. Activity projection groups the interaction into its tool's history; the representative tool event need not carry the interaction link.

Push was enabled when inspected. The push subscriber handles `approval_requested` and wake pings, not `mcp_interaction_updated`, so this provider form had no push notification path. This was the pre-fix attention gap that could explain a missed prompt, not proof of the owner's browser state. The receipt fix itself changed no notification or UI behavior. OA-473 subsequently adds open forms in chat and minimal response-needed pushes; see the current MCP lifecycle notes. The visibility change preserves explicit provider consent and does not extend the provider's deadline.

See [MCP interaction behavior](mcp-lifecycle.md) and [the reviewed receipt contract](mcp.md#reviewed-read-only-composio-batches-oa-395).

## Controlled verification

`verify-composio-contract.mjs` uses the real SDK HTTP, manager, runner, permission gate and disposable receipt store. The added saved-error shape failed before the fix (Unknown instead of Failed). Coverage includes text and structured flagged failures, success-looking flagged replies, malformed/plain errors, writes and same-named tools on another server.

`verify-mcp-interactions.mjs` uses the real gateway, attention query, React form and shared stream in a disposable store/DOM. It submits the saved provider form's schema with Allow once and verifies the exact response. This establishes controlled form routing and submission, not historical visibility or live provider acceptance.

Build, standalone command outcomes and packaged default-bot knowledge delivery are recorded in OA-472. No unit/Jest/Vitest suite, live provider/adapter journey, deployment, or live data mutation is part of this change.
