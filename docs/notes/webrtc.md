# WebRTC join-without-VPN (OA-214 design, OA-305..307 implementation)

STATUS: the daemon side (`rtc.ts`, setting `rtc`, OFF by default, owner-only) and the desk transport (`apps/desk/src/rtc/`) exist; the UI wiring and a real two-device NAT test are MANUAL/pending (see the ticket logs). The original spike is `scripts/spikes/webrtc-spike.mjs`. Everything below describes what the daemon enforces.

## Goal
A phone reaches the desk without Tailscale or a public port, with device pairing still required. Thin client against the
existing gateway, not a rewrite. Tailscale stays the default private path.

## Spike result (verified)
`werift@0.25.2` (pure TypeScript, MIT, Node >= 22, no native build; alternative `node-datachannel@0.33.6`, native
libdatachannel bindings, MPL-2.0) lets two peers open a data channel. In the spike the "daemon" peer answers each request
frame `{id, method, path, headers, body}` by calling the REAL gateway (`createGateway(...).fetch`), so auth is the gateway's:
`/health` 200, `/whoami` without token 401, with a device token 200, with a bad token 401, a path outside the allow-list 400.
Run: `pnpm -r build && cd scripts/spikes && npm i --no-save werift@0.25.2 && node webrtc-spike.mjs`. Signaling is in-memory,
no STUN/TURN: it proves the transport, not NAT traversal.

## Design
- Transport: one data channel `openag-api` per paired device. Frames: request/response (HTTP-shaped, JSON, <= 64 KB, an
  allow-list of API paths, GET/POST) and a stream subscription that replaces `/stream` (same ledger events).
- Phone: the desk PWA gets a small transport shim (a `fetch`/stream adapter) selected when the LAN/Tailscale URL is unreachable.
- Signaling (outbound-only on both sides; pick one in Phase 4): (a) a tiny rendezvous relay (a Cloudflare Worker/Durable
  Object, same account as the `/hooks` tunnel), (b) an ntfy topic (already integrated, topic is a secret), (c) copy/QR of
  offer/answer (no server; fine for the first pairing).
- NAT: STUN (public) and optional coturn TURN; ICE candidates reveal the daemon's addresses to the rendezvous, which is acceptable.
- Pairing binding (the key rule): an offer is only accepted if it carries an HMAC over the offer's DTLS fingerprint,
  keyed by (new device) the unused 8-char pairing code, or (known device) a key derived from its device token. A
  signaling MITM therefore cannot swap fingerprints, and a stranger who finds the rendezvous id cannot get a channel.
- Even with a channel, every frame still carries the device Bearer token and goes through the normal gateway auth, so the
  signaling layer is NOT an auth boundary. The OWNER token is never accepted over RTC (owner-only routes stay LAN/Tailscale).

## Threat model
- Who can signal: anyone who learns the rendezvous id. Mitigations: HMAC-bound offers, size caps, rate limits, at most N
  concurrent peers, offers expire in minutes. A bad offer is dropped silently (no oracle).
- A compromised rendezvous can drop or delay, and can see peer addresses; it cannot authenticate (no key) or read data (DTLS).
- A stolen device token over RTC equals a stolen token over HTTP: revocation (`DELETE /devices/:id`) must also close the peer connection.
- Abuse of the data channel: path allow-list, frame cap, per-peer rate limit, no raw WebSocket/Upgrade passthrough.

## Not done (Phase 4)
Browser transport shim and service-worker interplay; the signaling relay; TURN; reconnection/ICE restart; stream
subscription frames; revoke-closes-peer; peer and rate limits; per-device audit events; a real two-device test over NAT.


## As built (OA-305) and what the security review changed
- Signaling: an ntfy-compatible server (https only; http only for localhost), a SECRET topic (`POST /rtc/topic`, owner only, never listed by `GET /settings`, rotated automatically when any device is revoked). Offers go to the topic, answers to `<topic>-<id>`.
- Offer MAC: `HMAC-SHA256(key, id \n ts \n dtls-fingerprint \n kind \n device)`; the SDP must have exactly ONE `a=fingerprint` line and it must be sha-256 (werift verifies against the strongest algorithm present, so an extra sha-512 line could smuggle another certificate). Keys: `device` = sha256(token) hex; `pair` = a random per-invite SECRET minted by `POST /rtc/invite` (memory only, 5 min). The 8-char pairing code is NOT a MAC key: 40 bits can be cracked offline by anyone who saw the offer.
- ANSWER MAC (review finding 1): the daemon signs its answer with the same key over the ANSWER's own fingerprint (`kind=answer`); the phone must verify it before applying the SDP, otherwise anyone who can publish to the sub-topic could complete DTLS and steal the first frame's token or the pairing code.
- Pair peers: only `POST /pair` and `GET /health`, at most 2, absolute 3 min lifetime. Device peers: bound to one device, max 2 per device, 4 in total (slots reserved before async setup), 15 min idle, 60 frames per 10 s. Allowed paths are matched against the URL as parsed (no `%`, `\`, `//`; the parsed path must equal the sent path, defeating `%2e%2e`), and `/settings` is not reachable over RTC. The owner token is refused. Only `authorization` (rebuilt from the validated token) and a printable `content-type` are forwarded.
- A frame handler can never throw into the process: header values are validated and every handler promise is caught.
- Events: same as `/stream` minus hidden rooms; an event over 60 KB is replaced by a stub (`payload.truncated`) because SCTP messages are limited to 64 KB. Responses are chunked at 12 KB, 256 KB max.
- Audit (`_system`): `rtc_peer` open/close with device id and counts, `rtc_offer_rejected` (rate limited), `rtc_topic_rotated`. Invites are audited as `pairing_code_created` (via rtc).

## Known limits (documented, not fixed)
- Anyone holding the topic can flood it (30 offers/min and 60 bad-MAC offers/10 min are global limits), which can delay legitimate joins; rotating the topic fixes it. A copy of the DB can sign device offers (the key is the stored token hash) but not frames. After a daemon restart an authenticated offer captured within its 2 minute window could be replayed (it only holds a slot; DTLS cannot complete). `/pair` over RTC shares one rate-limit bucket. ICE candidates chosen by an authenticated offerer make the daemon send STUN checks to those addresses. No backpressure on the data channel beyond the size caps. Hidden rooms are reachable by id exactly as over HTTP for a device.
- An ntfy server turns messages over 4096 bytes into attachments; an answer over 3800 bytes is refused (a werift answer with many candidates could hit it).

## TURN (OA-307)
Optional, env only: `OPENAG_RTC_TURN_URLS` + `OPENAG_RTC_TURN_SECRET` (see `docs/coturn.md`). Only short-lived REST credentials leave the daemon (invites, its own peer); the secret is never stored, returned or visible to bots. Reconnect: a closed/failed peer is simply gone on the daemon; the phone reconnects by making a NEW offer (new id, fresh MAC) with backoff, and re-reads the topic via a new invite if it was rotated by a revoke. ICE restart of a live peer is not implemented (a new offer replaces it).
