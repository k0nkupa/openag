# Codex ACP adapter (verified for OA-116)

Current execution contract (OA-402 source, not deployment): both adapters refuse native effects unconditionally. Only exact own-server tools are forwarded, using allow_once as transport acknowledgement; the daemon permission session and operation requirement decide execution/review/refusal and record independent receipts. Claude starts with native tools disabled, strict own-MCP configuration and empty setting sources. Codex uses the pinned isolated launcher, disabled native tools/hooks/features and excluded inherited MCP transports. Native asking modes remain a defensive check, not the action authority. Cached context changes on permission revisions and is reused within an unchanged revision. The mode-bypass observations below explain the retired native approach. See [permission sessions](permission-sessions.md), [execution worlds](permission-worlds.md) and [daemon confinement evidence](daemon-execution.md).

Checked 2026-10-27 with real runs on this Mac (Codex CLI 0.164.0, logged in with ChatGPT).

## Package
- `@agentclientprotocol/codex-acp` 2.3.0, bin `codex-acp` -> `dist/index.js`. Bundles `@openai/codex` ^0.164.0 and pins `@agentclientprotocol/sdk` ~2.0.2 (same SDK as the Claude adapter).
  Older name `@zed-industries/codex-acp` (0.16.0) is not used.
- Launch like the Claude adapter: `node <resolved dist/index.js>` with stdio pipes, cwd = the bot work dir.
- Env knobs: `INITIAL_AGENT_MODE` (`read-only|workspace-write|agent|agent-full-access`), `CODEX_CONFIG` (JSON merged into the session config), `NO_BROWSER`, `CODEX_PATH`, `CODEX_API_KEY`/`OPENAI_API_KEY`.

## Auth
- `authMethods`: `api-key` and `chat-gpt`. With the existing ChatGPT login, `session/new` works without an `authenticate` call.
- **The adapter can authenticate from `CODEX_API_KEY` / `OPENAI_API_KEY` in its environment.** A stray key in the daemon's env could bill an API account instead of the subscription, so the Codex profile deletes both variables from the child's env.

## Capabilities (real `initialize`)
`loadSession: true`; `sessionCapabilities`: resume, list, close, delete, fork, additionalDirectories, subagents, systemPrompt; `mcpCapabilities`: http true, sse false (so OA-115's HTTP MCP server can be passed to Codex too).

## Gotcha: the default mode bypasses the gate (same class of problem as Claude's settings)
`session/new` returns `modes.currentModeId = "agent"` ("Auto review: only ask for actions detected as potentially unsafe").
Real run, prompt "create hello.txt":
- default (`agent`): `hello.txt` created, **0 permission requests**.
- after `session/set_mode` -> `read-only`: **1 permission request** (`title "Run command"`, `kind "execute"`, `rawInput {command, cwd}`); rejected -> no file, `stopReason: "cancelled"`.

Fix (in the Codex profile, fail closed like Claude's): spawn with `INITIAL_AGENT_MODE=read-only`, and also force `read-only` through `session/set_mode` on every new/resumed session; if it is not offered or the call fails, the turn does not run. Reset any mid-turn `current_mode_update` to another mode. Safe mode id for Codex is `read-only` (not `default`).

## Permission request shape
- `toolCall`: `{ title: "Run command", kind: "execute", rawInput: { command, cwd } }`; no `name`, no `_meta` tool name. Map by `kind`, never by title:
  execute -> `codex.shell` (act-external, a shell reaches the network), edit/delete/move -> `codex.edit` (act-local),
  fetch -> `codex.fetch` (browse), search -> `codex.search` (search), read -> `codex.read` (read); anything else is `codex.<kind>` and stays strictest.
- `options`: `allow_once` (id `allow_once`), `allow_always` (id `accept_execpolicy_amendment`, **never select**), `reject_once` (id `cancel`).
- Rejecting ends the whole Codex turn (`stopReason: cancelled`); a respond/edit follow-up is sent as the next prompt in the same session, as for Claude.

## Real runs through openagd (OA-116 acceptance)
- `@codex create hello.txt`: pending `codex.shell` (act-external) approval -> accept -> `hello.txt` = `hi`; ledger message, route, turn_started, tool_call, approval_requested, approval_decided, tool_result, bot_output, turn_finished. The daemon had `OPENAI_API_KEY` set in its env on purpose; the child did not use it (scrubbed) and the ChatGPT login worked.
- `@researcher` (now `config.adapter = "codex"`, act-local/act-external denied): "use web search to find the latest Node.js release" -> Codex's **native web search ran with no permission request** (`tool_call kind "search", title "Web search"`), answered in ~16 s. In `read-only` mode Codex treats web search as a built-in read-only tool, so it cannot be gated by us. It is class `search`, which defaults to `auto` anyway, so there is no policy gap, but note it for OA-102: provider-native search results are untrusted and not interceptable.
- Seed: bot `codex` added; `researcher` defaults to the Codex adapter for fresh installs and for existing bots whose config lacks `adapter` (the live DB picks this up on the next seed, i.e. the next `scripts/install-service.sh`).
