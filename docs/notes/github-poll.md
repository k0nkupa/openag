# GitHub polling (OA-215): verified API facts

Checked against docs.github.com on 2026-10-28.

## Repository events: `GET /repos/{owner}/{repo}/events`
- Headers: `Accept: application/vnd.github+json`, `Authorization: Bearer <token>`, `X-GitHub-Api-Version`.
- `per_page` default 30, max 100. Newest first. Event ids are increasing numeric strings.
- Latency 30 seconds to 6 hours (not real time). Keeps at most 300 events from the last 30 days.
- "Optimized for polling with the ETag header": send the quoted ETag in `If-None-Match`; no news gives `304 Not Modified`, which does NOT use the rate limit.
- `X-Poll-Interval` is the minimum seconds between polls and may grow under load: obey it.
- Fields: `id`, `type` (`IssuesEvent`, `PullRequestEvent`, `PushEvent`, ...), `actor.login`, `repo.name`, `payload` (`payload.action`, ...), `created_at`.

## Notifications: `GET /notifications` (NOT implemented in OA-215)
- Classic personal access tokens ONLY (`notifications` or `repo` scope); fine-grained tokens are not supported. That is a much broader credential than a fine-grained read-only token, so this mode is a follow-up, not part of OA-215.
- Polling uses `Last-Modified` / `If-Modified-Since`, `X-Poll-Interval`, 304 does not use rate limit.

## Design consequences
- Mode `repo` only: one repo per automation, a read-only token with access to that repo (fine-grained: Metadata + the read permissions of the events you care about; unverified which exact permission the events endpoint needs, so the desk says "read-only access to the repository").
- Fixed host `api.github.com`, repo string validated by a strict regex, redirects refused (a redirect could carry the token to another host).
- First poll only records the cursor (highest event id). Later polls fire only events with a higher id.
- One poll that finds new allowed events starts ONE unattended isolated run with all of them (max 10) as untrusted data, output through the wake filter.
- Back off on 403/429 (`Retry-After`, `X-RateLimit-Reset`), and obey `X-Poll-Interval`.
