# Exposing webhooks with Cloudflare Tunnel (only `/hooks/*`)

OpenAg's automations can be triggered by GitHub, Slack or any script through `POST /hooks/<slug>`. Those senders live on
the public internet, so this one route has to be reachable from there. **Nothing else should be.** The desk, the API,
`/stream` and `/mcp` stay on the LAN / Tailscale.

Verified on this Mac with `cloudflared 2025.11.1` (`cloudflared tunnel --help`, `tunnel ingress --help`). Nothing in this
file is applied automatically: you create the tunnel, the DNS record and the process yourself.

## What is protected, and by what
- The route is unauthenticated at the HTTP level and protected by a per-automation secret (see `docs/notes/hooks.md`):
  `X-OpenAg-Secret` for plain webhooks, `X-Hub-Signature-256` for GitHub, `X-Slack-Signature` + timestamp for Slack.
- The daemon caps the body (256 KB), rate-limits failures per client and globally, rate-limits successes per hook, and
  answers an unknown slug exactly like a bad secret.
- The tunnel config below ALSO refuses every path except `/hooks/...`, so a mistake in the daemon cannot expose the desk.

## Use a separate tunnel and config
You already have a tunnel (`paper-trading`) with its own `~/.cloudflared/config.yml`. Do not edit it. Create a second one
with its own config file so the two never interfere:

```
cloudflared tunnel login                         # only if ~/.cloudflared/cert.pem is missing
cloudflared tunnel create openag-hooks           # prints the tunnel id and writes ~/.cloudflared/<id>.json
cloudflared tunnel route dns openag-hooks hooks.example.com    # use your own hostname
```

Create `~/.cloudflared/openag-hooks.yml` (replace the id and hostname):

```yaml
tunnel: openag-hooks
credentials-file: /Users/<you>/.cloudflared/<tunnel-id>.json

ingress:
  # Only /hooks/<slug>. The path is a regular expression matched against the URL path.
  - hostname: hooks.example.com
    path: ^/hooks/[a-z0-9-]+$
    service: http://localhost:4747
  # Everything else on this hostname is refused by cloudflared before it reaches the daemon.
  - service: http_status:404
```

Check it before running anything:

```
cloudflared tunnel --config ~/.cloudflared/openag-hooks.yml ingress validate
cloudflared tunnel --config ~/.cloudflared/openag-hooks.yml ingress rule https://hooks.example.com/hooks/h-abc123
cloudflared tunnel --config ~/.cloudflared/openag-hooks.yml ingress rule https://hooks.example.com/rooms    # must hit the 404 rule
```

## Run it (when you decide to)
```
cloudflared tunnel --config ~/.cloudflared/openag-hooks.yml run openag-hooks
```
To keep it running across reboots, run it as a launchd agent of your own (a second plist next to
`com.openag.daemon`); do not reuse the OpenAg plist, which contains the owner token. Stop it any time with Ctrl-C or
`launchctl bootout`. Deleting the DNS record in the Cloudflare dashboard closes the public path immediately.

## Test it
1. In the desk, Automations, create a **Webhook** automation. Copy the URL and the secret (the secret is shown once).
2. Locally: `curl -i -X POST http://127.0.0.1:4747/hooks/<slug> -H "X-OpenAg-Secret: <secret>" -H 'content-type: application/json' -d '{"hello":"world"}'` -> `202`.
3. Through the tunnel, the same with `https://hooks.example.com/hooks/<slug>` -> `202`. Without the header -> `401`.
4. `https://hooks.example.com/` and `https://hooks.example.com/rooms` must return `404` from cloudflared.

## GitHub and Slack
- GitHub: repository Settings, Webhooks, Payload URL `https://hooks.example.com/hooks/<slug>`, content type
  `application/json`, secret = the signing secret you typed into the automation; choose only the events you listed.
- Slack: Event Subscriptions, Request URL `https://hooks.example.com/hooks/<slug>` (Slack sends a `url_verification`
  challenge that the daemon answers after verifying the signature); the automation needs the Slack app's signing secret.
- Neither sender can reach the desk or any other route through this tunnel.

## Optional: Cloudflare Access
Do not put Access in front of `/hooks/*`: GitHub and Slack cannot authenticate to it. If you also want the desk reachable
from outside, use a separate hostname with an Access policy (or keep using Tailscale, `docs/tailscale.md`).

## Composio remote sign-in

Any additional desk or operator-managed callback hostname needs explicitly approved routing; the hooks-only configuration above remains unchanged. `/composio-connect` accepts only an expiring device-bound attempt created by an authenticated start; it grants no OpenAg login. Do not forward unrelated APIs or remove Access policies merely to expose a callback. Callback reachability, Access login hops and a real phone round trip must be verified separately before claiming live acceptance.

The one-click Composio flow now also has an outbound hosted callback relay. A desk reached through a Cloudflare tunnel can use it without publishing `/composio-connect` on the installation. The private Tailscale route is an alternative for tailnet browsers. This does not deploy the relay or change existing tunnel routing. See [Composio setup](composio.md).
