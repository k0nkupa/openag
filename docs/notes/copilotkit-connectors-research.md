# CopilotKit connector research

Checked 2 November 2026. Primary documentation and selected source only; no installs, tests, or live connection attempts.

## Core CopilotKit: protocol plumbing, not a Gmail/Apple marketplace

CopilotKit's MIT SDKs and TypeScript runtime connect a UI to an agent. The OSS core can run without a CopilotKit service. Its listed framework integrations (Mastra, LangGraph, Google ADK, etc.) connect **agent frameworks**, not the corresponding vendors' personal apps. Intelligence is a separate service with separate terms, cloud-hosted or self-hosted. [OSS versus Intelligence](https://docs.copilotkit.ai/concepts/oss-vs-enterprise).

The exact current API is `BuiltInAgent` from `@copilotkit/runtime/v2`:

| API | Responsibility |
| --- | --- |
| `mcpServers: [{type:"sse", url, headers?}]` | Agent creates an MCP client per run, discovers tools, then closes it. Authentication headers are supplied by the application. |
| `mcpServers: [{type:"http", url, options?}]` | Streamable HTTP; options pass to SDK `StreamableHTTPClientTransport`. Source documents `options.fetch` as the extension point for dynamic headers. |
| `mcpClients: [{tools(): Promise<ToolSet>}]` | Application creates/configures/closes the client. Supports persistent connections, tool caching, custom auth and token refresh. |
| `defineTool({name, description, parameters, execute})` | Application-owned server tools can coexist with MCP tools. |
| `useDefaultRenderTool(...)` | Frontend tool-call display; does not itself authorize execution. |

Sources: [MCP setup docs](https://docs.copilotkit.ai/mcp-servers), [agent implementation](https://github.com/CopilotKit/CopilotKit/blob/main/packages/runtime/src/agent/index.ts), [MCP versus MCP Apps and approval](https://docs.copilotkit.ai/agentic-protocols/mcp).

The inspected `MCPClientConfig` union offers HTTP/SSE, not a direct stdio command entry. A local Apple stdio server therefore needs an application-owned client or another bridge outside that simple configuration. The documentation's dynamic-auth example explicitly puts token expiry and reconnection inside the application's `mcpClients` provider. This configuration does not supply Google developer-client registration, account consent UI, refresh-token vaults or macOS app permissions. Those belong to the application or the connector/broker it chooses. [Source types and connection code](https://github.com/CopilotKit/CopilotKit/blob/main/packages/runtime/src/agent/index.ts), [dynamic auth docs](https://docs.copilotkit.ai/mcp-servers#dynamic-authentication).

The generic MCP guide suggests an external Composio MCP endpoint as one way to obtain tools. That is reuse of a connector provider, not proof that Gmail/Drive are built into CopilotKit core. No first-party Apple app bridge was established by the inspected core documentation/source. [MCP guide](https://docs.copilotkit.ai/agentic-protocols/mcp).

## Distinct product: CopilotKit/OpenBot

`CopilotKit/OpenBot` is a separate MIT product built on this framework. Do not conflate it with `nightly-labs/openbot`; no shared identity or lineage is assumed here. The CopilotKit README describes OpenBot as the OSS coworker workspace and Soar as a commercial product above it. [CopilotKit README](https://github.com/CopilotKit/CopilotKit#ai-coworkers-built-on-copilotkit).

Its inspected connector implementation is more relevant to an app catalog than CopilotKit core:

- **Google Drive is concrete, read-only, per-person OAuth.** The curated entry uses `transport: "google-drive-rest"`, `https://www.googleapis.com/drive/v3`, scope `drive.readonly`, offline consent, and a refresh-token grant. The REST adapter exposes search, recent-file listing and file-text reads, including text export of Google editor formats. Source says it replaced a Google MCP endpoint due to preview enrollment requirements; that is the project's documented reason, not an independently verified claim about Google's current availability. [Catalogue](https://github.com/CopilotKit/OpenBot/blob/main/server/src/plugins/catalogue.ts), [REST adapter](https://github.com/CopilotKit/OpenBot/blob/main/server/src/plugins/google-drive-rest.ts).
- **Gmail comes through the Composio broker in the documented path.** Operator sets `COMPOSIO_API_KEY`; admin enables an app and grants Bot actions; each person connects their own account. Composio holds the vendor account credentials. The curated `CATALOGUE` inspected here has a Drive entry but no Gmail or Apple entry. This is scoped source evidence, not an exhaustive absence claim about every optional integration. [Composio design](https://github.com/CopilotKit/OpenBot/blob/main/docs/plugins/composio.md), [catalogue](https://github.com/CopilotKit/OpenBot/blob/main/server/src/plugins/catalogue.ts).
- **OAuth is product code.** The plugin OAuth module handles PKCE, sealed short-lived connection state, authorization-code exchange requiring a refresh token, and optional dynamic client registration. Those facilities live in OpenBot, rather than arriving automatically from the core `mcpServers` option. [OAuth implementation](https://github.com/CopilotKit/OpenBot/blob/main/server/src/plugins/oauth.ts).

## OpenAg implication

Reuse the pattern: a catalog describes each connector's transport, account owner, auth flow and tool grants; a runtime consumes its tools. OpenAg already has its runtime and approval gate, so adopting CopilotKit merely to get Gmail/Drive/Apple access would add a framework without removing the connector/auth work. The useful borrowing is the separation between admin enablement, person-owned accounts, per-Bot tool grants, and policy checked on each action.

No live connector acceptance, complete repository audit, hosted-plan entitlement check, or native Apple integration was verified.
