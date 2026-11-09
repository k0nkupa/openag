# OA-319 — integrated desk shell

Implemented locally on 31 October 2026 in `codex/desk-shell`. This is the first production-code migration from the [design handover](../../design/openag-desk/README.md). The running daemon and its built desk in the original checkout were not changed.

## What changed

- The shared shell uses shadcn Base UI sidebar, mobile sheet, command search, badges and switches. Existing Button/Input/Separator behavior is retained. Only missing primitives were copied from the reviewed reference; its sample state was not copied into the application.
- Rooms, bots, device identity and approval counts come from the existing API and shared stream. Agent links open an existing one-member conversation or its bot settings. Creating a direct conversation remains OA-314. Search also lists every existing room.
- One-member rooms show bot context and a bot-settings link. Group rooms keep the existing operational rail. Message, approval, computer and settings logic remain in their existing components.
- Primary navigation, breadcrumbs and actions use 14px; descriptions use 13px; compact metadata is at least 12px. Settings form spacing and enable switches are shared fixes.
- `openag.theme` stores only a non-secret appearance preference. System is the default; the header cycles System → Light → Dark. Semantic variables and Tailwind `dark:` use the same effective `data-theme` value.

## Reversible presentation

The new shell is the default in this checkout. Add `?desk=classic` before the hash to use `ClassicShell`, for example `http://127.0.0.1:5192/?desk=classic#/room/main`. Remove that query to return. Both presentations use the same authentication, route state, API, shared stream and feature components. Shared controls/theme changes remain shared; this is a shell fallback, not a second application or database.

Do not build this branch into the live daemon's served directory until cutover is authorized. Work remains in an isolated worktree. No live restart, deployment, model turn, external action or data migration was performed.

## Reproduce the isolated checks

Run from the isolated checkout, after dependencies are installed:

```sh
pnpm -r build
node --check scripts/verify-desk-shell.mjs
node scripts/verify-desk-shell.mjs
```

The last command binds **127.0.0.1:5192**, makes a fresh temporary SQLite directory and prints short-lived full/limited pairing codes for that temporary gateway. It clears inherited credentials and points model discovery at an unused loopback port. No real runtime, scheduler, computer or external integration is started. The script asserts static serving, rooms/bots, invalid-token 401, device identity, and limited-device settings-write 403. It does not import a test runner.

Use “Pair with a code” in that desk. In an interactive terminal, enter `reconnect` to detach and restore its stream after three seconds; enter `approval` to append a pending approval. Ctrl-C stops the temporary gateway. The temporary database is retained for inspection; it is not `~/openag-data`.

## Results

- `pnpm -r build`: daemon TypeScript and desk TypeScript/Vite passed. Vite reports a 635 kB minified entry chunk above its 500 kB warning threshold; build succeeds. No bundle optimization is claimed.
- `node --check scripts/verify-desk-shell.mjs`: passed. Standalone HTTP/static/auth assertions: passed against temporary data.
- Browser matrix: **1440×960 and 390×844 CSS pixels**, each in Light and Dark. [measurements.json](measurements.json) records 14px navigation/breadcrumbs, 13px descriptions, no document/content overflow, and switches approximately **32×18.4px**. Agent metadata computed to 12px on desktop and in the phone drawer. The browser's existing 110% zoom required larger physical capture dimensions; screenshots include the full browser surface.
- Logo/nav icon left coordinates matched (~16px) on desktop and phone. Search opened by ⌘K; filtering and Enter navigated to an existing page. Escape closed the phone drawer and returned focus to its trigger. Keyboard focus had a visible solid outline.
- System theme followed emulated Light/Dark preferences. Explicit Light held while system Dark was active. Reduced motion yielded `0s` switch transitions. Temporary emulation was cleared after checks.
- Heartbeat switch: changed, saved through the existing API, survived reload, then restored to off. No scheduler was running.
- Full/Limited devices rendered as badges. Pairing and sign-out returned through the existing login flow. Reconnect visibly changed Reconnecting → Live. A streamed approval changed the single Needs you nav count from 1 → 2; there was no duplicate header link.
- Classic shell query and direct-chat bot context passed. The source checkout still has only its pre-existing untracked files.

Screenshots use controlled fixture records stored in the temporary daemon. Counts can differ as stream checks add approvals. Optional managers are absent from this small gateway, so some Settings panels honestly show unavailable/404 states; these screenshots do not prove operations readiness, reflection execution, real provider sign-in or computer connectivity.

Unit tests/Jest were not run, per the owner's rule. Real accounts, WebRTC across devices, live models, external tools and service cutover remain unverified. OA-314–317 and OA-320–330 retain their own acceptance gates.
