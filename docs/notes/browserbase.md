# Browserbase computer driver (OA-206)

Code: `apps/daemon/src/computer/browserbase.ts` (driver), `apps/daemon/src/computer/cdp.ts` (minimal CDP client).
Shared driver contract: `apps/daemon/src/computer/driver.ts`.

## Verified (docs.browserbase.com, 2026-10-28)

- Base URL `https://api.browserbase.com`, auth header `X-BB-API-Key`.
- `POST /v1/sessions`: optional `projectId`, `timeout` (60..21600 s), `browserSettings.viewport`, `region`. Returns 201 with `id`, `status`, `connectUrl` (CDP WebSocket URL, may carry the key: a secret), `expiresAt`, `projectId`.
- `POST /v1/sessions/{id}` with `{"status":"REQUEST_RELEASE"}` asks Browserbase to end the session.
- `GET /v1/sessions/{id}/debug` returns `debuggerFullscreenUrl`, `debuggerUrl`, `pages`, `wsUrl` (live view; a credential).

## Inferred (NOT verified against a live session)

- `GET /v1/sessions/{id}` returns the session object with `status` (assumed; a 404 is treated as "session gone").
- CDP over `connectUrl` is standard Chrome DevTools Protocol (as Playwright `connectOverCDP`). Target/Input/Page calls used: `Target.getTargets`, `Target.createTarget`, `Target.attachToTarget` (flatten), `Page.captureScreenshot`, `Page.navigate`, `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Input.insertText`.
- The live-view URL shape (`debuggerFullscreenUrl` on `*.browserbase.com`, https) is validated by the driver and is inferred from the docs.

## Design

- One session at a time, held in memory (id + connectUrl). The connectUrl never leaves `browserbase.ts`.
- `stop` == `destroy` == release: a session cannot be suspended or resumed. `start` on an absent box creates one.
- `inspect`: RUNNING -> running; PENDING -> unknown; ERROR/TIMED_OUT/COMPLETED or 404 -> session forgotten, absent.
- Actions go over CDP to the first page target (attached once per connection; any CDP failure resets the connection). Supported argv: `click X Y [button]`, `type -- TEXT`, `key K`, `hotkey A+B` (modifiers ctrl/alt/shift/meta, cmd/super = meta), `scroll DIR N` (100 px per step, N clamped 1..50), `open -- URL` (http/https only).
- No shell: `shell()` always refuses. Capabilities `{ shell: false, view: "external" }`.
- Live view: `GET /debug`, `debuggerFullscreenUrl` returned as an external link with a 30 minute expiry.
- Security: API key only in the `X-BB-API-Key` header; `redirect: "error"`; 20 s `AbortSignal.timeout`; 1 MB response cap; session id validated `^[A-Za-z0-9_-]{6,80}$` before use in a path; connectUrl must be `wss:` on `browserbase.com`; all errors are ComputerError with fixed messages.

## Configuration

- `BROWSERBASE_API_KEY` (required).
- `BROWSERBASE_PROJECT_ID` (optional; inferred from the key when omitted).

## Known gaps

- Live-view interactivity and URL shape are unverified against a real session.
- No session resume: a restart of the daemon forgets the session (it keeps running until Browserbase times it out).
- A failed release keeps the in-memory handle so a retry is possible.
- Costs browser minutes; the default session timeout is 1800 s.
- Wiring into the daemon config (selecting this backend) is not part of this change.

## Backend architecture and review notes (OA-206)
- `computer/driver.ts` is the single generic `Computer` for every non-Cua backend (one mutex, input guard for takeover, screenshot validation/storage, redaction, audit, status cached for 5 s because a hosted backend's inspect is a REST call). `computer/router.ts` is the one `Computer` the daemon sees; it forwards to the backend chosen by the OWNER-only `computer.backend` setting and switches only between calls, never while busy, while a human holds control, or while a computer action awaits approval.
- Credentials only from the environment (`BROWSERBASE_API_KEY`, optional `BROWSERBASE_PROJECT_ID`), validated, never returned by any API, and stripped from the environment of bot (ACP) processes. Without them the backend is inert: nothing is created or contacted.
- Shutdown release failures propagate to the daemon stop verdict; rejected or unconfirmed stop states cannot report a graceful shutdown. The existing five-second bound still applies. This is controlled local evidence, not live provider release acceptance.
- Hosted sessions: switching away from Browserbase, and daemon shutdown (bounded), release the session (`REQUEST_RELEASE`). Revoking the device that holds an external live view also releases it, because the live-view URL itself cannot be revoked; a plain hand-back leaves the session (and the link, which expires after 30 minutes) alone. LIMITS: a daemon crash or a create that times out after Browserbase made the session leaves an untracked session until its own timeout (30 minutes); the session id is not persisted.
- An external takeover is not subject to the idle timer (the viewer reports no activity to us): it ends on hand-back, revoke, or the link's own expiry.
- `computer_shell` is not offered (and shell calls are refused) on a backend without a shell.
