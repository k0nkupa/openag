# Owner access and host recovery

OpenAg creates and keeps its owner credential. The normal browser/phone flow uses a revocable device credential; users do not need to remember or copy an owner token.

## First sign-in and recovery

1. Start the daemon, or install the service. No `OPENAG_TOKEN` is needed for a fresh workspace.
2. From this repository on the **computer running the daemon**, as its OS user, run `pnpm desk:open`. Set `OPENAG_DATA` to the same directory if this installation uses a custom location. The command requires an existing build and a running daemon; it does not install, start or restart a service.
3. OpenAg opens the local desk with a one-use pairing link. Confirm the browser's name and Full access within five minutes. The browser stores only its revocable `oag_` device credential. If this browser already has valid Full access, it keeps that session.

Repeat the same host command if browser storage is cleared or no trusted device remains. It can also pair a browser that is currently signed in with Limited access. Cancel or a failed pairing leaves that browser's current access intact. A successful replacement does not revoke the old device or unrelated devices; review them in Settings, Devices.

The host command opens the browser on the daemon computer. It is not a remote-phone login link: its origin is pinned to `127.0.0.1` and the daemon's actual port. On another device, use a trusted desk's Settings, Devices to create a pairing code/QR for a reachable desk address. Limited remains the default; Full access must be chosen by an owner/full device. WebRTC restrictions and its separate invite flow are unchanged.

## Credentials and migration

The private `$OPENAG_DATA/.owner/` directory is mode 700; `credential.json` and `access.sock` are owner-only. The daemon creates a cryptographically random credential once and reuses it. If publication was interrupted after linking the file, startup removes only matching private staging hard links and keeps the original credential; unrelated hard links are refused. The installer prints a shell-quoted `OPENAG_DATA` command for the selected installation, including custom paths. The launcher does not read it: it requests a grant through the protected local Unix socket. No new HTTP ownership route exists. Visiting localhost grants no authority.

Existing `OPENAG_TOKEN` values, including service-plist values, are preserved and imported to the private credential file on first startup. Existing device tokens, access levels, database and pairing rules are preserved. Later starts can use the stored credential without the environment variable. A different explicit token is refused rather than silently rotating the credential. A legacy workspace with a DB but no saved credential needs its original `OPENAG_TOKEN` once; the installer reuses the original service-plist value automatically. Legacy token sign-in and temporary Owner actions remain under explicit legacy UI for compatibility.

Unreadable/corrupt credentials, unsafe ownership/permissions, symlinks, a missing credential in initialized private state, or conflicting secrets fail clearly. Restore the original protected credential; OpenAg does not generate a replacement to hide the error. Keep the private state in your secured host backup. SQLite backups alone do not contain it. Losing both the protected host state and the original legacy credential is not repaired by an anonymous recovery endpoint.

The credential file is outside SQLite and automatic SQLite backups, excluded from data-repository git commits, and never part of bot help/memory. File-loaded credentials are registered with the redactor. The owner secret remains separate from `OPENAG_CONNECTOR_KEY`; this feature does not configure or migrate Google/Composio encryption keys or OAuth.

## Limits

- macOS and Linux hosts only. A desktop session/browser opener is needed. Long data paths use a hash-named socket under the private mode-700 `/tmp/openag-owner-<OS uid>/` directory so macOS socket-path limits do not break existing installations. No TCP fallback is used.
- At most five unused pairing codes can be active. Repeatedly opening without redeeming can reach this limit; wait five minutes. Grants are single use and never retried automatically after an uncertain redemption.
- The temporary link is a bearer credential until redeemed. It is removed from the address bar; the owner secret is never placed in the URL, clipboard or command output. Unlike OpenClaw's signed-device bootstrap, these existing pairing codes are not cryptographically bound to a device identity.
- Host recovery trusts the daemon's OS user. It is not a tool offered to bots and gives no new tool-policy authority. Processes running as that OS user are not isolated from each other by this feature. Browser localStorage still has the existing risk from scripts executing in the desk origin.
- These are source behavior and controlled verification claims. They do not establish deployment, a real phone's acceptance, or protection from a compromised host OS account.

## Verification

`pnpm -r build`; `node scripts/verify-owner-access.mjs`; `node scripts/verify-bot-knowledge.mjs`. The owner-access script uses temporary data, synthetic credentials, the real socket/gateway and real React Login/App code; it also starts the actual daemon twice in an isolated HOME without an owner environment token. It runs no unit/Jest/Vitest suite. Physical-device and deployment checks are separate.
