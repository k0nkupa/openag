# Cua sandbox CLI (verified for OA-103 with a REAL sandbox, cua 0.7.0, 2026-10-27)

User-approved test: `cua sandbox create linux --tier slim --browser --name openag-test --json --wait desktop`
on this Mac. First run downloaded the built-in Linux runtime + image: ~80 s total, `~/.cua` grew from 50 MB to **3.1 GB**
(reclaim with `cua sandbox rm <name> -f` and `cua cache`). No Docker needed: it ran as a gVisor container.

## Lifecycle (name-addressed, JSON works)
- `cua sandbox create linux --tier slim --browser --name NAME --json --wait desktop` -> JSON object:
  `{ id: "local:NAME", name, image: "ghcr.io/trycua/linux:24.04-slim", kind: "container", runtime: "gvisor", state: "running", status: "ready", services: {env: port}, endpoints: {env: "http://127.0.0.1:PORT"}, browser: {pid, product: "chromium", tab_id, ...}, provider_details: {backend, container_id, host, provider} }`
- `cua sandbox ls --json` -> array of the same objects (+ `size_bytes`). `cua sandbox info NAME --json` -> one object.
- `suspend NAME` -> `state: "stopped", status: "stopped"` (prints a plain sentence, not JSON); `resume NAME` -> `state: "running", status: "ready"`;
  `rm NAME -f` deletes (`-f` is REQUIRED without a terminal, otherwise nothing is deleted).
- `cua sandbox screenshot NAME -o PATH --json` -> `{ "width": 1280, "height": 800, "path": PATH }`, a real 1280x800 PNG (~50-180 KB). Name-addressed: no global state.
- `cua sandbox exec NAME "<command line>"`: runs `sh -c` on the joined args (quoting is lost: pass ONE string), stdout/stderr come through, **the command's own exit status is propagated**.
- Exit codes: `0` ok, `1` the action failed, `2` bad arguments (clap), `3` not found (sandbox/target does not exist).

## Computer actions (`cua do ...`): GLOBAL target, TEXT output
- `cua do switch NAME` selects the target for ALL later `cua do` calls (process-global state on this machine): the daemon must serialise every computer call behind one mutex.
- `cua do screenshot|click X Y [button]|dclick|move|type TEXT|key KEY|hotkey cmd+c|scroll up|down|drag|open URL|launch APP|shell CMD|window|a11y tree|find|act|clipboard`.
- **`--json` does NOT give JSON for these.** Output is text: line 1 starts with `✅` (success) or `❌` (failure + reason), then a footer `💻 <target> 🔍 zoom: off`. Use the EXIT CODE as the truth (0 ok, 1 failed, 2 bad args, 3 unknown target) and the first line as the message. A trailing `--json` after `shell`'s command is swallowed into the command line.
- Real examples: `✅ opened: https://example.com`, `✅ clicked (640, 400) [left]`, `✅ typed: "hello"`, `✅ pressed key: enter`, `✅ scrolled down 3x`, `❌ invalid argument: protocol error: unknown key "notakey"`.
- Each CLI call costs ~450-550 ms (process start); fine for agent steps.
- `cua do screenshot` saves to `~/.cua/screenshots/` (newest 20 kept): use `cua sandbox screenshot NAME -o` instead to control the path.
- Coordinates are screenshot pixels (1280x800 here). The desktop is a Linux session with Chromium; typing/keys go to the focused window.

## For OA-105 (takeover)
- `cua sandbox view NAME` opens the cua-spacesd HTML5 viewer in a browser; `cua viewer --listen 127.0.0.1:PORT --no-open` serves a viewer for all sandboxes on a loopback port; `cua sandbox url NAME SERVICE` prints a service URL (services are declared with `--port NAME=PORT` at create time; the default one is `env`, which is the sandbox's environment endpoint, not a viewer). To be verified in OA-105.

## Free-text arguments MUST follow `--` (verified for OA-104)
- `cua do type "-x"` fails (clap: `unexpected argument '-d'`, exit 2); `cua do type -- "-x"` works. Same for `cua sandbox exec NAME "-n hi"` (the shell sees an option) vs `cua sandbox exec NAME -- "..."`.
  Always put `--` before typed text, URLs and shell command lines.
- `cua sandbox exec NAME --timeout SECONDS -- "cmd"`: `sleep 10` with `--timeout 2` exits 1 after ~2 s; the command's own exit code is passed through otherwise (`exit 5` -> 5); stdout and stderr both arrive.
- `cua do scroll <up|down|left|right> [AMOUNT=3]`, `cua do key <KEY>` (single key names: enter, escape, tab...), `cua do hotkey <KEYS joined with +>`, `cua do open <PATH|URL>`, `cua do type <TEXT>`, `cua do click <X> <Y> [left|right|middle]` (screenshot pixel coordinates).

## Viewer / takeover (OA-105)

Verified against real cua 0.7.0 + the running sandbox:
- `cua sandbox view NAME --no-open --ttl 30m --json` prints one JSON line `{expires_at_unix, name, url}`; `url` is `http://127.0.0.1:<port>/viewer/#ticket=v1....&files=...`. The origin is the sandbox's viewer server; the ticket is in the URL FRAGMENT and is a bearer credential.
- `/viewer/` uses relative assets (`./viewer.js`) and derives its API base as the parent of its own directory, so served at `/computer/view/viewer/` it calls `/computer/view/<rpc path>` (fetch, `Authorization: Bearer <ticket>` set by its JS) and opens a WebSocket (subprotocol `rcdp.v2`, binary frames) at `/computer/view/<wsPath>`. A plain prefix proxy therefore works. Upstream CSP has `frame-ancestors 'none'`: the desk opens the viewer in a new tab.

Design: `POST /computer/takeover` (Bearer, owner or device) takes the in-memory lock (`takeover.ts`), installs the input guard (`human has control`; screenshots still work), logs a `takeover` event in `_system` (no ticket/cookie), sets the HttpOnly `oag_view` cookie (Path=/computer/view, SameSite=Strict, 30 min) and returns `viewPath` containing the ticket (the only place it leaves the daemon). `/computer/view/*` (`computerview.ts`) accepts ONLY that cookie (a Bearer token is not accepted there, the cookie is no API credential), pins the upstream to the loopback origin reported by `computer.viewLink()`, forwards only an allow-list of request headers (never the cookie / x-forwarded-*), drops upstream set-cookie/CORS, streams bodies, relays WS text+binary frames, rejects cross-origin WS handshakes, caps sockets (8) and messages (16 MB). Dot segments are normalised by the HTTP stack before routing; encoded dots/slashes/backslashes/NUL are refused (400). Release (hand-back, 30 min idle, revoking the holder's device, shutdown) clears sessions and closes view sockets (code 4002). A daemon restart also hands control back (state is in memory).

Hardening after the OA-105 review: the viewer's RPC fetches (credentials omitted) authenticate with the ticket the holder was given, sent in `x-cua-env-authorization` (forwarded upstream); tickets are pinned per takeover so a link refresh cannot invalidate them; a device revoked while its take is in flight cannot end up holding control; only the holder or the owner can hand back (403 otherwise); upstream frames do not count as activity (only HTTP requests and client frames do); socket cap includes handshakes in flight; duplicate/malformed `Sec-WebSocket-Protocol` is a 400. RESIDUAL: the viewer is served at the desk's origin (the desk keeps its token in localStorage). HTML other than the viewer page is sandboxed by CSP and nothing is sniffed, but a viewer XSS would still reach the desk origin; serving the viewer from a separate port is the follow-up if that matters.

## Status inspection and recovery

If the `cua` CLI is not on the daemon's PATH, status and actions fail with "cua is not installed". Install Cua on the daemon host (or choose another backend) and refresh.

The desk's full and contextual computer views have Refresh status and explain absent, stopped, running and unknown states. Unknown is not absence: refresh and inspect the backend on the daemon host if it remains unknown. The desk does not offer Start or Destroy as recovery for unknown status, and lifecycle controls are blocked while busy, under human control, after a status error or while a backend change is pending.

Only the Cua CLI's not-found exit establishes absence. Malformed/non-object info output, missing state or invalid status types raise a status error; they never authorise creation. A parsed but unrecognised state remains unknown. No automatic recreation, destruction or lifecycle retry is added.

GET /computer inspects the current backend without applying a pending backend change or releasing a hosted session. This performs a backend status query and is distinct from the cached-only capability catalogue. The router keeps status and capabilities from the same inspected backend. Explicit backend selection saves the setting, then the owner/Full-only POST /computer/backend/apply requests application through the existing busy/takeover/approval switch guards. If blocked, the desk offers Apply selected backend after the computer becomes idle and human control ends. A normal tool/lifecycle action retains the existing backend-selection behaviour; an ordinary page read does not apply it.
