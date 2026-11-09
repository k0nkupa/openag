# Devices settings

Devices lives at **Settings → Devices** (`#/settings/devices`). Server settings remain at `#/settings`, labelled Server. The profile link and command-menu Devices entry open the Devices page; the Server page retains a Manage devices link for existing bookmarks.

The current device appears first. Active browsers/phones show their name, access, last-seen time and who added them. Last seen is historical activity, not proof that a device is online. Revoked devices are kept in a separate collapsed history with no active controls. The daemon derives the current-device marker from the raw authenticated identity, including Full access devices.

## Pairing

Pair device opens a dialog without creating a credential. Limited access is the default. Only an owner/Full device can select Full access. Create pairing code performs the existing authenticated request; the code is single-use and expires after five minutes. The dialog shows the granted access, countdown and copy control. Closing/reopening reuses an unexpired code; it does not silently mint another. Expiry requires an explicit new-code action. Failure is displayed without an automatic retry.

A reachable desk origin gets a QR join link. A loopback address (localhost/127.x/::1) instead explains that a phone must open a reachable LAN or Tailscale desk address and enter the code. The UI does not invent a public address or change network/service configuration. There is no clipboard write until Copy code is clicked; a blocked clipboard shows a manual-copy fallback.

## Access and removal

Manage opens a device dialog. Access changes require an explicit Save access and the existing owner/Full API authorization. A successful change to the current device also updates the shared desk identity. Removing access is a separate confirmation; removing the current device warns that it signs this browser out. When a device added others, the cascade switch defaults on and shows the count of active descendants. Switching it off removes only the selected device. Existing daemon permissions, revocation, WebSocket closure and WebRTC rules are unchanged.

This session, Sign out and Access & recovery are on the Devices page. Sign out revokes the current device before clearing local access (best effort if offline). Host-authorized recovery is described in [owner access](owner-access.md); it remains a user/OS action, never a bot tool.

## Design decisions

Existing shadcn Base UI components provide buttons, badges, fields, dialogs, switch, loading skeletons, empty/error states and collapsible history. No new UI dependency or preset. Dialogs keep the house focus/close behavior and short motion; no page/list entrance animation or stagger is added. Relative times refresh each minute; the open pairing countdown refreshes each second. Reduced motion remains governed by the existing global preference.

| Before | After | Why |
| --- | --- | --- |
| Device management inside Server & devices | Dedicated Devices route and clear Server page | Keep access management in one place |
| Two prominent actions under every device | Compact device rows with one Manage trigger | Let names and access lead |
| Revoked and active devices mixed together | Active list and collapsed revoked history | Keep current access visible |
| Pairing controls always in the page | Focused pairing dialog with explicit creation | Avoid accidental grants and visual clutter |
| Full devices missing the current-device marker | Raw identity used for the marker | Make self-removal consequences clear |

Component contracts checked through the installed shadcn CLI and official [Dialog](https://ui.shadcn.com/docs/components/base/dialog), [Field](https://ui.shadcn.com/docs/components/base/field), [Switch](https://ui.shadcn.com/docs/components/base/switch) and [Collapsible](https://ui.shadcn.com/docs/components/base/collapsible) docs. Implemented behavior above follows OpenAg source; these external references describe component composition.

## Verification

Build, standalone Devices/owner-access/knowledge acceptance, desktop and 320/390px real-browser checks using temporary data, independent Standards/Spec and built-in Codex review passed. See [verification and screenshots](devices/verification.md). No unit/Jest/Vitest suite or deployment.
