# Chats and rooms

A direct chat has one permanent bot. A named room is a separate optional conversation with selected bots and a lead, even with one bot.

The home route opens the default bot's direct chat. In rooms, @mentions select members; otherwise routing selects the lead or recipient. Room delegation stays member-only. For guest mentions and consultations, read Agent requests (agent-requests).

Proactive delivery uses the configured delivery room when one is set, otherwise the default bot's direct chat. A missing explicitly configured destination is a setup problem, not permission to silently choose a different room. Pending information is retained. Push notifications use their own settings.

Owners and Full devices can create a named room with the plus beside Rooms in the redesigned sidebar. Select existing agents and a lead from those members. Creating a room starts no turn or Work and changes no proactive destination. See Create a room for recovery and limits. Help/status tools cannot create rooms or change membership.

The redesigned sidebar supports Pin to top, Unpin, Move up/down and grip dragging within pinned/unpinned groups. Order is browser-local. Reduced motion and keyboard/menu moves are instant. See docs/notes/conversation-model.md for storage limits and classic fallback.

## Chat display

**Hide technical activity** in **Settings → Server → Appearance** hides technical steps. Messages, results, errors, pending approvals and the working indicator remain. This browser-only choice defaults off and changes no authority or history. Without storage, it lasts for this page. Activity and Ledger retain details.

Activity groups turn operations. Settled groups start closed; expand for operations, command output, exact evidence and receipts. Failures and uncertainty stay explicit. Work plans show reported progress; delegated runs expand for available activity/results. Copy copies original text and reports failure. Inline reviews use compact items; Accept/Edit/Respond/Ignore keep their meanings.

Starter prompts prepare an editable draft in an empty conversation; Send keeps the usual checks. Work's Queue groups the reported plan into To do and Completed.

Completed file writes can show a recorded file tree. Selecting a file shows retained evidence, not current disk contents. Returned Brave search results have source links/previews; these are not verified answer citations. Recognized recorded TAP output and JavaScript stack frames get summaries beside the exact output.

Full devices can open Request usage below an agent reply for reported tokens and the required-input character budget. Missing values stay unavailable; this is not a model context-window percentage.

## Reply to a message

Choose **Reply** beside Copy below a message. A quoted preview appears above your draft. **Cancel reply** or Escape removes it and keeps your draft; choosing another message replaces it. A failed or unconfirmed send keeps both. Check the conversation before sending again.

Sent replies retain the quote after reload. They stay in the same chat; mentions and room routing still choose the agent. Agents, including mentioned guests, receive up to 1,200 characters as quoted context, without new action permission. Attachment-only quotes show a label without resending files. Earlier quotes are not copied.

## Request details

Owner and Full devices can expand **turn started** in technical activity and choose **Request details** for context, tools, settings and attempts. Reading details never replays a request.

API/Ollama record daemon-visible requests. ACP records OpenAg's handoff and fresh/reused sessions; hidden requests, retained context and usage are unavailable. Missing usage is unavailable, not zero. Returned requests do not prove actions succeeded; check execution receipts.

Stored metadata excludes full prompts and attachment contents. Character counts are JavaScript string lengths, not tokens. Redacted fingerprints cannot reconstruct sources. Historical turns show **Not recorded**. Settlement gaps never cause replay. Limited devices cannot inspect these records.

See `docs/notes/request-provenance.md`.

## Room settings

In a multi-bot room, open the side panel and choose the Room settings tab (the sliders icon after Activity). The owner (or a full-access device) can rename the room, edit its description, choose the lead from the room's members, and set routing for messages without an @mention. Routing uses one Model list that merges every configured compatible provider; choosing a model also chooses its provider, and the list loads automatically. Limited devices do not see the tab. Changes are recorded as `config` events in the hidden `_system` room, and a lead change is also recorded in the room itself. Direct chats have no room settings; Bot settings covers the bot instead. Routing can also still be changed under Settings, Models.

In routing settings, Cancel restores the saved configuration and reloads its model controls before saving can resume. A failed discovery is shown as an error; another explicit Cancel can reload it. See `docs/notes/provider-routing.md` (Routing editor reset).

## Recent conversation context

API and Ollama receive recent history from their own participation in this conversation: up to 20 messages and 24,000 characters. ACP keeps adapter context while its session is available. Fresh ACP sessions after restart, input pause or session loss restore ledger history under the same limits and conversation/agent restrictions; reused sessions get no duplicate copy. Older context may be omitted; supply missing details when needed. The current request appears once. Historical tool calls and approval grants are never replayed.

An input question leaves the conversation or Work awaiting input while its asking turn ends normally. The conversation activity says "awaiting input"; stopping the adapter prompt for that pause is not an owner cancellation. Late text or cancellation output from the paused prompt is discarded. An answer supplies context and starts one continuation, with no new action permission. Genuine cancellation remains visible. Earlier ledger events are retained rather than rewritten.

Operating rules remain separate from remembered facts, source excerpts and specialist handoffs. History does not grant action permission or create Work. Isolated, hidden and external/noIndex-origin history is excluded. Memory recall remains bot-wide, so this does not promise that all context is private to one room.

Oversized required input stops incomplete with context_limit before model requests or tools; shorten the request. The application text ceiling is 64,000 characters including declared tool schemas, not a model token guarantee. There is no new history-reset control. Historical attachments contribute references rather than resent content.

See `docs/notes/hosted-context.md` for selection, boundaries, limits and verification scope.

## Bounded execution and incomplete results

API and Ollama turns use at most 20 model steps by default. In Bot settings, the owner can set Maximum model steps from 1 to 100. Each turn also permits at most 40 executed tools; refused proposals do not consume that execution allowance. Settings are captured when the turn starts and retained for same-turn recovery. ACP keeps its adapter-owned execution behavior.

A normal final answer at the exact limit can complete. A forced stop, unresolved calls, output-length stop or omitted oversized tool data is reported as Incomplete, with the reason and any partial findings retained. Model-facing tool data is capped at 20,000 characters in valid JSON. Retained tool events and action receipts remain separate evidence; connected tools can also apply their own output limits.

Incomplete appears in chat, linked Work and automation history. Unknown actions remain in history without a manual inspection requirement; neither Incomplete nor a completed turn proves an external effect. There is no automatic continuation or action retry. Model-request retries are described below. Scheduled turns are not investigations.

See `docs/notes/hosted-outcomes.md` for outcome and recovery details.

## Transient model-request failures

API and Ollama can make up to two retries after an initial generation request fails temporarily. They retry that request, not the conversation, Work, tools or earlier actions. Authentication, configuration and invalid-input errors are not retried. ACP keeps its adapter-owned behavior.

Each model step has a five-minute window shared by its attempts and waits, including response reading. This is not a five-minute limit on an entire turn or on approval waits. A valid provider Retry-After is never shortened. If the wait cannot fit, the result is Incomplete with provider_backoff and, when known, a Retry not before time. That time does not schedule another run. A linked continuation preserves the applicable wait across restart; unrelated requests do not share a new account-wide throttle.

A broken response stream stops incomplete without being resubmitted or combined with another response. Partial findings are retained when available. Deadline and cancellation also stop further submissions. Existing permission and approval gates still apply; a model connection failure does not mean an earlier action failed.

See `docs/notes/model-retries.md` for retry categories, timing, error handling and verification limits.

## Agent summaries

The working indicator shows activity, not completion or proof that a tool succeeded. Reduced motion keeps decorative indicators static.

The side panel starts closed; its toggle or panel/Work links open it. Model/effort badges reflect settings or this chat’s current reports. Idle agents have no status line; the avatar indicator means working and respects reduced motion. Approval needed stays explicit.

Messages keep users right and agents left, without visible sender avatars/names. Accessible labels and time remain. Agent bubbles follow avatar colour; user bubbles are neutral. Markdown replies keep HTML/remote images blocked. See [conversation presentation](../notes/conversation-model.md).

The composer’s model controls belong to one addressed agent: the direct-chat agent, a single explicit mention, or an unrouted room’s lead. Everyone, multiple-agent and dynamically routed messages do not imply one selected model. Changes require Full access, update that agent across its chats, and preserve the current message/attachments. See [model configuration](../notes/oa-335-model-configuration.md#composer-model-controls-oa-404).

The composer expands for focus, drafts, attachments, dictation and errors. Uploads start immediately; failed chips retain Retry and Remove. File drags show an available target; upload limits still apply.

Received attachment chips have a Download action. Code and tool payloads use a shared keyboard-scrollable code surface; the stored text and approval payloads are unchanged.

Conversation side-panel addresses restore saved sections. Back/Forward between retained sections preserves mounted drafts. Refresh restores the section, not unsaved edits; leaving with edits warns before discarding.

Dictation adds speech to your draft. Enable it in Settings → Models → Dictation and use the microphone beside Send. Stop transcribes; Cancel discards. Review and send normally. See the Dictation help topic for provider choice, microphone access and limits.

## Questions and decisions in chat

Bot questions appear as ordinary messages. Answer through the normal composer: Replying to identifies the selected question; New message sends an unrelated message. With several questions, choose Reply on the relevant one. A stale or cancelled reply fails without clearing your draft. Approvals and live integration prompts remain explicit cards in the conversation. Needs you and its separate queues are removed. Open questions pause their requests, not unrelated conversation activity. No interruption creates an acknowledgement form. See [the interaction rules](../notes/chat-interactions.md).
