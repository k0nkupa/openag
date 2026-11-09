# Remote OAuth through Tailscale, tunnels and multiple desk addresses

Historical research checked 2 November 2026 against OpenAg baseline `716b369`, before OA-366. See [source verification](remote-composio-verification.md) for the subsequent implementation; current-code observations below describe that earlier baseline. Discussion only: no application changes, tests, Tailscale/Cloudflare configuration, provider registrations or account operations. Public repository heads were resolved through GitHub; inspected files are pinned below.

## Finding

**OpenAg should support remote sign-in without requiring the owner to sit at the daemon. The missing design is the return path across browser origins, not whether Tailscale or Cloudflare is an acceptable network.** The compared projects use two concrete patterns: a server callback that completes independently of the arriving browser session, or an authenticated relay that brings the callback back to the host. Some retain manual paste fallbacks. None of this proves Composio accepts the current raw HTTP tailnet address.

For the reported `http://<tailscale-ip>:4747/#/app-library`, OpenAg itself currently rejects non-loopback HTTP and any browser origin different from its selected callback. This happens before a Composio authorization request. It is therefore incorrect to describe the screenshot as a provider rejection. The hash route is the desk location; it is not the OAuth callback path. [Current address selection](../../apps/daemon/src/callback-address.ts), [connection callback pinning](../../apps/daemon/src/composio-connect.ts).

There is a second obstacle: OpenAg stores its device credential in origin-local browser storage and its return page submits an authenticated completion request. HTTP tailnet IP, HTTPS `ts.net`, and a Cloudflare hostname do not share that storage. Merely permitting their URLs will not move the existing Full-device session between them. [OpenAg device storage](../../apps/desk/src/auth.ts), [return handler](../../apps/desk/src/components/ConnectorConnectReturn.tsx), [MDN storage-origin behavior](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).

## What other agents do

| Project and pinned source | Remote desk access | OAuth return mechanism | Relevance and limit |
| --- | --- | --- | --- |
| OpenClaw, [`d8b5fe0`](https://github.com/openclaw/openclaw/tree/d8b5fe08f78081bce23ee6679c6c783edb591a2d) | Direct tailnet HTTP or integrated Tailscale Serve HTTPS. Its current docs explicitly allow direct HTTP browser device signing. | Documented OpenAI model-provider OAuth uses loopback with a pasted redirect/code fallback for remote/headless hosts. | Remote UI support and provider sign-in are distinct. This is not evidence of arbitrary Composio redirects. [Tailnet modes][O1], [OAuth][O2] |
| Nightly OpenBot, [`ac99196`](https://github.com/nightly-labs/openbot/tree/ac99196e66fe8f9d426433aa5e79d6e999d1c818) | Joined remote host with an authenticated Team channel. | Native client captures the browser's loopback callback and relays its query to the host. Browser-only client uses pasted-address fallback. | Actual remote MCP OAuth orchestration, but not a seamless phone-browser listener. [Relay architecture][N1], [authenticated routes][N2] |
| CopilotKit/OpenBot application, [`c396a5f`](https://github.com/CopilotKit/OpenBot/tree/c396a5f68c817043846f1ca3c2b42061ee73ceb5) | Application and API can have different configured addresses. | Fixed backend callback, sealed flow state and PKCE; server saves the grant, then redirects to the configured application address. Callback deliberately does not require the arriving browser's session. | Strong example of separating callback address from UI address. It uses its own account/access model; it is not a drop-in OpenAg route. [Flow/state][C1], [callback][C2], [configuration][C3] |

### OpenClaw: remote control is not provider OAuth

The current source documents a managed Serve mode that provides tailnet-only HTTPS, and a direct tailnet bind that can serve the Control UI over HTTP. Browser device identity still applies. Serve identity-header authentication has specific provenance checks and a limited surface; it does not automatically authenticate every API route. [Tailnet access][O1]

Its documented OpenAI OAuth flow, by contrast, uses `localhost:1455/auth/callback` and offers manual code/redirect pasting when callback capture cannot work remotely. This is model-provider authentication, not upstream Gmail/Slack consent or OpenAg owner recovery. It shows a remote fallback rather than a universal callback-URL exception. [OpenAI flow][O2]

### Nightly: relay the result to the executing host

For MCP sign-in, the joined host retains the flow and PKCE material while the user signs in through their own browser. The native client captures the loopback callback and forwards its query over the Team channel. Each relay route requires administrator access; the host associates the flow with its initiating member. The browser-only path cannot bind a listener and falls back to pasting the resulting address. [Architecture][N1], [route authorization and member binding][N2]

This supports a distinct **completion channel** for a remote browser. It does not justify assuming that an iPhone can receive the Mac's loopback callback. Its provider-CLI relay and generic MCP relay are separate routes, even though they share transport. [N1]

### CopilotKit/OpenBot: finish on the backend, then return to the app

`redirectUriFor(publicUrl)` appends a fixed callback path to deployment configuration. The application return address is a separate `appUrl`. The callback explicitly bypasses `requireUser`: identity comes from encrypted flow state, not whichever browser session happens to arrive. It checks that the initiating person still has access before exchanging the code, uses the flow's PKCE verifier, stores the resulting grant, and redirects to a deployment-selected screen. [Callback implementation][C2]

The sealed state contains the initiating user, integration and return-screen choice; it is not an arbitrary caller-provided return URL. Configuration defaults the API callback base from the authentication base URL and selects the app return origin separately. These are configured addresses, not unrestricted Host-header reflection. [State/URL construction][C1], [configuration][C3]

This is a pattern OpenAg could adapt using its own initiating Full-device identity and revocation checks. It does not imply copying another project's user/session system or removing OpenAg's policy gate.

## Network and provider constraints

- **OAuth redirect scheme:** RFC 9700 §2.6 prohibits HTTP redirect URIs except the native-app loopback case; §2.1 requires exact registered-URI matching and rejects open redirectors. A tailnet `100.*` IP is not loopback. Tailscale encrypting its network does not turn an HTTP URL into an HTTPS OAuth redirect. This is normative guidance, not an observation that Composio has rejected the address. [OAuth security BCP](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.6).
- **Tailscale:** Serve provides private tailnet routing and HTTPS termination for a local HTTP backend. Public Funnel is unnecessary for a browser already connected to the tailnet. Direct HTTP over a tailnet and a provider-approved OAuth redirect are separate questions. [Serve features](https://tailscale.com/docs/features/tailscale-serve), [CLI/proxy behavior](https://tailscale.com/docs/reference/tailscale-cli/serve).
- **Cloudflare Tunnel:** a published HTTPS hostname can route to a local application; Access policy is a separate layer from OpenAg device authorization. OpenAg's existing tunnel guide is deliberately hooks-only and is not evidence that the desk or OAuth callback is exposed. [Cloudflare routing](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/), [current OpenAg tunnel scope](../cloudflare-tunnel.md).
- **Composio:** read-only authorization metadata advertises authorization-code and refresh-token grants, public-client authentication and S256 PKCE. It does not advertise a device-code grant or establish which redirect schemes/private addresses registration will accept. No registration POST was attempted. The public GHMCP repository at [`da8afdb`](https://github.com/ComposioHQ/GHMCP/tree/da8afdb60f7e54e515c0bffe0153da418d3609ed) did not expose the server's redirect-validation source in its inspected tree. [Authorization metadata](https://connect.composio.dev/.well-known/oauth-authorization-server), [Composio Connect](https://docs.composio.dev/docs/composio-connect).
- Composio's SDK/broker documentation distinguishes an upstream provider's `redirect_uri` from an application's `callbackUrl`. That is a different flow from authenticating OpenAg to the shared MCP endpoint; it cannot establish that the current MCP flow accepts raw HTTP tailnet returns. [White-label authentication](https://docs.composio.dev/docs/authentication/white-labeling-authentication).

## Recommendation for OpenAg — inference, not implementation

Separate three concepts: **desk access origins**, **provider callback address**, and **post-sign-in return/completion channel**. Tailscale IP, tailnet hostname and a future Cloudflare hostname can all reach one installation without becoming interchangeable browser identities.

| Access case | Proposed behavior |
| --- | --- |
| Current HTTP tailnet IP | Keep the desk usable there. Use a provider-compatible HTTPS callback plus server-side completion/return relay; do not design around using a non-loopback HTTP redirect contrary to OAuth security guidance. A deliberate paste fallback is another remote option, not a demand to sit at the Mac. |
| HTTPS tailnet hostname | Use a provider-accepted `ts.net` callback with private routing. Pair the browser at that origin, or deliberately implement a return channel to its original paired desk. |
| Cloudflare hostname | Use a provider-accepted callback at a deliberately configured hostname. Keep tunnel/Access policy and OpenAg device authorization distinct. Do not repurpose the hooks-only ingress implicitly. |
| Several desk aliases | Allow trusted configured desk origins and bind the chosen origin to each attempt. Keep one canonical callback plus a return channel, or use provider-supported registered callbacks per origin. Changing networks should not itself require disconnecting the provider account. |

The smallest general browser design is a canonical provider-compatible HTTPS callback with a server-owned pending flow bound to the initiating device. In the normal authorization-code redirect, the browser returns to that address; the provider does not itself need a route into the tailnet. A private HTTPS Serve callback can therefore be an option, subject to the provider’s registration/validation policy. Complete the exchange on that channel, recheck the device's access/revocation, then let the original authenticated desk obtain the result through its existing origin. A trusted return link may navigate back, but must not carry the owner/device credential or provider tokens. Whether to introduce a server callback or retain authenticated callback-query relay needs an explicit design decision: OpenAg currently requires authenticated completion and its route policy must not change accidentally.

The selected callback must remain reachable from the signing-in browser. A private tailnet callback still requires Tailscale even when the desk was opened through Cloudflare. To support future Cloudflare access without Tailscale, choose a suitably protected HTTPS callback reachable in that mode, or provider-supported registered callback choices pinned per attempt. One private canonical callback is not automatically sufficient for every network. This is an architectural consequence of the routing patterns above, not a tested OpenAg deployment.

Retain the existing encrypted daemon credential store, single-use/expiry checks, Full-device start permission, PKCE and tool approvals. Do not accept arbitrary Host/forwarded values as trusted callback origins, and do not confuse an allowed return address with an approved provider redirect. Native relays and device-code flows are options only when an actual client/provider supports them.

## Remaining acceptance

Unverified: Composio’s actual enforcement/registration policy and acceptance of proposed HTTPS aliases; real phone round trips; loss/cancellation of a cross-origin return; device downgrade/revocation during consent; and the selected tunnel/Access routing. No existing local-only restriction should be removed merely by claiming Tailscale encryption proves provider compatibility. Equally, the current client-side block must not be presented as an upstream provider requirement without evidence.

[O1]: https://github.com/openclaw/openclaw/blob/d8b5fe08f78081bce23ee6679c6c783edb591a2d/docs/gateway/tailscale.md#L9-L124
[O2]: https://github.com/openclaw/openclaw/blob/d8b5fe08f78081bce23ee6679c6c783edb591a2d/docs/concepts/oauth.md#L196-L211
[N1]: https://github.com/nightly-labs/openbot/blob/ac99196e66fe8f9d426433aa5e79d6e999d1c818/docs/architecture/integrations.md#L101-L178
[N2]: https://github.com/nightly-labs/openbot/blob/ac99196e66fe8f9d426433aa5e79d6e999d1c818/src/main/team-api/route-sign-in-relay.ts#L17-L76
[C1]: https://github.com/CopilotKit/OpenBot/blob/c396a5f68c817043846f1ca3c2b42061ee73ceb5/server/src/plugins/oauth.ts#L6-L122
[C2]: https://github.com/CopilotKit/OpenBot/blob/c396a5f68c817043846f1ca3c2b42061ee73ceb5/server/src/plugins/route-groups/oauth-callback.ts#L17-L160
[C3]: https://github.com/CopilotKit/OpenBot/blob/c396a5f68c817043846f1ca3c2b42061ee73ceb5/server/src/config.ts#L1407-L1448
