#!/usr/bin/env bash
# Compare the environment launchd gives openagd (and so the Claude/Codex ACP adapters) with an interactive shell, and run
# a one-shot `claude -p` under exactly the service's environment. Prints env KEY NAMES only, never values.
# Env: OPENAG_DATA (default ~/openag-data), OPENAG_LAUNCHD_LABEL (com.openag.daemon),
#      OPENAG_PLIST_OUT (plist to inspect; default ~/Library/LaunchAgents/<label>.plist),
#      OPENAG_DIAG_SKIP_CLAUDE=1 (skip the live `claude -p` call, which spends one tiny Claude turn).
set -euo pipefail

LABEL="${OPENAG_LAUNCHD_LABEL:-com.openag.daemon}"
DATA="${OPENAG_DATA:-$HOME/openag-data}"
DATA="${DATA/#\~/$HOME}"
PLIST="${OPENAG_PLIST_OUT:-$HOME/Library/LaunchAgents/$LABEL.plist}"
[ -f "$PLIST" ] || { echo "diagnose-adapter: no plist at $PLIST (is the service installed?)" >&2; exit 1; }

keys_of_plist() { plutil -extract EnvironmentVariables json -o - "$PLIST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Object.keys(JSON.parse(s)).sort().join("\n")))'; }
SERVICE_KEYS="$(keys_of_plist)"
SHELL_KEYS="$(env | cut -d= -f1 | sort)"

echo "== env keys the SERVICE sets explicitly (launchd adds a few more, e.g. HOME/USER/LOGNAME/SHELL/TMPDIR)"
echo "$SERVICE_KEYS"
echo
echo "== keys present in your interactive shell but NOT set by the service plist"
comm -13 <(echo "$SERVICE_KEYS") <(echo "$SHELL_KEYS") | tr '\n' ' ' | fold -s -w 100
echo
echo
echo "== adapter logs (last lines, already redacted)"
for f in "$DATA"/logs/adapter-*.log; do
  [ -f "$f" ] || continue
  echo "-- $f"
  tail -n 15 "$f"
done
echo
echo "== service error log (last 15 lines)"
[ -f "$DATA/logs/openagd.err.log" ] && tail -n 15 "$DATA/logs/openagd.err.log" || echo "(none)"

if [ -z "${OPENAG_DIAG_SKIP_CLAUDE:-}" ] && command -v claude >/dev/null 2>&1; then
  echo
  echo "== one-shot claude -p under the SERVICE environment (PATH/HOME + plist keys only)"
  SERVICE_ENV=()
  while IFS= read -r k; do
    case "$k" in OPENAG_TOKEN) continue ;; esac
    v="$(plutil -extract "EnvironmentVariables.$k" raw -o - "$PLIST" 2>/dev/null || true)"
    SERVICE_ENV+=("$k=$v")
  done <<<"$SERVICE_KEYS"
  start=$(date +%s)
  if out="$(env -i HOME="$HOME" USER="$USER" LOGNAME="$USER" "${SERVICE_ENV[@]}" claude -p "Reply with the single word ok." 2>&1)"; then
    echo "claude answered in $(( $(date +%s) - start ))s: $(printf '%s' "$out" | head -c 80)"
  else
    echo "claude FAILED after $(( $(date +%s) - start ))s (exit $?): $(printf '%s' "$out" | head -c 200)"
  fi
fi
