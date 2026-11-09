# Owner access without manual token handling

Researched 2 November 2026. Research and design recommendation only: no authentication implementation, service change, credential inspection, deployment or runtime acceptance. Public sources were fetched during this research. The GitHub revisions below identify the source snapshots inspected; they are not claims about released or installed versions.

## Recommendation

OpenAg should create and keep its own root credential, then give each browser or phone a revocable device credential through a short-lived pairing handoff. The user should see **Open desk**, **Pair device**, and **Recover access on this computer**, with no root token to copy or remember. This is a proposed OpenAg design, informed most directly by OpenClaw's host-authorized dashboard handoff and Goose's internal desktop/server credential wiring. It does not require an OpenAg account service.

Removing manual secret handling still requires a way to establish authority: an already trusted device or a deliberate command/app action by the OS user who owns the daemon. Merely visiting localhost must not grant ownership. OpenClaw likewise explicitly retains authentication on loopback. [OpenClaw dashboard](https://github.com/openclaw/openclaw/blob/710b58de2adfae0d4a9da83aaf0bc55d851dfbc3/docs/web/dashboard.md#auth-basics-local-vs-remote).

## Comparison

| Project | Verified mechanism | Relevance to OpenAg |
| --- | --- | --- |
| nightly-labs/openbot | Email sign-in; persisted account session encrypted through OS storage; mobile one-use links and account sessions; short-lived remote connection tickets. | Good example of hiding durable credentials and tracking device access, but its hosted account/control plane is substantially more than OpenAg needs. |
| CopilotKit OSS | Application authentication supplied through runtime hooks/middleware and request identity; runtime forwards approved auth context to the agent. | Useful integration boundary, not a ready-made local owner registration, pairing or recovery system. |
| OpenClaw | Host CLI opens a single-use browser bootstrap link, exchanged for durable administrator device access; shared gateway secret stays out of the launch URL. | Closest match for an always-on home daemon with a browser desk. |
| Goose | Desktop generates a random server secret and passes it internally to its local backend; separately configured remote servers still require a shared secret. | Strong local automatic-wiring example; its documented remote setup does not solve the user's manual-secret problem. |

Each row is supported by the project-specific sources below. The relevance column is an engineering judgment, not an upstream promise.

## nightly-labs/openbot

Inspected revision [`ac99196e66fe8f9d426433aa5e79d6e999d1c818`](https://github.com/nightly-labs/openbot/tree/ac99196e66fe8f9d426433aa5e79d6e999d1c818).

- The account flow starts email authentication at `/v1/auth/email/start` and verifies the result at `/v1/auth/email/verify`. Its manager restores saved account sessions on startup. These are OpenBot account credentials, distinct from Codex/Claude provider sign-in. [CentralAuthManager](https://github.com/nightly-labs/openbot/blob/ac99196e66fe8f9d426433aa5e79d6e999d1c818/src/main/central-auth-manager.ts#L1398-L1579).
- Session persistence checks secure storage availability, encrypts the serialized session, writes a mode-0600 temporary file, and renames it into place. If secure storage is unavailable, it does not silently save plaintext. The privacy document identifies the encryption as operating-system storage protection. [Persistence implementation](https://github.com/nightly-labs/openbot/blob/ac99196e66fe8f9d426433aa5e79d6e999d1c818/src/main/central-auth-manager.ts#L1888-L1923), [privacy and account storage](https://github.com/nightly-labs/openbot/blob/ac99196e66fe8f9d426433aa5e79d6e999d1c818/PRIVACY.md#data-stored-by-the-central-account-service).
- Mobile Connect uses host-bound links/codes; mobile can also sign in with email. Its documentation distinguishes invitation membership from signing a phone into the desktop account. The central service issues short ES256 connection tickets, and access/session revocations are delivered to Signal through a durable outbox. This is account-mediated remote access, not unauthenticated local ownership. [Mobile connection and sign-in](https://github.com/nightly-labs/openbot/blob/ac99196e66fe8f9d426433aa5e79d6e999d1c818/docs/architecture/team-api.md#L58-L85), [remote session lifecycle](https://github.com/nightly-labs/openbot/blob/ac99196e66fe8f9d426433aa5e79d6e999d1c818/docs/architecture/team-api.md#L229-L258).

**Takeaway:** copy the product experience of automatic credential persistence and explicit device sessions. Do not introduce its hosted identity service solely to remove OpenAg's token-paste step. This is a recommendation; OpenBot's full account backend was not audited.

## CopilotKit OSS

Inspected revision [`c5616c818bf9b6d97b29fb1d766876c807e2b208`](https://github.com/CopilotKit/CopilotKit/tree/c5616c818bf9b6d97b29fb1d766876c807e2b208).

The official authentication guide demonstrates passing frontend authentication to a runtime and validating it before agent execution. Its sign-in demo uses a demo token; that does not establish a production identity, credential storage or recovery system. The OSS runtime exposes request middleware and user-resolution hooks, and documents forwarding authorization and eligible application headers while denying infrastructure headers. [Official auth guide](https://docs.copilotkit.ai/langgraph-fastapi/auth), [OSS runtime middleware and identity options](https://github.com/CopilotKit/CopilotKit/blob/c5616c818bf9b6d97b29fb1d766876c807e2b208/packages/runtime/src/v2/runtime/core/runtime.ts#L184-L329).

**Takeaway:** retain authentication at OpenAg's gateway and carry verified identity into agent execution. CopilotKit is not evidence that OpenAg can safely remove its ownership boundary; no built-in local-daemon owner bootstrap was identified in the inspected guide/runtime surfaces. This is a scoped finding, not a claim that every CopilotKit example lacks account integration.

## OpenClaw

Inspected revision [`710b58de2adfae0d4a9da83aaf0bc55d851dfbc3`](https://github.com/openclaw/openclaw/tree/710b58de2adfae0d4a9da83aaf0bc55d851dfbc3).

- Its recommended `openclaw dashboard` command opens/copies a one-use pairing link granting administrator access to the signed browser, including recovery from limited access. The docs describe a short-lived bootstrap bound to that browser's signed device identity and exchanged for a durable administrator credential. The shared gateway secret is not the browser-launch credential. [Dashboard fast path and auth](https://github.com/openclaw/openclaw/blob/710b58de2adfae0d4a9da83aaf0bc55d851dfbc3/docs/web/dashboard.md#L33-L59).
- The actual handoff helper issues a device bootstrap with the Control UI owner profile and puts that bootstrap, profile hint and gateway URL into a URL fragment. The CLI opens it through its private browser launcher and gives a ten-minute delivery instruction. That is source evidence for the handoff, rather than just a UX description. [Handoff helper](https://github.com/openclaw/openclaw/blob/710b58de2adfae0d4a9da83aaf0bc55d851dfbc3/src/commands/control-ui-handoff.ts#L142-L159), [dashboard delivery](https://github.com/openclaw/openclaw/blob/710b58de2adfae0d4a9da83aaf0bc55d851dfbc3/src/commands/dashboard.ts#L328-L394).
- Bootstrap operations are scope/profile constrained; reading already-bound bootstrap context requires the same token, device ID and public key. This is stronger than a generic bearer pairing code alone. The exact pairing implementation would need its own security review before copying it. [Bootstrap implementation](https://github.com/openclaw/openclaw/blob/710b58de2adfae0d4a9da83aaf0bc55d851dfbc3/src/infra/device-bootstrap.ts#L68-L101), [bound identity lookup](https://github.com/openclaw/openclaw/blob/710b58de2adfae0d4a9da83aaf0bc55d851dfbc3/src/infra/device-bootstrap.ts#L354-L369).
- Device tokens can be rotated or revoked; the documented rules limit self-service callers and require administrator authority for other devices. A host-authorized fresh dashboard handoff is the documented browser repair route. [Device rotation/revocation](https://github.com/openclaw/openclaw/blob/710b58de2adfae0d4a9da83aaf0bc55d851dfbc3/docs/cli/devices.md#L182-L224), [dashboard repair](https://github.com/openclaw/openclaw/blob/710b58de2adfae0d4a9da83aaf0bc55d851dfbc3/docs/web/dashboard.md#L35-L42).

**Takeaway:** adopt the host-authorized, short-lived browser handoff pattern. Do not describe OpenAg's existing bearer pairing codes as cryptographically device-bound unless that binding is implemented. Preserve explicit trust for remote devices and recovery through the host OS account.

## Goose

Inspected revision [`b23d21cabd9b4de0c045dcdd731821a3a15c2bfc`](https://github.com/block/goose/tree/b23d21cabd9b4de0c045dcdd731821a3a15c2bfc).

The Electron desktop generates a 32-byte random hexadecimal secret and uses it for its managed backend. The backend-start helper places it into `GOOSE_SERVER__SECRET_KEY` and launches the local server on loopback. The user does not have to supply that managed-desktop credential. [Secret generation/selection](https://github.com/block/goose/blob/b23d21cabd9b4de0c045dcdd731821a3a15c2bfc/ui/desktop/src/main.ts#L848-L890), [backend selection](https://github.com/block/goose/blob/b23d21cabd9b4de0c045dcdd731821a3a15c2bfc/ui/desktop/src/main.ts#L1066), [backend environment and launch](https://github.com/block/goose/blob/b23d21cabd9b4de0c045dcdd731821a3a15c2bfc/ui/desktop/src/gooseServe.ts#L321-L395).

Its separate remote-server guide explicitly asks users to create a long random shared secret, keep it in a password manager, and enter the same secret in desktop settings. Rotation must be synchronized manually. Automatic local wiring must therefore not be presented as automatic remote pairing or durable daemon recovery. [Remote setup](https://github.com/block/goose/blob/b23d21cabd9b4de0c045dcdd731821a3a15c2bfc/documentation/docs/guides/remote-goose-server.md#L30-L47), [remote settings and rotation](https://github.com/block/goose/blob/b23d21cabd9b4de0c045dcdd731821a3a15c2bfc/documentation/docs/guides/remote-goose-server.md#L98-L117).

**Takeaway:** OpenAg should own secret creation and internal wiring. A process-lifetime desktop secret alone does not meet OpenAg's restart/recovery requirements.

## Proposed OpenAg product contract

These are recommendations, not shipped capabilities:

1. **Install/start:** generate a cryptographically random root credential when none exists; persist it privately and reuse it on restart. Preserve existing installer and environment credentials during migration. Never rotate silently on an ordinary restart.
2. **Open desk:** a deliberate host app/CLI action reads the protected credential internally and mints a short-lived, single-use full-access pairing grant. Open a fixed, trusted desk origin with only the temporary grant. Never put the root secret into browser URLs, browser storage, clipboard or command output.
3. **Remember device:** redeem through the existing device flow and keep only that device's revocable credential in the client. Retain full/limited access controls; pairing a phone does not silently grant full access.
4. **Pair another device:** use a trusted full-access desk or a deliberate host action to show a QR/link/code. Make the requested access clear before confirming.
5. **Recover access:** after losing browser storage or every paired device, repeat the host-authorized Open desk action. No remembered master token. Recovery must not be an anonymous HTTP endpoint or a tool offered to bots.
6. **Keep the boundary:** pin the daemon/data directory and desk origin before using the root credential; do not send it to arbitrary URLs. Keep redaction, restricted child environments, pairing expiry/rate limits and revocation. A temporary pairing link is still a bearer credential until redeemed; a URL fragment alone does not make it device-bound.

The smallest implementation should reuse OpenAg's existing full-device and pairing machinery. Keychain integration, passkeys and a hosted account service are optional future choices, not prerequisites for this outcome. A protected local control socket is an alternative to host-side root-token reads, with a larger implementation scope.

## OpenAg today

Inspected local source at `10310ff`. These findings describe this checkout, not the running service or its credentials.

| Surface | Current source behavior | Required change |
| --- | --- | --- |
| Service install | Generates a random secret if none was supplied or found in the existing service plist; stores it in that mode-600 plist. Installer output tells the user how to extract it. | Keep automatic generation and preservation; replace the extraction instruction with Open desk. |
| Direct daemon start | Exits without `OPENAG_TOKEN`. The README asks the user to generate, print and retain the secret. | Resolve a persistent, automatically managed credential for this path too. |
| Browser login | Pasted owner token is exchanged for a full-access device token. Ordinary client storage holds the device token. | Replace the ordinary token-paste entry point with host-authorized pairing. |
| Device authority | Gateway treats full-access devices as owners while `/whoami` retains their device identity. Only owner/full callers can create full pairing codes or change access. | Reuse this boundary; no new account or role system. |
| Pairing | Eight-character, five-minute, single-use codes; limited by default. Existing join links prefill the pairing form and remove the fragment from the address bar. | Host launcher creates a full grant; browser confirms its name and redeems it. Other-device access stays explicit. |
| Limited-device escalation | Owner actions panel takes the root token into page memory and retries an owner-only request. | Replace the normal root-token prompt with guidance to approve access from a trusted full device or the host. |

Sources: [installer](../../scripts/install-service.sh) (credential resolution lines 29–34, persistence/protection 63–77, extraction instruction 106); [daemon startup and listener](../../apps/daemon/src/main.ts) (48–52, 197, 273); [README start instructions](../../README.md); [Login](../../apps/desk/src/components/Login.tsx) (40–49, 60–102); [client storage](../../apps/desk/src/auth.ts); [gateway](../../apps/daemon/src/gateway.ts) (232–272, 289–360); [auth implementation](../../apps/daemon/src/auth.ts) (44–48, 150–158, 191–227); [OwnerPanel](../../apps/desk/src/components/OwnerPanel.tsx), [ownerSession](../../apps/desk/src/ownerSession.ts), [API retry](../../apps/desk/src/api.ts).

Thus the service installer already handles secret creation and storage. The missing product behavior is the initial browser handoff, host-authorized recovery and automatic credentials for direct daemon starts. Full devices already avoid routine owner-token entry. These conclusions follow from the source map above.

## Smallest complete implementation scope

This is a proposed scope for a later implementation ticket, not an alteration of the current build queue.

1. **One credential resolver shared by startup and host tooling.** Preserve explicit environment overrides and installed service secrets. For automatic storage, use a private daemon-owned location outside bot workspaces, memory/git content and product-knowledge sources. Require owner-only directory/file access, refuse symlinks or unsafe ownership, create atomically, and reuse on restart. Do not silently replace an unreadable or malformed credential. A protected file is the smallest portable baseline; selecting Keychain would need unattended service-start verification. Register a newly file-loaded secret with the redactor explicitly: the current redactor discovers environment secrets, which is insufficient for a new file source. [Current environment discovery](../../apps/daemon/src/redact.ts), [current startup](../../apps/daemon/src/main.ts).
2. **A deliberate host launcher**, for example a proposed `openag open` command or equivalent installer/app action, mints a full pairing grant and opens the configured local desk join URL. It uses the credential only internally against the intended daemon; no root secret in command arguments, terminal output or URLs. Reuse `POST /devices/pairing-codes` and `POST /pair` where possible. Do not add an anonymous HTTP endpoint that mints owner access, and do not grant ownership based on a loopback address. The daemon currently listens on all interfaces, so localhost assumptions would be especially unsafe. [Gateway pairing routes](../../apps/daemon/src/gateway.ts), [listener](../../apps/daemon/src/main.ts).
3. **Reuse the existing join form and device storage.** One confirmation of the browser name is enough; users need not copy a secret. Strip the temporary fragment promptly, keep the existing expiry/single-use/failure behavior, and make the full-access grant clear. Repeating Open desk can recover a cleared browser without deleting the database or revoking unrelated devices. An expired or uncertain redemption must not trigger a blind automatic retry. [Join flow](../../apps/desk/src/components/Login.tsx), [device storage](../../apps/desk/src/auth.ts).
4. **Finish the callers and guidance.** Update startup/install instructions, Login, OwnerPanel and owner-access error/help text. Trace the retry behavior in `api.ts` and old stored-owner migration in `app.tsx` before removing any compatibility path. Keep existing explicit `OPENAG_TOKEN` installations working during migration. Preserve WebRTC restrictions; its transport cannot become a root-secret recovery channel. [Client API](../../apps/desk/src/api.ts), [legacy storage migration](../../apps/desk/src/app.tsx), [WebRTC boundaries](webrtc.md).

Do not expose host recovery through the bot tool registry. Environment filtering is already present but is not an OS isolation boundary against code running as the same OS user. A new credential file must not accidentally enter memory, backups or bot-visible help merely because it sits under the data directory. Check the actual backup and data-git paths before selecting its location. [Bot environment filtering](../../apps/daemon/src/runtimes/acp.ts), [backup implementation](../../apps/daemon/src/backup.ts), [data git](../../apps/daemon/src/datagit.ts).

The existing eight-character grant is a bearer code protected by expiry and online rate limits. Reusing it is the smallest change, but it does not reproduce OpenClaw's signed-device binding. A higher-entropy dedicated browser handoff is a separate hardening choice to assess before implementation. Keeping device credentials in localStorage also retains the existing risk from scripts executing in the desk origin. These are design limits, not verified exploits. [Pairing implementation](../../apps/daemon/src/auth.ts), [redemption rate limits](../../apps/daemon/src/gateway.ts), [client storage](../../apps/desk/src/auth.ts).

### Acceptance to require when implemented

- Fresh direct start and service install both work without the user creating or retaining a token; restart preserves credentials and existing devices.
- Open desk signs in a new browser with full device access, while the root credential never appears in the browser, URL, clipboard, logs or bot environment. Confirm the grant's expiry, single use and explicit access level.
- Remote anonymous requests, limited devices and ordinary localhost visits cannot mint full access. Verify the intended daemon/origin check before transmitting a root credential.
- Existing owner-token installations and paired devices survive migration. Corrupt storage and conflicting credentials fail clearly without an unnoticed rotation.
- Clearing browser storage can be repaired from the host; an existing full device can pair another device; revocation still closes access. Loss of every trusted device and host OS access has no anonymous recovery bypass.
- Update the authoritative access documentation, README/service guidance and affected `docs/help/` topics/manifest; run `pnpm -r build` and `node scripts/verify-bot-knowledge.mjs`, then check delivery to the configured default bot, including existing installs. Use applicable non-unit verification for authentication and browser acceptance; never run unit tests or Jest. A research note alone does not prove bot knowledge delivery.

## Verification and limits

- Verified public documentation plus the pinned source snapshots above. No upstream projects were installed or launched; no end-to-end login, recovery, revocation, browser-isolation or remote-network acceptance was performed.
- No unit tests, Jest or other test commands were run. This change is research prose only.
- No shipped behavior changed, so no bot-facing knowledge delivery change is required for this research note. Any later implementation must update the authoritative access/help documentation and verify delivery to the default bot.
- This is a focused comparison, not a full security audit. In particular, it does not prove resistance to malicious code running as the daemon's OS user or scripts running inside an authenticated desk origin.
