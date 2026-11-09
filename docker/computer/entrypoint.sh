#!/bin/sh
# UNTESTED (see Dockerfile). Starts the virtual X display, a window manager and a browser on about:blank, then keeps
# the container alive. Commands from the daemon arrive through `docker exec` and need DISPLAY=:99.
set -eu

export DISPLAY=:99

Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
XVFB_PID=$!

# Wait for the X server socket (max ~10 s).
i=0
while [ ! -S /tmp/.X11-unix/X99 ] && [ "$i" -lt 100 ]; do
  i=$((i + 1))
  sleep 0.1
done

openbox &

chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --no-first-run \
  --disable-gpu \
  --user-data-dir=/workspace/.browser-profile \
  about:blank >/dev/null 2>&1 &

# Keep PID 1 alive for as long as the X server runs; a dead display ends the container so the daemon sees it stopped.
wait "$XVFB_PID"
