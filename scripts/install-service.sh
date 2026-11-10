#!/usr/bin/env bash
# Install openagd as a per-user launchd service (KeepAlive, logs to $OPENAG_DATA/logs/).
# Env overrides: OPENAG_DATA (default ~/openag-data), OPENAG_PORT (4747), OPENAG_TOKEN (reused from an existing
# install, else managed automatically by the daemon), OPENAG_BOSS_MODEL (optional, passed through), OPENAG_LAUNCHD_LABEL (com.openag.daemon).
# API keys for the API runtime are NOT copied into the plist; add them to its EnvironmentVariables yourself.
# OPENAG_SEED_SAMPLE=1 also seeds the development sample (room main + boss/coder/researcher/codex); off by default.
# OPENAG_KEEP_AWAKE=1 wraps the daemon in `caffeinate -i` so the Mac does not idle-sleep while it runs.
# Also copied when set: OPENAG_HOST (127.0.0.1 default; 0.0.0.0 for LAN access), OPENAG_SIGNIN_RELAY_URL, OPENAG_HEALTHCHECK_URL, OPENAG_BACKUP_DIR, OPENAG_TURN_IDLE_MIN, OPENAG_RTC_TURN_URLS/SECRET, SLACK_APP_TOKEN/BOT_TOKEN,
# OPENAG_OLLAMA_URL, OPENAG_TZ (values from an existing install are kept).
# Dry run: OPENAG_SERVICE_DRY_RUN=1 OPENAG_PLIST_OUT=/some/path.plist renders and lints the plist and loads nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="${OPENAG_LAUNCHD_LABEL:-com.openag.daemon}"
DATA="${OPENAG_DATA:-$HOME/openag-data}"
DATA="${DATA/#\~/$HOME}"
PORT="${OPENAG_PORT:-4747}"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
DRY_RUN="${OPENAG_SERVICE_DRY_RUN:-}"
[ -z "$DRY_RUN" ] || DEST="${OPENAG_PLIST_OUT:?set OPENAG_PLIST_OUT for a dry run}"
TEMPLATE="$ROOT/scripts/launchd/com.openag.daemon.plist"
DOMAIN="gui/$(id -u)"

open_command() { printf '  open:   cd %q && OPENAG_DATA=%q pnpm desk:open\n' "$ROOT" "$DATA"; }

die() { echo "install-service: $*" >&2; exit 1; }
[ "$(uname)" = "Darwin" ] || die "launchd is macOS only"
NODE="$(command -v node)" || die "node not found"
[ "$("$NODE" -p 'process.versions.node.split(".")[0]')" -ge 22 ] || die "Node 22+ required (found $("$NODE" -v))"

# Preserve explicit and legacy service credentials; new installs use private daemon-managed storage.
TOKEN="${OPENAG_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$DEST" ]; then
  TOKEN="$(plutil -extract EnvironmentVariables.OPENAG_TOKEN raw -o - "$DEST" 2>/dev/null || true)"
fi

if [ -n "${OPENAG_SKIP_BUILD:-}" ]; then echo "build skipped (already built)"; else echo "building"; (cd "$ROOT" && pnpm -r build >/dev/null); fi
mkdir -p "$DATA/logs" "$(dirname "$DEST")"
# Provision before an optional seed creates the DB. This prints no credential and does not start the daemon.
if [ -z "$DRY_RUN" ]; then
  OPENAG_DATA="$DATA" OPENAG_TOKEN="$TOKEN" "$NODE" --input-type=module -e 'const {resolveOwnerCredential}=await import(process.argv[1]); resolveOwnerCredential(process.env.OPENAG_DATA,process.env.OPENAG_TOKEN);' "$ROOT/apps/daemon/dist/owner-credential.js"
fi
# The development sample (room main + boss/coder/researcher/codex) is opt-in: a normal install starts with the default bot only.
if [ "${OPENAG_SEED_SAMPLE:-}" = "1" ] && [ -z "$DRY_RUN" ]; then
  OPENAG_DATA="$DATA" "$NODE" "$ROOT/apps/daemon/dist/seed.js" >/dev/null
fi

EXISTING_PLIST="$DEST"
if [ -f "$DEST" ]; then
  cp "$DEST" "$DEST.prev"
  chmod 600 "$DEST.prev" # it holds the token too; removed below
fi
EXISTING_PLIST="${DEST}.prev"
cp "$TEMPLATE" "$DEST"
plutil -replace Label -string "$LABEL" "$DEST"
if [ -n "${OPENAG_KEEP_AWAKE:-}" ]; then
  [ -x /usr/bin/caffeinate ] || die "OPENAG_KEEP_AWAKE needs /usr/bin/caffeinate"
  plutil -replace ProgramArguments -json "$("$NODE" -e 'console.log(JSON.stringify(process.argv.slice(1)))' /usr/bin/caffeinate -i "$NODE" "$ROOT/apps/daemon/dist/main.js")" "$DEST"
else
  plutil -replace ProgramArguments -json "$("$NODE" -e 'console.log(JSON.stringify(process.argv.slice(1)))' "$NODE" "$ROOT/apps/daemon/dist/main.js")" "$DEST"
fi
plutil -replace WorkingDirectory -string "$ROOT" "$DEST"
plutil -replace StandardOutPath -string "$DATA/logs/openagd.out.log" "$DEST"
plutil -replace StandardErrorPath -string "$DATA/logs/openagd.err.log" "$DEST"
plutil -replace EnvironmentVariables.OPENAG_DATA -string "$DATA" "$DEST"
plutil -replace EnvironmentVariables.OPENAG_PORT -string "$PORT" "$DEST"
[ -z "$TOKEN" ] || plutil -replace EnvironmentVariables.OPENAG_TOKEN -string "$TOKEN" "$DEST"
SERVICE_PATH="$(printf '%s' "$(dirname "$NODE"):$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" | awk -v RS=: '!seen[$0]++ { printf "%s%s", sep, $0; sep = ":" }')"
plutil -replace EnvironmentVariables.PATH -string "$SERVICE_PATH" "$DEST"
[ -z "${OPENAG_BOSS_MODEL:-}" ] || plutil -insert EnvironmentVariables.OPENAG_BOSS_MODEL -string "$OPENAG_BOSS_MODEL" "$DEST"
# Optional settings and secrets, copied into the plist (mode 600) ONLY when set in this shell. An existing install's values
# are kept when the variable is not set now, so re-running the installer never silently drops them.
for NAME in OPENAG_HOST OPENAG_SIGNIN_RELAY_URL OPENAG_SIGNIN_ROUTE OPENAG_PUBLIC_URL OPENAG_CONNECTOR_KEY OPENAG_COMPOSIO_REDIRECT_URI OPENAG_GOOGLE_CLIENT_ID OPENAG_GOOGLE_CLIENT_SECRET OPENAG_GOOGLE_REDIRECT_URI OPENAG_HEALTHCHECK_URL OPENAG_BACKUP_DIR OPENAG_TURN_IDLE_MIN OPENAG_RTC_TURN_URLS OPENAG_RTC_TURN_SECRET SLACK_APP_TOKEN SLACK_BOT_TOKEN OPENAG_OLLAMA_URL OPENAG_TZ; do
  VALUE="${!NAME:-}"
  if [ -z "$VALUE" ] && [ -f "$EXISTING_PLIST" ]; then
    VALUE="$(plutil -extract "EnvironmentVariables.$NAME" raw -o - "$EXISTING_PLIST" 2>/dev/null || true)"
  fi
  [ -z "$VALUE" ] || plutil -replace "EnvironmentVariables.$NAME" -string "$VALUE" "$DEST"
done
rm -f "$DEST.prev"
chmod 600 "$DEST" # holds the access token
plutil -lint "$DEST" >/dev/null || die "generated plist is invalid: $DEST"

if [ -n "$DRY_RUN" ]; then
  echo "dry run: rendered $DEST (nothing loaded)"
  open_command
  exit 0
fi

if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN/$LABEL" || true
  # bootout returns before launchd has finished removing the job; bootstrapping too early fails with "Input/output error".
  for _ in $(seq 1 50); do
    launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break
    sleep 0.2
  done
fi
BOOTSTRAPPED=""
for _ in 1 2 3 4 5; do
  if launchctl bootstrap "$DOMAIN" "$DEST" 2>/dev/null; then BOOTSTRAPPED=1; break; fi
  sleep 1
done
[ -n "$BOOTSTRAPPED" ] || launchctl bootstrap "$DOMAIN" "$DEST" # last try, showing launchd's own error

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo "installed and running: $LABEL on port $PORT"
    echo "  data:   $DATA"
    echo "  logs:   $DATA/logs/"
    echo "  plist:  $DEST (mode 600; preserves any legacy token)"
    open_command
    exit 0
  fi
  sleep 0.5
done
die "daemon did not become healthy; see $DATA/logs/openagd.err.log"
