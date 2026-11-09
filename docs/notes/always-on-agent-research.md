# How OpenAg can excel as an always-on agent

Research date: 2 November 2026. Scope: product and harness research, not an implementation or release claim. Official product documentation and engineering sources were read live. OpenAg source and tickets were inspected locally at checkout `10310ff`; no peer application was run.

## Recommendation

Make OpenAg the **quiet operations teammate that an owner can inspect, correct and trust**. Start with owner-operated small teams handling technical and business work across several systems. Win on verified outcomes, continuity, controlled access and useful interruptions. Model and host choice support that promise; they do not replace it.

The peers already offer persistent computers, memory, connected apps and background work. Those features establish the category. A plausible advantage for OpenAg is answering, accurately and with evidence: What happened? What remains? What needs my decision? What did you remember? What will this consume? This is a recommendation inferred from the sources below, not measured customer demand or a claim that OpenAg already outperforms these products.

The immediate engineering focus should remain the existing work boundary and hosted harness tickets: OA-342 and OA-355. Research does not reorder their queue, authorize runtime implementation or satisfy OA-355's design approval requirement. See [roadmap](../../ROADMAP.md).

## Identities and evidence rules

“Grokbot” means **Grok Bot**, documented by xAI; the official documentation refers to Cursor accounts and cloud infrastructure. “Duet” means **Claude Duet**, not the unrelated meetduet.in product. “Dots” means **OpenAI Dots**, not similarly named clones or unofficial domains. OpenAg's [product notes](../openag.md) explicitly name these three peers.

Evidence labels used here:

- **Documented:** an official help or technical page describes behavior. This establishes the vendor's published contract, not independent acceptance.
- **Positioning:** a first-party launch/product page describes its value or breadth. Treat connector counts and broad productivity claims as marketing, not demonstrated workflow success.
- **Source:** local OpenAg code establishes an implementation path. It does not establish deployed state or user-visible acceptance.
- **Recommendation:** an inference or proposed experiment. No recommendation is an authorization to execute external actions.

Public documentation does not expose the complete internal execution or memory architecture of any of the three products. Absence from these pages means unverified, not necessarily unavailable. Subscription, region and preview details can change.

## What the three peers teach us

### Grok Bot: persistent specialist coworkers and repeatable workflows

**Positioning/documented:** Grok Bot centers named specialists, persistent context, parallel coordination and work that continues with the laptop closed. Its account has one shared computer; bot conversations and memories are distinct but files and browser sessions are shared. That makes handoffs cheap, while preventing a claim that each bot is a separate trust boundary. [Official overview](https://docs.x.ai/grok-bot/overview).

**Documented:** each bot has a separate screen, allowing parallel desktop work on the shared host. Screens are explicitly not security boundaries. The user can watch and take over. Browser sessions persist, and authentication can require human intervention. [Computer and apps](https://docs.x.ai/grok-bot/computer-and-apps).

**Documented:** a skill records how to work; a routine supplies a schedule or event. The recommended sequence is complete one task, save its method, then automate it. Routine instructions include the source, expected output, approval boundary and missing-data behavior. The docs warn that accepted webhooks do not mean completed work, narrow triggers reduce usage/noise, and test runs perform real actions. Run history and explicit failures are part of the product. [Skills and routines](https://docs.x.ai/grok-bot/skills-routines-and-automations).

**Documented:** bot memory retains facts and work summaries automatically. Personal bots lack a memory screen; users inspect or correct it in chat. Memory can enter group responses even when it originated privately, so remembered information needs discretion. The vendor explicitly warns that memory is not authoritative current data. [Bot memory](https://docs.x.ai/grok-bot/bots).

**Documented:** its transcript combines results, files, questions and tool/computer activity. Users can steer while work continues. [Messaging](https://docs.x.ai/grok-bot/chat-and-collaboration). Attachments and editable deliverables are a first-class route through the product, including moving files to connected storage; overwrite behavior varies by destination. [Files and results](https://docs.x.ai/grok-bot/files-and-results).

**Documented:** a separate Auto Review system can allow, ask or deny risky actions. It complements deterministic controls and does not inspect every side effect. The security page describes credential filling that avoids exposing values to the model, backend-held connector tokens, and enterprise-only network/audit controls. This is a published architecture claim, not an audit performed here. [Security](https://docs.x.ai/grok-bot/security).

**Cost:** access and usage grants depend on the account/plan. Shared weekly allowances, additional usage and legacy on-demand billing have different rules. The legacy monthly on-demand limit is not a mid-run hard stop. An apparent subscription allowance is not a universal spend guarantee. [Plans and billing](https://prod.cursor.com/help/grok-bot/plans).

**Implication for OpenAg:** borrow the complete-task → inspect → skill → routine progression and explicit source/failure instructions. Reuse the existing skills, automations, capabilities and receipts. Do not copy autonomous management writes or saved automatic external-action rules into OpenAg's stricter policy.

### Claude Duet: protect attention and return usable work

**Positioning:** the product leads with reducing what needs the user's attention. It markets broad connector/plugin reach, but a connector count says little about permissions, maintained operations or end-to-end success. [Product page](https://claude.com/product/claude-duet).

**Documented:** Duet keeps background work in its cloud, supplies morning briefs, uses a task list and returns larger deliverables in a Make tab. Main chat stays focused on decisions/results; only the user marks a task completed. The preview is US/waitlist-limited, uses specified Claude subscription plans and counts background activity against plan limits. It does not offer model selection or watching/taking over its browser. Periodic checks may miss urgent arrivals between polls. [Getting started and limitations](https://support.claude.com/en/articles/17631495-get-started-with-claude-duet).

**Documented architecture:** consequential-action approval and a separate action classifier run outside the main model. Another classifier checks outgoing sensitive information. Credentials are isolated from the work environment; connector auth uses a proxy, and the browser has a separate VM with restricted commands. The article acknowledges imperfect classifiers and approval fatigue. Disconnecting a connector stops new access, while already learned information remains until memory reset. [Safety, privacy and security](https://claude.com/resources/articles/claude-duet-safety-privacy-and-security).

**Implication for OpenAg:** use a quiet main conversation plus authoritative Work and Needs you states, understandable decision cards and inspectable deliverables. Human takeover and model choice are useful differences, but only if the actual integrated routes work. Do not interpret “quiet” as hiding failed work, silently marking success or suppressing a material blocker.

### OpenAI Dots: continuity across work surfaces

**Positioning:** Dots combines an always-reachable primary agent with an owned cloud computer and an app ecosystem. The launch describes specialist/team expansion, so do not treat every future multi-agent promise as current functionality. The first dot is bundled on eligible plans, with an allowance for deeper work; delegated Work/Codex tasks consume their usual limits. “Always-on” is not unlimited completed execution. [Launch and usage description](https://openai.com/index/introducing-dots/).

**Documented:** scheduled work and proactive updates appear in conversation. Users can pause the dot. Optional local access is explicitly granted and requires the local computer/app to remain online; it is distinct from cloud access. A blocked cloud-browser session does not automatically transfer to a local browser. Disconnecting an app stops new access but does not erase acquired context. [Getting started](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot).

**Documented:** proactive research is more restricted than previously authorized background tasks: research tools cannot directly message others, modify plugin content or control a computer. Auto-review and required safety rules cannot be disabled by custom rules. Dot memory cannot currently be individually viewed, edited or deleted; deleting the dot clears its context while separately stored files and Work/Codex conversations remain. Action approval does not imply authority beyond its stated scope. [Privacy, security and safety FAQ](https://help.openai.com/en/articles/20001529-dots-privacy-security-and-safety-faqs).

**Implication for OpenAg:** separate observing/proposing from executing an authorized task, and make access/revocation versus retention/deletion understandable. Offer meaningful memory inspection and correction. An editable MEMORY.md is a useful start, not proof that vectors, history and artifacts obey a complete forgetting policy.

## Comparison that matters for OpenAg

These cells summarize the cited official descriptions above. They are not benchmark rankings.

| Dimension | Grok Bot | Claude Duet | OpenAI Dots | OpenAg opportunity |
| --- | --- | --- | --- | --- |
| Main experience | Named specialists and collaboration | Quiet assistant with tasks and artifacts | Primary agent across ChatGPT/work surfaces | One dependable primary; add specialists for real roles |
| Execution surface | Shared persistent cloud host, per-bot screens | Cloud work and separate restricted browser | Cloud computer, optional connected local computer | Keep execution replaceable while durable state survives |
| Human oversight | Approvals, Auto Review, live takeover | Approvals/classifiers, no browser takeover in preview | Action rules, Auto-review, supported takeover | Clear target/effect/evidence and truthful pause state |
| Memory control | Inspect/correct through chat | Shared Claude context and reset controls | No individual dot-memory editor | Provenance, correction and explicit retention boundaries |
| Proactivity | Scheduled/event routines | Briefs and periodic account checks | Proactive research and scheduled tasks | Detect useful changes cheaply and explain each interruption |
| Proof still needed | Restart and external-action semantics | Preview reliability and urgency calibration | Context/delegation and allowance behavior | Measure all of these instead of promising parity |

Model quality, pre-existing account context, polished onboarding and connector breadth are substantial peer advantages. OpenAg cannot infer a win from architecture or ownership alone. Its setup and maintenance burden must be included in the comparison.

Owning the daemon also means owning its availability. A sleeping Mac, power loss or broken home connection can stop useful progress even while a remote computer still exists. Hosting the daemon elsewhere exchanges that local dependency for hosting cost and administration. Treat “always-on” as an observed service property with recovery evidence, not a label earned by installing launchd.

## Engineering lessons beyond product marketing

### Durable state is different from a large context window

Anthropic's long-running-agent work found compaction insufficient by itself. Incremental work, explicit progress artifacts and checks against the actual desired behavior helped successors continue and reduced premature completion. This is evidence from a coding setting, not proof that every personal-agent task needs an initializer agent or repository. Borrow small, durable progress records and evidence-based completion. [Long-running harness research](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents).

Anthropic's Managed Agents engineering separates the append-only session, harness and sandbox. The execution environment can fail without losing the authoritative event log; credentials remain outside generated-code environments. The authors also warn that model-specific harness workarounds can become obsolete. OpenAg should preserve its one durable ledger and replaceable backends rather than copy their distributed architecture wholesale. [Managed Agents architecture](https://www.anthropic.com/research/managed-agents).

LangGraph distinguishes thread checkpoints from a cross-thread memory store. In-memory checkpoint examples do not survive process restarts. This is a useful conceptual separation for OpenAg: conversation continuity, task recovery, stable memory and raw event history serve different purposes. It is not a recommendation to replace the existing SQLite daemon with LangGraph. [Persistence documentation](https://docs.langchain.com/oss/javascript/langgraph/persistence).

### Reflection must earn its cost

Letta's sleep-time work moves memory processing into idle periods and separates memory maintenance from the conversational agent. Its research/results do not establish that nightly reasoning helps every operations workflow; higher frequency consumes more tokens. For OpenAg, measure whether approved reflection improves later recall, removes repeated corrections or captures a workflow. Preserve proposal-only behavior until the owner approves the write. [Sleep-time research](https://www.letta.com/blog/sleep-time-compute/).

The earlier [OSS harness comparison](oss-agent-harness-comparison.md) already covers tool discovery, cancellation, replay safety and scoped grants. This report complements it. In particular, OpenAg's capability catalogue has since landed: do not start another catalogue implementation.

## OpenAg's current strengths and concrete gaps

Local source supports the following narrower claims. Installed configuration, deployed behavior and live provider acceptance were not checked.

| Area | Existing foundation | Gap or claim limit |
| --- | --- | --- |
| Authority | Central gate; external actions and secrets cannot become Auto; persistent approvals | Class permissions are deliberately stricter than some peers. Do not advertise fully autonomous sending or payments. [Policy](../../apps/daemon/src/policy.ts) |
| Recovery | Durable turn state, action receipts and interrupted-turn handling | Receipt presence is not provider acceptance; unknown outcomes require readback, not turn replay. [Runner](../../apps/daemon/src/runtimes/runner.ts), [receipts](../../apps/daemon/src/action-receipts.ts) |
| Work boundary | Explicit Work lifecycle and continuation surfaces | Runner still calls `work.begin` for ordinary turns; OA-342 defines approved creation instead. Hiding chat cards does not correct records. [Runner](../../apps/daemon/src/runtimes/runner.ts), OA-342 |
| Hosted continuity | Shared prompt assembly and API/Ollama tool gates | API defaults to five steps; hosted runtimes start without recent conversation history. Caps need honest incomplete outcomes. [API](../../apps/daemon/src/runtimes/api.ts), [Ollama](../../apps/daemon/src/runtimes/ollama.ts), OA-355 |
| Tool results | Shared tool definitions and wrapped external outputs | Ollama slices serialized tool JSON; design valid structured truncation and evidence preservation. [Ollama](../../apps/daemon/src/runtimes/ollama.ts) |
| Attention | Wake deduplication, active hours, urgency and daily budget; deterministic brief | Tune usefulness from owner feedback and measure missed important events, not just fewer pings. [Wake](../../apps/daemon/src/wake.ts), [brief](../../apps/daemon/src/brief.ts) |
| Memory | Editable MEMORY.md, vectors, approved reflection proposals | End-to-end provenance, correction, deletion and stale-source behavior need explicit design/acceptance. [Memory](../../apps/daemon/src/memory.ts), [reflection](reflection.md) |
| Capabilities | Passive status with reasons for unavailable search/computer/notification tools | Improve actual setup/reconnection outcomes using the existing catalogue. [Capability note](capabilities.md) |
| Operations/cost | Backups, liveness/watchdog and optional daily turn counts | Turns are not dollars or subscription allowance. Do not label the existing limits a monetary cap. [Operations](../ops.md) |

## Smallest credible route to excellence

This is a proposed sequence of outcomes, not a reordered build queue or a commitment to dates. Any new scope should receive its own ticket through the existing process.

### 1. Make continuity and completion truthful

Use OA-342 for the chat/Work boundary and OA-355 for the hosted design. The OA-355 deliverable remains `docs/notes/hosted-harness.md`, grounded in exact callers, installed Mastra retry behavior, context budgets and compatible outcomes. Present that concrete design for owner approval before runtime changes.

Required behavior: a second message can refer to the first; the bot knows its current objective and remaining work; context overflow is bounded; step exhaustion reports incomplete; completed tools remain recorded. A retry of an eligible model request must never become a replay of a whole turn or an uncertain write.

Keep ordinary chat, Work creation, Work execution, action authorization and result acceptance distinct. Creation approval grants creation only. A restart cannot manufacture permission, duplicate a task or silently turn a failed run into a success.

### 2. Make one useful job dependable before broadening access

Start with three owner-selected workflows using already supported connections:

1. A daily operations watch: read scoped sources, cite changes, silence unchanged/no-actionable-input runs, escalate only a material issue.
2. An investigation handoff: gather current source evidence, produce a reviewable diagnosis and proposed remedy, stop before a live write.
3. A reviewed deliverable: create a useful artifact in an authorized local/output path, show its location and validation, then separately approve any publishing or external sending.

For each, specify owner, source/account, trigger, freshness, finish line, budget and stop boundary. If an unattended tool write would need approval, return a proposal/output instead. Do not quietly relax policy to imitate a competitor's routine.

After repeated correct runs, save a versioned skill with error/no-data behavior. Automate through existing objects. Expose last run, next run, evidence, failure and attention reason using current surfaces before adding new dashboards.

### 3. Make attention and memory understandable

Every decision card should show the target, proposed effect, relevant current state and exact approval scope. Reuse decision context where helpful while preserving exact per-action review; a batch summary must not authorize unreviewed effects.

Every proactive notice should explain what changed and why it matters now. Retain digest/feedback data so a quiet system can still be audited. Distinguish unavailable data from “nothing changed.” Source outages must not become reassuring stale summaries.

Start memory improvements with visible source, scope and last-confirmed time for consequential facts. Define how a correction reaches the prompt and vector retrieval, how old copies are superseded, and what deletion does to immutable history and external artifacts. Do not promise comprehensive forgetting until all stores and backups are covered by a deliberate retention policy.

### 4. Bound real resource use and maintenance

Measure model calls, tool calls, latency and known provider usage per completed workflow. Mark unavailable CLI/subscription metering as unknown; do not convert guessed tokens into a trustworthy dollar figure. Separate foreground work from proactive/reflection consumption and computer-host cost.

Prefer narrow event subscriptions and cheap source-change checks where supported. Use an expensive model for ambiguous reasoning after a useful change has been found, not for repeatedly discovering nothing happened. Validate this experimentally; heuristics can miss important changes.

Keep one daemon/SQLite authority. Add neither a distributed scheduler nor a new orchestration framework without a demonstrated limit. Preserve existing backup, watchdog, auth, redaction and unattended boundaries.

## Seven-day pilot: prove saved effort and retained control

Anthropic distinguishes an agent's transcript from the actual outcome in its environment. A claim that an action succeeded is not evidence that the target changed. Its evaluation guidance combines outcome checks, trace inspection and repeated trials. Apply that distinction here with standalone controlled assertions and owner review; no new framework or model judge is needed for the initial pilot. [Agent evaluation research](https://www.anthropic.com/research/demystifying-evals-for-ai-agents).

These are proposed initial targets, not reported results. First establish baseline task times and owner preferences. Controlled cases use temporary data/transports; any real accounts or writes require their own applicable authorization.

| Measure | Initial acceptance target |
| --- | --- |
| Continuity | 20/20 scoped two-turn recall cases pass; cross-room/isolated context does not leak in controlled boundary cases |
| Honest outcomes | Every controlled cap, provider failure and interruption reports an explicit incomplete/failed/unknown result; zero false completion claims |
| Recovery | Restart at proposal, approval and external-call boundaries creates zero duplicate Work or external effects in controlled scenarios; uncertain calls stay blocked pending readback |
| Traceability | Every completed pilot Work links to a usable artifact/result and the evidence used to verify its finish line |
| Attention | Owner rates at least 80% of delivered proactive notices useful; audit all important seeded events for misses; zero repeated alerts for unchanged evidence within the agreed dedupe window |
| Memory | All seeded corrections affect subsequent answers/retrieval; scope and retained copies are explained; zero secret-bearing shared knowledge entries in controlled cases |
| Efficiency | Three workflows repeat successfully at least three times each; compare owner active minutes against manual baseline, including review, corrections and amortized setup/maintenance |
| Budget | Record foreground/background consumption separately; show unavailable metering as unknown and surface cap/allowance interruptions honestly |
| Operability | Complete one backup/restore drill with temporary state and one controlled outage/reconnect; verify phone review/pause through the integrated desk |

Use deterministic standalone assertions and integrated checks for the pilot design. No unit/Jest/Vitest runs are part of this research. Live model evaluation, paid usage, deployed checks and writes are separate acceptance stages, not implied by a documentation change.

## What to defer

- Broad enterprise collaboration, a bot marketplace, autonomous management tools and more computer backends until the core workflows earn trust.
- A new agent framework or custom loop; improve the existing runtime seams.
- Continuous model polling, unlimited nightly reasoning, or assuming more agents mean better results.
- Broad automatic external-action permission. It conflicts with the current product's locked policy classes.
- Competitive pricing claims or promises of local-only data. Cloud models/connectors/computers still process data even when OpenAg owns its local state.

## Research limits and next decision

The strongest conclusion is about product priorities, not which vendor is objectively best. This study did not independently measure peer uptime, completion rates, prompt-injection resistance, restart recovery, credential isolation, cost or user satisfaction. Official documentation is stronger evidence than a secondary review for intended behavior, but vendor claims still require acceptance work. Search snippets sometimes lagged their opened help pages; this report follows the opened pages.

No OpenAg application code, ticket status, handbook/runtime knowledge, installed configuration or live service was changed. This is a research note, not bot-facing documentation of shipped behavior. The existing project rule to update/deliver bot knowledge still applies to each approved implementation slice.

Recommended next decision: endorse the narrow product promise and the three pilot workflows, then finish OA-355's concrete design within the existing queue. Use that design to approve focused slices; do not turn this comparison into a feature-parity campaign.
