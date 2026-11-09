# Running OpenAg always-on

- **First install:** `scripts/install-service.sh` (launchd, KeepAlive). For existing services, use the [local deployment and rollback runbook](local-deployment.md) to preserve the complete environment and verify the actual release. `OPENAG_KEEP_AWAKE=1` wraps the daemon in `caffeinate -i` so the Mac does not idle-sleep.
- **Backups:** daily, verified, 7 kept, optional `OPENAG_BACKUP_DIR` mirror. See `docs/backup.md`.
- **Liveness ping (dead-man's switch):** set `OPENAG_HEALTHCHECK_URL=https://hc-ping.com/<uuid>` (healthchecks.io, Uptime Kuma push URL, ...) in the plist environment. Every 5 minutes, while the DB answers and the scheduler runs, the daemon sends one GET there; configure the monitor to alert when pings stop. The URL is a secret (redacted, never returned by the API; `GET /ops` only says configured or not).
- **Turn budget:** `PUT /settings/limits {"maxTurnsPerBotPerDay": 200, "maxUnattendedPerDay": 50}` (0 = off). Counts turns over a rolling 24 hours, not dollars. A blocked turn records `daily turn limit reached` and a failed `turn_finished`.
- **Watchdog:** a turn silent for 10 minutes (20 unattended; `OPENAG_TURN_IDLE_MIN`) outside a pending approval is ended as failed.
- **Logs:** `openagd.out.log` / `openagd.err.log` rotate in place above 20 MB (newest 2 MB kept in `<name>.1`); adapter logs under `logs/adapter-<bot>.log` are capped at 512 KB (one rotation).
- **Diagnostics:** `scripts/diagnose-adapter.sh`.

Use `pnpm desk:open` on the daemon host for first sign-in or browser recovery. The daemon retains its owner credential automatically; existing service tokens migrate without rotation. See [owner access and recovery](notes/owner-access.md).

## Controlled shutdown

SIGINT and SIGTERM share one shutdown operation. The daemon stops admission/schedulers, marks active turns Interrupted, preserves pending reviews, revokes adapter access and cancels owned execution. It keeps SQLite open while all admitted runs, turn background jobs and existing resource owners drain. Ordinary `Runner.idle()` retains its narrower meaning; shutdown uses `drain()`. Normal idle ACP sessions and MCP connections remain reusable until their owner closes them.

The overall limit is 20 seconds. App/shell/ACP/MCP owners retain their local termination grace periods; hosted browser release remains bounded to five seconds. A successful drain exits 0 and logs `execution drained`. An owner cleanup failure, unconfirmed hosted release or deadline exits 1 with an incomplete/forced-stop message. The deadline does not prove a remote effect was cancelled, a hosted session released or an escaped process stopped. Interrupted/Unknown records and pending reviews remain available for inspection/restart; nothing is replayed by shutdown. See [execution ownership acceptance](notes/execution-ownership.md).
