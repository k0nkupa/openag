> Current interaction model: Needs you and Recovery acknowledgements are removed. Questions and explicit decisions live in their originating conversation. See [conversation interactions](chat-interactions.md). Historical acceptance below describes its recorded version.

# Conversation model and proactive delivery (OA-344)

Rooms are optional. A fresh install has the default bot (OA-339) and **zero rooms**; nothing creates or requires a room named
`main`.

## Chat display

The browser preference in `chat-display.ts` filters only `isActivity` rows in the shared `Feed`, covering direct chats, rooms and the classic shell. The canonical behavior and Settings location are in [Chats and rooms](../help/conversations.md#chat-display). It uses local storage plus same-page and cross-tab notifications; blocked storage retains the current-page selection. The daemon, event history, Activity tab, Ledger and policy gate are unaffected.

## Replies to specific messages (OA-476)

The shared Feed offers Reply on visible user/agent messages in direct chats, rooms and the classic shell. Composer owns the selection, focuses the draft, keeps it on failed/unconfirmed sends, and clears it only after an acknowledged send or explicit cancellation. A room change unmounts the room-keyed composer. The native Button/Tooltip action and InputGroup block-start preview reuse the installed Base UI/base-nova composition. MessageQuote is a semantic document excerpt, with escaped plain text and a two-line preview; it has no independent control skin.

`POST /rooms/:id/messages` accepts optional `replyToMessageId` (positive safe integer). The gateway resolves it through the daemon ledger and refuses missing, foreign-room, hidden-room, internal-consultation or non-message targets before dispatch. It ignores caller-supplied quote contents. It appends `{reply:{messageId,actor,text}}` through normal ledger redaction: text is at most 1,200 characters, or `[Attachments]` for attachment-only messages. Original message text, attachments, stored history, routing and permissions retain their existing contracts. No migration is needed.

The runner includes the stored quote in required current input for hosted/API/Ollama and ACP paths, with explicit untrusted-data attribution. History reconstruction retains the same quote on earlier replies. Mention requests forward the quote as selected context, without adding origin history or reattaching original files. Nested quotes are not copied. The reply field is distinct from legacy delegated-message `replyTo` (a bot id). User instructions remain the new message text; the quote grants no authority and triggers no replay.

Acceptance: `node scripts/verify-message-replies.mjs` uses an actual disposable gateway, runner, SQLite ledger and built-desk DOM. See the ticket Log and component audit for current verification scope and the browser restriction. No real provider or adapter acceptance is implied.

## Kinds (`rooms.kind`, migration 021)
- `room`: created by the user, any name; new rooms require one or more existing bots (a named room with one bot is still a `room`).
- `direct`: the chat with one bot (exactly one member, who is the lead). `ensureDirectChat` / `POST /rooms {kind:"direct"}`
  create it once per bot and reuse it by kind. The desk makes ids `chat-<32 hex>`.
- The kind is never inferred from the member count. `POST /rooms` without `kind` creates a `room`.
- Backfill (migration): only rows with id `chat-<32 hex>`, exactly one member, and that member is the lead become `direct`.
  Everything else, including `main` and the hidden `_` rooms, stays `room`. Checked against a copy of the live DB.

## Delivery (`delivery.ts`, setting `deliveryRoom`)
Pings, the morning brief and reflection proposals go to `resolveDeliveryRoom`:
1. the owner's `deliveryRoom.roomId`, if set and the room exists (hidden `_` rooms are refused by the API);
2. otherwise the default bot's `direct` chat, created on first delivery;
3. otherwise nothing.

A room that is set but gone resolves to nothing: it is not replaced and not recreated.
- **Ping** (`wake.ts`): no destination -> the ping is downgraded to a digest item with `suppressedBy: "no_destination"` (kept for
  the brief, no push). `Decision.delivered` reports the room and event a delivered ping was written to; automation run history
  uses it, and `recover()` finds the event by decision id.
- **Brief** (`brief.ts`): no destination -> `{sent:false, reason:"no_destination"}` before digest items are marked delivered or
  `briefState` is written, so it retries inside its window.
- **Reflection** (`reflection.ts`): proposal approvals use the delivery room; with none they stay in the hidden `_reflection` room.
- **Readiness**: required item `delivery`.

Existing installs: migration 021 sets `deliveryRoom = main` when room `main` exists, so nothing changes for them. New installs
have no setting and use the default bot's chat.

## Desk
The address-less route is `home` (`#/`): it opens the default bot's direct chat and replaces itself in history. With no default
bot it shows "Nothing to open yet" with New bot and Settings controls (creation actions are available in the redesigned sidebar).
The sidebar Rooms group lists every non-direct room, so a named one-bot room shows there; direct chats are under Agents.

### Action outcome history

An ordinary conversation can have an action receipt without a Work item. Unknown outcomes remain readable from conversation activity and receipt links. They do not appear as receipt Recovery items, require a target/findings form, or block new actions, agent requests or model changes. Existing historical receipts follow the same rule without rewriting their outcomes. Normal permissions, pending approvals and active execution still apply. OpenAg does not automatically replay an uncertain action.

Composio read confirmation still requires the exact daemon-reviewed contract; a general execution tool result does not establish every external effect. See [MCP classification and completion](mcp.md#trusted-classification-and-completion-oa-379).

Controlled acceptance: `node scripts/verify-chat-receipt-recovery.mjs` checks retained evidence, absent receipt Recovery items, model admission and removal of the inspection endpoint through a disposable gateway. `node scripts/verify-action-receipts.mjs` checks new approved actions after Unknown/restart, single-use decisions and the shipped receipt page without an inspection form.

## Seeding
`pnpm --filter daemon seed` is the explicit development sample (room `main`, boss/coder/researcher/codex). `install-service.sh`
runs it only with `OPENAG_SEED_SAMPLE=1`.

Verified by `node scripts/verify-conversation-model.mjs` (needs `pnpm -r build`).

## Input pauses and ACP continuity (OA-377)

A durable input question leaves the conversation or Work awaiting input; the asking turn finishes normally with reason `awaiting_input`. The runner exposes its waiting state to the ACP runtime. The adapter prompt is cancelled to yield control, but that transport cancellation is not an owner cancellation: late message chunks, tool updates and stop output from that paused prompt are suppressed. Permission-mode resets remain enforced. Genuine cancellation outside an input pause remains visible. Existing ledger records are not rewritten.

The conversation is independent of the adapter session. A fresh session receives a labelled, JSON-encoded history block before the current prompt. The existing `ledger.conversationHistory` selector supplies only eligible messages from the same room and agent participation. Hidden, isolated and external/noIndex contexts receive no injected history. Agent-wide memory recall remains separate and is not a room-privacy guarantee. The snapshot upper anchor is persisted in `turns.state_json.acpHistoryThroughId`; the trusted lower `historyAfterId` boundary is preserved. Selection failure stops the turn before an adapter prompt rather than silently inventing continuity.

Restored history is a contiguous recent suffix capped at 20 eligible messages and 24,000 characters including its JSON envelope/label. It does not begin with an orphan assistant reply. Historical attachments contribute references, not bytes. History is supporting data, not operating rules or a permission grant; tool calls and approvals are not replayed. Native cached sessions and successful interrupted-turn session resumes receive no duplicate history. Pending-approval recovery retains its existing exact-payload and one-time permission rules. Input answers start a separate session so the prior paused prompt cannot interfere with the continuation.

Acceptance uses `node scripts/verify-acp-continuity.mjs` and its explicit `--real` mode, temporary data and the local `request_input` tool. The real mode uses both subscription adapters without mailbox or external action tools. Hosted context, input runtime, tool identity, action receipt and delivered-help regressions remain required. See the ticket Log for verified results; source behavior is distinct from deployment and live receipt inspection.

The optional `--render` mode reads gateway event JSON and renders the desk's actual ActivityTrace component to HTML, asserting the awaiting-input label. It is an integration/rendering check, not visual browser acceptance or a screenshot. The plain controlled mode also forces late paused output, a real cancellation result, runtime replacement, agent/room/source isolation, bounded history, a trusted history boundary and invalid context that must stop before an adapter prompt.

OA-377 source acceptance: 10 controlled/render groups and four real-adapter groups passed on main 02ada208 plus this change. Both real adapters retained the synthetic marker and chosen option after the input answer and after runtime replacement; cached turns retained context without duplicated injected history. Full workspace build (relay dry-run), daemon type check, input-runtime, hosted-context, explicit-Work, conversation-model, action-receipt, tool-identity and packaged help regressions passed. Independent Standards/Spec and built-in Codex reviews were clear. Browser access was disabled, so visual screenshot acceptance remains unavailable; no unit runners or mailbox calls were used.

## Sidebar pins and order

Accepted pointer drops settle displaced rows over200ms using native transform animation. Keyboard/menu moves, invalid/cancelled drops and passive updates do not start settling. New drags, resize, navigation, reduced-motion changes and unmount cancel it. Preferences are committed immediately; animation never delays persistence or interaction.
In the redesigned desk, Rooms and Agents each support pinning and manual order. Open an item's options button and
choose **Pin to top** or **Unpin**. Pinned items show a pin icon and stay before unpinned items in their own list.
Drag the grip beside an item onto another item to move it to that position; mouse, pen and touch pointers use the same
handle. Reordering stays within the pinned or unpinned group. The options menu also offers **Move up** and **Move down**
for touch and keyboard use. These controls do not change room membership, the default bot or chat routing.

Preferences are saved in this browser for this desk address. They survive reloads, but do not sync to other devices or
browsers and are cleared with browser site data. If storage is blocked, changes work for the current page and a status
message explains the limit. The classic fallback desk does not have these controls.

## Named room creation

The plus beside Rooms opens the owner/Full New room sheet. Names may repeat; a stable identity distinguishes rooms. Select 1–50 existing agents and their lead. Creation starts no turn or Work and does not select a proactive destination. See [room creation](room-creation.md) for the authoritative contract, recovery and compatibility limits.

## Agent summary presentation

While a bot runs, the conversation feed shows its name and “Working…” in the shared native Trace presentation. A small activity spinner stops under reduced motion. The label reflects an active turn, not hidden reasoning, measured progress or a confirmed external effect. Pending approvals hide this row; finishing the turn removes it. The former AgentUI grid and rotating decorative phrases have been retired.

Run `node scripts/preview-working-indicator.mjs` for a local preview at `http://127.0.0.1:5198/`. It renders the actual Feed with in-memory events and an inert transport; no daemon, bot or provider calls. Controls show working, approval wait, completion and light/dark themes. The preview is separate from a deployed desk.

Conversation side panels start closed at every screen width unless the route selects a panel tab or Work item. The existing toggle opens the panel; resizing does not open it automatically. Conversation side panels use compact model and effort badges. A current-configuration report from this conversation supplies reported labels; otherwise badges describe saved configuration. Other-room and stale reports are not used as this conversation’s runtime evidence. Badge titles identify session/returned versus configured values. Full report details remain in the agent’s side panel, Settings, Model and reasoning.

Idle agents have no status line. Working agents have a small indicator attached below their avatar; reduced motion keeps a static indicator. Approval-needed agents retain an explicit badge and do not show the working pulse. Conversation and Work side-panel tabs share an explicit gap above their content.

## Desk usability: navigation and reply formatting

The primary sidebar includes Needs you, Work, Computer, Automations and App library on desktop and phone widths. Navigation opens existing pages; it does not start a model turn, computer lifecycle action or integration maintenance.

Agent replies render Markdown paragraphs, headings, emphasis, lists, links, code and tables inside the existing message/scroller components. User text and diagnostic payloads remain literal. Raw HTML does not execute, unsafe link protocols are filtered and Markdown images are not loaded; images remain explicit authenticated attachments. Long code and tables scroll within the reply. Formatting is presentation only: it does not grant action permission or confirm an outcome.

Pointer-opened attachment pickers and native file drops give only newly added chips a 150 ms opacity/scale entrance. Keyboard-opened pickers, paste, retries, upload-state refreshes and removal remain instant. Reduced motion disables the entrance. This changes no upload limits, draft retention or attachment IDs. See [restrained desk motion](desk-motion.md).

A fine-pointer/hover desktop file drag shows a decorative outline only while the Composer permits attachment attempts (not disabled or submitting). Nested drag leaves preserve it; leaving the target, drop, Escape, drag end, window blur, route changes and loss of availability clear it. The 125 ms opacity fade is instant under reduced motion. Touch/coarse pointers have no outline. addFiles and server validation remain authoritative.

The empty idle composer collapses to one line with44px action targets. Focus reveals the existing two-line composer and controls; settings remain mounted while hidden. Draft text, attachments, dictation, busy configuration/send state and errors retain the expanded view. Focus in the composer or its menu/dialog keeps it open. Pointer disclosure animates measured form height for150ms with the shared cubic-bezier(0.23,1,0.32,1); keyboard interactions cancel motion immediately, and reduced motion, resize and unmount stop it. Uploads, transcript insertion and sends have no animation delay.

The compact composer keeps Add at the left edge, with Dictate and Send at the right. Its existing action nodes stay mounted through expansion, preserving activation and keyboard focus. Expanded Add remains on the left of the bottom toolbar.

Composer icon actions and compact model/reasoning triggers use the shared ghost variant: no resting border or fill, with native hover, open-menu, keyboard focus and disabled feedback. Hit areas and action placement are unchanged. Full-size settings controls retain their existing variants.

Composer action/model/reasoning icons are24px and use the semantic foreground color for stronger contrast. Shared icon-sm sizing owns this treatment; existing32px desktop/44px phone hit areas and disabled opacity remain unchanged.

The composer Send icon keeps the same full-contrast foreground as Add/Dictate even when disabled. The shared ghost-submit icon style owns this exception; native disabled state and empty/busy/upload send guards are unchanged. Other disabled icons retain their normal dimming.

The composer has no agent/mode row beneath the input. Bot settings → Permissions owns its current-conversation control. `/permission` still opens the shared session dialog from chat, including agent selection in shared rooms. Full-device access, explicit acknowledgements and revision guards remain unchanged.

Send now uses the native primary filled variant with a contrasting arrow and normal disabled feedback. Other composer icons remain borderless ghost controls. All glyphs remain24px, with unchanged hit areas and Add-left placement.

Send keeps its24px arrow with a smaller32px filled circle. The shared icon-primary Button variant centers that decorative fill inside the unchanged native button hit area (44px phone,32px compact desktop), with native focus/disabled feedback and semantic contrast.

The compact phone textarea uses10px vertical padding around its24px line inside the44px control, aligning text with the icon centers without internal vertical overflow. Desktop and expanded padding are unchanged. This is a visual alignment correction; controls and behavior are unchanged.

## Guest requests and consultation

A direct chat keeps one permanent agent. Explicit guest mentions and agent-to-agent consultations use bounded private execution and project attributed findings back into the initiating conversation. They do not add membership or create Work. See [agent requests](agent-requests.md) for the authoritative contract and acceptance scope.

## Message presentation — 5 November 2026

The shared Feed used by direct chats, rooms and the classic desk follows the [shadcn Base Message composition](https://ui.shadcn.com/docs/ai-elements/base/message). User messages align right with muted Bubble/BubbleContent; agent replies align left with the native tinted Bubble variant. Each agent bubble scopes the primary colour token to the same saved or deterministic automatic colour used by BotAvatar. The native variant derives light/dark tints and keeps foreground text; no bespoke bubble skin or animation is added. Appearance refreshes recolour existing replies. Missing agent metadata uses the actor handle for automatic colour. Error bubbles retain the destructive variant.

Message rows have no sender avatar or visible name header. Each article retains an accessible sender label using the profile or agent display name; native MessageFooter holds the timestamp. Profile images remain available in Profile settings. Generated avatar previews remain message content. Attachments, approvals, saved-result links, Work cards and technical activity retain their existing behavior. Working/approval indicators remain explicit. Markdown safety and message history are unchanged.

Controlled DOM coverage is in scripts/verify-render-performance.mjs, with preview/approval regressions in scripts/verify-avatar-desk.mjs. Browser comparison at desktop/phone widths in light/dark themes remains unverified because local browser use is disabled in Work settings. Source/DOM checks do not prove rendered contrast, overflow or scroll behavior.

## AI Elements activity and review compositions (OA-467)

Turn activity uses nested native Trace compositions. Settled history starts collapsed; active groups start open. Each operation retains its reconciled lifecycle, exact evidence, request details and receipt link. Summary counts distinguish failed and unconfirmed steps; missing results on a settled turn are unconfirmed. Approval decisions do not become execution confirmation. Command output is shown only from recorded stdout/stderr and remains bounded/redacted by its existing runtime contract; this release does not add terminal or reply streaming.

Work’s Reported plan uses native pending/running/done step icons and a reported-done count. It does not assert that a reported completion is execution evidence. Delegated Work expands its existing authenticated activity reader; request disclosures display their returned result, receipts and only matching events in the current room. No new cross-room history access is added. Simple inline reviews use native Item, with the exact proposal initially closed, and retain Accept/Edit/Respond/Ignore, review versions, busy guards, errors and saved drafts. Complex avatar/reflection/full-page reviews keep their Card.

Message footers offer Copy message for actual text. Copy writes the original text, including Markdown, to the clipboard; success lasts briefly and a rejected/unavailable clipboard shows an actionable error. Names remain accessible, avatars stay absent, and agent colours/timestamps are unchanged.

The native scroller and current anchoring stay unchanged pending rendered browser evidence. The following OA-470 additions and the separate conversation-forks topic supersede the initial gaps. Hidden reasoning and streamed command/reply output remain unavailable; the audit’s recommendations do not claim their implementation. See [pattern audit](ai-elements-pattern-audit-2026-11-05.md) for initial findings and this adoption scope. Controlled verification: scripts/verify-ai-patterns.mjs, verify-activity-trace.mjs, verify-render-performance.mjs and verify-avatar-desk.mjs. Browser visual/scroll acceptance remains separately open.


## Recorded evidence and conversation controls (OA-470)

Request usage in a Full-access reply footer lazily reads the existing request-manifest endpoint. It shows the latest recorded request's provider-reported input/output tokens (including Ollama counts); missing usage is Not reported. The progress bar is the daemon's required-input character budget, never an estimated provider context-window percentage. It uses the existing owner/Full permission boundary. Opening/refreshing reads stored metadata only.

Recorded file changes include completed `write_file` results only (up to 64 distinct paths, 2,048 characters and 32 segments per path). Unknown and non-file operations are excluded. Selection opens retained lifecycle evidence; it neither reads files nor previews current contents. Returned structured Brave search records provide HTTP(S) links and hostname previews, capped at ten. Credential URLs, unsupported schemes, malformed and truncated result envelopes are excluded. These are returned results, not claims that the answer used, visited or verified those sources.

Recorded command output retains exact stdout/stderr and lifecycle JSON. A summary appears only for one internally consistent bounded TAP count set (up to 10,000 tests; first 200 cases). Duplicate/contradictory totals and output beyond 128,000 characters are not summarized. At most 100 recorded JavaScript-style stack frames are shown, without source navigation. No test command is run by this feature or its verification.

Reported Work plans offer Plan/Queue tabs. Queue groups the same reported states into To do/Completed and is not an editable task authority. Empty conversations offer two starter prompts in Composer; selecting one prepares a draft only when the draft and attachments are empty. The regular Send path still handles permissions, model changes, dictation, attachments, delivery uncertainty and busy guards.

Controlled checks: verify-ai-patterns.mjs covers actual native DOM, unsafe/malformed sources, ambiguous counts, bounded file paths, unavailable usage and lazy reads; verify-render-performance.mjs covers suggested-draft and existing rendering/animation guards. No provider/runtime contract changes. See the component audit for rendered coverage and the dated release note for deployment evidence.
