# Composio source reuse review

Checked 2026-11-03. Read-only source research; no provider calls, consent links, credentials, installations or test runs. Public GitHub default-branch commits were resolved through the GitHub API, then files were read at those commits. Test descriptions below mean inspected test source, not passing results.

## Decision

Reuse **CopilotKit/OpenBot's broker validation and diagnostic patterns** and **official Composio SDK contracts**. Keep OpenAg's existing Connect OAuth MCP transport, owner checks, authoritative policy gate and durable action receipts. The SDK examples are useful references, but replacing Connect with project-key sessions would be a separate product/authentication decision. None of the inspected integrations establishes OpenAg's complete owner/approval/unknown-outcome guarantees.

The two OpenBots are different projects. Actual Composio code was found in all three inspected applications; it is not merely inferred from generic MCP support.

## Authentication surfaces are different

| Surface | Verified source | Consequence for OpenAg |
| --- | --- | --- |
| Consumer Composio Connect | Official docs give the shared `https://connect.composio.dev/mcp` address, browser authorization and dynamic meta tools, without an SDK session. | Matches OpenAg's existing OAuth connection concept. Preserve its device-bound callback and encrypted credential store. |
| Project-key SDK | `new Composio({apiKey})`, application-controlled user identity, session creation/use or direct tool execution. | Requires an operator's project API key and explicit user/account mapping. It does not inherit the existing consumer OAuth connection automatically. |
| SDK session exposed through MCP | `composio.create(userId, {mcp:true, ...})` produces `session.mcp.url` **and headers** for an MCP client. | An MCP transport does not make this the consumer Connect product. Do not substitute its URL or credentials into the current connection. |

Sources: official [Connect documentation](https://github.com/ComposioHQ/composio/blob/a0c51b01ea6325ca46b1fb3393fe574dffa57ffe/docs/content/docs/composio-connect.mdx#L1-L18), [session configuration](https://github.com/ComposioHQ/composio/blob/a0c51b01ea6325ca46b1fb3393fe574dffa57ffe/docs/content/docs/configuring-sessions.mdx#L7-L49), [SDK MCP example](https://github.com/ComposioHQ/composio/blob/a0c51b01ea6325ca46b1fb3393fe574dffa57ffe/ts/examples/tool-router/src/mcp.ts).

The pinned Connect docs describe seven meta tools. Treat that as documentation, not an exhaustive inventory of OpenAg's connected server. The parent investigation's live catalogue is the authority for the tools available to this installation.

## CopilotKit/OpenBot: strongest reusable validation

Revision `df50f6950ffcdb2cdbefd2fcac3eac1c2951c9d9`; [MIT license](https://github.com/CopilotKit/OpenBot/blob/df50f6950ffcdb2cdbefd2fcac3eac1c2951c9d9/LICENSE).

This is a real project-key integration. Its adapter deliberately uses per-call requests instead of session creation, to avoid introducing the hosted shell/workbench surface. Catalogue and action reads follow pagination to completion rather than mistaking one full page for the whole list. [Adapter rationale and seam](https://github.com/CopilotKit/OpenBot/blob/df50f6950ffcdb2cdbefd2fcac3eac1c2951c9d9/server/src/plugins/composio-adapter.ts), [action pagination](https://github.com/CopilotKit/OpenBot/blob/df50f6950ffcdb2cdbefd2fcac3eac1c2951c9d9/server/src/plugins/composio-client/actions.ts#L24-L87).

Tool offering is derived from bot grants. Execution goes back through `store.callTool` with actor/bot identity, rather than calling the vendor from the model-facing wrapper. Before a direct vendor call, the adapter resolves the action at its recorded concrete version, verifies its toolkit matches the gated connection, refuses unsupported file arguments, and forwards the user identity and optional specific account. Ordinary calls can be unpinned to a specific connected account; do not assume exact-account acceptance from user scoping alone. [Grant execution wrapper](https://github.com/CopilotKit/OpenBot/blob/df50f6950ffcdb2cdbefd2fcac3eac1c2951c9d9/server/src/plugins/tools.ts#L284-L335), [direct execution checks](https://github.com/CopilotKit/OpenBot/blob/df50f6950ffcdb2cdbefd2fcac3eac1c2951c9d9/server/src/plugins/composio-client/actions.ts#L89-L232), [identity/version/account guards](https://github.com/CopilotKit/OpenBot/blob/df50f6950ffcdb2cdbefd2fcac3eac1c2951c9d9/server/src/plugins/composio.ts#L1865-L1959).

Its result handling distinguishes vendor-reported failure from a thrown call, unreadable response, or missing result envelope. An `answered` flag supports account-verification decisions; it is **not** a durable exactly-once action receipt or proof that a timed-out write had no effect. [Response handling](https://github.com/CopilotKit/OpenBot/blob/df50f6950ffcdb2cdbefd2fcac3eac1c2951c9d9/server/src/plugins/composio.ts#L1970-L2116), [evidence assertions](https://github.com/CopilotKit/OpenBot/blob/df50f6950ffcdb2cdbefd2fcac3eac1c2951c9d9/server/tests/composio-transport.test.ts#L3588-L3707).

**Portable to current Connect MCP:** validate result envelopes; distinguish pre-execution refusal, provider-reported failure and unknown completion; preserve provider log IDs; separate project/configuration failure from missing account/consent; never change connection state merely because a diagnostic could not reach/read the provider. Apply these at OpenAg's MCP result boundary without importing its project-key broker.

**Not directly portable:** REST toolkit pagination and project auth-config creation, project user/account IDs, SDK-specific version plumbing, account deletion/connection writes. Connect search and schema tools have their own contracts. Keep provider hints untrusted: this project's behavior-tag classifier must not replace OpenAg's reviewed tool classes.

### Existing checks worth adapting, not running wholesale

- `OPENBOT_LIVE_COMPOSIO=1 COMPOSIO_API_KEY=... bun test tests/composio-live.test.ts` (from its server directory) is opt-in. It checks that Gmail listings carry versions/behavior labels, an unconnected identity yields an explanatory failure, `latest` execution is locally refused, a nonexistent public Hacker News user produces a resolved failure envelope, the broker catalogue includes Gmail/action counts, and a fresh deployment identity has no connected account. This is API contract coverage, not real connected-account consent or successful provider-action E2E proof. The fixed “nobody” identity is an assumption of that test; recheck it before reuse. [Live test source](https://github.com/CopilotKit/OpenBot/blob/df50f6950ffcdb2cdbefd2fcac3eac1c2951c9d9/server/tests/composio-live.test.ts).
- `COMPOSIO_API_KEY=... bun run composio:smoke -- --user <id>` (repo root) reads catalogue/connection status; `--call` additionally selects `GMAIL_GET_PROFILE`, checks its current read/destructive labels and concrete version, calls with `{}`, checks `successful`, and prints the returned log ID. It neither creates a consent link nor proves a write. A missing auth config and unfinished consent remain indistinguishable in its connection read. Adapt the staged diagnostic shape to OpenAg's existing connection, not the command/key. [Smoke source](https://github.com/CopilotKit/OpenBot/blob/df50f6950ffcdb2cdbefd2fcac3eac1c2951c9d9/scripts/composio-smoke.ts#L440-L570).
- Stub-based transport tests explicitly cover malformed envelopes, non-boolean success flags, thrown versus answered calls, and account pin forwarding. Read them for expected edge cases; Alex's standing instruction prohibits running unit suites. [Transport checks](https://github.com/CopilotKit/OpenBot/blob/df50f6950ffcdb2cdbefd2fcac3eac1c2951c9d9/server/tests/composio-transport.test.ts#L3055-L3780).

## CopilotKit/OpenDots: small session adapter, limited policy transfer

Revision `8091324942b86789ed0da7facbee855145d933b0`; [MIT license](https://github.com/CopilotKit/OpenDots/blob/8091324942b86789ed0da7facbee855145d933b0/LICENSE).

It creates a project-key session for an owner ID, caches its ID against a hash of sorted toolkit policy plus `instant:false`, and creates a replacement when that policy changes. An empty toolkit selection omits the restriction; it does not mean no access. Its tool wrapper forwards JSON schemas, abort signals and `session.execute`, returning `{data,error}` and sanitized thrown errors. [Session implementation](https://github.com/CopilotKit/OpenDots/blob/8091324942b86789ed0da7facbee855145d933b0/src/server/composio.ts), [execution adapter](https://github.com/CopilotKit/OpenDots/blob/8091324942b86789ed0da7facbee855145d933b0/src/server/composio-tools.ts).

The separate generic MCP connection wrapper queues owner approval instead of executing tools marked as requiring review. That is **not evidence that the Composio wrapper applies the same gate**; the latter directly calls the session executor. Do not transplant that execution path around OpenAg's `ctx.callTool`. Its inspected Composio tests mock the SDK/session and verify reuse, policy changes, schemas/signals and safe errors; they do not establish real consent or provider acceptance. [Generic MCP approval wrapper](https://github.com/CopilotKit/OpenDots/blob/8091324942b86789ed0da7facbee855145d933b0/src/server/connection-tools.ts), [session tests](https://github.com/CopilotKit/OpenDots/blob/8091324942b86789ed0da7facbee855145d933b0/tests/composio.test.ts), [wrapper tests](https://github.com/CopilotKit/OpenDots/blob/8091324942b86789ed0da7facbee855145d933b0/tests/composio-tools.test.ts).

Reuse schema/signal forwarding and configuration-bound cache invalidation only if the current OpenAg transport needs them. Cancellation alone cannot establish that an external action stopped.

## nightly-labs/openbot: real plugin, different auth and license

Revision `21369e1eec420772a7db9f6bbfeae2ef9b3ab83a`; [PolyForm Noncommercial 1.0.0 license](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/LICENSE). This is source-available with noncommercial restrictions, not an MIT source-copy candidate. Commercial reuse needs an applicable separate grant; prefer independently implemented patterns or the MIT sources above.

Its actual Composio plugin asks the user for their MCP URL and an API key sent as `x-consumer-api-key` (`ck_…`). This is a generic HTTP MCP plugin configuration, not the same OAuth onboarding already implemented in OpenAg. [Plugin manifest](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/marketplace/plugin-catalog/plugins/composio/plugin.json).

Generic MCP tooling includes server-change consent hooks and guidance to call tools under the user's request. The repository also has generic MCP consent/OAuth scripts; their presence is not a Composio provider E2E result. No Composio-specific E2E script was identified in the complete tree's Composio-named files. [MCP tooling](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/src/backend/agent/mcp-tools.ts), [generic consent check](https://github.com/nightly-labs/openbot/blob/21369e1eec420772a7db9f6bbfeae2ef9b3ab83a/scripts/mcp-tool-consent-e2e.ts).

## Official SDK: reuse contracts, preserve OpenAg authority

Revision `a0c51b01ea6325ca46b1fb3393fe574dffa57ffe`; [MIT license](https://github.com/ComposioHQ/composio/blob/a0c51b01ea6325ca46b1fb3393fe574dffa57ffe/LICENSE).

Current session code supports tools, direct execution, meta execution and authorization. Authorization starts a new link flow; connected-account output may contain live credentials, so examples print only IDs/status. Do not persist or log whole SDK account objects. [Session code](https://github.com/ComposioHQ/composio/blob/a0c51b01ea6325ca46b1fb3393fe574dffa57ffe/ts/packages/core/src/models/ToolRouterSession.ts#L462-L585), [authorization example](https://github.com/ComposioHQ/composio/blob/a0c51b01ea6325ca46b1fb3393fe574dffa57ffe/ts/examples/tool-router/src/authorize.ts).

Experimental `requireApproval` filters and `ComposioToolInputRequiredError` support user answers plus opaque continuation state. Approval lists alone do not restrict offered tools. The official example explicitly restricts tools and disables the sandbox. These are useful contracts if provider input requests reach OpenAg, not permission to let remote continuation state decide OpenAg's owner/policy approval. SDK session tests use mocked clients; inspected source does not prove this feature is enabled on OpenAg's consumer endpoint. [Configuration/approval contract](https://github.com/ComposioHQ/composio/blob/a0c51b01ea6325ca46b1fb3393fe574dffa57ffe/docs/content/docs/configuring-sessions.mdx#L76-L93), [approval example](https://github.com/ComposioHQ/composio/blob/a0c51b01ea6325ca46b1fb3393fe574dffa57ffe/ts/examples/approvals/src/session.ts), [SDK tests](https://github.com/ComposioHQ/composio/blob/a0c51b01ea6325ca46b1fb3393fe574dffa57ffe/ts/packages/core/test/models/toolRouter.test.ts).

## Smallest next step

Keep the current transport. First map read-only checks against the actual offered catalogue and identify fixture versus real backend/provider evidence. Reuse OpenBot's staged status/read/result checks and malformed-response cases. Select any write target separately later; do not run account setup, feedback, skills, shell/workbench, proxy writes, consent or retries merely because the remote catalogue exposes them. A timed-out or unreadable external call stays Unknown until destination evidence resolves it. No source reviewed here justifies downgrading that receipt or replaying a write.

No product/help or bot-delivery update is required for this research-only note: runtime capability and user behavior are unchanged. No build or tests were run; no live integration acceptance is claimed. OpenClaw and Letta were not re-audited in this bounded Composio review.
