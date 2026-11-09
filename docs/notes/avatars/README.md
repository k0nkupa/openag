# Open Bot Avatar replacement

OpenAg uses `open-bot-avatar` 0.1.1 (MIT, Dominik Scholz) for all agent artwork and rendering. The desk offers 12 characters: seven upstream examples (Controller, Barbell, Mug, Lightbulb, Chat, Sprout and Watering can) and five generated additions (Book, Compass, Robot, Rocket and Telescope). OpenAg retains its 14-colour palette, automatic colour, shuffle/reset, save/cancel, expression preview and per-agent animation preference. The editor uses existing house controls rather than embedding the upstream editor. Chat generation and the session-gated runtime library are described below. There is no raw JSON import/export UI.

The shared renderer owns mounting, updates and cleanup. Avatars with animation enabled use the upstream CSS 3D scene in the chat header and other agent views, including neutral idle motion. Message rows omit sender avatars and use the agent colour for their bubbles; see [message presentation](../conversation-model.md#message-presentation--5-november-2026). The Agents sidebar passes a local static override and always renders a static SVG without animation frames; it does not change the saved animation preference. All live instances share one animation loop. Character thumbnails and avatars with animation disabled use one static SVG. Waiting uses the neutral idle expression; the existing approval/input indicators remain authoritative. System reduced motion and the saved animation preference stop animation, gaze and editor turning. Pointer following and keyboard/drag turning are editor-only.

The shared BotAvatar now disconnects its renderer when IntersectionObserver reports it outside the visible region, retaining the sized outer element. Re-entry mounts the current appearance and expression; it does not replay missed completion transitions or change the saved animation preference. Unchanged options no longer dirty the renderer on unrelated parent renders. Browsers without IntersectionObserver retain the existing mounted behavior. Local deployment is recorded in the rendering release; see [conversation rendering](../conversation-rendering.md) for controlled checks and the pending real-browser gate.

Existing shape IDs remain readable and writable compatibility inputs. IDs without a bundled character resolve to a deterministic new character based on the agent handle; no database rewrite or appearance preservation is required. The original seven-character automatic assignment list stays fixed when the picker grows. Reset remains `avatar: null`. Changing appearance leaves agent identity, history, memory and permissions intact. Limited devices may still save appearance only through the existing gateway. No permission or activity policy changed.

Work expressions still use the existing activity logic, including its completion window, failure/unknown handling and reconnect behavior. Ordinary chat does not implicitly create Work. The controlled avatar fixture explicitly assigns synthetic Work for lifecycle checks.

Deployment history is recorded below and in the dated release notes. Browser visual/performance acceptance remains pending because local browser use is disabled in Work settings.

## Knowledge delivery and verification

The Bots and models handbook topic explains the replacement and links here through its source manifest. Build packages the handbook; `scripts/verify-bot-knowledge.mjs` checks packaged/default-agent and cached ACP delivery. Current replacement acceptance and remaining gaps are recorded in [replacement-acceptance.md](replacement-acceptance.md). Historical checks describe the earlier implementation, not acceptance of this replacement.

## Chat generation and shared library

With the generation skill installed, an attended conversation can call `avatar_preview` with geometry-only JSON. The daemon validates the bounded schema and the upstream geometry contract, rejects sensitive material, stores an immutable draft in `avatar_designs` (migration 031), and emits an `avatar_preview` event. Chat renders it even when technical activity is hidden. A preview is not in the picker library.

`avatar_library_add({previewId})` adds a validated draft under the effective session policy. Interactive Full access registers it without an Inbox approval; Read Only and Workspace Write require Inbox review. The global Never policy still refuses operations that explicitly require review. Registration binds the exact definition and its hash and can reference only a draft from the same bot and conversation. Under Ask, the proposal cannot be edited; Accept registers the draft and Ignore/respond/expiry make no library write. Either authorized path emits `avatar_library_updated`; a repeated add returns the same entry. Adding never changes any agent's appearance. The agent should show the preview and ask in chat if the desired design is unclear; Full access does not require a separate confirmation for a requested registration.

The read-only authenticated `GET /avatars` returns registered entries only. The shared desk reader refreshes on registration and reconnect, including WebRTC (GET-only access to this route). The picker offers bundled and custom designs; selection still uses the existing appearance save and Limited-device permissions. Custom references are opaque `custom:<UUID>` values; the gateway rejects unregistered drafts and unknown references. Registration and selection survive restart. There is no HTTP registration write route, arbitrary SVG markup, remote asset URL or filesystem import. Unattended and hidden-room generation is refused. The library is capped at 200 designs/256 KiB of geometry; unapproved drafts are capped at 500. Removal/renaming is outside this change.

Server validation enforces the engine's safety contract; the stronger face-room/seam targets used for our bundled generated additions are design checks, not a claim that every future model output has had visual review. The preview shows the exact render; Full access can register it as part of the requested generation. Generation skills grant no new action permissions. An older installed daemon without the avatar tools can only return JSON drafts; it cannot add them to the picker.

See [library-acceptance.md](library-acceptance.md) for verification and deployment limits. `node scripts/verify-avatar-library.mjs` checks the actual runner/gateway/approval/restart flow; `node scripts/verify-avatar-desk.mjs` checks the actual chat/approval render, live catalogue update and selection with a controlled generation runtime. No real model/provider or production acceptance is implied.

## Generated characters

The five additions were designed with the upstream `generate-avatar` skill and its canonical geometry prompt at commit `3a5119877844165eebafe57d3100da475f67d0a8`. Definitions live in `apps/desk/src/components/avatar-generated.ts`. No global skill installation or generation service was added.

All five passed the unmodified upstream `avatar-validate.ts --strict` using the installed 0.1.1 engine source in a temporary harness. This checked schema/path limits, full-size eye clearance, full gaze and silhouette seams. `node scripts/verify-avatar-desk.mjs` repeats those same strict checks using the pinned package implementation and verifies every character through the actual renderer. Front, turned and 28px SVG renders were rasterized and visually inspected: [generated-preview.png](generated-preview.png). This is asset review, not integrated browser acceptance.

## Licence

The npm package includes the MIT copyright and permission notice. Its notice must accompany redistributed software; see `apps/desk/public/licenses/open-bot-avatar.txt`, copied to the built desk as `/licenses/open-bot-avatar.txt`.

---

## Historical implementation and acceptance

# OA-329 — editable animated avatars

The real desk now uses the accepted original character artwork and whole-body CSS motion. The editor has 14 shapes, 14 explicit colour IDs, automatic colour, shuffle, reset, expression preview, keyboard/drag turning, optional editor-only gaze and a per-bot animation preference. Save avatar writes through the existing bot-settings route; Cancel leaves saved state unchanged, and a failed save keeps the draft. The shadcn dialog retains focus and contains its controls at phone widths. Its trigger waits for settings to load and keeps its 56px SVG size inside the shared Button.

All six original shape IDs, nine original colour IDs/values and automatic identity lists are retained. The additional IDs are explicit; `yellow`, `mint` and `violet` are not silently renamed to reference colours. Absent `animated` remains absent in older records and means enabled in the renderer. `avatar: null` still resets to the generated default. No database migration is needed. Limited devices can save only appearance; name, description and instructions retain owner/full-device permissions. Instructions remain absent from the public bot list and limited settings response.

Small avatars use one SVG. Only the large editor uses 25 depth slices, preserving the CSS 3D context. Body sway/squash/turn and eye motion stop with the saved animation preference or system reduced motion. The system setting also overrides gaze and editor turning. There is no new rendering dependency, downloaded artwork, AI generation, import/export or sound.

## Live state

Work is the authoritative activity source: it already reconciles concurrent turns, delegation, approvals, failed tools, interrupted recovery and unknown receipts. Its existing `work_updated` event now includes additive `previousStatus` metadata only when the persisted status actually changes. Existing event fields, Work records and APIs are unchanged.

The existing shared StreamProvider records a three-second marker only for a live transition to `completed`. One timer ends the happy expression for all consumers. Bounded live settlement metadata (up to 1,000 Work IDs, cleared on reconnect) prevents a slow card refresh from reverting the avatar to thinking after that expression ends. Metadata-only completed updates do not restart or erase the window; reconnect clears it. Chat uses current completed Work and the live marker. Work cards also use the transition revision to show current completion feedback while a slower list refresh still holds an older record. A newer failed/changed record wins over an older marker. This handles cards mounted after fast completion, delayed child settlement, HTTP/event arrival order and recovery without reconstructing status transitions from client snapshots. Thinking/waiting derive from current Work and pending approvals; disconnected, failed and uncertain work does not celebrate.

Bot-list/room readers refresh on `bot_settings`, reject superseded responses and refresh on reconnect. WebRTC receives a separate sanitized refresh notice with empty room ID, daemon actor and only `{action: "bot_settings", botId}`; the hidden audit record and all other hidden-room events stay private. The transport's write allow-list is unchanged.

## Verification

- `pnpm build`: daemon TypeScript and desk TypeScript/Vite passed. The existing large-entry-chunk warning remains.
- `node scripts/verify-avatars.mjs`: standalone public HTTP/stream/real-runner checks passed. Covers old/new IDs, invalid animation/shape/colour payloads, null/automatic colour, permission and mixed-patch refusal, instruction privacy, actual temporary process restart, failed/unknown ACP-shaped outcomes, deferred child settlement and transition metadata. Includes a real local WebRTC data channel with in-memory signaling: sanitized avatar notice, fresh bot read, private-audit non-disclosure and existing management 403s. Result: [http.json](http.json).
- `node scripts/verify-desk-flow.mjs`: existing room/direct-chat and conversation/approval/restart assertions passed.
- Browser acceptance used the disposable avatar daemon and synthetic data. Verified draft save/cancel/reset/shuffle, retry after refused save, double-click guard, saved motion/automatic colour, two-client live appearance updates and a limited-client save reflected in the full client, instruction lock, full-size trigger SVG, keyboard and native pointer drag, distinct body matrix3d transforms, preserve-3d wrappers, reduced-motion override and desktop/phone in light/dark. Delayed old bot-list replies did not replace the newer saved appearance; editing remained disabled during a delayed initial settings read.
- Lifecycle browser checks: working → thinking, pending approval → waiting, ignored/failed/unknown → neutral, live success → happy → neutral, fast cards mounting after completion, delayed child completion after 4.2 seconds, interrupted recovery, disconnect and completion backfill without replay. Measurements: [browser.json](browser.json).
- Independent Standards and Spec source reviews cleared after corrections. Final built-in `codex review --uncommitted` covered tracked and untracked source against `4697c82` and found no substantive remaining defects.

No unit tests, Jest or Vitest were run, per the owner rule. Affected existing fixture sources were updated but their unit runners were not executed. Browser clients were separate tabs/origins on this Mac, not physical second-device acceptance. No real bot model, external account or live avatar edit was used for acceptance.

Screenshots contain temporary verification data: [desktop dark](editor-dark.png), [desktop light](editor-light.png), [phone dark](editor-phone-dark.png), [phone light](editor-phone-light.png), [live completion](live-completion.png).

## Rollback

The release backup preserves the previous builds, SQLite database and service configuration. No schema change needs reversal. Prefer restoring the prior builds after stopping the service; inspect newer user state before restoring any database. Older builds can ignore newly added shape/colour IDs and display a generated fallback, so rollback must not rewrite saved avatars to compensate.


## Release on 4747

Released source commit `48cdfbc` to the existing launchd service on 1 November 2026. The original checkout was fast-forwarded and `pnpm build` passed before restart. Health, authenticated reads, prior App library setup reviews and served HTML/JavaScript matching the new build passed. Database integrity is OK, schema remains 19 and all 29 accessible table snapshots are unchanged, including saved bots/avatars, Work, history, approvals, results and settings. Service configuration and integration files are unchanged. No live avatar edit, integration installation or external account connection was used for release acceptance. Temporary verification listeners were closed; OpenAg uses only 4747.

Backup: `$OPENAG_DATA/backups/oa329-release-2026-11-01T03-35-13Z` (prior daemon/desk builds, mode-600 service plist and SQLite backup).
