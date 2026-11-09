#!/usr/bin/env bash
# Phase 1 end-to-end check: real daemon + real Claude Code over ACP, a restart while an approval is pending.
# Uses a temp OPENAG_DATA and a free port. Spends a few small Claude Code turns of the machine's Claude login.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="$(mktemp -d)"
TOKEN="e2e-$$-$RANDOM"
PORT="${OPENAG_E2E_PORT:-$(node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})')}"
BASE="http://127.0.0.1:$PORT"
DAEMON_PID=""
FAILED=0

log()  { printf '[e2e] %s\n' "$*"; }
fail() { printf '[e2e] FAIL: %s\n' "$*" >&2; FAILED=1; exit 1; }

stop_daemon() {
  if [ -n "$DAEMON_PID" ] && kill -0 "$DAEMON_PID" 2>/dev/null; then
    kill "$DAEMON_PID" 2>/dev/null
    for _ in $(seq 1 50); do kill -0 "$DAEMON_PID" 2>/dev/null || break; sleep 0.1; done
    kill -9 "$DAEMON_PID" 2>/dev/null
  fi
  DAEMON_PID=""
}
cleanup() {
  stop_daemon
  if [ "$FAILED" = 1 ]; then log "daemon log kept at $DATA/daemon.log"; else rm -rf "$DATA"; fi
}
trap cleanup EXIT

api() { curl -fsS -H "Authorization: Bearer $TOKEN" "$@"; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(eval(process.argv[1]))})' "$1"; }

start_daemon() {
  OPENAG_DATA="$DATA" OPENAG_TOKEN="$TOKEN" OPENAG_PORT="$PORT" node "$ROOT/apps/daemon/dist/main.js" >>"$DATA/daemon.log" 2>&1 &
  DAEMON_PID=$!
  for _ in $(seq 1 100); do
    curl -fsS "$BASE/health" >/dev/null 2>&1 && return 0
    kill -0 "$DAEMON_PID" 2>/dev/null || fail "daemon exited during startup (see $DATA/daemon.log)"
    sleep 0.1
  done
  fail "daemon did not become healthy"
}

wait_for() { # description timeout_seconds command...
  local what="$1" timeout="$2"; shift 2
  for _ in $(seq 1 "$timeout"); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  fail "timed out waiting for: $what"
}
pending_count() { api "$BASE/approvals?status=pending" | json 'j.approvals.length'; }
has_pending()   { [ "$(pending_count)" -ge 1 ]; }
has_file()      { [ -f "$DATA/bots/coder/work/hello.txt" ]; }
turn_done()     { [ "$(api "$BASE/rooms/main/events" | json 'j.events.filter(e=>e.type==="turn_finished").length')" -ge 1 ]; }

log "building"
(cd "$ROOT" && pnpm -r build >/dev/null) || fail "build failed"

log "seeding + starting daemon on :$PORT (data: $DATA)"
OPENAG_DATA="$DATA" node "$ROOT/apps/daemon/dist/seed.js" >/dev/null || fail "seed failed"
start_daemon

log "1. post message, wait for a pending approval"
api -X POST -H 'content-type: application/json' -d '{"text":"@coder create hello.txt containing hi"}' "$BASE/rooms/main/messages" >/dev/null || fail "post message"
wait_for "pending approval" 120 has_pending
APPROVAL_ID="$(api "$BASE/approvals?status=pending" | json 'j.approvals[0].id')"
[ -f "$DATA/bots/coder/work/hello.txt" ] && fail "hello.txt exists before approval (gate bypassed)"
log "   pending approval $APPROVAL_ID, file not yet written"

log "2. stop the daemon, start it again, approval is still pending"
stop_daemon
start_daemon
[ "$(api "$BASE/approvals?status=pending" | json 'j.approvals[0].id')" = "$APPROVAL_ID" ] || fail "approval did not survive the restart"
log "   approval survived the restart"

log "3. accept, hello.txt appears"
REVIEW_VERSION=$(api "$BASE/approvals/$APPROVAL_ID" | json 'j.approval.reviewVersion')
api -X POST -H 'content-type: application/json' -d "{\"kind\":\"accept\",\"reviewVersion\":\"$REVIEW_VERSION\"}" "$BASE/approvals/$APPROVAL_ID" >/dev/null || fail "accept"
wait_for "hello.txt" 180 has_file
wait_for "turn_finished" 60 turn_done
log "   hello.txt: $(tr -d '\n' < "$DATA/bots/coder/work/hello.txt")"

log "4. ledger order: message -> route -> approval_requested -> approval_decided -> turn_finished"
api "$BASE/rooms/main/events" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const types=JSON.parse(s).events.map(e=>e.type);
  const want=["message","route","approval_requested","approval_decided","turn_finished"];
  let i=0; for(const t of types) if(t===want[i]) i++;
  if(i!==want.length){console.error("types:",types.join(","));process.exit(1)}
  console.log("   ledger:",types.join(" "));
})' || fail "ledger order"

log "5. /health reports vec_version"
VEC="$(curl -fsS "$BASE/health" | json 'j.vec_version')"
[ -n "$VEC" ] && [ "$VEC" != "undefined" ] || fail "no vec_version"
log "   vec_version=$VEC"

log "PASS"
