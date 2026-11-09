# OSS connector approaches

Researched 2026-11-02. Documentation/source review only; no connector installed, account connected, or runtime acceptance performed. Apple-specific findings are in [apple-connectors-research.md](apple-connectors-research.md).

## Three useful patterns

| Project | How it connects | What to learn |
| --- | --- | --- |
| [gogcli](https://github.com/openclaw/gogcli) | Google APIs through a CLI, plus a typed `gog mcp` stdio server. Desktop OAuth client configuration and account authorization. Platform keyring token storage by default; encrypted file backend for headless use. | A small local adapter can expose Gmail/Drive/Calendar without OpenAg implementing each provider API. MCP is read-only by default; writes need explicit authorization. |
| [LibreChat MCP](https://www.librechat.ai/docs/features/mcp) | Generic MCP connections with per-user OAuth or supplied credentials. Connect/reconnect/revoke UI, background refresh where supported. Local stdio servers remain administrator configuration. | Reuse a generic account connection lifecycle instead of implementing a separate connection system for every service. MCP OAuth authenticates to the MCP server; its provider authorization still depends on that server. |
| [Onyx Gmail](https://docs.onyx.app/admins/connectors/official/gmail/overview), [Drive OAuth](https://docs.onyx.app/admins/connectors/official/google_drive/oauth) | Scheduled ingestion into a search index. OAuth for individual accounts; service accounts with domain delegation for Workspace. Gmail threads become searchable documents, refreshed every 30 minutes by default. | This is useful for cross-source knowledge search, but is extra storage/sync machinery beyond live agent tools. Source-permission synchronization has edition restrictions. |

gogcli documents broad default Gmail/Drive scopes as well as narrower authorization options. Command-level read-only restrictions and OAuth scopes are separate controls. Start with only needed services and scopes; do not assume a read-only MCP surface means a read-only underlying credential. See [gogcli README](https://github.com/openclaw/gogcli).

## OpenAg fit, checked in this checkout

- `apps/daemon/src/mcp.ts` supports local stdio and remote Streamable HTTP with configured headers. The HTTP transport construction supplies no OAuth provider; a LibreChat-style interactive connection/refresh lifecycle is not present there.
- `apps/daemon/src/app-library.ts` explicitly distinguishes local readiness/tool discovery from verified provider account access. Keep that distinction in any expanded catalogue.
- `docs/apps.md` documents the optional Composio bridge, with connected accounts managed outside OpenAg. It is an alternative to direct adapters, not required infrastructure.

Recommendation: reuse MCP for execution. Evaluate a pinned Apple local connector and `gog mcp` first, with tool-by-tool read/write classification through OpenAg's existing gate. Keep sends, shares, invites, edits and deletion subject to approval. Add native OAuth account management only when the product needs an integrated sign-in experience. Add content indexing only when cross-source search warrants its extra storage and sync work.

For Apple local mode, permissions/accounts belong to the Mac and OS user running the connector. A browser on another device does not transfer that device's app access to the daemon. Separate connector installed, process connected, account authorized, app permission granted, and successful read states in the UI.

## Limits

These are representative projects, not an exhaustive survey or security audit. Hosted documentation can change; pin a release and inspect exact tool names, scopes, license and launch context before implementation. No application code, live configuration or ticket completion state was changed.
