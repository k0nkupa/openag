# Backups

The daemon takes a verified online backup of `openag.db` every day (default 04:00 local, newest 7 kept) into
`$OPENAG_DATA/backups/openag-YYYYMMDD-HHMMSS.db` (mode 600, one self-contained file). The database holds the ledger,
approvals, settings, devices and automations; MEMORY.md and skills live in the data git repo, not in the DB.

- Settings: Settings API key `backup` `{enabled, time, keep}` (`PUT /settings/backup`).
- Status: `GET /backups`. Take one now: `POST /backups/run` (owner or Full access device only).
- Off-machine copy: set `OPENAG_BACKUP_DIR=/absolute/path` (must already exist, e.g. a synced or external folder). The newest backup is copied there and pruned to `keep`.
- Backups are NOT encrypted. Treat them like the live DB (device token hashes, settings, redacted history).

## Restore (manual, with the daemon stopped)
```
scripts/uninstall-service.sh            # or: launchctl bootout gui/$(id -u)/com.openag.daemon
cp ~/openag-data/openag.db ~/openag-data/openag.db.before-restore     # keep what you had
rm -f ~/openag-data/openag.db-wal ~/openag-data/openag.db-shm
cp ~/openag-data/backups/openag-YYYYMMDD-HHMMSS.db ~/openag-data/openag.db
scripts/install-service.sh
```
A backup from an older build is migrated on start. Pending approvals in the restored copy come back as they were.

Owner access state under `$OPENAG_DATA/.owner/` is not in SQLite backups. Preserve it in your secured host backup and restore it with its mode-700 directory/mode-600 credential. Keep existing service `OPENAG_TOKEN` configuration when restoring a legacy installation. See [owner access and recovery](notes/owner-access.md); restoring a DB alone into a new workspace does not restore the owner credential.

Connector credentials also need a secured host backup: preserve `$OPENAG_DATA/.connectors/` (directory 700, key 600), `connector-google.enc` and `connector-composio.enc` (600), with any installation address/provider-client configuration. The connector key is separate from the owner credential. Restore the matching key and encrypted files together; a DB-only restore does not restore provider access. Existing connector-key environment overrides must match the saved key. Missing or corrupt original keys are not automatically replaced. See [Composio setup and recovery](composio.md).

## Status after restart

The latest audited backup attempt is restored from the daemon's `_system` ledger when backup services start. A failed attempt stays failed after restart. Existing filenames alone do not prove success: if no audited result exists, the desk says that files exist with no recorded run result. Server, Operations shows configuration and the file list separately.
