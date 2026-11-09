# Reaching openagd from your other devices with Tailscale

Verified on this Mac with Tailscale 1.102.4 (`tailscale version`, `tailscale serve --help`). Nothing here is applied
automatically: `tailscale serve` changes what your tailnet can reach, so you run it yourself.

## Why Tailscale
- openagd listens on `127.0.0.1:4747` by default and speaks plain HTTP. Option B (`tailscale serve`) works with that default. Option A needs `OPENAG_HOST=0.0.0.0`, which also exposes the port to your LAN.
- Tailscale gives every device a private, encrypted WireGuard path to this Mac. Only devices signed in to your tailnet can connect.
- Per-device tokens (OA-117) add a second layer: even a device on your tailnet needs a paired token, and you can revoke it.

## Option A: reach the daemon by its tailnet address (plain HTTP, encrypted by Tailscale)
Start the daemon with `OPENAG_HOST=0.0.0.0` (set it before `scripts/install-service.sh` for the launchd service).
1. Install Tailscale on the other device and sign in to the same tailnet.
2. Find this Mac's name or IP: `tailscale status` (the first line is this machine), or `tailscale ip -4`.
3. Open `http://<machine-name>:4747` (MagicDNS) or `http://<tailscale-ip>:4747`.

The traffic between devices is encrypted by Tailscale, but the browser sees plain `http://`, which is **not a secure context**:
the desk still works, but its service worker (offline shell) and the install-to-home-screen prompt will not.

## Option B: HTTPS with `tailscale serve` (recommended)
`tailscale serve` terminates HTTPS with a real certificate for this machine's tailnet name and proxies to the daemon.
```
tailscale serve --bg 4747        # https://<machine>.<tailnet>.ts.net  ->  http://127.0.0.1:4747
tailscale serve status           # what is currently shared
tailscale serve reset            # stop sharing
```
- This needs HTTPS certificates enabled for your tailnet (admin console -> DNS -> HTTPS Certificates). `tailscale status --json` lists the name under `CertDomains`.
- It is **tailnet-only**. Do not use `tailscale funnel`, which publishes to the public internet.
- A secure context lets the desk register its service worker and be installed as an app.
- The proxy reaches the daemon from `127.0.0.1` and sends `X-Forwarded-For`; the daemon trusts that header **only** when the TCP peer is loopback, to rate-limit `/pair` per real client.

## Pairing a new device
1. On a device that is already signed in: Settings -> Devices -> **Add a device**. It shows a code like `K7QM-2XPD`, valid for 5 minutes, usable once.
2. On the new device open the desk, choose **Pair with a code**, enter it and give the device a name.
3. Revoke any device from Settings -> Devices; its open connections are closed immediately.

The first browser you use signs in with the owner token (`OPENAG_TOKEN`, see `scripts/install-service.sh` output) and is immediately
exchanged for its own device token; the owner token is not kept in the browser.

## Security notes
- Treat `OPENAG_TOKEN` as the master key: it can mint devices and is the only credential that survives revoking everything. Keep it in the launchd plist (mode 600) and nowhere else.
- Device tokens are stored only as SHA-256 hashes on the daemon. A lost device: revoke it.
- Any paired device can create pairing codes and revoke devices, so a stolen device could add more. Each device records who added it (shown as "Added by ..." in Settings -> Devices), and revoking a device offers **"Also revoke the devices it added"** (on by default; `DELETE /devices/:id?cascade=1`), which follows the whole chain. Every action is recorded as a `config` event in the hidden `_system` room.
- **Sign out** in the desk also revokes that device on the daemon, so a copied token dies with the session.
- Bot (ACP adapter) processes are started without `OPENAG_TOKEN` in their environment, so an agent cannot read the owner key.
- Keep macOS and Tailscale updated. For stronger isolation use Tailscale ACLs to limit which tailnet devices can reach port 4747/443 on this Mac.
