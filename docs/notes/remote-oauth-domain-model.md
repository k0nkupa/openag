# Remote sign-in domain model

Discussion model following the [remote OAuth research](remote-oauth-access-research.md). Terms are recorded in the root [glossary](../../GLOSSARY.md). These are proposed relationships for remote sign-in, not claims that cross-address completion is implemented. No application, network or account changes are included.

## Relationships

- One installation can have multiple desk addresses, including a Tailscale IP, a tailnet hostname and a future Cloudflare hostname. An address is a way to reach the installation, not its identity or an authorization grant.
- A paired device has its own access to that installation. The same physical phone visiting another browser origin is not automatically the same paired device. The current desk stores its device credential in origin-local storage; a domain-name or protocol change does not transfer it.
- A sign-in attempt belongs to one initiating device and concerns an installation's integration connection. The provider account, initiating device and installation owner are distinct identities.
- Each attempt has a selected provider callback address and a trusted sign-in return destination. They can differ. Callback selection must respect provider registration; the return destination must be an approved desk address, not an unrestricted caller-supplied URL.
- Sign-in completion establishes or renews the installation's integration connection. Returning the browser to the desk is navigation, not proof of completion. Provider tokens remain with the installation; changing a desk address does not require copying owner/device credentials between addresses.
- Changing networks or desk addresses should not itself disconnect a working integration connection. A provider callback-registration change may still require explicit provider setup or reconnect; it is a separate operation from choosing a desk address.

## Concrete scenarios

| Scenario | Model outcome |
| --- | --- |
| Start at `http://<tailscale-ip>:4747/#/app-library`; provider returns through an approved HTTPS callback | The initiating paired device remains the authorizing identity. Completion can occur separately from browser return to the original desk. |
| Open the same installation through Cloudflare tomorrow | Same installation and integration connection; the browser may need its own device pairing at the new origin. |
| Cloudflare desk is reachable, but the selected callback is private to Tailscale and the phone has left the tailnet | The callback is unreachable in that access mode. Desk reachability alone does not establish callback reachability. |
| Revoke or reduce the initiating device's access during consent | Completion must check current authority; arriving at the callback does not preserve a permission that has ended. |
| Provider denies consent, the attempt expires, or the person closes the browser | No new connection is established by navigation alone. A failed reconnect must not replace an existing working connection. |
| An old callback is repeated, or another browser receives it | It cannot create a new attempt, grant device access or complete another attempt. The pending attempt determines the authorized operation. |

## Current code and gaps

`callback-address.ts` currently uses one selected callback origin as the required browser origin. `composio-connect.ts` retains the callback with the account/client registration and refuses an address change. `auth.ts` in the desk reads an origin-local device credential; `ConnectorConnectReturn.tsx` depends on that authenticated desk session to finish the exchange. Together these explain the current restriction. They do not establish that Composio rejected the reported Tailscale URL.

The proposed model separates desk navigation from callback registration and completion. Supporting more addresses will therefore require an explicit completion design, not just a larger URL allow-list. The existing `/hooks/*` Cloudflare ingress remains separate; this model does not authorize exposing the desk or adding a public callback route.

## Decision still open

Choose how the callback reaches the daemon's authenticated pending attempt: a server-owned callback receiver or an authenticated relay to the existing completion route. Backend completion is the research recommendation, but no receiver route, trust mechanism or ingress change is approved by this modeling pass. No ADR records that choice as settled.

No runtime/help behavior changed, so the delivered handbook is unchanged. Documentation checks only; provider acceptance and physical-phone completion remain unverified.

## Subsequent source implementation

The owner approved the server-completion plan after this modeling pass. OA-366 implements that choice in source while retaining legacy authenticated completion; the current-code gap descriptions above refer to baseline `716b369`. See [source verification and remaining limits](remote-composio-verification.md). No tunnel, provider or deployment acceptance is implied.
