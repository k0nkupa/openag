#!/usr/bin/env bash
# Stop and remove the launchd service. Leaves $OPENAG_DATA (database, bot files, logs) untouched.
set -euo pipefail

LABEL="${OPENAG_LAUNCHD_LABEL:-com.openag.daemon}"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN/$LABEL"
  echo "stopped $LABEL"
else
  echo "$LABEL was not loaded"
fi
if [ -f "$DEST" ]; then rm -f "$DEST"; echo "removed $DEST"; fi
echo "data directory left in place"
