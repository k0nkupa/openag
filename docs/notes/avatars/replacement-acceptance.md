# OA-390 replacement acceptance — 3 November 2026

## Source result

Pinned `open-bot-avatar` 0.1.1 with the npm integrity recorded in the lockfile. All desk avatar callers use the shared replacement renderer. The editor offers 12 characters (seven upstream examples and five generated additions) and the existing palette. Legacy shape IDs resolve safely, without rewriting records or retaining original artwork. Saved animation preferences, Limited appearance permissions, explicit activity indicators, save/cancel/reset and failure retention remain. The original artwork and avatar animation CSS are removed. The upstream MIT notice is copied into the built desk at `/licenses/open-bot-avatar.txt`.

## Checks run

- `pnpm -r build`: passed daemon, desk and signin-relay build; relay deploy was dry-run only. The desk retains a large-entry-chunk warning (about 1.04 MB minified, 323 KB gzip).
- `node scripts/verify-avatars.mjs`: passed temporary public HTTP, stream, real-runner, actual restart and local WebRTC assertions. New and legacy IDs, palette, permissions, validation, privacy, resets and activity lifecycle are covered. The fixture explicitly assigns synthetic Work through the existing helper; ordinary chat semantics are unchanged.
- `node scripts/verify-avatar-desk.mjs`: passed actual React renderer/editor and desk API against a temporary gateway. Covers all 12 rendered characters, deterministic legacy fallback, 100 static instances leaving no animation frames, live thinking/happy, neutral waiting, animation-off, dynamic system reduced motion, keyboard turning, limited save/readback, cancellation, reset, save refusal, duplicate-save protection and mount/unmount cleanup. These are DOM assertions; they do not measure browser layout or frame performance.
- `node scripts/verify-bot-knowledge.mjs`: passed four integration groups. Packaged Bots handbook includes the new behavior and source reference. Controlled default API/Ollama and cached ACP/MCP paths receive the replacement explanation; existing tool restrictions remain. No real provider/model was called.
- Syntax checks for changed scripts and `git diff --check`: passed.
- `cmp` confirmed the packaged licence equals the installed package notice, and the built desk copy equals the public source notice.
- Local Standards/Spec source review: cleared after correcting static-SVG sizing and removing obsolete scene styles.
- `codex review --uncommitted`: completed with no actionable defects. Scope included staged, unstaged and untracked changes, including the earlier approved glossary edit. Review also ran desk TypeScript and the standalone DOM/gateway check. An MCP shutdown warning followed the completed review; it did not prevent its result.

## Unresolved acceptance

- Browser access: `cua.getBrowser` and `cua.listBrowsers` both report “Local browser use is disabled in Work settings”. Desktop and 390px light/dark appearance, actual pointer drag/follow, focus behavior in a real browser, readability at small sizes and real large-list/conversation performance are unverified. Enable browser use for the remaining acceptance; do not substitute the DOM checks for these gates.
- `node scripts/verify-desk-flow.mjs` failed at line 93: its empty named-room creation expects 201, while `apps/daemon/src/roomcreation.ts` requires 1–50 known members and returns 400. The avatar change does not modify room creation. This unrelated stale assertion was retained, and the broader check is not claimed as passed.

OA-390 remains open. No unit tests, Jest or Vitest were run. No commit, deployment, external publication, real account connection or live avatar/data change was performed. The configured installed default bot was not changed; knowledge delivery was verified through controlled runtime paths and the local packaged release.

## Generated additions — same-day follow-up

The owner requested more characters using the upstream generate-avatar skill. Added Book, Compass, Robot, Rocket and Telescope to the picker and daemon validation. The original seven-character automatic assignment list is fixed, so the expanded picker does not reshuffle defaults.

- All five passed upstream `avatar-validate.ts --strict` with engine 0.1.1, including enlarged-eye clearance, full gaze and no accidental silhouette seams. Definitions and provenance are described in the avatar guide.
- Front, turned and 28px asset renders were visually inspected; retained at `generated-preview.png`.
- Workspace build (including relay dry-run), expanded public avatar HTTP/runner/restart/WebRTC assertions, actual renderer/editor-to-gateway checks including repeated strict geometry checks, and all four packaged/default-bot knowledge groups passed. Changed-script syntax and whitespace passed.
- Final `codex review --uncommitted` found no actionable defects in staged, unstaged and untracked changes. No unit runner was invoked.
- Restarted only the owned temporary preview on `127.0.0.1:56575`, retaining its temporary data and device access. Served HTML and JavaScript match the final build byte-for-byte and include all five additions. No live service was restarted or deployed.

Real-browser visual and performance acceptance remains open; asset renders and DOM checks do not satisfy that gate.

## Idle animation setting fix — 5 November 2026

Removed the shared renderer override that forced neutral avatars outside the editor to remain static. `node scripts/verify-avatar-desk.mjs` first failed with `controller animates while idle`, then passed after the fix. It covers all 12 characters, actual idle transform changes, 100 live avatars sharing one frame loop, dynamic reduced-motion stop/resume, neutral waiting, saved animation-off for idle/working, editor controls and gateway/library integration. This is controlled DOM acceptance, not browser frame-rate or visual acceptance. Browser inventory still reports local browser use disabled in Work settings. No deployment or live settings write.

Final checks: `pnpm -r build` passed (including relay deployment dry-run; existing desk bundle-size warning). `node scripts/verify-avatar-desk.mjs` passed. `node scripts/verify-bot-knowledge.mjs` passed all four controlled delivery groups, including packaged handbook, API/Ollama, cached ACP/MCP and replacement default bot. `git diff --check` passed. No unit/Jest/Vitest runners were used.
