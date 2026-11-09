# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.5.x   | Yes       |
| < 0.5   | No        |

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub Security Advisories: on the repository page, choose **Security** then **Report a vulnerability**. Include the affected version or commit, the steps to reproduce, and the impact you expect. Redact any real tokens, device credentials or private data from logs you attach.

Please give the maintainers a reasonable window to fix the issue before public disclosure.

## Scope

In scope: the `openagd` daemon (`apps/daemon`), the web desk (`apps/desk`), the Cloudflare sign-in relay (`apps/signin-relay`), the installer scripts, and the default configuration.

Out of scope: vulnerabilities in third-party agent runtimes (Claude Code, Codex, Ollama), provider APIs, Cua, Browserbase, Composio or other external services. Report those to their maintainers. Issues that require an attacker who already holds the owner credential or an authorised Full-access device are generally treated as expected behaviour, but still report them if the boundary you expected is not enforced.

## Threat model summary

OpenAg is a personal agent daemon. It runs agents that can read files, run shell commands, use the network and call external tools, so its controls are about limiting what an agent may do and proving what it did.

Key controls, which the code and `AGENTS.md` describe in detail:

- **Single policy gate.** Every tool call goes through one gate (`ctx.callTool`) that resolves to execute, review or refuse. Runtimes do not call tools directly. Unknown tools are classified `act-external` and need explicit review.
- **Permission sessions.** Read Only, Workspace Write and Full access, with Never refusing explicit review. The daemon enforces filesystem writes where the mode supports it.
- **Approvals.** Actions that need review pause the turn until an explicit decision in its conversation. Pending approvals are stored in the database and expire.
- **Redaction.** Secrets are redacted before writes to the ledger, approvals, turn state, memory and adapter logs. Bot processes do not inherit owner secrets or provider API keys.
- **Owner and device access.** The owner credential is a mode-600 file. Browsers and phones use per-device tokens stored only as SHA-256 hashes. Devices are added with single-use, short-lived pairing codes. Owner-only routes refuse limited devices.
- **Unauthenticated routes.** Only a few routes are reachable without a token: `GET /health`, `POST /pair` (pairing, rate limited, small body cap), `POST /hooks/:slug` (automation ingress, signature or secret verified over the raw body, identical 401 responses) and `GET /composio-connect` (OAuth callback, single-use state that only completes an already authorised attempt). Everything else requires a Bearer token or a device session.
- **Remote MCP and OAuth.** Remote MCP servers must use https. Private and metadata addresses are blocked unless opted in per entry. OAuth state is single-use and device-bound.
- **Hosted relay.** The sign-in relay stores only short-lived sealed callback codes. It does not hold PKCE verifiers or provider tokens.

## Known limits

- **The daemon speaks plain HTTP.** It listens on `127.0.0.1` by default. `OPENAG_HOST=0.0.0.0` exposes it to your LAN; use that only on a trusted network, or reach it over Tailscale with HTTPS instead. Do not expose the port directly to the internet.
- **Full access runs with the daemon user's privileges.** An agent in Full access can act on the machine as that user. Use Workspace Write or Read Only for agents that do not need that.
- **Installed Apps and MCP servers run code.** Approvals and process isolation limit what they get, but they do not sandbox installed code.
- **Remote computer input cannot enforce the host filesystem boundary.** Computer backends that accept remote input are unavailable in confined permission modes.
- **Provider and runtime behaviour is outside our control.** We do not verify provider-side data handling.
