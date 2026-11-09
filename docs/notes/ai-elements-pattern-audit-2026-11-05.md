# AI Elements pattern audit — 5 November 2026

## Finding and scope

OpenAg does not implement the full catalogue. Of the **21 current Base UI patterns**, **3 have their core composition adopted**, **8 are partly represented**, and **10 have no dedicated pattern**. These are source findings, not rendered visual certification. A generic Trace import does not establish that every Trace-based pattern is implemented.

The [official introduction](https://ui.shadcn.com/docs/ai-elements) describes compositions of shared components, not a package or a requirement to add every feature. The useful work is to improve existing activity, plans and delegation first. Some missing patterns require new runtime data or product behavior rather than a component swap.

Inspected local main `602655f`, whose desk source matches deployed feature `3800fef`. The loaded launchd configuration points to `<releases>/message-bubbles-20261105`. This audit does not re-establish served-byte identity, provider acceptance or visual behavior. The existing decisions remain: users right, agents left, no message sender avatars/names, avatar-coloured agent bubbles, static Agents sidebar, conversation panel closed by default.

## All 21 patterns

“Adopted core” does not mean every optional action from the documentation is present. “Partial” means the underlying flow exists but its composition or behavior differs. “Absent” means the specific pattern is missing; a related feature may still exist.

| Pattern and official reference | Status | Current evidence and gap |
| --- | --- | --- |
| [Chain of Thought](https://ui.shadcn.com/docs/ai-elements/base/chain-of-thought) | Partial | ActivityTrace shows observed operations as independent expandable rows. There is no parent summary such as “Completed 3 steps” containing the steps of one turn. [A] [F] |
| [Chat](https://ui.shadcn.com/docs/ai-elements/base/chat) | Partial | Feed uses the native MessageScroller hierarchy, autoScroll, message IDs and jump button. User items do not set `scrollAnchor`. The runtime paths inspected publish buffered/final output rather than a live text-delta feed to the desk. [F] [R] |
| [Checkpoint](https://ui.shadcn.com/docs/ai-elements/base/checkpoint) | Absent | No turn marker or conversation restore/branch action. The sample drops later messages; OpenAg has an append-only evidence ledger. This requires a separate branching/restoration design, not copying `setMessages(slice(...))`. [F] [L] |
| [Confirmation](https://ui.shadcn.com/docs/ai-elements/base/confirmation) | Partial | Real gated approval exists, outside the activity Trace, with Accept/Edit/Respond/Ignore and exact proposal/evidence. It uses Card rather than the reference Item composition. A compact presentation must retain these distinct decisions, review version checks and receipts. [C] [F] |
| [Context](https://ui.shadcn.com/docs/ai-elements/base/context) | Absent | No context-use HoverCard/Progress display. Request provenance has selected-character information, which is not authoritative current token usage or a model context-window percentage. The inspected adapter paths do not supply a common usage contract to Feed. [R] [D] |
| [File Tree](https://ui.shadcn.com/docs/ai-elements/base/file-tree) | Absent | The Files tab shows saved results through ResultsPanel; it is not a changed-files folder tree. No folder/file change renderer is wired into Feed. Add only if a bounded changed-file set and permitted file-open behavior are available. [W] [F] |
| [Inline Citation](https://ui.shadcn.com/docs/ai-elements/base/inline-citation) | Absent | MessageText emits normal Markdown links, not source buttons with HoverCard previews. No structured per-message source/citation part renderer was found. Markdown URLs alone do not establish which evidence supports a sentence. [M] [F] |
| [Message](https://ui.shadcn.com/docs/ai-elements/base/message) | Adopted core | Message/MessageContent/Bubble/BubbleContent/MessageFooter are used, with user-right/agent-left alignment and accessible sender labels. Agent tint and hidden avatars/names follow the owner's request. Footers currently contain time only: Copy, feedback, Edit and Retry are not implemented as message actions. [F] |
| [Model Selector](https://ui.shadcn.com/docs/ai-elements/base/model-selector) | Adopted core | Composer uses separate model and effort controls built from DropdownMenu radio groups and InputGroupButton, with real configuration saves. Compact icon triggers and owner/Full restrictions are product adaptations, not missing model functionality. [S] |
| [Plan](https://ui.shadcn.com/docs/ai-elements/base/plan) | Partial | Work already stores bounded step titles and pending/in_progress/completed states. WorkOverview renders a numbered list with text states, not a Trace summary/count and step icons. ACP plan notifications reach `reportWork`; plans remain agent reports, separate from confirmed execution. [P] [R] |
| [Prompt Input](https://ui.shadcn.com/docs/ai-elements/base/prompt-input) | Adopted core | Composer uses InputGroup, textarea, attachment chips, attach/send buttons, model/effort controls and Enter/Shift+Enter handling. Compact disclosure, dictation and permission controls are existing product additions. Source adoption does not certify visual fidelity. [I] |
| [Queue](https://ui.shadcn.com/docs/ai-elements/base/queue) | Absent | Work has lifecycle filters and a reported plan, but no dedicated agent todo renderer split into To do and Completed sections. Work's item lifecycle must not be silently reinterpreted as an editable todo queue. Reuse plan data only if a queue view is useful. [P] [W] |
| [Reasoning](https://ui.shadcn.com/docs/ai-elements/base/reasoning) | Absent | Feed shows a “Working…” Trace indicator, not a collapsible model reasoning stream with duration. The ACP sink inspected handles message/tool/plan updates, not agent-thought updates; Ollama strips think blocks. An effort selector is a configuration control, not reasoning content. [F] [R] |
| [Sources](https://ui.shadcn.com/docs/ai-elements/base/sources) | Absent | No “Used N sources” Trace group attached to replies. Links can appear in Markdown, and saved investigation evidence exists, but there is no general structured source list associated with a reply. [M] [F] [D] |
| [Stack Trace](https://ui.shadcn.com/docs/ai-elements/base/stack-trace) | Absent | Errors have destructive bubbles or generic activity evidence. There is no dedicated frame list, application/framework grouping or source-line navigation. Generic JSON containing a stack is not adoption of this pattern. [A] [F] |
| [Subagent](https://ui.shadcn.com/docs/ai-elements/base/subagent) | Partial | Delegated Work and agent requests exist, including status, result snippets, receipts and links. They are shown as request rows/buttons and separate views, not a nested Trace with the child's operations and result beneath the originating run. [G] [W] |
| [Suggestion](https://ui.shadcn.com/docs/ai-elements/base/suggestion) | Absent | Feed has an explanatory empty state, but no suggested-prompt buttons that send a prompt. Composer mentions select agents, not suggested tasks. This is optional onboarding/UI work. [F] [I] |
| [Task](https://ui.shadcn.com/docs/ai-elements/base/task) | Partial | Work records ownership/progress and ActivityTrace lists operations. There is no semantic task group containing the observed steps under a changing task title. A flat tool log is not the complete Task composition. [A] [W] |
| [Terminal](https://ui.shadcn.com/docs/ai-elements/base/terminal) | Partial | Command calls and completed results reach generic Trace/CodeBlock evidence. No command-specific row with isolated output and live stdout/stderr display is wired to Feed. Host execution buffers capped output until the result; ACP tool-result publishing occurs on completion/failure. [A] [R] [E] |
| [Test Results](https://ui.shadcn.com/docs/ai-elements/base/test-results) | Absent | No structured suite/test/failure summary renderer. Test output, if returned by a permitted tool, remains generic evidence. This audit did not run tests; Alex's ban on unit/Jest execution is unchanged. [A] [F] |
| [Tool](https://ui.shadcn.com/docs/ai-elements/base/tool) | Partial | Tool calls/results/receipts are reconciled and displayed with native Trace/Collapsible and CodeBlock. Titles are generic “tool call/result”; details are serialized lifecycle JSON. TraceLine only sets error status, not running/pending; no tool-specific command/read/search presentation. Keep existing Unknown and returned-but-effect-unconfirmed semantics. [A] [F] [L] |

## Recommended order

1. **Improve existing activity first: Tool + Chain of Thought + Task.** Put observed steps beneath one bounded turn/task summary; show useful operation titles and running/error/settled states. Retain exact JSON and receipts behind disclosure. Existing reconciliation already distinguishes wrapper reports, daemon results and receipt outcomes; presentation must use it rather than invent a second status authority. Never treat adapter completion or a returned provider payload as confirmed external effect.
2. **Render the existing reported Plan with the reference composition.** Step states are already available for tracked Work. Keep the distinction between agent-reported plan progress and recorded execution. Ordinary chat does not automatically create Work; no plan should be invented for it.
3. **Bring delegated activity into the Subagent composition.** Reuse actual parent/child Work and request relationships, preserving authorization, isolation and room visibility. Do not expose hidden or unrelated child-room history to populate a nested view.
4. **Finish the small Message/Chat gaps.** Copy is the simplest useful message action. User scroll anchoring needs a rendered long-thread check before changing it. Edit/Retry require explicit conversation and execution semantics; they are not harmless decorative buttons. Token-by-token reply streaming is a separate runtime/transport change.
5. **Use compact Confirmation where the review is simple.** Keep the complete proposal, Edit/Respond/Ignore, current permission-session rules and decision/execution separation. Do not relabel Ignore as Deny or reduce complex reviews to a yes/no sample merely to match a screenshot.
6. **Add Sources/Inline Citation when replies carry explicit source records.** Establish trusted URL handling, redaction, provenance and per-reply associations first. Do not scrape arbitrary links out of generated prose and present them as verified research sources.

Context, Reasoning, streamed Terminal and structured Test Results need additional data contracts before claiming the complete patterns. File Tree and Checkpoint need a concrete product use case. Suggestions are optional; they should match useful OpenAg tasks rather than fill space.

## Source map

- **[F] Feed** — [composition and rows](../../apps/desk/src/components/Feed.tsx:59), [empty state](../../apps/desk/src/components/Feed.tsx:63), [message footer and Working indicator](../../apps/desk/src/components/Feed.tsx:88).
- **[A] Activity** — [ActivityTrace](../../apps/desk/src/components/ActivityTrace.tsx:14), [operation reconciliation](../../apps/desk/src/activity.ts:8), [exact CodeBlock evidence](../../apps/desk/src/components/EvidenceBlock.tsx:5).
- **[C] Confirmation** — [ApprovalCard](../../apps/desk/src/components/ApprovalCard.tsx:149), with decision/version and draft behavior earlier in the same component.
- **[M] Message text** — [Markdown and link handling](../../apps/desk/src/components/MessageText.tsx:8).
- **[S] Model selection** — [ChatModelSettings](../../apps/desk/src/components/ChatModelSettings.tsx:35), [ModelSelector](../../apps/desk/src/components/ui/model-selector.tsx:39), [compact effort menus](../../apps/desk/src/components/ReasoningFields.tsx:25).
- **[I] Input** — [Composer](../../apps/desk/src/components/Composer.tsx:265), with keyboard handling at line 196.
- **[P] Plans** — [reported plan UI](../../apps/desk/src/components/WorkView.tsx:542), [bounded Work report schema](../../apps/daemon/src/work.ts:14), [desk plan type](../../apps/desk/src/types.ts:617).
- **[W] Work** — [delegated Work](../../apps/desk/src/components/WorkView.tsx:602), [Files tab](../../apps/desk/src/components/WorkView.tsx:703), [Work lifecycle filters](../../apps/desk/src/components/WorkView.tsx:798).
- **[G] Agent requests** — [AgentRequestsPanel](../../apps/desk/src/components/AgentRequestsPanel.tsx:23).
- **[R] Runtime** — [ACP notification sink](../../apps/daemon/src/runtimes/acp.ts:605), [ACP plan handoff](../../apps/daemon/src/runtimes/acp.ts:638), [API buffering/publication](../../apps/daemon/src/runtimes/api.ts:96), [Ollama think-block removal](../../apps/daemon/src/runtimes/ollama.ts:79).
- **[E] Host command output** — [buffering and bounded/redacted result](../../apps/daemon/src/execution.ts:90).
- **[D] Diagnostics/data** — [request provenance presentation](../../apps/desk/src/components/RequestDetails.tsx), [desk data contracts](../../apps/desk/src/types.ts), [saved result presentation](../../apps/desk/src/components/ResultsPanel.tsx).
- **[L] Ledger semantics** — [event summaries and Unknown handling](../../apps/desk/src/ledger.ts:16), [daemon append-only event store](../../apps/daemon/src/ledger.ts:61).

## Verification and limits

Read all 21 current official Base UI pattern pages and the introduction; traced the production Feed, Composer, model/effort controls, approvals, activity projection, plans, delegated Work, agent requests and relevant runtime event paths. Searched the production desk for dedicated context, citations, sources, checkpoints, queues, reasoning, terminal, file-tree and test-result rendering. The counts measure source adoption against the definitions above, not a numeric quality score.

No application code, bot knowledge, settings or deployment changed. This file is an audit artifact, not a new claim of implemented behavior for the default bot. No tests, builds, provider calls or browser journeys were run for this audit. Current rendered fidelity and performance were not checked; the last browser probe in this chat reported local browser use disabled in Work settings. Existing component inventory coverage is also incomplete (ProfileImageEditor.tsx is missing from that inventory). Recommendations are future work, not authorization to change execution policy, replay actions or erase history.

## OA-467 follow-up

The owner authorized a bounded implementation on local main and local deployment. The table above remains the initial audit. The existing-data improvements are documented in [conversation behavior](conversation-model.md#ai-elements-activity-and-review-compositions-oa-467): grouped activity, native reported plans and delegated disclosures, Copy, compact confirmations and recorded command-output presentation. Runtime-dependent patterns and user scroll anchoring remain deferred for the prerequisites described above. Source/controlled acceptance and deployment evidence are recorded separately in the ticket and dated release note; this audit is not a claim that all 21 patterns are implemented.


## OA-470 follow-up

Existing recorded evidence now supports bounded File Tree, Sources and Inline Citation-style source previews, Stack Trace and Test Results summaries. Full devices have lazy request usage (reported tokens and daemon character budget); this is partial Context coverage, not provider capacity measurement. Work plans have a reported Queue view. Empty conversations have editable-draft Suggestions. See conversation-model.md#recorded-evidence-and-conversation-controls-oa-470 for the exact contracts and bounds. Returned sources are not answer citations. Recorded terminal output remains available after completion; live terminal/reply streaming and model reasoning require a separate runtime contract. The initial table is retained as the before-state audit, not the current completion count.

## OA-471 owner-directed removal

Checkpoint was removed from the chat UI at the owner's request. Existing forked rooms/history remain; the earlier adoption notes and screenshots are historical. Checkpoint is intentionally excluded from the current UI.
