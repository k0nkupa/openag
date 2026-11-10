# Deploying your own sign-in relay

OpenAg has no built-in sign-in relay. Browser sign-in for Composio and custom remote MCP servers (OAuth) uses a private Tailscale Serve callback by default. The relay in `apps/signin-relay` is an optional Cloudflare Worker that you deploy to **your own** Cloudflare account and point the daemon at with `OPENAG_SIGNIN_RELAY_URL`.

## Do you need it?

Deploy a relay only if you want browser sign-in to work **without Tailscale**, for example from a phone that is not on your tailnet. If your browser can reach the OpenAg computer over Tailscale, you do not need it.

## What the relay can and cannot see

The design and security properties are recorded in [one-click Composio notes](notes/one-click-composio.md). In short:

- **Sees:** the OAuth `state` and the one-time authorization `code` (or the provider's `error`) when the provider redirects the browser to `/composio-connect`, plus the requesting IP for rate limiting.
- **Stores:** only a callback encrypted to a fresh daemon public key (P-256 ECDH, HKDF-SHA256, AES-256-GCM) in a Durable Object, for at most five minutes. The daemon deletes it on completion or cancellation; an alarm removes expired records.
- **Never sees:** the PKCE verifier, owner or device credentials, provider access/refresh tokens, service-account grants or tool data. It never exchanges tokens and never redirects to a desk address.
- Only the daemon holding a separate random read credential (sent as a SHA-256 hash at session creation) can read or close a session.

A relay adds a cloud dependency that you operate, for sign-in only. A response at the callback grants no device login or tool authority.

## Cost

The relay uses Cloudflare Workers, a SQLite-backed Durable Object and the Workers rate-limit binding. Sign-in traffic is tiny, but check current [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and Durable Objects availability on your plan before deploying.

## Prerequisites

- A Cloudflare account with a `workers.dev` subdomain (Workers and Pages in the dashboard).
- Node 22+ and pnpm, with the repository dependencies installed (`pnpm install` at the repository root).
- Shell access to the OpenAg computer to set daemon environment variables.

## What the configuration deploys

`apps/signin-relay/wrangler.jsonc` contains no `account_id` and no custom routes; Wrangler uses the account you sign in with. It defines:

| Setting | Value |
| --- | --- |
| Worker name | `openag-signin` (also the first label of your `workers.dev` hostname) |
| Entry point | `src/index.ts` |
| Public address | `workers_dev: true` → `https://openag-signin.<your-subdomain>.workers.dev` |
| Durable Object | binding `SESSIONS`, class `RelaySession`, migration tag `v1` (`new_sqlite_classes`) |
| Rate limits | `REQUEST_LIMIT` 600/60 s per IP, `REQUEST_TOTAL_LIMIT` 12000/60 s shared, `CREATE_LIMIT` 10/60 s per IP, `TOTAL_LIMIT` 1000/60 s shared (namespace ids `1001`–`1004`) |
| Observability | `"enabled": false` |

The rate-limit `namespace_id` values must be unique within your account. If another Worker in your account already uses `1001`–`1004`, change them in your copy before deploying.

## Deploy

From the repository root:

1. Install and check the build (a dry run; it uploads nothing):

   ```sh
   pnpm install
   pnpm --filter signin-relay build
   ```

   The output lists the `SESSIONS` Durable Object and the four rate-limit bindings and ends with `--dry-run: exiting now.`

2. Sign Wrangler in to your Cloudflare account (opens a browser):

   ```sh
   pnpm --filter signin-relay exec wrangler login
   pnpm --filter signin-relay exec wrangler whoami
   ```

   If you have several accounts, `whoami` shows which one is used; set `CLOUDFLARE_ACCOUNT_ID` in the shell to choose.

3. Deploy:

   ```sh
   pnpm --filter signin-relay exec wrangler deploy
   ```

   Wrangler prints the Worker address, for example `https://openag-signin.<your-subdomain>.workers.dev`. That origin (no path) is your relay URL.

4. Verify the health endpoint:

   ```sh
   curl -s https://openag-signin.<your-subdomain>.workers.dev/health
   ```

   Expected: `{"ok":true}`. Every other unknown path returns HTTP 404 `{"error":"Sign-in unavailable or expired"}`.

## Keep invocation logging off

Callback URLs carry authorization codes. The configuration disables Workers observability and the relay never logs state or code. Do **not** enable Workers Logs, Logpush, Tail Workers, traces or `wrangler tail` for this Worker, and exclude it if you turn on account-level logging. Do not put the Worker behind a proxy or analytics product that records full request URLs.

## Point OpenAg at the relay

`OPENAG_SIGNIN_RELAY_URL` must be an `https://` origin with no path, query, fragment or credentials (a trailing `/` is fine). Anything else fails with "Invalid hosted sign-in configuration".

**Manual run** (for example `pnpm --filter daemon start`):

```sh
export OPENAG_SIGNIN_RELAY_URL=https://openag-signin.<your-subdomain>.workers.dev
pnpm --filter daemon start
```

**launchd service:** `scripts/install-service.sh` copies `OPENAG_SIGNIN_RELAY_URL` and `OPENAG_SIGNIN_ROUTE` into the plist when they are set in the shell, and keeps an existing install's values when they are not:

```sh
OPENAG_SIGNIN_RELAY_URL=https://openag-signin.<your-subdomain>.workers.dev scripts/install-service.sh
```

**Route selection** (`OPENAG_SIGNIN_ROUTE`, default `auto`):

- `auto`: use the relay when `OPENAG_SIGNIN_RELAY_URL` is set; if relay preparation fails before consent, fall back to the private Tailscale callback.
- `hosted`: use only the relay; no Tailscale fallback. Without a relay URL this is refused.
- `tailscale`: ignore the relay.

Explicit `OPENAG_COMPOSIO_REDIRECT_URI` / `OPENAG_PUBLIC_URL` overrides and a saved explicit callback origin still take priority (see [Composio operator configuration](composio.md#operator-configuration-and-compatibility)). Changing the route can require fresh client registration at the next Connect; existing connections stay active until that succeeds.

## Confirm from the desk

On a Full access device, open **App library** → **Composio** and choose **Connect Composio** (or **Reconnect** under Settings → Connectors). The provider tab should return to `https://openag-signin.<your-subdomain>.workers.dev/composio-connect` and show "Return to OpenAg"; the original desk then shows the result. Reaching that page only proves the relay received a response; the desk's **Connected** state is the real check.

## Remote MCP sign-in

Composio and custom remote MCP servers share the relay's `/composio-connect` callback. The relay accepts any RFC 9207 `iss` that is a plain `https` URL (no credentials, query or fragment) and stores it with the callback. The daemon then compares it with the issuer it discovered for that attempt before any code exchange, so a callback from the wrong provider fails without spending the code.

## Updating

Pull the repository, then repeat the build and deploy steps. Re-deploying keeps the same address. Do not rename the `RelaySession` class or remove the `v1` migration; a renamed or deleted Durable Object class needs a new migration entry.

## Removing

1. Unset the relay on the daemon. For the service, remove the key from the plist (the installer otherwise keeps it), then reinstall:

   ```sh
   plutil -remove EnvironmentVariables.OPENAG_SIGNIN_RELAY_URL ~/Library/LaunchAgents/com.openag.daemon.plist
   scripts/install-service.sh
   ```

   Also remove `OPENAG_SIGNIN_ROUTE` if it is `hosted`.

2. Delete the Worker (Wrangler asks for confirmation):

   ```sh
   pnpm --filter signin-relay exec wrangler delete
   ```

Sign-in then uses the private Tailscale callback. Saved connections are unaffected.

## Troubleshooting

| Message | Cause and fix |
| --- | --- |
| Hosted sign-in is not configured. Set OPENAG_SIGNIN_RELAY_URL. | `OPENAG_SIGNIN_ROUTE=hosted` without a relay URL. Set the URL in the daemon's environment (for the service, rerun the installer with it set) and restart. |
| Hosted sign-in is unavailable. Try again later. | `hosted` mode and session creation failed: the relay was unreachable, returned 429/5xx or an unexpected response, timed out (8 s), or the URL itself is invalid. Check `/health`, that the value is a bare `https://` origin, and that the Worker is deployed in the account you expect. Rate limits reset within a minute. |
| Invalid hosted sign-in configuration | The URL is not `https`, or has a path, query, fragment or credentials. The daemon checks this at startup and refuses to start. Use the bare origin. |
| Invalid hosted sign-in response / Invalid sign-in response | While waiting for the callback, the URL answered with something other than this relay's format (wrong host, or a proxy rewriting responses). The attempt stops. |
| Invalid sign-in route configuration | `OPENAG_SIGNIN_ROUTE` is not `auto`, `hosted` or `tailscale`. |
| Sign-in is temporarily unavailable. The OpenAg operator needs to check hosted sign-in or Tailscale access. | `auto` mode: the relay failed (or is not set) and the Tailscale route failed too. |
| Callback tab shows "Sign-in unavailable or expired" | The attempt expired (five minutes), was already used or cancelled, or the provider sent an `iss` that is not a plain `https` URL. Start Connect again. |
| `wrangler deploy` fails on a `ratelimits` entry | Another Worker in your account may already use that `namespace_id`. Change the ids in `wrangler.jsonc` to unused integers. |

In `auto` mode an unreachable relay does not show an error: sign-in quietly uses Tailscale. Set `OPENAG_SIGNIN_ROUTE=hosted` while testing the relay so failures surface.

Rate limits are applied per Cloudflare location, not as an exact worldwide quota.
