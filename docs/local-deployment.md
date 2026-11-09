# Local macOS deployment and rollback

Use this procedure for an existing `com.openag.daemon` launchd installation. It changes the local service only. Obtain deployment authority first; a source merge or build does not authorize a service switch. Do not run these steps as part of documentation validation.

## 1. Pin and build the release

Merge the approved work into local `main`, preserving unrelated edits. Build a separate checkout at the committed revision so unfinished work cannot enter the release:

```sh
revision=$(git rev-parse main)
release="$HOME/Projects/OpenAg-releases/release-$revision"
git worktree add --detach "$release" "$revision"
cd "$release"
pnpm install --frozen-lockfile
pnpm -r build
node scripts/verify-bot-knowledge.mjs
```

Run the changed feature's standalone acceptance commands from its ticket. For execution ownership these include `node scripts/verify-daemon-shutdown.mjs`, `node scripts/verify-mcp-ownership.mjs` and `node scripts/verify-work.mjs`. They use disposable data. Never run unit/Jest/Vitest, including through hooks. The relay workspace build is a dry-run and does not deploy a hosted relay.

## 2. Identify and protect the existing installation

Inspect the loaded job, not just the checkout. The default plist is `~/Library/LaunchAgents/com.openag.daemon.plist`. Read its `WorkingDirectory`, `ProgramArguments`, `OPENAG_DATA` and `OPENAG_PORT`; keep secret environment values out of logs and shell history. A launchd job can run an older immutable release despite a newer `main`.

Before switching:

1. Check `/health` and authenticated owner/Full reads. Record the current PID and release path.
2. Wait for active execution to settle. If a turn remains active, resolve whether interruption is authorized before proceeding. Pending reviews are allowed to remain pending; record their IDs and decisions privately.
3. Record schema version and fingerprints of settings, permission selections, bot configuration, approvals, receipts and owner/connector keys. Never publish the underlying credentials or database rows. Device last-seen timestamps and discovery timestamps may advance; access grants must remain unchanged.
4. Run a daemon-managed backup from Settings → Server → Operations, or authenticated `POST /backups/run`. Require `{ok:true}`; inspect its `name` under `OPENAG_DATA/backups/` and verify the backup database's `PRAGMA integrity_check` is `ok`.
5. Preserve the original plist in a private rollout directory, mode 700 with files mode 600. Protect owner/connector key material as described in [backups](backup.md). Do not rotate credentials or restore a stale connector record.

Do not print the plist: it may contain credentials. The installer does not preserve every provider variable. For an existing configured service, copy the complete plist and change only its entrypoint and working directory.

## 3. Stage a configuration with the complete environment intact

Set `release` to the checkout built in step 1. Set `rollout` to a new absolute directory inside the installation's backup directory. The following edits only a private staged copy:

```sh
umask 077
mkdir -m 700 "$rollout"
export OPENAG_RELEASE_PATH="$release" OPENAG_ROLLOUT_PATH="$rollout"
python3 - <<'PY'
import os, pathlib, plistlib, subprocess
source = pathlib.Path.home() / 'Library/LaunchAgents/com.openag.daemon.plist'
folder = pathlib.Path(os.environ['OPENAG_ROLLOUT_PATH'])
release = pathlib.Path(os.environ['OPENAG_RELEASE_PATH']).resolve()
assert (release / 'apps/daemon/dist/main.js').is_file()
previous = source.read_bytes()
config = plistlib.loads(previous)
args = config['ProgramArguments']
assert args[-1].endswith('/apps/daemon/dist/main.js'), 'Inspect custom launcher before changing it'
(folder / 'previous.plist').write_bytes(previous)
args[-1] = str(release / 'apps/daemon/dist/main.js')
config['WorkingDirectory'] = str(release)
assert config['EnvironmentVariables'] == plistlib.loads(previous)['EnvironmentVariables']
(folder / 'next.plist').write_bytes(plistlib.dumps(config))
for name in ['previous.plist', 'next.plist']:
    os.chmod(folder / name, 0o600)
subprocess.run(['plutil', '-lint', str(folder / 'next.plist')], check=True)
PY
```

This retains the existing Node executable, optional `caffeinate` wrapper, environment, log locations and launchd settings. If the launcher's shape differs, inspect it and stage an equivalent narrow edit before stopping the service.

## 4. Switch once, then inspect

Recheck that no new execution started. Record the existing PID from `launchctl print`; do not assume that removing the launchd job means its old process has exited.

```sh
job="gui/$(id -u)/com.openag.daemon"
launchctl bootout "$job"
```

Wait for both the job to disappear and the recorded PID to exit. Allow the [20-second shutdown ceiling](ops.md#controlled-shutdown), with a bounded observation window of 30 seconds. On timeout or an incomplete-stop log, inspect owned processes and retained Interrupted/Unknown records before proceeding; do not issue repeated stop/start commands or replay actions.

Once stopped, install the already validated staged plist atomically and bootstrap it:

```sh
cp "$rollout/next.plist" "$HOME/Library/LaunchAgents/com.openag.daemon.plist.next"
chmod 600 "$HOME/Library/LaunchAgents/com.openag.daemon.plist.next"
mv "$HOME/Library/LaunchAgents/com.openag.daemon.plist.next" "$HOME/Library/LaunchAgents/com.openag.daemon.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.openag.daemon.plist"
```

Wait up to 45 seconds for `/health` on the configured port. If bootstrap or health fails, inspect the job and service logs before any retry. `launchctl kickstart -k` alone does not change the configured release and may terminate execution abruptly; use the controlled switch above.

## 5. Read back the deployed result

| Boundary | Required evidence |
| --- | --- |
| Process | Loaded working directory and command point to the pinned release; new PID is running; old PID is gone. |
| HTTP | Health 200; authenticated owner/Full reads for identity, rooms, bots, Work and approvals succeed. |
| Desk assets | Served HTML and its JS/CSS bytes match `apps/desk/dist` in that release. |
| Storage | Expected schema; integrity `ok`; no foreign-key errors. If migrations exist, verify them on a private backup copy before the switch. |
| Authority and evidence | Pending review IDs/decisions, configuration, permission modes, receipts, device grants and owner/connector keys match the baseline, allowing only explained changes. |
| Bot knowledge | Release handbook is packaged and its delivery verifier passes. This does not establish a live model answer. |

Record the exact source revision, release path, backup name, checks and any differences in a dated release note. Keep private evidence in the protected rollout directory. Health alone does not prove provider acceptance or user-visible behavior. Do not start live model turns or provider writes just to validate a deployment without the applicable authority.

## Roll back code

Preserve the failed release and inspect its state first. If the old code remains compatible with the current schema, stop the new job using the same bounded procedure, restore `previous.plist` with mode 600, bootstrap it and repeat the readback checks. Confirm the recorded old release still exists before switching.

A code rollback does not undo actions or migrations. Do not overwrite the live database, owner credentials or encrypted connector state with older copies. If schema compatibility or an action outcome is uncertain, stop and reconcile it; data restoration is a separate authorized procedure in [backups](backup.md).
