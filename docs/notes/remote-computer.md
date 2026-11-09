# Remote box computer backend (OA-207)

An X11 desktop on a machine you control (a VPS, a spare Mac mini running Linux in a VM...), driven over SSH. It is the same
X11 layer as the Docker backend (`computer/x11.ts`: xdotool for input, ImageMagick `import` for screenshots); only the
transport differs (`computer/ssh.ts`). Select it with the OWNER-only setting `computer.backend = "ssh"`.

## What the box needs
- An SSH server, `base64` and `timeout` (coreutils) on the box, and any login shell (the command line sent is only fixed words plus base64, decoded and run by POSIX `sh`; tested against sh, bash, zsh, dash, csh and tcsh),
  an X server on a known display (default `:0`, set `OPENAG_SSH_DISPLAY`), `xdotool`, ImageMagick (`import`), a browser.
  The Docker image recipe in `docker/computer/Dockerfile` shows the packages.
- A non-root user for the agent. Anything the agent does through `computer_shell` runs as that user.
- Login output must be clean: `.bashrc`/MOTD text on stdout would corrupt screenshots (they are validated as PNGs and refused otherwise).

## Configuration (environment of the daemon only; never the DB or the API)
| Variable | Meaning |
|---|---|
| `OPENAG_SSH_HOST` | host name or IPv4 (letters, digits, dots, dashes; no `user@`, no leading dash) |
| `OPENAG_SSH_USER` | remote user |
| `OPENAG_SSH_PORT` | optional, default 22 |
| `OPENAG_SSH_KEY_FILE` | ABSOLUTE path of the private key, mode 600 (a group/other-readable key is refused) |
| `OPENAG_SSH_KNOWN_HOSTS` | ABSOLUTE path of a known_hosts file that ALREADY contains the box's host key (`ssh-keyscan -p PORT HOST >> file`, then verify the fingerprint yourself) |
| `OPENAG_SSH_DISPLAY` | optional X display, default `:0` |
Without them the backend is inert: nothing is spawned and nothing is contacted. These variables are stripped from the environment of bot processes.

## Security design
- Host keys: `StrictHostKeyChecking=yes` with your known_hosts file; a box whose key is not already trusted (or has changed) is refused, never accepted on first use.
- ssh ignores `~/.ssh/config` and `/etc/ssh/ssh_config` (`-F /dev/null`): no ProxyCommand/ControlMaster/SetEnv/extra identities from files OpenAg did not write, and only the given known_hosts is trusted (`GlobalKnownHostsFile=/dev/null`). Jump hosts are therefore not supported; use a direct address (or a VPN such as Tailscale).
- ssh runs with `BatchMode`, `-n` (stdin closed), `IdentitiesOnly`, no agent, no X/agent/port forwarding, no local commands, `-T`, and a child environment of only PATH/HOME/LANG/TMPDIR.
- Every remote command is `env DISPLAY=:N timeout -k 2 N <argv...>` with EACH argument single-quoted (`shellQuote`) inside a script that is shipped as base64 (`echo <b64> | base64 -d | sh`), so quotes, `$()`, backticks, newlines, `!`, `;` and globs in typed text are inert in EVERY login shell (the tests run them through real sh/bash/zsh/dash/csh/tcsh). The box enforces the time limit itself with `timeout`, so a timed-out command does not keep running while the next one starts. `computer_shell` is the only path that runs a shell command on the box, and it is `act-external`: every call asks for approval.
- Error messages are fixed strings (host key not trusted / authentication failed / box unreachable / timed out); stderr, host names, key paths and typed text never appear in them.

## Lifecycle semantics
OpenAg does not own the machine, so `stop` and `destroy` only DETACH (the daemon stops using it; `status` shows stopped/absent). `start` checks the connection (`ssh ... true`). Nothing is created or powered on/off remotely.

## Known gaps
- No live view / takeover on this backend (view: none); you can still use your own VNC/RDP to the box.
- Detaching (stop/destroy) is remembered only in memory: after a daemon restart a reachable box reads as running again.
- ssh's own failures (exit 255) are reported as a generic "shell failed"/"action failed"; the reason (host key, auth, unreachable) shows in the status after `start`.
- Never run against a real box in development: the whole backend is tested with a fake ssh and a real local POSIX shell for the quoting only.
