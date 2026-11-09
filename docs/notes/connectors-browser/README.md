# Connector browser acceptance

2 November 2026. Branch: `codex/read-search-connectors`. OA-352 passed.

Used the Codex in-app browser through `cua_repl`. Started `node scripts/verify-connectors.mjs --serve`: its controlled HTTP/runner/scoped MCP assertions passed before serving the built desk. The server used temporary SQLite data, fake Google auth/fetch, fake Apple handlers and a fake permission function. No live Google sign-in, Apple operation or macOS grant occurred.

| Surface | Result |
| --- | --- |
| Desktop 1440×960 | Apple/Gmail/Drive detail text and controls readable; page width equals viewport width. |
| Mobile 390×844 | Catalogue, search, all three details, long setup digests/paths and commands fit; dialogs scroll vertically, no page/dialog horizontal overflow. |
| Gmail and Drive | Explicit Check read access shows Read verified and timestamp; pause removes verification and shows Paused; resume restores Connected. |
| Apple | Simulated Calendar permission changes to Permission granted; separate read check adds Read verified and timestamp. Mail read also checked on desktop. Messages remains disabled with its missing prerequisite explanation. |
| Shared Google account | Disconnect warns both services lose access; Keep connection cancels; explicit Disconnect both services removes access. Reconnecting only Gmail leaves Drive showing Needs access. |
| OAuth return | Synthetic successful return completes under the same full device. Cancellation shows a safe message. Both remove code/state/error from the visible URL before rendering and return to App library. No external consent page opened. |
| Restricted device | Limited device sees owner-required error, no account email or read/pause/disconnect controls; Connect Google disabled. |
| Keyboard/reload | Tab reaches access buttons with visible focus ring; Escape dismisses details; authenticated reload returns current inventory. |
| Console | No captured warning/error entries on owner or limited browser tabs. |

Screenshots: [desktop Gmail](desktop-gmail.png), [desktop Apple keyboard focus](desktop-apple-focus.png), [mobile Gmail](mobile-gmail.png), [mobile Drive paused](mobile-drive.png), [mobile Apple](mobile-apple.png), [mobile OAuth return](mobile-oauth-return.png). Screenshots show synthetic state, not provider acceptance.

`pnpm -r build` passed again after browser checks (existing large desk chunk warning). No source fixes were needed. Browser viewport override reset; temporary tabs closed; server stopped normally and temporary data removed. No unit tests/Jest/Vitest, physical-phone/native-service checks, light-theme matrix or live provider acceptance performed. At browser-check time, OA-353 was blocked by the separately reproduced baseline `verify-desk-flow.mjs:78` failure (`201 !== 200`). The later [OA-353 regression repair](../desk-flow/README.md#oa-353-regression-repair-2-november-2026) updates the stale direct-chat requests and restores that gate. No deployment was performed.
