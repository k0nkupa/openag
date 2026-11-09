# Conversation rendering performance — OA-466

The owner reported slow typing, menus and scrolling from another Mac using the desk over Tailscale. Local API timings do not establish remote-browser responsiveness. The source work starts from local main `6f179cb`; at planning time the service ran the separate pinned release `agent-mentions-521d445`. The owner subsequently authorized local-main merge and deployment of `3bd73f7`; see the local release record. Browser acceptance remains separate.

## Contracts

Retained messages and execution evidence are distinct from their chat presentation. Display optimizations must preserve order, grouping across intervening messages, pending/failed/Unknown meanings, permission gates, drafts, caret/focus, attachments and reading position. Avatar animation is presentation, not action or completion evidence. Resuming an avatar uses current state, not missed transitions.

## Implementation

- Feed prepares one `activityItems` projection for each immutable history snapshot while technical activity is shown. Native ActivityTrace sections share it; standalone Work/Activity consumers retain their existing events interface and memoize their own projection. The reconciliation algorithm and retained events are unchanged.
- Evidence serialization lives inside a child rendered by the native collapsible panel. Closed panels do not format evidence; expanded panels show the same stored payload/history. MessageText skips Markdown parsing when its text is unchanged.
- BotAvatar memoizes renderer options and releases its renderer after an off-screen visibility notification, keeping its fixed-size outer element. Visibility callbacks use current options. The first mount remains eager; old browsers without IntersectionObserver keep the previous behavior. Animation-off, reduced motion and current expression rules still apply. See [avatar behavior](avatars/README.md).
- Composer measures its form at expanded/compact transitions. ResizeObserver records border-box changes for the next transition instead of forcing a synchronous form measurement on each character. Existing 150 ms pointer disclosure and immediate keyboard/reduced-motion behavior remain.

The installed `@shadcn/react` 0.3.1 MessageScroller and its official composition are retained. Inspection found a full row-geometry scan in its scroll-state calculation. A real-browser trace after these fixes is required before patching that dependency; no replacement scroller, virtualization or scroll-position algorithm is introduced here.

## Controlled verification

`node scripts/verify-render-performance.mjs` mounts real Feed, Composer and BotAvatar modules in JSDOM through Vite. Temporary transform counters measure actual projection, Markdown and evidence-formatting calls; production code contains no counters. Synthetic data contains interleaved messages and operations so later tool results update earlier sections. No production messages, tokens or provider responses are copied into fixtures.

The initial 360-event baseline performed 240 history projections, parsed 120 Markdown messages and formatted 360 closed evidence blocks across initial renders. The corrected fixture performs one projection, parses each bot message once and formats no closed evidence. Expanded 780-event and 1,560-event histories each require one projection for a new snapshot. Unchanged history does no additional projection, unchanged text does not reparse Markdown, and expanding native Trace reveals the original evidence.

Controlled avatar checks cover 60 visible instances sharing one frame, off-screen unsubscription, hidden appearance/state updates, expired completion not replaying on re-entry, animation-off, reduced motion and observer/frame cleanup. Composer checks cover 25 keystrokes without synchronous form reads, retained draft/caret/focus on parent refresh, IME confirmation, observer cleanup and pointer collapse from the last observed height. Existing activity, avatar/editor and shipped-desk motion/upload scripts remain separate regressions.

These work counts and DOM timings are not browser frame-rate or remote-Mac acceptance.

The full recursive build passed (sign-in relay dry-run only), as did standalone activity projection/render, avatar/editor/gateway, shipped desk motion/upload, packaged bot-knowledge delivery and script/whitespace checks. A disposable built-preview probe verified startup, pairing, history paging and clean listener shutdown. The required `node scripts/verify-desk-components.mjs` currently fails on the pre-existing missing `ProfileImageEditor.tsx` inventory entry; OA-466 does not certify that unrelated profile surface. No unit/Jest/Vitest runners were used. Source reviews and remaining acceptance status are recorded in the ticket Log.

## Browser journey

After building, run `node scripts/verify-render-performance.mjs --serve`. It starts a disposable gateway serving the actual built desk, seeds 780 synthetic events and prints a temporary loopback URL and pairing code. Forward that printed port through an owner-managed SSH tunnel to use it from another Mac. One fixture message arrives every five seconds for five minutes. No production state, model, integration or computer service is used. Stop with Ctrl-C to close the listener and delete its temporary data.

On the affected browser, compare the same before/after build, viewport, motion preference and interaction sequence:

1. Open the seeded main room; scroll to older messages and expand evidence. Check that incoming events do not move the reading position. Exercise Jump to latest and return to older messages.
2. Type and edit a draft while messages arrive. Check caret, focus, IME, mentions, model menus and compact/expanded disclosure. Do not infer success from an HTTP timing.
3. Scroll avatars into and out of view; check current expression, animation-off and reduced motion. Confirm that pausing/resuming does not change row height or trigger repeated layout/resize work.
4. Capture Performance traces for typing, menu opening and scrolling, including a period with incoming events. Compare long tasks and frame times at the client's refresh rate. Inspect desktop/phone sizes and light/dark states against the native compositions.

Local browser use is currently disabled in Work settings. This journey, visual consistency and the affected Mac's perceived improvement remain unverified. Controlled checks, source review, deployment and owner-confirmed use must be reported separately. The ticket must remain open until required browser acceptance is recorded or the owner explicitly changes that gate.
