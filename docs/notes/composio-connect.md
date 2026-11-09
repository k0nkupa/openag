# Composio OAuth connection — source verification

Owner approved implementation on 2 November 2026, with no deployment or live account changes. Scope is one daemon-wide optional Composio connection, app-library controls, retained legacy bridge and existing policy/receipt behavior.

## Provider and package findings

Read-only provider discovery on 2 November 2026 returned:

- `https://connect.composio.dev/mcp` returns 401 without credentials and advertises `/.well-known/oauth-protected-resource`.
- Resource metadata identifies `https://connect.composio.dev/mcp` and authorization server `https://connect.composio.dev`.
- Authorization metadata identifies issuer `https://connect.composio.dev`, authorize endpoint `https://connect.composio.dev/oauth/authorize`, token endpoint `https://login.composio.dev/oauth2/token`, and registration endpoint `https://login.composio.dev/oauth2/register`.
- Public client authentication (`none`), authorization-code and refresh-token grants, and PKCE `S256` are advertised. No revocation endpoint was advertised.

References: [Composio Connect](https://docs.composio.dev/docs/composio-connect), [official MCP README](https://github.com/ComposioHQ/GHMCP). The provider recommends SDK/session endpoints for application builders; OpenAg acts as an MCP client here. Registration/callback acceptance by a real provider remains unverified. No registration, token request or live account operation was performed against Composio.

The lockfile-resolved `@modelcontextprotocol/sdk@1.32.2` was inspected locally after `pnpm install --frozen-lockfile --ignore-scripts`. Its `OAuthClientProvider`, `auth`, issuer-bound token storage and Streamable HTTP transport are reused. The transport's automatic auth recovery can resend a request, so the managed tool connection deliberately does not supply its `authProvider`. A guarded fetch obtains/refreshed credentials before each request; 401/403 stops without resending. SDK OAuth recovery is also stopped on invalid credentials, rather than silently registering another client in background work.

## Code and verification seams

- `composio-connect.ts`: fixed endpoints, SDK OAuth, credential persistence, flow lifecycle and guarded transport. `mcp.ts`: reserved managed id, tool discovery/schema conversion, existing execution wrapping and policy defaults. `main.ts`: explicit inclusion in scoped ACP tools as well as existing API/Ollama paths; ordinary administrator MCP servers retain their exposure rules.
- `connector-credentials.ts`: the Google store extracted for its second consumer; Google filename and authenticated encryption context are preserved. An independently constructed legacy Google ciphertext is verified for compatibility.
- `verify-composio-connect.mjs`: actual SDK OAuth/MCP client and server transport, temporary encrypted files/SQLite/gateway and runner. Controlled fetch never reaches a real service. Exercises PKCE, state/device/expiry/replay, refresh/restart, strict tool input, redaction, owner/full/limited access, a real approval before execution, unattended denial, scoped ACP calls through the actual runner gate, disconnect/exchange and refresh races, unsafe endpoint/file refusal, opaque ID-token redaction and reserved id protection. A held action on another MCP server and unchanged connection/close counters prove targeted Composio recovery leaves unrelated connections intact. The runner correctly keeps an unconfirmed external result Unknown.
- `verify-composio-desk.mjs`: actual React access and shared OAuth-return components with real context providers in a standalone DOM fixture. Checks setup/limited-device handling, invalid authorization URL refusal, reconnect/disconnect confirmation, cancellation, query/history cleanup and a single exchange under StrictMode for both Google and Composio. This establishes DOM behavior, not layout or physical-device acceptance.

Operational behavior, setup, privacy and recovery are authoritative in [docs/composio.md](../composio.md). Packaged help links to it rather than duplicating setup details. The shared knowledge fixture verifies updated Composio help reaches API, Ollama and cached ACP/default-bot paths.

## Results

Passed source checks:

- `pnpm -r build` and `pnpm --filter daemon exec tsc --noEmit`.
- `node scripts/verify-composio-connect.mjs` and `node scripts/verify-composio-desk.mjs`.
- `node scripts/verify-google-connectors.mjs`, `node scripts/verify-app-library.mjs`, `node scripts/verify-integration-setup.mjs` and `node scripts/verify-connectors.mjs`.
- `node scripts/verify-bot-knowledge.mjs` and `node scripts/verify-capabilities.mjs`; current Composio help reached controlled API, Ollama and cached ACP/default-bot sessions.
- Local read-only Standards and Spec reviews cleared their findings after adding ID-token redaction and targeted Composio reload. Built-in `codex review --uncommitted` reviewed the complete staged/unstaged change against base `c0ab6034f6dff958968170cf23d0fa2d3b47e892` and found no actionable defects; its independent daemon/desk TypeScript checks also passed. No merge or publication was performed.

The existing desk bundle-size warning remains. No unit/Jest/Vitest runner, deployment or live account mutation is authorized. Browser inventory reports `Local browser use is disabled in Work settings`; desktop/phone visual acceptance remains unverified. No browser settings were changed or alternate path used to bypass that restriction.

## Subsequent owner-authorized deployment

On 2 November 2026 the owner authorized merging PR #1, updating the canonical local checkout and deploying. Remote main merge `31a88c1` was integrated with the seven existing local desk commits as `6fbc6c8`, preserving the deployed Inbox/styling changes. The documentation conflict retained the deployed Inbox OA-357 and renumbered the Composio ticket OA-359 (formerly OA-357). Full canonical build and focused review-fixes/Composio/Google/Inbox/help checks passed. The existing launchd job was restarted without replacing its plist or integration configuration. Live health/auth/read-only API/static-byte checks passed; schema 23 and historical rows were preserved. Composio remained unconfigured; no registration, OAuth consent or provider account operation was attempted. See sanitized deployment evidence. Visual/physical-device acceptance is still unverified.

## Managed onboarding follow-up (OA-365 (formerly OA-363))

The approved follow-up generates/preserves the connector encryption key and derives callbacks from the installation's trusted app address or actual local loopback. It preserves legacy keys, ciphertext, callback registrations, owner/device access and tool policy. See [managed-onboarding verification](managed-onboarding-verification.md) for current source checks and limits; earlier setup/results above describe the initial OAuth implementation. Authoritative operational guidance remains docs/composio.md.
