# OpenBot connector implementation

Checked 2 November 2026 against nightly-labs/openbot main and selected source files. Source/documentation evidence only; no installed runtime acceptance.

## Architecture

OpenBot separates marketplace applications (MCP servers plus setup metadata) from built-in account connectors (services, contracts, controllers and panels). Marketplace auth kinds are `link` (OAuth), `key` (headers/env), and `local` (host setup). See [integration architecture](https://github.com/nightly-labs/openbot/blob/main/docs/architecture/integrations.md).

For remote MCP, `McpOAuth` uses the MCP SDK for discovery, dynamic client registration, PKCE and refresh. Storage is implemented in the main process with Electron safeStorage. Servers without dynamic registration can use an admin-registered sign-in app. The agent reaches an authenticated loopback proxy rather than receiving the provider's raw token. Sign-out clears local tokens and attempts remote revocation. See [OAuth provider](https://github.com/nightly-labs/openbot/blob/main/src/backend/mcp-oauth-provider.ts) and [proxy](https://github.com/nightly-labs/openbot/blob/main/src/backend/mcp-oauth-proxy.ts).

Remote sign-in can open the provider page on the user's computer and relay the callback to the executing host; grants remain on that host. This is distinct from running local Apple apps on the user's computer. [Architecture](https://github.com/nightly-labs/openbot/blob/main/docs/architecture/integrations.md#remote-sign-in-the-callback-relay).

## Apple apps

The [manifest](https://github.com/nightly-labs/openbot/blob/main/marketplace/plugin-catalog/plugins/apple-apps/plugin.json) has marketplace version `1.1.0` but starts `npx -y mcp-icloud@2.1.3` over stdio. These versions describe different things; the screenshot does not demonstrate an old package.

The manifest's `macAutomation` array names seven apps. [mac-automation.ts](https://github.com/nightly-labs/openbot/blob/main/src/main/mac-automation.ts) maps those names to fixed bundle IDs and sends `count windows` using `osascript` to trigger each macOS Automation permission prompt. An app opened for the request is then asked to quit; an already running app remains open. Each app reports granted/denied/failed separately. This proves Automation access, not a successful mailbox/calendar read or Messages Full Disk Access.

The UI and permission helper surround an existing community MCP server; OpenBot does not implement all seven app integrations itself. [Public listing](https://openbot.run/plugins/apple-apps).

## Gmail and Drive

The checked [catalogue](https://github.com/nightly-labs/openbot/blob/main/marketplace/plugin-catalog/catalog.json) has no dedicated Gmail/Drive entries. A Google Workspace implementation was added then removed in [revert 3d7328d](https://github.com/nightly-labs/openbot/commit/3d7328dbd2cda7f791d39668f4b1494c22d84366); this review did not establish why. Do not describe that removed implementation as current support.

The current [Composio listing](https://github.com/nightly-labs/openbot/blob/main/marketplace/plugin-catalog/plugins/composio/plugin.json) explicitly offers Gmail and other apps through the user's hosted Composio MCP URL plus `x-consumer-api-key`. Accounts are connected in Composio, rather than through a native OpenBot Google setup. Custom MCP servers are another route; this review did not establish every possible custom configuration.

## OpenAg fit and limits

Reuse the manifest pattern: server launch/URL, auth kind, host permissions, publisher, examples and status. Keep daemon-owned execution and the existing policy gate. Borrow permission onboarding for a pinned Apple connector; consider a generic OAuth lifecycle for remote services later. Electron-specific storage does not directly fit a Node daemon.

The checked [LICENSE](https://github.com/nightly-labs/openbot/blob/main/LICENSE) is **PolyForm Noncommercial 1.0.0**, not MIT. Treat it as an architecture reference; do not assume permissive code reuse. Third-party MCP packages have separate licenses.

No install, sign-in, permission grant, test suite, launchd validation or complete security audit was performed.
