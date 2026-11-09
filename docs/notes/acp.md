# ACP (Agent Client Protocol) packages and Claude Code adapter (verified for OA-009)

Current execution contract (OA-402 source, not deployment): both adapters refuse native effects unconditionally. Only exact own-server tools are forwarded, using allow_once as transport acknowledgement; the daemon permission session and operation requirement decide execution/review/refusal and record independent receipts. Claude starts with native tools disabled, strict own-MCP configuration and empty setting sources. Codex uses the pinned isolated launcher, disabled native tools/hooks/features and excluded inherited MCP transports. Native asking modes remain a defensive check, not the action authority. Cached context changes on permission revisions and is reused within an unchanged revision. The mode-bypass observations below explain the retired native approach. See [permission sessions](permission-sessions.md), [execution worlds](permission-worlds.md) and [daemon confinement evidence](daemon-execution.md).

Checked on 2026-10-27 against npm and by running the real adapter's `initialize`.

## Effective permissions and native execution

The runner supplies `permissionGuidance` on every ordinary ACP turn, for Claude and Codex, including reused sessions. It describes the effective daemon filesystem boundary and approval policy after inherited restrictions. Native execution remains disabled independently. A native read-only setting alone is not evidence that an offered daemon tool cannot write. Authorized commands and file changes use the appropriate offered OpenAg tool; the daemon gate and execution result determine what can run and what happened. A daemon refusal is not permission to switch channels, lift native restrictions or bypass controls.

Changing a permission revision still replaces cached ACP context. Guidance changes reach subsequent turns without requiring the owner to change the mode. Full access does not remove offline, unattended, isolation, takeover or uncertainty restrictions. Runtime guidance communicates authority; it never grants it.

### Trusted session instructions (OA-464 source)

Both pinned adapters advertise append-only-compatible session `systemPrompt` support on the SDK unstable-v1 interface. OpenAg uses that supported interface for its client, types and directly connected controlled peers. Missing support stops setup before a prompt. The static daemon-owned execution contract is appended on new and resumed sessions; it requires exact offered MCP identities rather than invented native aliases, and it never contains user messages, skill contents, tool results or per-turn permission grants. Conflicting legacy/SDK Claude prompt carriers are refused. Native modes, disabled tools, inherited-MCP exclusions and the daemon gate are unchanged.

The bridge text has a SHA-256 version saved with each ACP turn. Matching persisted context can resume; missing/changed bridge versions and changed permission context use fresh sessions. Unchanged in-memory sessions remain reusable. A failed matching resume is reported as a failure; it does not silently start another session. This avoids treating a fresh history replay as successful native resume, or relying on Claude to apply changed resumed instructions before compaction. Current effective permissions and unattended/offline/isolation limits continue to arrive per turn and are enforced at daemon dispatch.

Standalone acceptance: `verify-acp-permission-context.mjs` captures real installed adapters against loopback model endpoints and checks privileged placement, user separation and native tool exclusion. Claude's separate title request is excluded from the main-turn capture. `verify-acp-instruction-lifecycle.mjs` checks the runner/SDK lifecycle with controlled peers. `verify-acp-skill-install.mjs --real` uses actual subscription adapters and production daemon tools against disposable data, including the actual Accredo package as unchanged read-only input. Source instructions, managed metadata, all bundled resource bytes, catalogue discovery/loading and installed-reference reads must agree. These checks establish their recorded scope only; see the ticket Log for results. No deployment is implied. Research and versioned primary sources: [ACP contract research](acp-permission-contract-research.md).

OA-464 final local acceptance passed for both pinned adapters, including complete Accredo managed installation and actual reference reads in fresh/reused/resumed sessions. Controlled compatibility failures and the real native/filesystem negatives also passed. Exact IDs, source/resource checks, known earlier failures and review scope are recorded in [session instruction evidence](permission-modes/acp-session-instructions.json). These results do not establish deployment or an installed default-bot skill change.

### OA-458 verification scope

The disposable gateway/runner/MCP journey uses the production command tool, guarded to one exact local command per request. Successful copy/read requests name no tool; the adapters select the daemon route themselves. A completed earlier turn supplies the reported mistaken read-only reply, and an assertion verifies that reply is eligible for selected history. Copies check exact target contents and the unchanged source; reads check returned contents and the bot answer. Receipts must match actual outcomes. Unchanged revisions must reuse sessions; changed revisions must replace them. Separate explicit boundary probes check refused writes; a native-only negative must create no file or daemon fallback, and inherited MCP fixtures must never start.

The clean Codex Sol baseline passed before the guidance change, so this is not a claim that every model/session reproduces the reported refusal. Final adapter coverage and review results are recorded in the OA-458 ticket Log and [sanitized evidence](permission-modes/acp-permission-guidance.json). These are local source and disposable subscription-adapter checks, not deployment, live skill installation, managed skill-writer acceptance or business-provider acceptance.

## Packages (names changed from older docs/blog posts)
| Role | Package | Version |
|---|---|---|
| TypeScript SDK (client + agent sides) | `@agentclientprotocol/sdk` | 2.0.2 |
| Claude Code adapter | `@agentclientprotocol/claude-agent-acp` | 0.97.0 (bin `claude-agent-acp` -> `dist/index.js`) |

Old names to avoid: `@zed-industries/agent-client-protocol` (0.4.5), `@zed-industries/claude-code-acp` (0.16.2).
The adapter pins the same `@agentclientprotocol/sdk` 2.0.2 and uses `@anthropic-ai/claude-agent-sdk`.

## SDK API (default entry = stable ACP v1; `experimental/v2` entries exist, not used)
- `client({ name }).onRequest(methods.client.session.requestPermission, ({ params }) => ...)` registers client handlers.
- `app.connect(stream)` returns `{ agent: ClientContext, close(), closed, signal }`. `app.connect(agentApp)` connects
  in-process to a fake `agent()` (used in tests, no subprocess).
- `ndJsonStream(WritableStream, ReadableStream)`; with a child process use `Writable.toWeb(child.stdin)` and
  `Readable.toWeb(child.stdout)`.
- `agent.request(methods.agent.initialize, { protocolVersion: 1, clientCapabilities: {} })`.
- `agent.buildSession(absCwd).start()` -> `ActiveSession` with `prompt(text)` and `nextUpdate()`
  (`{kind:'session_update', update}` ... then `{kind:'stop', stopReason}`).
- Permission request: `{ sessionId, toolCall: ToolCallUpdate, options: PermissionOption[] }`;
  response `{ outcome: { outcome: 'selected', optionId } | { outcome: 'cancelled' } }`.
  Option kinds: `allow_once | allow_always | reject_once | reject_always`.
- Session updates used: `agent_message_chunk`, `tool_call`, `tool_call_update` (status `pending|in_progress|completed|failed`).

## Launch
`node <resolved path to @agentclientprotocol/claude-agent-acp/dist/index.js>` with stdio pipes (resolved with
`createRequire(import.meta.url).resolve('.../package.json')` so it works under pnpm). cwd = the bot's work dir
`$OPENAG_DATA/bots/<id>/work/`. Environment is inherited so the adapter can use the machine's existing Claude login.

## Load / resume support (real `initialize` response)
- `agentCapabilities.loadSession: true`
- `agentCapabilities.sessionCapabilities`: `resume`, `list`, `close`, `delete`, `fork`, `additionalDirectories`
- `authMethods: []` (no ACP-level auth step; relies on the local Claude login / env)
=> OA-010 can resume an interrupted session with `session/resume` (or `session/load`) instead of re-running the turn,
   falling back to re-run with a one-time pregrant if resume fails.

## Gotcha: the CLI's own permission engine bypasses the gate (found in the OA-009 manual run)
First real run created `hello.txt` with no approval: the adapter loaded the machine's
`~/.claude/settings.json` (`permissions.defaultMode: "auto"` plus a large `allow` list), so Claude Code approved the
`Write` itself and never sent `session/request_permission`. The gate only sees what the CLI chooses to ask.

Fix (in `runtimes/acp.ts`, fail closed):
- `session/new` carries `_meta.claudeCode.options.settingSources: []`, so user/project/local settings and allow rules are not loaded.
- After start, if `modes.currentModeId !== "default"`, call `session/set_mode` -> `default`. If `default` is not offered or
  the call fails, the turn fails and nothing runs. A mid-turn `current_mode_update` to another mode is reset.
- Only `allow_once` options are ever selected, so "always allow" can't be granted by us.
Residual risk: other adapters (Codex, OA-116) need the same check; verify their equivalent of settings/modes.
## Conversation continuity

Input-pause status and bounded ledger restoration for fresh sessions are described in [the conversation model](conversation-model.md#input-pauses-and-acp-continuity-oa-377). Adapter cancellation used to pause for input does not cancel the owner's request.

The trusted session instruction bridge prefers daemon read_file/list_files/search_files over shell inspection and explains scoped receipt conflicts. Its content hash replaces incompatible cached/resumed context. Both adapters retain disabled native execution. A new chat is not itself proof of an independent write target; shared daemon authorization and dispatch decide that. See [daemon execution](daemon-execution.md#bounded-inspection-and-conflict-scope).
