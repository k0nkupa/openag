# Hooks: external triggers for automations (OA-201/202/205)

## Flow
1. An automation with `triggerKind` `webhook`, `github` or `slack` gets a `hookSlug` (auto `h-…` unless given).
2. A sender POSTs to `/hooks/<slug>`. This route is the ONLY unauthenticated API route. It is registered before the
   Bearer middleware, like `/pair`, and delegates to `hooks.ts` (`createHookHandler`).
3. `hooks.ts` caps the body (256 KB) before reading it, verifies the signature over the raw bytes, checks the event
   allowlist, de-duplicates deliveries, and rate-limits failures (per client and global) and successes (per hook and
   global). Unknown slugs and bad signatures look the same to the sender.
4. `automations.fireHook` starts the run in the background and returns at once. It refuses `busy` when that automation
   already runs or its bot has a running turn in the hidden room `_hooks`.
5. The run is an UNATTENDED turn in `_hooks`. The prompt is the automation prompt, then a delimited block with the
   payload (redacted, clipped to 8000 chars) marked as untrusted DATA, then the heartbeat verdict format instruction.
6. The reply goes ONLY to the wake filter (`wake.ts`): silent, digest or ping. Dedupe, active hours, urgency and the
   daily ping budget apply, and the budget is shared with heartbeat and watchers. There is no direct path to the
   Primary. A delivered ping is the only Primary message.
7. One `_system` config event `automation_hook_fired` is written per fire (event name only, never the payload).
   `last_status`, `last_turn_id` and `last_verdict` are stored on the automation.

## Verification per kind
- `webhook`: header `x-openag-secret` (or `Authorization: Bearer`) compared by SHA-256 hash. The daemon generates a
  32-byte base64url secret, shown once on create or rotate, stored only as its hash.
- `github`: `X-Hub-Signature-256` HMAC-SHA256 of the raw body, `X-GitHub-Event` must be in `hookEvents`.
- `slack`: `X-Slack-Signature` `v0=` HMAC over `v0:<timestamp>:<body>`, timestamp skew at most 5 minutes.

## Trust model
- The raw signing secret is stored for github and slack because HMAC needs the value. Those rows are readable by
  anyone with DB access, so the DB file is as sensitive as the secret. The webhook secret is stored hashed.
- Every raw secret is registered with the redactor on create, update and sync.
- Secrets never appear in list, get, `_system` events, logs or any other automation's response. A webhook secret
  appears only in the create or rotate response, once. A github or slack secret is never echoed back.
- Payloads are untrusted. Hook and watcher turns are ISOLATED by default (no tools at all). `allowTools` opts into the
  unattended read/search/browse tools only. act-* and secrets are always denied in unattended turns unless
  `allowApprovals` is set on that automation.
- Output is wake-filtered only. Invalid or empty model output becomes `silent/invalid` and creates no Primary message.
- Caps: 50 automations total, 20 hook automations, 20 wake-mode automations (watchers and hooks), watchers at most
  every 15 minutes, cron automations at most every 5 minutes.

## Cloudflare Tunnel
Expose only `/hooks/*` publicly. See `docs/cloudflare-tunnel.md` (not yet written; OA-201 out of scope for this note).

## Review notes (Wave 2)
- Isolation: each hook/watcher automation has its OWN hidden room (`_iso-<id>`, or `_hook-<id>` when `allowTools`), so no conversation is shared between automations. For Claude bots an isolated room's session also lists Claude Code's built-in tools (Read, Glob, Grep, WebFetch, Bash...) as disallowed, because those can run without ever raising a permission request (verified: an isolated hook asked to Read a file answered NO-READ-TOOL). Codex has no equivalent switch: a Codex bot used as a hook bot can still read local files in its read-only sandbox, so prefer a Claude bot for untrusted triggers.
- Hook turns are never written to the vector recall index (`noIndex`), and hook triggers cannot set `allowApprovals`.
- Wake filter: dedupe keys are per source (an external sender cannot suppress another source's alert by reusing its key); a ping from an automation is labelled "(via <automation name>)". The daily ping budget is still shared with the heartbeat (a flood of events can use it up; per-hook rate limit 30/min).
- Rate limits: failures are charged per client; unknown-slug probes share a small global budget that only throttles other unknown-slug requests, so a flood of bad slugs cannot lock out GitHub/Slack. Oversized bodies count as failures.
- De-duplication happens only for ACCEPTED deliveries, so a delivery that was rate limited or skipped (busy) is processed when the sender retries (GitHub redelivery keeps the delivery id; Slack retries keep event_id).
- Known limits: replay. GitHub's `X-GitHub-Delivery`/`X-GitHub-Event` headers are outside the HMAC, and the plain webhook has no timestamp, so anyone holding one valid signed request can replay it (bounded by the per-hook rate limit). Behind Cloudflare, per-client limits rely on the last X-Forwarded-For entry; if "remove visitor IP headers" is on, all tunnel clients share one key.
- Busy hooks answer `202 {"status":"skipped","reason":"busy"}`; the event is dropped, not queued.

## GitHub polling (OA-215, `triggerKind: github_poll`)
- **No tunnel, no inbound route.** The daemon polls `GET https://api.github.com/repos/{owner}/{repo}/events` itself
  (outbound only). It is not reachable through `POST /hooks/*`, has no `hookSlug`, and never appears in the hook path.
- **Repo mode only.** One `owner/name` per automation (strict regex; URLs, `..`, extra path parts are refused). The
  notifications mode is a follow-up: it needs a classic token with broad scope.
- **Events** are an allowlist of names (`issues`, `pull_request`, `push`, ... up to 13, unique). Unknown names are refused.
- **Token**: a fine-grained, read-only token with access to that repository (Metadata and the read permissions of the
  events you want). It is typed once on create (or replaced by an update), stored RAW in `automations.poll_token` (the
  API needs it), registered with the redactor, and never returned by any API, log, audit event or prompt. A blank or
  absent token on update keeps the stored one. Never reuse `gh` CLI credentials.
- **First poll only records the cursor** (highest event id) and the ETag. History is never replayed. Later polls fire only
  events with a higher id that are on the allowlist, newest 10 at most per poll.
- **One run per poll** that finds new events: one unattended, isolated hidden-room run (same path as hooks), with the events
  as delimited untrusted data, output only through the wake filter. The cursor advances only when that run was handed off,
  so a busy hidden room delays the events to the next poll instead of dropping them.
- **Scheduling**: a job ticks every minute; a poll is due when `poll_next_at` has passed (default every 15 minutes, min 5,
  max 1440). `If-None-Match` makes unchanged polls a 304 (no rate-limit cost). `X-Poll-Interval`, `Retry-After` and
  `X-RateLimit-Reset` are honoured as backoff. A 401 waits an hour, a 404 waits an hour, other errors wait 5 minutes.
- **Latency**: GitHub's events API is not real time. Events can show up 30 seconds to 6 hours late, and the feed keeps only
  about 300 events from the last 30 days. Treat this as a nudge, not an alarm.
- **Status**: `last_status` holds fixed short strings only (`ok`, `ok: not modified`, `backoff: rate limited`,
  `error: token rejected`, ...). The response body and item text are never stored in the automation row.

### Review notes (OA-215)
- Poll runs never get tools (`allowTools` is refused for `github_poll`), are isolated, offline and never indexed. Tool-enabled WEBHOOK/GitHub/Slack hook runs are now also OFFLINE (search/browse denied by the gate; Claude's WebFetch/WebSearch/Bash/Write built-ins disallowed in `_hook-` rooms): read tools plus an outbound fetch would let untrusted text send local data (e.g. the DB with stored secrets) out.
- Events are fitted into the prompt as WHOLE items (free text shrunk first, oldest items dropped, `omittedOlderEvents` stated); a blind clip used to cut the newest events after the cursor had moved past them.
- Cursor/ETag are written only while the row still targets the polled repository, only when a run was handed the events; a busy/failed hand-off keeps the cursor but waits for the next interval.
- Manual "Run now" is refused (silently, keeping the status) for 30 s after a poll and during any back-off or error wait.
- Tokens must be `[A-Za-z0-9_-]{12,255}` (GitHub token alphabet), so every accepted token is one the redactor will mask.
- Known limits: only the first page (100 events) is read, so more than 100 events between polls are lost; events delivered late with a lower id than the cursor are never seen; GitHub's events API can lag by minutes to hours.
