# Nightly OpenBot remote sign-in and HTTPS comparison

Historical comparison checked 3 November 2026 against OpenBot `main` and OpenAg deployment/source baseline `7596c94`, before OA-367. No network configuration changed. The subsequent approved hosted/private route design is implemented locally in [OA-367](one-click-composio.md); that source has not been deployed. References to the deployed OpenAg flow below describe baseline `7596c94`, not OA-367.

## Finding

OpenBot can feel as if HTTPS is automatic because its hosted account and remote-connection service already provides the public HTTPS/WSS endpoints. It does **not** turn a user's local host HTTP address into an HTTPS OAuth callback.

For URL MCP OAuth on a joined server, OpenBot uses a different pattern: the browser returns to a loopback address on the user's own computer, and the signed-in native OpenBot client relays that query over its authenticated Team channel to the host. The host then completes the flow and retains the grant. Its browser client cannot run that loopback listener, so its documented path is paste-only. This avoids a provider callback directly into the host and therefore needs no public/Tailscale HTTPS callback for that particular native-client flow.

OpenAg's deployed flow is intentionally different: browser-only and phone usable. It completes at a server callback, then returns the browser to its original trusted desk. For that model, an OAuth provider-compatible HTTPS callback is still needed; the existing HTTP Tailscale desk remains usable as the desk address.

## Evidence

- OpenBot says that a joined-server browser callback targets `http://127.0.0.1:<port>` on the user's computer, and the client sends the callback query to the host: [current integration guide](https://github.com/nightly-labs/openbot/blob/main/docs/architecture/integrations.md#remote-sign-in-the-callback-relay).
- Its sequence explicitly has the client listen locally, opens an HTTPS sign-in page, then relays the loopback query; the browser client is listed as “paste only”: [relay sequence and parts](https://github.com/nightly-labs/openbot/blob/main/docs/architecture/integrations.md#sequence).
- Its normal web client is served from OpenBot's own account service and uses an authenticated host connection; provider and permission controls remain desktop-only: [web client limits](https://github.com/nightly-labs/openbot/blob/main/docs/web-client.md#behavior-and-limits).
- Self-hosting its remote account/signal layer is not automatic local HTTPS: its guide requires a Cloudflare domain, public server, custom HTTPS/WSS host names, and a DNS API token for certificate operations: [self-hosted remote access](https://github.com/nightly-labs/openbot/blob/main/docs/self-hosting.md#what-you-need), [Signal/TURN configuration](https://github.com/nightly-labs/openbot/blob/main/docs/self-hosting.md#3-start-signal-and-turn).

## Limit

This confirms OpenBot's documented relay and hosted-service architecture, not Composio's redirect registration policy. It does not prove that a raw HTTP Tailscale IP is accepted as a Composio OAuth redirect URI.
