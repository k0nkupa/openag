# OSS product references for OpenAg

Reviewed 31 October 2026. This is a read-only review of official documentation, licenses and selected implementation files. Open Duet received a documentation/license review only. No reference application was installed or run. Upstream feature claims and checked-in code are not proof of working live integrations or production readiness.

## Recommendation

OpenAg should be an owned workspace for ongoing agent work: a Primary coordinates specialists, work continues between visits, results remain inspectable, and a person decides consequential actions. The references support this direction. Keep OpenAg's existing daemon and policy boundary. Borrow their strongest interaction patterns before considering another runtime, persistence service or application base.

The most useful combination is:

- **Nightly OpenBot:** persistent teammates, work ownership, channels, quiet routines and remote continuity.
- **OpenMuse:** an outcome becomes a durable task with a plan, missing-input state, review and saved results.
- **CopilotKit OpenBot:** responsibilities, governed handoffs, action review and audit.
- **OpenDots:** continuous personal conversations with a computer/results side pane.
- **CopilotKit framework:** typed agent UI events and application-owned interactive renderers.
- **Open Duet:** lead/specialist team interaction and clear bot-versus-room context.

These are design recommendations, not approval to replace OpenAg's stack or add every feature present upstream.

## Project identities and reviewed scope

| Project | Product role | Actual repository license inspected | Main qualification |
| --- | --- | --- | --- |
| [CopilotKit/CopilotKit](https://github.com/CopilotKit/CopilotKit) | Framework connecting agents to interactive applications | [MIT](https://github.com/CopilotKit/CopilotKit/blob/main/LICENSE) | SDK/protocol capabilities differ from the separate Intelligence service |
| [CopilotKit/openmuse](https://github.com/CopilotKit/openmuse) | Personal-agent application with durable tasks and rich results | [MIT](https://github.com/CopilotKit/openmuse/blob/main/LICENSE) | Alpha; important live acceptance remains outstanding |
| [CopilotKit/OpenBot](https://github.com/CopilotKit/OpenBot) | Company-oriented coworker workspace | [MIT](https://github.com/CopilotKit/OpenBot/blob/743649efc3f21d7bf0badbe6af2bcd5daedd97ce/LICENSE) | Beta template; multiple operating services |
| [CopilotKit/OpenDots](https://github.com/CopilotKit/OpenDots) | Single-owner personal coworker/document workspace | [MIT](https://github.com/CopilotKit/OpenDots/blob/8091324942b86789ed0da7facbee855145d933b0/LICENSE) | Alpha; groups and automatic delegation are further work |
| [nightly-labs/openbot](https://github.com/nightly-labs/openbot) | Local-first persistent teammate workspace | [PolyForm Noncommercial 1.0.0](https://github.com/nightly-labs/openbot/blob/3b384b21bba953e76c42ccf3a5487db5a0caf902/LICENSE) | Source available with noncommercial terms; docs/source disagree on approval defaults |
| [Anil-matcha/open-duet](https://github.com/Anil-matcha/open-duet) | Owner-controlled lead/specialist workspace | [Apache 2.0](https://github.com/Anil-matcha/open-duet/blob/main/LICENSE) | Experimental platform/integration qualification |

“OpenDot” is interpreted as CopilotKit/OpenDots. “OpenBot” and the explicitly named Nightly repository refer to two different projects. OpenDots names OpenMuse/OpenBot as references and reuses OpenBot computer services; these are distinct repositories, not aliases. The available evidence does not establish a simple rename/successor chain. [OpenDots README](https://github.com/CopilotKit/OpenDots/blob/8091324942b86789ed0da7facbee855145d933b0/README.md).

Source snapshots inspected for the larger templates: CopilotKit OpenBot `743649efc3f21d7bf0badbe6af2bcd5daedd97ce`; OpenDots `8091324942b86789ed0da7facbee855145d933b0`; Nightly `3b384b21bba953e76c42ccf3a5487db5a0caf902`. Other links follow mutable `main` or live documentation.

## Findings by project

### CopilotKit: useful UI layer, with boundaries to preserve

AG-UI standardizes agent/application events, including streaming messages, tool calls and shared state. CopilotKit provides components and hooks over that connection. It could make rich tool results and interactive decisions easier to present. AG-UI is a user-interface connection; ACP remains OpenAg's subscription-CLI connection and MCP remains its tool connection. An AG-UI adapter would be a separate, optional boundary. [AG-UI documentation](https://docs.copilotkit.ai/agentic-protocols/ag-ui).

The HITL documentation distinguishes model-selected frontend questions (`useHumanInTheLoop`) from graph-enforced interruptions (`useInterrupt`). A model choosing to ask is not equivalent to OpenAg's server enforcing a policy on every tool call. Current Mastra integration docs support tool-based HITL but do not support native AG-UI interrupt handling; they explicitly distinguish this from Mastra's own suspension API. A migration must preserve OpenAg's gate and persistent approval state rather than replacing them with an optional confirmation tool. [HITL patterns](https://docs.copilotkit.ai/human-in-the-loop), [Mastra integration limitation](https://docs.copilotkit.ai/mastra/human-in-the-loop/interrupt-flow).

CopilotKit's current durable AG-UI Streams documentation assigns replay, reconnection and cross-device delivery to **Intelligence**, separately from the backend's agent context/checkpoint storage. The protocol alone does not provide these guarantees. Continuing after a browser disconnect is also explicitly distinguished from recovering execution after server failure. OpenAg already owns its ledger and approval state; adopting the SDK does not require adopting this storage model. [AG-UI Streams](https://docs.copilotkit.ai/threads).

**Recommendation:** borrow registered renderers for known action/result types. Consider a narrow UI adapter only when a concrete integration saves work. Keep SQLite and the existing approval API authoritative. Do not add a second thread store merely to obtain a chat component.

### OpenMuse: the clearest task-and-result reference

OpenMuse's inspected `TaskCard`/`TaskDetail` implementation presents plan progress, next step, missing information, review state and result. A saved task loads its events, files, artifacts and browser sessions; applicable controls include pause/resume/cancel/retry. These are concrete source-backed patterns for returning to work later. [Task UI source](https://github.com/CopilotKit/openmuse/blob/main/apps/mobile/src/agent-ui.tsx).

Its action service binds review to a parsed proposal, connection, target version and hash, claims execution atomically, and distinguishes failed from unknown provider outcomes. Its worker uses task leases and conditional checkpoints. This is useful evidence for making “needs input,” “needs approval,” “interrupted,” and “outcome unknown” separate states. It does not prove exactly-once external side effects. [Action source](https://github.com/CopilotKit/openmuse/blob/main/apps/server/src/actions.ts), [worker source](https://github.com/CopilotKit/openmuse/blob/main/apps/server/src/engine/worker.ts).

The experience notes also cover useful small details: keeping drafts while stopping, visible/removable follow-ups, editable composition during replies, and preserving the reader's position. Chat follow-ups queued in an open client are explicitly different from durable server tasks. [Experience](https://github.com/CopilotKit/openmuse/blob/main/docs/EXPERIENCE.md), [Rich Threads](https://github.com/CopilotKit/openmuse/blob/main/docs/RICH-THREADS.md).

The current design requires Intelligence for conversation persistence/replay; tasks and files use PGlite/PostgreSQL and separate workers. The OpenBot bridge is disabled/future work. The roadmap leaves live Google, Intelligence cross-device and open-ended live model acceptance outstanding. Those should not be counted as independently proven working features. [README](https://github.com/CopilotKit/openmuse/blob/main/README.md), [integration contract](https://github.com/CopilotKit/openmuse/blob/main/docs/OPENBOT-INTEGRATION.md), [roadmap](https://github.com/CopilotKit/openmuse/blob/main/ROADMAP.md).

**Recommendation:** borrow outcome → plan → visible work → review → saved result. Start by exposing OpenAg's existing turns, delegation and ledger through a compact work-detail view. Establish whether those records suffice before introducing a new durable task system.

### CopilotKit OpenBot: responsibilities and governed action

OpenBot separates bot responsibilities, memory, channels, approvals and company administration. Group work has attributed shared conversation and bot-specific execution contexts. Its stack is substantially larger than OpenAg's: React/Vite, Hono, PostgreSQL/pgvector, runtime/Intelligence, agent services, a computer supervisor and routine worker. Current computer architecture describes a container per person with per-bot folders/profiles; isolated bots receive separate containers. [Architecture](https://github.com/CopilotKit/OpenBot/blob/743649efc3f21d7bf0badbe6af2bcd5daedd97ce/docs/architecture.md).

The action gateway places policy and audit before execution. The approval executor reconstructs the continuation, checks actor/agent and re-enters the real gate, including refusal when a grant was removed. However, the documented startup action policy is explicitly allow-all unless replaced, despite the engine failing closed when policy is missing. OpenAg should retain its own locked defaults. [Architecture: governance](https://github.com/CopilotKit/OpenBot/blob/743649efc3f21d7bf0badbe6af2bcd5daedd97ce/docs/architecture.md#browser-action-governance), [approval executor](https://github.com/CopilotKit/OpenBot/blob/743649efc3f21d7bf0badbe6af2bcd5daedd97ce/server/src/approvals/execute.ts), [approval policy](https://github.com/CopilotKit/OpenBot/blob/743649efc3f21d7bf0badbe6af2bcd5daedd97ce/server/src/approvals/policy.ts).

**Recommendation:** make standing work legible: purpose, owning bot, trigger, next run, last outcome and pause. Keep exact action previews and lasting decision receipts. Avoid importing enterprise administration into the everyday personal desk.

### OpenDots: conversation beside tangible work

OpenDots combines personal conversations, specialist Dots, editable pages and computers. SQLite stores pages/metadata; its README explicitly says conversation events use Intelligence rather than a standalone SQLite conversation store. Multi-Dot groups and automatic delegation remain further work. A Space is a document destination, not a group conversation. [README](https://github.com/CopilotKit/OpenDots/blob/8091324942b86789ed0da7facbee855145d933b0/README.md).

Review-card source restores receipts, detects changed drafts and prevents repeated pending clicks. MCP wrappers create approval records instead of executing approval-required actions immediately. Runner source marks interrupted work honestly and checks lost ownership/revoked permissions. [PageReviewCard](https://github.com/CopilotKit/OpenDots/blob/8091324942b86789ed0da7facbee855145d933b0/src/client/PageReviewCard.tsx), [connection tools](https://github.com/CopilotKit/OpenDots/blob/8091324942b86789ed0da7facbee855145d933b0/src/server/connection-tools.ts), [runner](https://github.com/CopilotKit/OpenDots/blob/8091324942b86789ed0da7facbee855145d933b0/src/server/runner.ts).

**Recommendation:** use a contextual side pane for computer, results/files and activity. Start with result links and previews; a complete document editor and voice system are separate product decisions.

### Nightly OpenBot: closest always-on teammate reference

Nightly separates persistent bot identity from main chat, side threads and channel execution contexts. Shared channels have members, a lead and explicit work ownership. Source supports bounded assignments and recovery; routines have an explicit no-update result that stays out of unread chat/notifications while preserving run history. The host owns conversation/work state, while remote account/control services are separate. [State ownership](https://github.com/nightly-labs/openbot/blob/3b384b21bba953e76c42ccf3a5487db5a0caf902/docs/architecture/structure.md), [agent contexts](https://github.com/nightly-labs/openbot/blob/3b384b21bba953e76c42ccf3a5487db5a0caf902/docs/architecture/agents.md), [channel source](https://github.com/nightly-labs/openbot/blob/3b384b21bba953e76c42ccf3a5487db5a0caf902/src/backend/channel-service.ts), [quiet routines](https://github.com/nightly-labs/openbot/blob/3b384b21bba953e76c42ccf3a5487db5a0caf902/src/backend/agent/routine-quiet-runs.ts).

Browser/computer work has ownership and takeover state. The browser and host computer are different capabilities; the same host workspace is presented through remote clients. Borrow clear active-agent/work context and capability-aware controls while retaining OpenAg's managed sandbox and gate. [Browser](https://github.com/nightly-labs/openbot/blob/3b384b21bba953e76c42ccf3a5487db5a0caf902/docs/architecture/browser.md), [computer use](https://github.com/nightly-labs/openbot/blob/3b384b21bba953e76c42ccf3a5487db5a0caf902/docs/architecture/computer-use.md).

There is a material documentation/source mismatch. README/SECURITY describe blanket full-access/no-approval behavior; current source starts Codex with `on-request` and implements Workspace only / Ask first / Full access. Full access can auto-answer eligible approvals, including publishing/deletion flows. Nightly has approvals, but its broad grant model differs from OpenAg's nonautomatic external/secrets classes. [SECURITY](https://github.com/nightly-labs/openbot/blob/3b384b21bba953e76c42ccf3a5487db5a0caf902/SECURITY.md), [thread lifecycle](https://github.com/nightly-labs/openbot/blob/3b384b21bba953e76c42ccf3a5487db5a0caf902/src/backend/agent/thread-lifecycle.ts), [attention registry](https://github.com/nightly-labs/openbot/blob/3b384b21bba953e76c42ccf3a5487db5a0caf902/src/backend/agent/attention-registry.ts), [approval automation](https://github.com/nightly-labs/openbot/blob/3b384b21bba953e76c42ccf3a5487db5a0caf902/src/backend/agent/approval-automation.ts).

Its background memory review applies validated operations directly. OpenAg instead applies reflection proposals through a human approval decision. Preserve that distinction. [Memory-review source](https://github.com/nightly-labs/openbot/blob/3b384b21bba953e76c42ccf3a5487db5a0caf902/src/backend/agent/memory-review.ts). The actual license is noncommercial rather than permissive MIT/Apache; use the product patterns as references and check reuse terms before copying implementation. [License](https://github.com/nightly-labs/openbot/blob/3b384b21bba953e76c42ccf3a5487db5a0caf902/LICENSE).

### Open Duet: additional team interaction reference

The teams guide describes lead/specialist rooms, explicit addressing, separate member work, asynchronous delegation receipts and owner controls. The README identifies experimental desktop/server/computer behavior and incomplete platform/live-service qualification. This review checked those documents, not the implementation. [Teams](https://github.com/Anil-matcha/open-duet/blob/main/docs/TEAMS.md), [limitations](https://github.com/Anil-matcha/open-duet/blob/main/README.md#known-limitations).

**Recommendation:** keep one bot's identity/configuration separate from a room's roster/routing. Show delegated owner and result links without posting every coordination event into the shared conversation.

## What OpenAg already owns

The current code supports a deliberate foundation worth retaining:

- [Policy resolution](../../apps/daemon/src/policy.ts): unknown tools default to external; external/secrets cannot resolve to automatic.
- [Runner](../../apps/daemon/src/runtimes/runner.ts) and [approvals](../../apps/daemon/src/approvals.ts): daemon-owned lifecycle and persistent decisions, including interrupted approval recovery paths.
- [Wake filter](../../apps/daemon/src/wake.ts): silent/digest/ping decisions constrained by deduplication, hours, urgency and budget.
- [Reflection apply](../../apps/daemon/src/reflection-apply.ts): approved proposals are the write boundary.
- [Desk stream](../../apps/desk/src/stream.tsx), [Feed](../../apps/desk/src/components/Feed.tsx) and [RoomView](../../apps/desk/src/components/RoomView.tsx): shared live events, inline approval cards and a room view over the ledger.

These are source observations. No existing feature was requalified against live models, computers, providers or another device during this review. The source stack is React/Vite, despite the older product notes still naming Next.js as an initial opinion. The external UI preview remains sample-only.

## Suggested next design work

1. **Work detail from the existing ledger.** Show request, owner, current step/blocker, approvals, activity and result links. Keep missing input distinct from permission to act. Do not imply a new durable task backend already exists.
2. **Context by scope.** Direct bot chat shows that bot's work/context and a settings entry. A room shows only its members, lead, routing and shared work. Server, devices, providers and connectors remain in Settings.
3. **Review with a lasting receipt.** Show exact target/draft/diff, sources and consequences before Accept/Edit/Respond/Ignore. Keep the decision and subsequent execution result visible; accepting is not proof execution succeeded.
4. **Results beside conversation.** A switchable computer/results/activity pane gives work somewhere to live. Keep routine technical events out of the primary conversation.
5. **Quiet standing work.** Automations show next run, last outcome, owner and pause. Quiet runs remain inspectable without becoming alerts. Failures and uncertain outcomes need distinct presentation.
6. **Interaction polish.** Preserve drafts, reading position and queued follow-ups. Distinguish Stop reply, Cancel work and Take over computer; their effects differ.

The first preview improvement should explore one realistic end-to-end job, such as research → delegated comparison → draft → approval → saved result/receipt. Prototype it with sample data before changing the real daemon. No preview changes, dependencies, runtime changes, ticket status changes, commits or deployments were made by this research.

## Verification limits

Primary docs, selected source and actual repository license files were reviewed. No installations, unit tests, Jest, live account actions or runtime acceptance checks were performed. This is not an exhaustive security audit or a legal compatibility assessment for a combined distribution. Mutable documentation can drift; Nightly already demonstrates such drift.
