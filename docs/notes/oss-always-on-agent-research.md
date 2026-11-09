# OSS and source-available always-on agents: lessons for OpenAg

Researched 2 November 2026. Scope: current official repositories, pinned source and owning-project documentation. This is product/architecture research, not an implementation, deployment, security audit or live acceptance claim. OpenAg remains the product being improved.

## Recommendation

Keep OpenAg's daemon, SQLite authority, policy gate, durable approvals and action receipts. Borrow **bounded history and tool guidance from Nightly**, **interaction lifecycle and explicit identity from CopilotKit**, **memory inspection from Agent Zero/Letta**, and **operational diagnostics and replay distinctions from OpenClaw**. OpenMuse is the most useful small reference for work, review and recovery. OpenHands is especially relevant to coding specialists, rather than a reason to replace the primary agent.

Do not select a framework because its demo has more panels. OpenAg's immediate value depends on carrying context, finishing a useful job, preserving permissions through interruption, and showing the owner what actually happened. The existing OA-342 and OA-355 tickets cover important gaps. This report does not reorder the queue, approve their runtime changes or replace OA-355's concrete design/approval step.

A crucial correction to the category: **current nightly-labs/openbot is source-available under a noncommercial license, not permissively licensed OSS**. Studying behavior is different from copying code. CopilotKit's application templates are MIT, but their configured Intelligence dependency has separate licensing and operational requirements. “Self-hostable” does not mean an entire stack is open source, subscription-free or offline.

## Evidence and source identities

Repositories were resolved through GitHub's API, then selected README, LICENSE, architecture and implementation files were read at the revisions below. Branches can change after research; pinned links describe the observed snapshot. GitHub's detected license field is only a hint: Nightly and Agent Zero both returned `NOASSERTION`, with very different actual license bodies.

| Project | Observed revision | Root license and role |
| --- | --- | --- |
| nightly-labs/openbot | `ac99196e66fe8f9d426433aa5e79d6e999d1c818` | [PolyForm Noncommercial 1.0.0](https://github.com/nightly-labs/openbot/blob/ac99196e66fe8f9d426433aa5e79d6e999d1c818/LICENSE); desktop coworker application |
| CopilotKit/CopilotKit | `c5616c818bf9b6d97b29fb1d766876c807e2b208` | [MIT](https://github.com/CopilotKit/CopilotKit/blob/c5616c818bf9b6d97b29fb1d766876c807e2b208/LICENSE); frontend/runtime framework |
| CopilotKit/OpenBot | `c396a5f68c817043846f1ca3c2b42061ee73ceb5` | [MIT](https://github.com/CopilotKit/OpenBot/blob/c396a5f68c817043846f1ca3c2b42061ee73ceb5/LICENSE); coworker/team application |
| CopilotKit/OpenDots | `8091324942b86789ed0da7facbee855145d933b0` | [MIT](https://github.com/CopilotKit/OpenDots/blob/8091324942b86789ed0da7facbee855145d933b0/LICENSE); persistent coworker/Spaces template |
| CopilotKit/OpenMuse | `a4944f4c471d3dc93b8bfc060b5da309b5216ab2` | [MIT](https://github.com/CopilotKit/OpenMuse/blob/a4944f4c471d3dc93b8bfc060b5da309b5216ab2/LICENSE); personal assistant/work application |
| openclaw/openclaw | `2426aa9288a524c9cb912dca3da500f2f09fc83a` | [MIT](https://github.com/openclaw/openclaw/blob/2426aa9288a524c9cb912dca3da500f2f09fc83a/LICENSE); gateway and personal-agent system |
| letta-ai/letta-code | `3b7e3ffcf16d6ba4880f7a697261837000221320` | [Apache-2.0](https://github.com/letta-ai/letta-code/blob/3b7e3ffcf16d6ba4880f7a697261837000221320/LICENSE); stateful agent harness, App Server and channels |
| OpenHands/OpenHands | `172d7f180096cfe06f1a875d2fcbbcb1fae2b6bb` | [MIT](https://github.com/OpenHands/OpenHands/blob/172d7f180096cfe06f1a875d2fcbbcb1fae2b6bb/LICENSE); current Agent Canvas control center |
| agent0ai/agent-zero | `ba9b67df0f54ac78106ae85c552ef5d2458f7c9a` | [MIT](https://github.com/agent0ai/agent-zero/blob/ba9b67df0f54ac78106ae85c552ef5d2458f7c9a/LICENSE); general agent with Linux workspace |

These are root license observations, not a dependency or distribution clearance. CopilotKit's framework, CopilotKit/OpenBot and nightly-labs/openbot are different projects. OpenDots/OpenMuse are independently named templates, not the official OpenAI Dots/Claude Duet products. The [earlier harness comparison](oss-agent-harness-comparison.md) addresses a narrower tool contract; the [commercial-agent study](always-on-agent-research.md) addresses positioning. This note adds broader OSS application, operating and adoption evidence.

“Source verified” below means the mechanism was read, not run. “Documented” means an owner-maintained explanation. Author-reported acceptance is useful evidence but was not independently repeated here. Missing evidence is not proof of absence.

## 1. Nightly OpenBot: the closest desktop/product reference

**Fit and trade-off.** Nightly combines subscription CLI adapters, persistent teammates, conversation queues, files, browser/computer work, local skills and remote clients. This is a close reference for OpenAg's model choice and coworker experience. Its README explicitly calls the current product a development preview. Current agent execution uses `danger-full-access` and `approvalPolicy: never` after first-launch consent. The security policy confirms that agents are not sandboxed from the host on the user's behalf. That is a deliberate product boundary, incompatible with transplanting its runtime policy into OpenAg. [README](https://github.com/nightly-labs/openbot/blob/ac99196e66fe8f9d426433aa5e79d6e999d1c818/README.md), [security model](https://github.com/nightly-labs/openbot/blob/ac99196e66fe8f9d426433aa5e79d6e999d1c818/SECURITY.md).

**History worth borrowing.** Its handoff history uses bounded excerpts with separate recent/older/step allocations, preserves recent conversational anchors, and explicitly avoids pretending an excerpt is a complete summary. The original details remain retrievable. Scoped history tools validate cursors and apply redaction before search, avoiding a secret-dependent search hit/miss leak. This is a strong pattern for OA-355: recent history plus scoped retrieval first; persistent summaries only when their accuracy, replacement and privacy behavior are justified. Copy neither its numerical budgets nor source code blindly. [Handoff history](https://github.com/nightly-labs/openbot/blob/ac99196e66fe8f9d426433aa5e79d6e999d1c818/src/backend/agent/handoff-history.ts), [history tools](https://github.com/nightly-labs/openbot/blob/ac99196e66fe8f9d426433aa5e79d6e999d1c818/src/backend/agent/history-tools.ts).

**Compaction is an operation.** Context compaction has state, start and completion deadlines, provider-thread ownership and queue holds. It distinguishes requesting a compaction from the provider actually completing it. OpenAg's adapters have different ownership of context, so an application-wide “summarize everything” function would lose useful distinctions. Preserve ACP-owned history while defining hosted runtime continuity. [Compaction controller](https://github.com/nightly-labs/openbot/blob/ac99196e66fe8f9d426433aa5e79d6e999d1c818/src/backend/agent/context-compaction.ts).

**Discovery and routines.** Search/describe returns useful schemas and focused guidance without loading every tool in the initial prompt. Routine scheduling has occurrence keys and attention states. Those keys prevent some duplicate enqueueing; they do not establish exactly-once remote writes. Extend OpenAg's existing capability catalogue only when catalogue size warrants progressive discovery. An indirect tool call must resolve the real tool before classification, validation and approval. [Catalogue](https://github.com/nightly-labs/openbot/blob/ac99196e66fe8f9d426433aa5e79d6e999d1c818/src/backend/agent/tool-catalog.ts), [routine scheduler](https://github.com/nightly-labs/openbot/blob/ac99196e66fe8f9d426433aa5e79d6e999d1c818/src/backend/agent/routine-scheduler.ts).

**Adoption cost.** Current README says commercial use requires a separate license; versions through 0.1.11 remain Apache-2.0. An old permissive release is not permission to copy later features. Accounts/remote connectivity add services and data flows; local-first execution still calls model providers and visited services. Recommendation: independently implement selected behavior within OpenAg's existing seams, rather than fork current Nightly or import its permission defaults.

## 2. CopilotKit: distinguish the framework from the application templates

### Framework: useful interaction protocol and lifecycle

The MIT framework includes frontend tools, agent state/events and runtime interfaces. It is more than a chat widget: the source has runner ownership contracts and a SQLite runner. Its human-in-the-loop hook handles cancellation and exposes a live response callback only while an interaction is executing. Settled cards retain their result without retaining an active decision function. These are valuable interaction rules for a desk that reconnects or reloads. [Interaction hook](https://github.com/CopilotKit/CopilotKit/blob/c5616c818bf9b6d97b29fb1d766876c807e2b208/packages/react-core/src/v2/hooks/use-human-in-the-loop.tsx), [runner contract](https://github.com/CopilotKit/CopilotKit/blob/c5616c818bf9b6d97b29fb1d766876c807e2b208/packages/runtime/src/v2/runtime/runner/agent-runner.ts), [SQLite runner](https://github.com/CopilotKit/CopilotKit/blob/c5616c818bf9b6d97b29fb1d766876c807e2b208/packages/sqlite-runner/src/sqlite-runner.ts).

A renderer awaiting a callback is not OpenAg's authoritative durable approval. Keep backend state and exact action snapshots authoritative. AG-UI could be an interoperability boundary if a concrete external agent requires it; replacing OpenAg's stream/desk just to use the framework adds migration work without proving a user benefit.

### Intelligence: separately operated and licensed

All three inspected application templates configure Intelligence. Managed deployments store conversation events in CopilotKit's service; self-hosted options exist, so “cloud-only” would be inaccurate. Current local evaluation documentation describes a licensed Docker stack with account-based license issue/renewal, macOS/Docker Desktop preview support and substantial resources. It includes saved AG-UI streams, Automatic Learning and channels, but excludes User Memory and Product Analytics. Offline operation lasts only while the evaluation license remains valid. It is not a production installation entitlement. [Local evaluation](https://docs.copilotkit.ai/intelligence/self-hosting-local).

Production self-hosting has separate license and infrastructure requirements. Treat open template code, model costs and the Intelligence control plane as three separate adoption questions. OpenAg already owns its conversation persistence in SQLite; moving that authority would require a compelling benefit, export/retention behavior and a clear operating cost. [Production self-hosting](https://docs.copilotkit.ai/intelligence/self-hosting).

### CopilotKit/OpenBot: strongest actor/grant reference

OpenBot is a fuller coworker/team application: React/Hono, PostgreSQL, Intelligence, AG-UI agent endpoints and governed browser computers. The architecture separates the acting person from what initiated the run: person, deployment, routine or handoff. Its gateway resolves targets, checks policy and audits before acting. However, the shipped startup policy explicitly allows everything unless replaced, despite a policy engine that fails closed on missing/broken policy. Network proxy controls also acknowledge that raw sockets require an OS/network enforcement layer. Read the defaults and enforcement boundaries, not just the word “governed.” [Architecture](https://github.com/CopilotKit/OpenBot/blob/c396a5f68c817043846f1ca3c2b42061ee73ceb5/docs/architecture.md).

The most portable design is actor-scoped app diagnosis: ready, reconnect needed, disabled, ungranted and owner-grantable are different situations. Inspection must not grant access. This complements OpenAg's passive capabilities rather than replacing them. [App-access tool](https://github.com/CopilotKit/OpenBot/blob/c396a5f68c817043846f1ca3c2b42061ee73ceb5/server/src/plugins/app-access-tool.ts).

Routines impose hard frequency/count limits, run as the requesting owner, skip stale missed windows and distinguish dispatch retry from repeated routine failure. The documented fatigue rule reports the first failure, then disables after sustained failure and reports that transition. That is more useful than endless silent failures or repeated identical alerts. OpenAg can consider bounded failure visibility while preserving no catch-up and its existing wake rules. [Routines](https://github.com/CopilotKit/OpenBot/blob/c396a5f68c817043846f1ca3c2b42061ee73ceb5/docs/routines.md).

Adopting the full application means new persistence/control-plane, containers, identity/grants and migration work. The smaller opportunity is to carry trusted principal and trigger separately through OpenAg's existing runner before any management-tool expansion. The default bot must never become the owner by implication.

### OpenDots: rich workspace, with explicit integration dependencies

OpenDots combines persistent conversations, pages/Spaces, per-Dot connections, background turns and optional computers using CopilotKit/OpenBot's supervisor. Its README distinguishes SQLite workspace metadata from Intelligence-owned conversation history; there is no standalone SQLite conversation store. It also documents data sent to model/search/connector/speech providers and SDK telemetry opt-outs. Those are useful examples of explaining where each kind of state lives. [README](https://github.com/CopilotKit/OpenDots/blob/8091324942b86789ed0da7facbee855145d933b0/README.md).

Source separates MCP tools requiring review from direct execution: the model receives an approval identifier and instruction to wait, while the owner's approval route performs the action. That shape is compatible with OpenAg's creation-proposal concept, but does not prove equivalent policy or uncertainty handling. [Connection tools](https://github.com/CopilotKit/OpenDots/blob/8091324942b86789ed0da7facbee855145d933b0/src/server/connection-tools.ts).

Authors report live computer/file persistence and voice checks, while identifying Slack, spoken delegation and learning acceptance limits. Do not label everything a fixture or assume all connected workflows are proven. Borrow artifact/page context and explicit setup states selectively; do not add voice, Spaces and another computer supervisor before core tasks work. [Computers and setup boundaries](https://github.com/CopilotKit/OpenDots/blob/8091324942b86789ed0da7facbee855145d933b0/docs/COMPUTERS.md).

### OpenMuse: the most useful compact work/review reference

OpenMuse has a personal assistant, visible work, rich results, server/task/browser workers and editable personal context. It uses embedded PGlite or PostgreSQL for its own state and Intelligence for threads. The deployment is single-owner, not a multi-tenant security system. Source uses compare-and-set task claims, lease identity and renewal to fence workers; action review binds a proposal hash to the owner/account and checks connection changes. Uncertain provider outcomes are separate from clean failures. [Worker](https://github.com/CopilotKit/OpenMuse/blob/a4944f4c471d3dc93b8bfc060b5da309b5216ab2/apps/server/src/engine/worker.ts), [actions](https://github.com/CopilotKit/OpenMuse/blob/a4944f4c471d3dc93b8bfc060b5da309b5216ab2/apps/server/src/actions.ts).

Its verification document separates real Chromium/Docker behavior from controlled model/provider fixtures and pending live-account acceptance. That evidence format is worth adopting. Its OpenBot adapter is explicitly disabled/contract-checked, with no connected deployment round trip; two compatible repositories are not automatically an integrated product. [Verification](https://github.com/CopilotKit/OpenMuse/blob/a4944f4c471d3dc93b8bfc060b5da309b5216ab2/docs/VERIFICATION.md), [integration boundary](https://github.com/CopilotKit/OpenMuse/blob/a4944f4c471d3dc93b8bfc060b5da309b5216ab2/docs/OPENBOT-INTEGRATION.md).

OpenAg already has receipts, review versions and recovery. Compare contracts and edge cases rather than import a second task engine. The useful question is whether all runtimes preserve the same outcome and authorization boundaries through restart, cancellation, account change and concurrent decisions.

## 3. OpenClaw: operational boundaries before channel breadth

OpenClaw is a broad MIT personal-agent gateway. Current security documentation defines one trust boundary per gateway: one operator or a mutually trusted team, not hostile tenants sharing an agent. Pairing/allowlists, loopback defaults and channel-specific exceptions are explicit. This is a better scope statement than assuming multiple users or channels imply isolation. [Security guide](https://github.com/openclaw/openclaw/blob/2426aa9288a524c9cb912dca3da500f2f09fc83a/docs/gateway/security/index.md).

Tool offering and execution availability are separate. Replay safety depends on source-owned metadata; duplicate/shadowed identities fail closed. These help OpenAg keep discovery diagnostic while execution remains governed, and stop a safe-looking wrapper or renamed plugin from acquiring replay rights. [Availability](https://github.com/openclaw/openclaw/blob/2426aa9288a524c9cb912dca3da500f2f09fc83a/src/agents/agent-tool-availability.ts), [replay safety](https://github.com/openclaw/openclaw/blob/2426aa9288a524c9cb912dca3da500f2f09fc83a/src/agents/tool-replay-safety.ts).

Current heartbeat documentation describes migration into ordinary automation jobs and explicitly says heartbeat-specific duplicate suppression/no-route skipping were removed. Do not import older heartbeat advice as current design, or remove OpenAg's useful wake filtering merely to match the project. Migration preserves edits/deletions with receipts and archives original inputs, illustrating careful user-state migration. [Heartbeat migration](https://github.com/openclaw/openclaw/blob/2426aa9288a524c9cb912dca3da500f2f09fc83a/docs/gateway/heartbeat.md).

Its memory documentation separates profile, durable facts and detailed daily notes. OpenAg can use the conceptual separation without multiplying always-in-prompt files. Start with fresh scoped history and explicit stable facts; selective retrieval is not permission to move another room's private context. [Memory](https://github.com/openclaw/openclaw/blob/2426aa9288a524c9cb912dca3da500f2f09fc83a/docs/concepts/memory.md).

## 4. Letta: memory and stateful work, with current repository identity

The former `letta-ai/letta` repository now points to `letta-ai/letta-code` as the current harness, terminal UI, App Server and channel runtime. Do not evaluate the present system from an old Python-server architecture. Current code is Apache-2.0. Its README documents local and cloud backends, with cloud the default; some remote-computer/secrets capabilities require Letta sign-in. Git-backed MemFS, context inspection and skills are the relevant learning surfaces. [Current repository pointer](https://github.com/letta-ai/letta/blob/8816d3a8516893bfdc0fa14bfb1235226012e295/README.md), [current harness](https://github.com/letta-ai/letta-code/blob/3b7e3ffcf16d6ba4880f7a697261837000221320/README.md).

The scheduler has scoped lease ownership, queued/missed/failed outcomes and explicit diagnostics if the lease cannot be acquired. External-tool interruption reports that the remote tool may still finish and requires destination inspection before retrying a write. These are narrower, valuable guarantees; they do not make an entire remote task exactly once. [Scheduler](https://github.com/letta-ai/letta-code/blob/3b7e3ffcf16d6ba4880f7a697261837000221320/src/cron/scheduler.ts), [external interruption](https://github.com/letta-ai/letta-code/blob/3b7e3ffcf16d6ba4880f7a697261837000221320/src/tools/external-tool-background.ts).

Borrow inspectable memory changes and explicit missed-run outcomes. Preserve OpenAg's proposal-only reflection and approved skill writes. Autonomous memory rewriting is a different policy choice, not an automatic upgrade. Neither install a second memory authority nor add distributed leases while one daemon owns scheduling.

## 5. OpenHands: strong specialist/control-center reference

At the inspected revision, OpenHands/OpenHands is **Agent Canvas**, a React/TypeScript control center. Agent execution belongs to the separate Agent Server/software-agent-sdk; scheduled/event work requires the separate automation backend. The README supports local, remote, Docker and optional hosted backends, including ACP agents. Conversation sandboxing does not sandbox the outer Canvas/automation service. [Architecture](https://github.com/OpenHands/OpenHands/blob/172d7f180096cfe06f1a875d2fcbbcb1fae2b6bb/docs/architecture.md), [README](https://github.com/OpenHands/OpenHands/blob/172d7f180096cfe06f1a875d2fcbbcb1fae2b6bb/README.md).

The self-hosting guide distinguishes trusted loopback setup from public mode, where credentials are not baked into HTML, and calls out backend/session-key exposure. This is useful deployment documentation, not proof that a chosen backend is safe for arbitrary users. [Self-hosting](https://github.com/OpenHands/OpenHands/blob/172d7f180096cfe06f1a875d2fcbbcb1fae2b6bb/docs/SELF_HOSTING.md).

Use it to study coding-specialist workflows, backend diagnostics and visible files/terminal/browser results. A full adoption introduces another runtime/automation boundary and may duplicate OpenAg's desk. The Canvas root MIT license does not establish licensing of separately selected enterprise services; inspect those components individually before adoption.

## 6. Agent Zero: memory management and configurable general work

Agent Zero is MIT at the inspected revision. Its current README presents a general agent with a persistent Linux workspace, model/provider choice and Docker-oriented setup. A workspace capable of executing commands is a powerful tool surface; it is not evidence that each action receives OpenAg-equivalent approval. [README](https://github.com/agent0ai/agent-zero/blob/ba9b67df0f54ac78106ae85c552ef5d2458f7c9a/README.md).

The memory plugin exposes a FAISS-backed store, separate contexts, dashboard search/update/delete and a unified memory tool whose actions retain separate permissions. Load permission must not imply delete permission. This is a useful concrete reference for memory inspection and correction, although deletion from one index still says nothing about retained conversation, backup or external copies. [Memory plugin](https://github.com/agent0ai/agent-zero/blob/ba9b67df0f54ac78106ae85c552ef5d2458f7c9a/plugins/_memory/README.md).

Its scheduler persists task state and execution contexts; reading that implementation does not prove provider-action idempotency, multi-process ownership or recovery across every crash boundary. Its retry plugin is also not a reason to wrap an entire OpenAg turn in automatic retry. [Scheduler](https://github.com/agent0ai/agent-zero/blob/ba9b67df0f54ac78106ae85c552ef5d2458f7c9a/helpers/task_scheduler.py), [retry plugin](https://github.com/agent0ai/agent-zero/blob/ba9b67df0f54ac78106ae85c552ef5d2458f7c9a/plugins/_error_retry/README.md).

## Supporting components: durability and computer infrastructure

**LangGraph** is a useful durability reference, rather than another full personal-agent application. The inspected core license is [MIT at `d5b927ae`](https://github.com/langchain-ai/langgraph/blob/d5b927ae4c054f8f7ec26b7e6e0965db6d7b371f/LICENSE). Its official interrupt documentation explicitly warns that resumption restarts a node from its beginning. An external effect can repeat if execution fails after committing the effect but before completing the node. Persistence therefore does not remove the need for provider idempotency, receipts and uncertain-outcome reconciliation. Preserve OpenAg's existing safeguards; checkpointing alone would not replace them. [Interrupt and side-effect rules](https://docs.langchain.com/oss/javascript/langgraph/interrupts).

**Cua** is already an OpenAg backend, so another computer-layer adoption is not a current gap. Its repository has component-specific licenses: core SDK/CLI/Driver are MIT, Spaces and related extensions are FSL-1.1-MIT source-available, and optional SOM is AGPL-3.0-or-later. Do not infer reuse terms for a Spaces viewer, persistent-agent extension or sample from the core SDK license. Check the selected package and deployment path before importing it. This observation concerns upstream source, not the version installed on Alex's machine. [License map at `c1df825c`](https://github.com/trycua/cua/blob/c1df825cc7ad1257f73eef13f019763ab672bbc7/legal/LICENSING.md).

## What OpenAg should borrow, reuse or defer

The ranking below is an engineering recommendation, not a ticket-order change. OpenAg's [capability catalogue](capabilities.md), [receipts](action-receipts.md), [operations](../ops.md) and [roadmap](../../ROADMAP.md) already supply much of the foundation.

| Rank | Change worth considering | Reference and smallest OpenAg route | Proof required |
| --- | --- | --- | --- |
| 1 | Bounded conversational continuity | Nightly excerpts/retrieval; OA-355 hosted prompt/caller design | Two-turn recall, overflow, scoped retrieval, isolated/noIndex preservation; ACP history remains runtime-owned |
| 2 | Intentional Work and truthful outcomes | OpenMuse work/reviews; OA-342 and OA-355 | Chat creates no Work; creation approval creates one; exhaustion is incomplete; completed tool evidence survives |
| 3 | Recovery contract across runtimes | Letta/OpenMuse/OpenClaw | Cancellation/timeout/restart never silently replay a possible write; target readback resolves next steps, not fabricated success |
| 4 | Actionable setup and access diagnostics | CopilotKit/OpenBot, existing OpenAg catalogue | Explain missing config, expired access, denied permission and unsupported backend separately; inspection performs no action/grant |
| 5 | Useful routine failure visibility | CopilotKit/OpenBot and Letta | Expose missed/pre-launch/recurring failure without catch-up, duplicate runs or repeated alerts; preserve owner pause |
| 6 | Memory correction and provenance | Agent Zero dashboard, Letta versioned context | Corrected facts stop resurfacing from retrieval; scope and retained copies are explicit; approved reflection remains approved |
| 7 | Rich results with settled interactions | CopilotKit/OpenMuse/OpenDots | Stable artifact links and evidence after reload; decided cards cannot execute again; owner review works on phone |
| Later | AG-UI adapter, more channels, shared teams, distributed workers | Framework/OpenHands/OpenBot | Only after a concrete integration/user requirement; separate authority/migration design and acceptance |

For OA-355, define context/step budgets, proper trust roles, valid structured tool-result truncation, installed provider retry semantics and incomplete outcomes at exact seams. For OA-342, separate chat turns from Work without breaking approvals, receipts, saved results or restart recovery. Those two changes are related but not interchangeable.

Do not adopt someone else's task database, memory service, computer supervisor or scheduler merely to gain a UI feature. OpenAg's single authority is an advantage only while all runtime routes obey it. Provider/subscription access must remain terms-compatible; an available CLI adapter is not evidence of unlimited usage or transferable credentials.

## A bounded comparison that could prove the choices

Select three owner-approved workflows: scoped operations watch, investigation handoff and reviewed deliverable. Keep inputs and success criteria identical across any later peer comparison. Measure usable outcome, evidence quality, owner active minutes, interventions, elapsed time, interruptions and known resource use. Setup/maintenance and correction time count; unavailable subscription metering is unknown, not free.

Controlled acceptance should include history overflow, denied tool, stale connection, injected tool output, repeated approval decision, step cap, host restart and remote timeout after possible execution. Assert real final state and preserved permission boundaries, not just reassuring text. A missed run is different from a failed run; a successful HTTP request is different from a delivered business result.

Use temporary data, controlled adapters and standalone assertions first. Paid/live model trials, real account writes, deployment and failure injection into the installed service need their own authority. No unit/Jest/Vitest runners were executed for this research. Existing project knowledge-delivery checks remain required for each later implementation slice; a research document is not proof the default bot can explain shipped behavior.

## Limits and next step

This research read source and official documentation; it ran no peer application, install, build, model, provider action or production check. Author-reported checks were not reproduced. Dependencies were not exhaustively audited, and no project-wide security, license compliance, uptime or performance certification is implied.

The next useful deliverable is the concrete OA-355 design already requested by its ticket, informed by these mechanisms and OpenAg's own callers. Keep the product strategy from the commercial-agent report: dependable, quiet operations with inspectable state and verified results. The OSS evidence supports small improvements to that product rather than a framework replacement.
