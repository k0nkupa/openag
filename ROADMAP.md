# OpenAg Roadmap

This replaces the former internal ticket queue. It summarises what has shipped, what is still open, and ideas deliberately kept out of scope. Product concepts are in [docs/openag.md](docs/openag.md); feature behaviour is in [docs/notes/](docs/notes/).

Ticket IDs are not unique across campaigns. Some IDs were reused (for example OA-390, OA-398 to OA-403, OA-454 to OA-457). Treat an ID plus its title as the identity.

## Shipped

### Phase 1: spine
- Single daemon (`openagd`) with SQLite (WAL) and sqlite-vec; numbered migrations.
- Append-only ledger per room, rooms, bots and addressing (`@name`, `@everyone`, room lead).
- Policy gate: every tool call goes through `ctx.callTool` to auto, ask or deny; approvals pause the turn.
- REST and WebSocket gateway; bare web desk; macOS launchd service installer.
- Restart survival: in-flight turns are marked interrupted and can resume after approval.

### Phase 2: MVP
- Multi-bot routing (boss and specialists); Claude Code and Codex bots over ACP.
- Redaction of secrets before ledger, approval, turn-state and log writes.
- Per-bot `MEMORY.md` plus vector memory; permission modes (Read Only / Workspace Write / Full access).
- Desk v1; device pairing with single-use codes and per-device `oag_` tokens.
- Scheduler, heartbeat, wake filter, morning brief, cron automations, ntfy push.
- MCP client and openagd as an MCP server; Cua managed computer with tools and human takeover.

### Phase 3: v1 capabilities
- Nightly reflection (validated proposals; skill drafts still need approval).
- Skills (versioned agent-owned SKILL.md files, shared read-only library with assignments).
- Webhook automations with a Cloudflare Tunnel for `/hooks/*`; GitHub and Slack event triggers; ambient watchers.
- Computer backends: Browserbase, optional local Docker, VPS/SSH.
- First-party Apps SDK; optional Composio bridge; room router; Ollama chat bots.
- Slack channel (Socket Mode, one channel, allow-listed users); WebRTC peer service (daemon side, flagged off).

### Phase 4: hardening and always-on operations
- Turn watchdog, adapter stall diagnostics, approval source tags, Slack liveness.
- Daily verified SQLite backups; turn budget; liveness ping; log rotation; keep-awake; readiness checklist.

### Desk, integrations and safety campaigns
- Native shadcn/base-nova desk: shell, conversations, Work records, approvals, receipts, Settings pages, Devices page.
- Permission sessions replace category settings; permission confinement proven through both ACP adapters.
- Remote MCP servers managed from the desk (HTTP with env references, direct secrets, stdio with command review, generic OAuth).
- Read/search connectors: Apple Mail and Calendar (read-only), Google Gmail and Drive read/search, connector cards with evidence-based status.
- Composio browser sign-in through hosted or private callback routes.
- Model catalogue with capability discovery; Ollama switching; composer dictation; hosted-model continuity and bounded execution.
- Request provenance across hosted and ACP runtimes; tool execution reliability contract; ACP permission and instruction delivery.
- Room membership and layout; direct one-to-one chats; new bot and new room flows; default bot; conversation delivery model.

## Open

Unticked items in the former queue. Each needs its own acceptance before it is marked done.

**Conversation and chat**
- OA-477 Handle questions and decisions directly in chat (removes the "Needs you" queue).
- OA-476 Reply to a specific chat message.
- OA-466 Reduce conversation rendering and typing work.
- OA-427 Show an available file-drop target.

**Receipts, approvals and provider prompts**
- OA-475 Isolate uncertain action conflicts across conversations.
- OA-474 Separate MCP invocation results from effect verification.
- OA-473 Show provider response forms in chat and notify the owner.
- OA-469 Remove manual receipt inspection and its blocking workflow.
- OA-395 Complete reviewed read-only Composio batches instead of leaving Unknown receipts.

**Identity and avatars**
- OA-460 Change the user name and avatar.
- OA-462 Upload and adjust a user profile image.
- OA-390 Replace agent avatars with Open Bot Avatar (ID reused; the Composio entry under OA-390 is shipped).

**Memory, models and routing**
- OA-459 Save reflection memory automatically.
- OA-335 Bot adapter switching and model selection.
- OA-347 Default bot management tools (design first).

**Connectors and settings**
- OA-354 Live connector acceptance (needs separate authority and a disposable target).
- OA-330 Settings integration, branded providers and final flow verification.

**Channels and remote access**
- OA-215 GitHub polling trigger without a tunnel (the code exists; ticket not closed).
- OA-306 Desk WebRTC transport and pairing.
- OA-307 TURN and reconnect for WebRTC.

**Deferred**
- OA-440 Investigate LFM3 tool-result generation, only if the model is reprioritised.

## Parking lot

Ideas kept out of scope on purpose:
- Native phone app (the desk PWA comes first).
- Multi-box computer pools or parallel sandboxes per bot.
- Public App marketplace and code signing.
- Replacing the ACP CLIs with a custom agent loop.
- Making Composio a required dependency.
- Proactive pings that bypass the wake filter.
- A second SQLite database or a client-side database. The daemon owns the only one.

Known issue: the Claude adapter once stalled under the launchd service (cause unknown; it has not recurred). Stall watchdog (OA-301) and adapter diagnostics (OA-302) are in place; the manual reproduction step of OA-302 is still pending.
