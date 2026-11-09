# Managed integration onboarding: Composio first

Status: ready for implementation planning. Specification only; no implementation, deployment or live account changes authorized by this document.

## Problem Statement

Connecting an optional integration should feel like connecting an app. Today, Composio sign-in is disabled until someone manually supplies a connector encryption key and a provider-specific callback URL on the daemon. The desk exposes these internal configuration names and repeats several technical warnings. Users must understand backend configuration before they can click Connect.

Owner access now creates and preserves its private credential automatically and provides host-authorized browser access and recovery. Integration setup should follow the same product principle: the backend manages internal credentials and lifecycle, while users choose services and consent to access. Owner authentication and provider authentication remain separate responsibilities.

Future integrations need the same default approach so this manual setup problem does not recur.

## Solution

A Full access device opens Composio in the App Library, clicks Connect Composio, completes provider sign-in and consent, and returns to a clear Connected state. OpenAg manages credential encryption, OAuth registration where supported, callback construction, token storage and refresh. Normal onboarding requires no copied OpenAg secret, generated key, Composio API key or manually assembled provider callback URL.

The installation owns one trusted app address for browser-facing callbacks. For local desktop use, OpenAg can use its actual loopback address. For a phone or another computer, the installation must supply an approved, reachable HTTPS app address. Any necessary address setup is presented once as installation setup in ordinary language, with a concrete remedy. OpenAg must not silently create public ingress or pretend a phone can reach the daemon through the phone's localhost.

Use this approach for future integrations. In this slice, Composio adopts the shared app address; existing Google connections share the managed key but retain their current provider-specific callback configuration. Migrating Google callback registrations is separate work. Provider-required developer credentials remain an explicit operator responsibility where the provider does not support automatic registration; do not promise keyless setup for every third-party provider. Keep those prerequisites separate from the user's account-consent flow.

## User Stories

1. As an owner, I want Connect Composio to be usable after normal installation setup, so that I do not need to generate an internal encryption key.
2. As a user on a Full access device, I want to connect through provider sign-in and consent, so that I do not copy a master token or Composio API key into the desk.
3. As a local desktop user, I want OpenAg to handle its callback address, so that I do not compose a redirect URL.
4. As a phone user, I want sign-in to return to the same OpenAg installation, so that I can connect from the device I use daily.
5. As an installer, I want one trusted app-address setting shared by integrations, so that each connector does not introduce another callback-configuration task.
6. As an owner without a suitable remote address, I want one clear setup instruction, so that I can resolve the actual prerequisite without reading environment-variable names.
7. As an owner, I want to see Connected, Needs sign-in, Connecting or Setup needed clearly, so that I know what action to take.
8. As a user, I want cancelled, denied and expired sign-in attempts to have clear outcomes, so that I can try again deliberately.
9. As an owner, I want access to survive daemon restarts, so that I do not repeat setup after routine maintenance.
10. As an existing owner, I want my current encryption key and connected Google and Composio accounts preserved, so that migration does not lose access.
11. As an owner, I want conflicting, corrupt or missing original key material to produce a recovery instruction, so that OpenAg does not silently replace it and strand encrypted credentials.
12. As an owner, I want backup and restore guidance to cover private credential state, so that restoring the database alone does not give a false sense of recovery.
13. As a user, I want provider credentials to stay on the daemon, so that the browser, bots and shared product knowledge do not receive them.
14. As a Limited access device user, I want a clear explanation of the access required to connect an integration, so that I know how to use existing device-access controls.
15. As an owner, I want reconnect and disconnect controls, so that I can manage access without editing backend files.
16. As an owner, I want disconnect to explain whether provider-side revocation occurred, so that I understand what access remains upstream.
17. As an owner, I want connecting an account to preserve existing tool approvals, so that sign-in does not silently approve external actions.
18. As a user, I want one concise explanation of the provider's role and data sharing, so that consent is understandable without repeated technical warnings.
19. As a user of the legacy API-key bridge, I want it to remain usable, so that improved onboarding does not force a migration.
20. As a maintainer adding another integration, I want to reuse the backend credential lifecycle and trusted-address rules, so that users receive the same straightforward experience.
21. As an owner using an integration with mandatory operator credentials, I want those prerequisites stated honestly, so that automatic management is not confused with bypassing the provider's requirements.
22. As a user asking the default bot for help, I want advice that matches the installed behavior, so that it does not tell me to generate keys that OpenAg now manages.

## Implementation Decisions

- Keep the existing single-daemon architecture, optional Composio connection, MCP SDK OAuth/PKCE implementation, tool discovery and central policy gate. Do not introduce another agent framework or authentication service.
- Treat completed owner access as a dependency. Preserve the owner credential, host recovery, Full/Limited access model, device tokens and pairing behavior. Composio sign-in does not establish OpenAg ownership.
- Keep the connector encryption key separate from the owner credential. Reuse the principles of private host storage, atomic creation, stable reuse, redaction and explicit recovery; do not use the owner secret as an encryption key or build a general secret-management framework.
- Add a small daemon-owned connector-key resolver used by the existing encrypted credential stores. Generate a cryptographically random 32-byte key once when there is no previous key or encrypted connector state. Persist it privately outside SQLite and data-repository commits, with owner-only permissions and validated file ownership/type.
- Preserve the existing explicit connector-key override for compatibility. Import a valid existing key without changing its bytes. Refuse disagreement between a supplied key and the persisted key. Never generate a replacement when existing encrypted records require an unavailable original key. Migration must retain Google and Composio ciphertext compatibility and account access.
- Handle concurrent first startup and interrupted publication without replacing the winning key or accepting unsafe files. Read failures and invalid private state produce bounded, non-secret-bearing errors.
- Introduce one trusted installation app-address configuration for browser OAuth returns. Derive fixed provider callback paths from it. Accept explicitly configured legacy Composio redirect settings for compatibility, with deterministic precedence and clear conflict handling; do not silently change the redirect used by an already registered OAuth client.
- Never choose a trusted callback origin directly from arbitrary Host, forwarded headers, query parameters or model input. A remote address must be deliberately configured or validated through an authenticated Full access installation flow and persisted as installation configuration.
- Local desktop callbacks may use the actual daemon loopback port when supported by the provider. Remote-browser callbacks must use an approved address that reaches the same daemon and meets provider policy. A remote browser without such an address gets Setup needed, not a loopback redirect. No public tunnel, DNS change or relay is provisioned automatically.
- Select and pin the callback URI when a sign-in flow starts. Keep OAuth state single use, expiring, bound to the initiating device and protected against callback replay. Complete the exchange through the existing authenticated return flow. Revocation, disconnect and expiry invalidate outstanding flows as before.
- Preserve the Full access device requirement for browser OAuth. Legacy temporary owner elevation is not sufficient for a navigation-based sign-in that must survive leaving the desk.
- Continue storing provider tokens only in the existing encrypted daemon store. Refresh before requests as needed. Authentication failure must never replay an external tool action. Do not expose credentials through status APIs, ledger entries, bot context, logs or browser storage.
- Keep existing connector routes and status shape where possible. Status responses provide actionable user-facing setup/recovery reasons without secret values. Add only the shared installation-address contract actually needed by the flow; no provider catalogue, generic connector framework or speculative APIs.
- Simplify the Composio Access UI to the connection state and relevant action. Present concise consent/privacy text once; retain an accurate disconnect explanation. Move technical setup detail to owner help and diagnostics rather than the ordinary sign-in flow.
- Establish the same policy for future integrations: backend-managed internal secrets, shared trusted callback handling, existing account-consent mechanisms and revocable access. Use temporary pairing grants for OpenAg device access and OAuth authorization flows for provider access; they are distinct mechanisms, not a universal sign-in link type.
- Update product help, bot-facing knowledge and contributor guidance in the same implementation. Explain actual setup, address selection, key migration, backup/restore, access requirements and limitations. Verify packaged help reaches existing default-bot configurations.

## Testing Decisions

- The owner approved the verification approach in this conversation: controlled daemon and desk integration checks for the full Connect → sign-in → connected flow, restart, migration, cancellation and phone callback behavior. No unit/Jest/Vitest suites or live account changes are part of this scope.
- Prefer the existing highest-level acceptance seams: the real gateway, encrypted store, MCP SDK and runner with controlled OAuth/MCP endpoints, plus actual React access/return components in DOM fixtures. Extend those checks rather than add a parallel test framework or test implementation details.
- Verify fresh setup requires no connector key input; a restart reuses the same protected key and connection; legacy-key import preserves independently created Google ciphertext and Composio records; conflicts, missing originals, corrupt state, unsafe files, concurrent creation and interrupted publication fail or recover without data loss.
- Verify trusted address selection and fixed callback construction for local and simulated remote browsers. An unconfigured remote browser receives actionable setup information. Untrusted Host/forwarded values cannot alter the redirect. Address changes cannot redirect an in-flight exchange or silently reuse an incompatible registration.
- Exercise successful connection, denied consent, cancellation, expired/replayed/wrong-device state, revoked devices, reconnect and disconnect. Confirm callback query cleanup, a single exchange under repeated rendering, and preservation of existing device sessions on failed flows.
- Confirm Limited devices cannot initiate or complete owner-only connection actions. Connecting still leaves external tools behind the existing approval gate. Check refresh failure does not replay actions and unrelated MCP connections remain usable.
- Verify no secrets appear in status responses, audit records, bot context or DOM fixtures. Check the workspace build and bot-knowledge delivery after documentation/UI changes.
- Controlled phone-origin fixtures prove routing behavior, not physical-device usability or provider acceptance. A real Composio sign-in and phone round trip remain separate, explicitly authorized acceptance work. Do not report them as passed from mocked endpoints.

## Out of Scope

- Reworking completed owner access or replacing device authentication with Composio login.
- A hosted credential broker, native callback relay, new identity provider, new public ingress, DNS changes or automatic tunnel provisioning.
- New integrations, broad Google onboarding redesign, forced migration of legacy API-key Apps, or a generic connector/plugin framework.
- Reducing tool approval requirements, exposing credentials to bots, or bypassing provider-required registration and consent.
- Automatic secret rotation, account reconnection, upstream grant revocation claims without evidence, or changing existing live credentials as part of specification work.
- Deployment, service restarts, live account changes or real-provider acceptance without separate authorization.

## Further Notes

The reviewed baseline is main commit `517eeae`, merged into this worktree. Owner access is implemented there; automatic connector-key management and shared callback setup are not.

The earlier OSS research supports application-managed credential lifecycle and callback plumbing. It does not establish that the compared projects offer keyless Composio OAuth, that every provider supports dynamic registration, or that OpenAg's chosen remote callback will be accepted. Existing provider-discovery observations are recorded research, not refreshed acceptance evidence. During implementation, verify applicable callback and registration requirements against current primary sources before treating a deployment mode as supported.

Choose the smallest migration-safe implementation. If a provider rejects a proposed remote callback, report the exact deployment limitation; do not hide it behind a disabled button or silently substitute a desktop-only flow.

Related context: [owner access](owner-access.md), [current Composio behavior](../../docs/composio.md). The OSS research note is retained locally in this worktree and has not been published.
