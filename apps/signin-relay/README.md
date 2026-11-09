# signin-relay

Optional Cloudflare Worker that receives Composio and remote MCP OAuth callbacks for an OpenAg daemon that has no Tailscale route, and stores them encrypted for the daemon to collect. OpenAg does not run one for you.

- Deploy and operate it: [docs/signin-relay.md](../../docs/signin-relay.md)
- Design and security properties: [docs/notes/one-click-composio.md](../../docs/notes/one-click-composio.md)

`pnpm --filter signin-relay build` type-checks and runs `wrangler deploy --dry-run`; it never uploads.
