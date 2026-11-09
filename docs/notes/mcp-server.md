# openagd as an MCP server for ACP bots (verified for OA-115 with REAL Claude Code and Codex runs, 2026-10-27)

Experiment: a minimal MCP server (SDK 1.32.2 `McpServer` + `WebStandardStreamableHTTPServerTransport`, stateless,
`enableJsonResponse`, served by `@hono/node-server`) with one tool `slow_echo(text, delaySec)`, handed to a real ACP session via
`session/new { mcpServers: [{ type: "http", name: "openag", url, headers: [{ name: "Authorization", value: "Bearer ..." }] }] }`.

## What both adapters do
- Both advertise `mcpCapabilities.http: true`; the `Authorization` header we set reaches our server unchanged on every request.
- The model finds and calls the tool by itself. Claude names it `mcp__openag__slow_echo`, Codex `mcp.openag.slow_echo`.
- **The SDK request handler never receives an abort signal when a client gives up** (stateless JSON mode): the server cannot learn that
  the caller left, so the daemon must bound its own approval wait and expire the approval itself.

## Claude Code adapter (default mode, settingSources [])
- A permission request IS raised for the MCP tool: `toolCall.name = title = _meta.claudeCode.toolName = "mcp__openag__slow_echo"`, `kind: "other"`,
  `rawInput = { text, delaySec }`, and `_meta.claudeCode.mcpServer = { name: "openag", source: "dynamic" }`
  (`dynamic` = the server was supplied by the ACP client, not by user settings). Options: allow_once `allow-once`, allow_always `allow-with-updates`, reject_once `reject`.
- **Timeout:** with the default environment a 100 s tool call FAILED at ~60 s (turn ended after 67 s). With `MCP_TOOL_TIMEOUT=600000` in the adapter's
  environment the same 100 s call completed. We control the adapter env, so the Claude profile sets `MCP_TOOL_TIMEOUT=1200000` (20 min).
- Claude may call a `ToolSearch` tool first to load deferred tool schemas (no permission request for it).

## Codex adapter (`read-only` mode)
- A permission request IS raised, but its `toolCall` is only `{ toolCallId, kind: "execute", status: "pending" }`: **no title, no name, no rawInput**, i.e. the
  same shape as a shell command. Options: allow_once `allow_once`, allow_always `allow_session`, allow_always `allow_always`, reject_once `cancel`.
- The tool's identity is in the PRECEDING `tool_call` session update with the same `toolCallId`: `title: "mcp.openag.slow_echo"`, `kind: "execute"`,
  `rawInput: { server: "openag", tool: "slow_echo", arguments: {...} }`. The ACP runtime must remember `tool_call` updates and merge them into permission requests.
- **Timeout:** 3 s, 75 s, 100 s and 190 s calls all completed with the default configuration (no limit hit up to 190 s).

## Design consequences
- The MCP server is the AUTHORITATIVE gate (it asks/denies itself); the ACP-side handler auto-allows only calls recognised as OUR `openag` server
  (Claude: `_meta.claudeCode.mcpServer.name === "openag" && source === "dynamic"`; Codex: correlated `title` starts `mcp.openag.` and `rawInput.server === "openag"`).
  The id `openag` is reserved in `mcp.json`, and the daemon registers its own server under an unguessable per-connection name (`openag-<16 hex>`) that both matchers compare against exactly, so a server configured under any other name (even `openag`) is never auto-allowed.
- Tool identity preserves case across both adapters. Recognisers accept `A-Z`, `a-z`, digits, `_`, `.` and `-`, matching the names the daemon exposes, including generic MCP connector names. Exact membership in the current offered-tool allow-list is still required. This rule does not change App manifest naming restrictions or grant new tools to an agent.
- Claude presents punctuation in tool names as underscores. The installed Claude SDK replaces `[^a-zA-Z0-9_-]` with `_`; the real adapter presents `mcp.example.READ_ITEMS` as `mcp_example_READ_ITEMS`. After verifying the exact per-connection server and `dynamic` source, OpenAg matches that suffix against the current catalogue's canonical names and their Claude spellings. A single match reaches the usual daemon gate. Multiple matches are refused before approval or execution, including a dotted name colliding with an exact underscore name. There is no exact-name preference or underscore-to-dot guessing. Unmodified canonical suffixes from older adapters remain supported when unambiguous. Codex retains exact-name matching.
- The ACP allow-list and MCP server use the same enabled-tool-definition supplier. Disabled tools cannot create false collisions with active tools. Claude resolution is recomputed for each permission request, so current Apps/connectors and their collisions are considered without a stale alias cache. The daemon executes, approves and records only the original canonical name; adapter spellings are never stored as replacement tool identities.
- Forwarding one tool action through ACP and the daemon's MCP server must not create a second approval. Only the adapter's forwarding permission is allowed automatically; the daemon still asks or denies under its normal policy. Previously the lowercase-only recognisers misclassified uppercase connector tools as native tools; after approval, the outer running action blocked the inner call and left an unknown receipt.

## Names of forwarded desk-managed servers (OA-454, 4 November 2026)

Custom MCP servers added from the desk are forwarded under `mcp.<server>.<tool>` like the Apple and Composio connections. The installed Claude SDK (0.3.310, `sdk.mjs`) only rewrites characters (`[^a-zA-Z0-9_-]` becomes `_`); no length rule is in its JavaScript, and a limit enforced by the bundled native binary or the API cannot be read here. OpenAg therefore adds no length cap: real Claude and Codex runs of the Composio connection (OA-390/OA-391) already carry adapter names of 70 to 80 characters (`mcp__openag-<16 hex>__mcp_composio-connect_COMPOSIO_MULTI_EXECUTE_TOOL`). A real long-named custom tool is still part of the final real-adapter journey.

## Controlled tool-identity acceptance (3 November 2026)

`node scripts/verify-acp-tool-identity.mjs` drives controlled Codex and Claude ACP permission requests through the real runtime, MCP server, policy gate and receipts using temporary databases and loopback HTTP. It checks exact names and execution counts for uppercase, mixed-case, lowercase and App-shaped names; acceptance, Ignore and policy Deny; foreign, missing, unoffered, wrong-case and non-dynamic identities; Claude's observed underscore spelling, both collision shapes and legacy raw suffixes. No provider connection, real CLI or live data is used in this mode.

`node scripts/verify-acp-tool-identity.mjs --real` explicitly uses the real subscription adapters with the same local fixture tools and temporary data. It checks uppercase, mixed-case and App-shaped actions plus collision handling for both adapters, completed receipts and the marker returned to the model. It never contacts a mailbox or integration provider. These checks do not deploy the application or repair existing unknown receipts.

OA-375 results: 30 controlled flows and eight real-adapter flows passed. The real fixture permits discovery of its local tools, accepts only the exact requested canonical action and treats a missing or wrong-name call as a failure. Claude's collision is refused without an approval, execution or action receipt; Codex can still call the exact underscore name when the dotted name is also offered. Workspace build (relay dry-run), daemon type check, packaged bot-knowledge delivery, capability catalogue, receipt regressions and source reviews passed. No unit runners or live installation changes were used.

## Bounds and residual risks

- Approval waits are bounded per adapter (Claude 10 min, Codex 3 min; the Claude CLI's `MCP_TOOL_TIMEOUT` is forced above that). A pending approval is expired when the wait bound fires, the HTTP caller disconnects, or the turn ends; on daemon shutdown it is left pending so it survives the restart. Expiry is logged with actor `daemon`.
- The scoped `oagt_` token is passed to the adapter in `session/new` (Claude's CLI receives it in its argv, readable by the same OS user). It is per (bot, room), valid only during that pair's active turn, revoked when the connection closes, and every call still goes through that bot's own tool modes. Anything running as the daemon's user could already read the DB, so this is not a new boundary, but it is the reason the token is short-lived.
- The server bounds its own approval wait (default 10 min, below Claude's 20 min client timeout) and EXPIRES the approval if it passes, so nothing can run after the caller gave up.
- The token handed to the adapter is scoped to (bot, room), only valid while that pair has an ACTIVE turn, and is accepted on `/mcp` only.

Shared remote invocation, server-input review, catalogue validation and evidence behavior are documented in [MCP lifecycle](mcp-lifecycle.md). These rules apply across integrations; answering server input does not approve another tool or confirm a write. Task-only tools remain unavailable, and interrupted calls are never replayed automatically.

## Object-union inputs

The scoped tool catalogue serializes the full input schema with its required object root. It preserves object-union branches and optional defaults when forwarding integrations to Claude and Codex. The SDK high-level listing otherwise replaces a non-object Zod union with an empty object schema. Registration still validates the original Zod input and execution still passes through the normal daemon gate.
