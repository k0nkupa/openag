# Changelog

All notable changes to OpenAg are recorded here. Versions follow [Semantic Versioning](https://semver.org); before 1.0, minor versions may change interfaces.

## 0.5.0 — first public release

OpenAg is a self-hosted, always-on desk for AI agents: one daemon (`openagd`) and a web desk, running on your own Mac.

### Agents and models
- Claude Code and Codex agents over ACP, using the unmodified CLIs and your existing sign-in.
- API agents through Mastra (OpenAI, Anthropic, OpenRouter) and local Ollama chat models.
- A default agent created on first start; per-agent model and reasoning selection with capability discovery.
- Direct chats, shared rooms with a lead, `@mentions`, `@everyone` and delegation between agents.

### Permissions and safety
- One daemon-owned permission gate for every tool call, across all agents and runtimes.
- Permission modes: Read Only, Workspace Write (default for new installs) and Full access. Reviews happen in the originating conversation.
- The CLIs' native tools are disabled; agents reach OpenAg tools through a scoped MCP server.
- Secrets are redacted from the database, ledger, approvals, turn state and logs. Device tokens are stored as hashes.
- Scheduled runs cannot use approval-gated tools unless allowed per automation; webhook and GitHub-triggered runs are isolated.

### Memory and proactive work
- Per-agent `MEMORY.md` with vector search (sqlite-vec) and versioned skills.
- Optional nightly reflection that saves memory notes; skill drafts need approval.
- Heartbeat with a worth-waking filter (deduplication, active hours, urgency, daily budget) and a morning brief.
- Cron automations, verified webhooks, GitHub polling and an optional Slack channel.

### Computer use
- A managed Cua sandbox with screenshots, input and shell tools, plus human takeover.
- Optional Browserbase, Docker and SSH backends.

### Tools and connectors
- MCP client: local commands with owner review and hash pinning, remote HTTP servers with SSRF protection, stored secrets and OAuth sign-in.
- Owner-installed Apps; optional Composio bridge with browser sign-in.
- Read-only Apple Mail and Calendar, and Google Gmail and Drive read/search connectors.

### Devices and operations
- Responsive web desk, device pairing with single-use codes, Full and limited device access, revocation.
- Push notifications through ntfy; Tailscale access; optional WebRTC peer service (off by default).
- launchd service installer, daily verified SQLite backups, turn watchdog, readiness checklist.

### Changes for existing installs
- **The daemon now listens on `127.0.0.1` by default.** Set `OPENAG_HOST=0.0.0.0` (and re-run `scripts/install-service.sh` for the service) to keep LAN or direct tailnet-IP access. Access through `tailscale serve` works without it.
- **There is no built-in sign-in relay.** Composio and remote-MCP browser sign-in use a private Tailscale callback, or a relay you deploy yourself and set with `OPENAG_SIGNIN_RELAY_URL` ([guide](docs/signin-relay.md)). An invalid relay URL now stops the daemon at startup.

### Known limits
- macOS only; Linux and Windows are untested.
- The daemon speaks plain HTTP; use Tailscale or a trusted network for other devices.
- The sign-in relay accepts callbacks only from Composio; custom remote MCP servers must use the Tailscale route.
- Real provider acceptance for connectors is recorded per connector; see [ROADMAP.md](ROADMAP.md) for open items.
