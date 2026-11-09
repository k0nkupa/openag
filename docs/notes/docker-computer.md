# Local Docker computer (OA-212)

Status: implemented with fake-runner tests only. Docker is NOT installed on the development machine, so the image and the
docker calls are UNTESTED against a real Docker daemon.

## Design

Two layers so the SSH box (OA-207) can reuse the first one:

1. `apps/daemon/src/computer/x11.ts` — `createX11Driver(opts)`: a `ComputerDriver` for any box where one command can be
   run inside it with `DISPLAY` set. The transport is injected as `exec(argv, {timeoutMs, binary?})` and receives argv
   with NO shell. Actions are `xdotool` / ImageMagick `import` argv built here:
   - `click X Y [left|right|middle]`, `type -- TEXT` (<= 4000 chars), `key K`, `hotkey a+b`, `scroll DIR N` (N clamped 1..50),
     `open -- URL` (http/https only; typed into the focused browser: ctrl+l, type, Return).
   - `key` names come from a table read with own-property lookups (`constructor`, `__proto__`, `toString` are refused).
   - `screenshot` = `import -window root png:-` (binary, 30 s, 20 MB cap).
   - `shell` = `sh -c COMMAND` with timeout + 5 s; each stream capped at 8000 chars; transport timeout -> exit 124.
   - Errors are `ComputerError` with fixed messages; no stderr, stdout, argv or typed text is ever placed in an error.
   - `viewLink()` is refused: no live view.
2. `apps/daemon/src/computer/docker.ts` — `createDockerDriver(opts)`: docker lifecycle + `docker exec` transport.
   `dockerAvailability(env)` checks for an executable `docker` on PATH without spawning anything.

## Commands (argv, no shell)

- inspect: `docker inspect --format {{json .State}} NAME` (absent when the output says "No such").
- create: `docker run -d --name NAME --label openag=1 --security-opt no-new-privileges --shm-size 1g --memory 4g --cpus 2 -v openag-NAME-workspace:/workspace IMAGE`
- start: `docker start NAME`; stop: `docker stop -t 10 NAME`; destroy: `docker rm -f NAME` (the named volume is kept;
  destroy of an absent box succeeds).
- commands: `docker exec -e DISPLAY=:99 NAME <argv>`.

Child environment for the docker CLI: ONLY `PATH, HOME, LANG, TMPDIR, DOCKER_HOST, DOCKER_CONTEXT, DOCKER_CONFIG`.
The owner token, provider keys and device tokens are never passed.

Failure messages: `docker is not installed`, `the Docker daemon is not running`,
`docker image not found: pull or build it first`, `timed out`, otherwise `<what> failed`.

## Environment variables (to be wired by the owner in backends.ts)

- `OPENAG_DOCKER_NAME` — container name (default `openag-box`; `^[a-z][a-z0-9_.-]{0,62}$`).
- `OPENAG_DOCKER_IMAGE` — image reference (default `openag/computer:latest`; `^[a-z0-9][a-z0-9._/:@-]{0,200}$`).

Docker must be feature-detected with `dockerAvailability()`; the backend is never required and is inert when absent.

## Image

`docker/computer/Dockerfile` + `docker/computer/entrypoint.sh` (UNTESTED): Debian bookworm-slim, Xvfb `:99` at
1280x800x24, openbox, xdotool, ImageMagick, chromium, fonts, non-root user `computer` (uid 1000), `/workspace` volume.
The entrypoint starts Xvfb, openbox and chromium on about:blank and waits on Xvfb.

The image is NOT published. Build it locally:

    docker build -t openag/computer:latest docker/computer

## Security

- No `--privileged`, no host mounts (only the named volume at `/workspace`), no published ports.
- `--security-opt no-new-privileges`, memory and CPU limits.
- The container HAS network access (needed for the browser and for `computer_shell`). Shell commands are act-external
  and always ask.
- The named volume survives `destroy`; remove it by hand when the workspace is no longer wanted.
- Container names and image references are validated before any docker call.

## Gaps

- NO live view and NO human takeover (`view: "none"`). The desk cannot show or drive the box directly.
- Untested against a real Docker daemon; the chromium/openbox/Xvfb startup and `import` against the root window are unverified.
- A `docker exec` timeout kills the docker CLI, not necessarily the process inside the container.
- `open` assumes the browser window has focus after the container starts.
- `key` accepts only the named table and single printable ASCII; function keys (F1..F12) are refused.
- The `inspect` image field is the configured image, not the container's actual image.

## Review notes (OA-207 pass)
- `docker run` now uses `--pull never` (the image is not published; a name like `openag/computer` must never be fetched from a registry), `--init` (PID 1 reaps and forwards SIGTERM), `--cap-drop ALL`, `--pids-limit 512`, plus the existing no-new-privileges / memory / cpu limits.
- Every command is wrapped in `timeout -k 2 N` inside the container, so a command that exceeds its limit is killed by the box (a docker exec timeout alone only kills the local client). The typing limit grows with the text length.
