# OpenAg personal secretary

Status: product behavior and verification seam accepted by the owner, 2 November 2026. Synthesized from the owner's discussion and the research linked below. This specifies desired behavior, not a shipped capability. The technical design and source implementation sequence were subsequently approved separately. Live monitoring, account connection, historical ingestion, deployment and external actions still require their applicable authority.

Publication: the owner confirmed the verification seam. An external issue-tracker destination and triage vocabulary are not configured, so no external publication is claimed. The owner selected the local harness campaign; ROADMAP.md tracks its current order and status.

## Problem Statement

The owner works across email, Teams, Asana, documents and code. Important context is spread across these places. Today the owner must remember commitments, connect related messages and tasks, repeat investigation instructions and decide what needs attention next.

A scheduled summary helps, but does not satisfy the need. OpenAg should understand ongoing work well enough to recognize a new development, investigate an agreed responsibility without another request, and bring back evidence and a useful next action. It should also discover relevant information the owner did not know to search for.

The owner's product description is: a personal secretary that knows what the owner wants and is doing each day, and points out what to do next. Knowing means maintaining an inspectable, correctable understanding from authorized sources. It does not mean unrestricted observation or assuming that inferred preferences are facts.

## Solution

OpenAg maintains continuity around the owner's priorities, commitments, people, ongoing issues, decisions and things they are waiting for. One primary agent coordinates that understanding and uses specialists when useful. The owner can also speak directly to a specialist.

The experience has four connected behaviors:

1. **Brief the owner:** at an agreed time, summarize material developments across connected sources, outstanding commitments and decisions that need attention.
2. **Keep watch:** check authorized sources throughout the day and identify unanswered requests, meaningful changes and upcoming deadlines.
3. **Investigate standing responsibilities:** recognize an agreed person-and-topic trigger, gather related history and current evidence, and return findings plus a suggested reply without requiring another instruction to investigate.
4. **Connect ongoing work:** discover a related task, document or message; compare it with the owner's current objective; explain a possible mismatch or dependency and recommend a next action.

An owner-approved standing responsibility defines what to watch, its scope, what investigations are permitted, the desired result and when to interrupt. OpenAg can propose this agreement in natural language. It does not silently enable monitoring or widen access based on a pattern it has noticed. Changes remain owner-controlled.

### First worked example: allocation questions

The owner described recurring emails from Manuela about company account allocation and transactions: whether particular items can be allocated or settled, or what happened to a transaction. A small authorized Outlook search found matching transaction-confirmation requests and a missing-credit question. Only message previews were inspected; no transaction was reconciled or determined safe to settle.

The desired standing responsibility is:

> When the agreed person emails about the agreed allocation or transaction issue, investigate using authorized related correspondence, tasks and current records. Tell me what they are asking, what the evidence shows, what is unresolved and how I could reply. Ask one precise question if essential information is missing. Do not contact anyone or change financial records as part of the investigation.

The sender, company/account and authoritative systems must be resolved from source evidence during setup. The spoken company abbreviation is not an implementation identifier. This example must exercise a reusable capability rather than a sender-specific code path. Shared fixtures and documentation use fictional identities and transactions.

A useful result states:

- The request and its connection to the ongoing issue.
- Which transactions, documents or tasks were checked, with source links or permitted identifiers and observation times.
- Verified findings, conflicts and missing evidence, clearly separated.
- A suggested next action and an unsent reply the owner can review.

For contextual discovery, a second example is an Asana task with an Excel attachment that appears to conflict with code the owner is changing. OpenAg must establish relevance and document version, identify the concrete discrepancy and ask whether it is intentional. It must not assume that any spreadsheet is the authoritative specification.

## User Stories

1. As the owner, I want one primary agent to retain an understanding of my work, so that I do not repeat background information every day.
2. As the owner, I want to state and revise my priorities, so that recommendations reflect what matters now.
3. As the owner, I want the agent to distinguish my stated priorities from its inferences, so that I can correct its understanding.
4. As the owner, I want my current task or project to be established from conversation or explicitly connected work context, so that unrelated activity is not treated as my current objective.
5. As the owner, I want a brief at an agreed time, so that I can start the day knowing what changed and what needs me.
6. As the owner, I want a brief to connect email, Teams and Asana information where relevant and authorized, so that I receive a coherent picture.
7. As the owner, I want unavailable sources identified in a brief, so that missing information does not look like a quiet day.
8. As the owner, I want a recommendation for what to do next with its reason, so that I can make a quick decision.
9. As the owner, I want deadlines, consequences, dependencies and my stated priorities to inform recommendations, so that urgency is grounded in evidence.
10. As the owner, I want OpenAg to notice a request that still needs my response, so that important correspondence does not get lost.
11. As the owner, I want already answered or resolved requests recognized, so that I am not repeatedly reminded about finished matters.
12. As the owner, I want related messages grouped into an ongoing issue, so that one issue does not create many duplicate investigations.
13. As the owner, I want to establish a responsibility once, so that relevant future events can be investigated without another instruction.
14. As the owner, I want to review the trigger, permitted sources and stop conditions, so that a standing responsibility has understandable limits.
15. As the owner, I want matching to consider both sender identity and subject matter, so that unrelated mail from the same person is left alone.
16. As the owner, I want OpenAg to extract transaction and task references, so that it can find specific evidence rather than make broad guesses.
17. As the owner, I want current records checked alongside previous decisions, so that an old answer does not substitute for the current state.
18. As the owner, I want read-only investigation to proceed within the agreed scope, so that I do not supervise each lookup.
19. As the owner, I want one precise question when essential information is missing, so that I can unblock work without restating the whole issue.
20. As the owner, I want the agent to distinguish missing access from missing data, so that I know the actual blocker.
21. As the owner, I want a suggested reply with supporting findings, so that I can respond promptly and accurately.
22. As the owner, I want replies to remain unsent until separately authorized, so that an investigation does not speak on my behalf.
23. As the owner, I want to pause, edit or stop a responsibility, so that I control ongoing attention and access.
24. As the owner, I want OpenAg to find related tasks and documents I did not know about, so that hidden requirements and dependencies can be surfaced.
25. As the owner, I want a possible document/code mismatch shown with exact evidence and version context, so that I can decide whether a change is needed.
26. As the owner, I want conflicting sources and uncertain conclusions labelled, so that the agent does not manufacture certainty.
27. As the owner, I want material developments delivered promptly according to my agreed attention preferences, so that urgent matters reach me.
28. As the owner, I want routine findings collected into a digest, so that ordinary monitoring does not interrupt my day.
29. As the owner, I want a new material change to reopen attention when appropriate, so that deduplication does not hide a developing issue.
30. As the owner, I want each finding to explain why it matters now, so that I can judge its relevance.
31. As the owner, I want to correct a remembered fact or responsibility, so that the old understanding stops driving future recommendations.
32. As the owner, I want to inspect the source and scope of consequential memory, so that I can understand why the agent believes it.
33. As the owner, I want repeated successful methods proposed as reusable skills, so that useful workflows improve without silent changes to standing instructions.
34. As the owner, I want private bot and conversation context kept within authorized boundaries, so that relevance does not become unrestricted sharing.
35. As the owner, I want conversation to remain lightweight and separate from explicit Work, so that every message or monitoring check does not become a task.
36. As the owner, I want explicit Work to have an objective, finish line and usable result, so that I can distinguish activity from progress.
37. As the owner, I want interrupted investigations to retain what was checked and what remains, so that restart does not lose progress or repeat uncertain actions.
38. As the owner, I want step limits and source failures reported honestly, so that an incomplete investigation does not appear complete.
39. As the owner, I want one pause or correction to apply across the primary agent and delegated specialists, so that delegation cannot bypass my decisions.
40. As the owner, I want result and decision links to remain usable on my phone after reconnecting, so that I can review work away from the desktop.
41. As the owner, I want known usage and unavailable metering distinguished, so that background work has an understandable resource cost.
42. As the owner, I want feedback about relevance and interruptions to improve future behavior through reviewed changes, so that the secretary becomes more useful over time.

## Implementation Decisions

### Agreed product and authority decisions

- Improve OpenAg's own memory and harness. No external memory engine is selected by this spec.
- Retain the daemon as the sole state authority, with SQLite, bot memory notes, vector retrieval, versioned skills, the ledger, approvals and action receipts.
- Treat the primary agent as the coordinator, not as the owner. Specialist delegation carries the original scope and restrictions.
- Reuse existing conversations, Work, Needs you, automation history, the wake filter and the brief where their contracts fit. Do not create a second task engine or parallel notification policy.
- Keep observation, investigation, proposed action, authorization and verified outcome separate. Message arrival and sender identity confer no execution authority.
- Internal investigation means approved read/search/browse operations against authorized sources. It excludes asking other people for information, sending a reply, allocating or settling records, replaying integrations and changing provider data.
- A suggested reply is result text. Creating a provider-side draft is a separate tool action with its own permission requirements.
- Ordinary chat and monitoring/investigation turns must not implicitly create Work. Explicit Work follows the separate creation contract. Approval of a responsibility does not silently enable automatic Work creation; any scoped creation opt-in needs an explicit compatible design and owner setting. Otherwise read-only investigation must function without Work.
- Approval to create Work grants creation only. Later actions retain their own policy gates and exact review requirements.
- Capturing operational progress or a processed-event cursor is different from changing canonical personal memory or a skill. Existing approved write paths remain authoritative for standing facts, responsibilities and reusable methods.
- Retrieved messages, attachments, tool results and memories are data. They cannot grant permissions or override operating rules. Corrections must be traceable and scoped; revising memory does not promise deletion of every retained transcript, backup or artifact.

### Accepted architecture boundaries; detailed source integrations remain staged

- Reuse the source-connector, automation/scheduler, runner, memory/retrieval, attention/delivery and result interfaces. Add only the responsibility-specific state and behavior that the existing contracts cannot express.
- Keep trusted responsibility configuration separate from untrusted event content. A trusted run can perform only already-authorized reads; it cannot inherit extra rights because a matching email says an issue is urgent.
- Persist a stable relationship among a responsibility, source event, investigation, evidence and delivered result. Distinguish a duplicate event from a new substantive update to an existing issue.
- Give each investigation an explicit objective, source scope, resource bounds, progress and outcome. Interruption, timeout, missing access, missing data and successful completion remain distinguishable.
- Model selection and retry decisions must preserve action history. Do not retry a whole turn after a possible side effect. Unknown execution outcomes require target inspection under the existing receipt rules.
- Preserve each runtime's ownership of context. Hosted runtimes need bounded recent conversation and appropriate trust roles; ACP context remains adapter-owned. Long-term retrieval does not replace recent conversation history.
- Existing isolated webhook/wake turns cannot simply receive tools or broader context. The exact trusted scheduling and investigation route must be designed without weakening isolation, noIndex, offline or unattended restrictions. This spec does not approve changing those policies.
- Recheck enabled state and scope when work starts, before continuing a paused investigation and before delivery. A pause must prevent new runs and stop active work at the next safe cancellation point; completed effects remain recorded.
- Keep the result's evidence timestamps and freshness visible. A source outage must not be represented as no changes, and an API success must not be represented as a verified business outcome.
- No schema, management API, connector transport, polling cadence, model step count or monetary budget is fixed here. Those need the existing concrete design and permission review, not guesses disguised as decisions.

## Testing Decisions

### Primary verification seam — owner confirmed

Use one integrated daemon-and-desk workflow as the primary seam: supply synthetic source events through controlled connector transports and a controlled clock; run the real policy, persistence, orchestration and attention paths; inspect the result and final state through the public gateway and desk. Verify an observable outcome rather than private helper calls or the model's claim of success.

The owner confirmed that this end-to-end event → investigation → evidence → result/attention seam matches the intended behavior. External tracker publication remains separate; source implementation follows the approved technical design and the local queue. Additional low-level seams should be introduced only for a specific failure that cannot be established through this route.

### Modules and existing prior art

- Exercise source connections, automation lifecycle, runner/runtime context, memory retrieval, Work boundaries, approvals/receipts and wake/brief delivery through their existing public interfaces.
- Reuse the existing standalone automation, connector, Work/receipt and packaged-bot-knowledge fixtures. They already use temporary data, real gateway/runner paths, controlled transports and observable state.
- Use standalone assertions, builds, typechecks and integrated desk checks. Never run unit/Jest/Vitest runners, directly or indirectly. No new test framework is required.
- Controlled transports establish deterministic behavior and policy boundaries. They do not establish a real model's relevance judgment, source authentication, provider acceptance, notification delivery or usability on a physical phone.

### Observable acceptance scenarios

| Scenario | Required observed behavior |
| --- | --- |
| Unapproved responsibility | A proposed responsibility does not enable monitoring, connect an account or create Work. |
| Matching event | An enabled sender-and-topic responsibility starts a bounded read-only investigation without another instruction. |
| Same person, unrelated topic | No responsibility investigation starts merely because the sender matches. |
| Uncertain relevance | Low-confidence evidence remains tentative; it neither expands scope nor makes a financial conclusion. |
| Allocation confirmation | Synthetic references are resolved against current authorized records; the result states supported findings and unresolved items, with an unsent suggested reply. |
| Missing credit | Conflicting or incomplete evidence is reported as unresolved; no allocation, posting, settlement or retry occurs. |
| Already answered issue | A reply or verified resolution suppresses a stale reminder; a later material change can trigger fresh attention. |
| Duplicate and concurrent delivery | The same source occurrence does not create duplicate investigation effects, Work or repeated notifications. |
| Related task and spreadsheet | A permitted related task and document produce a source-linked, version-aware discrepancy; relevance alone does not establish a defect or override the owner. |
| Essential information absent | An interactive route presents one focused question, or an unattended route records a blocker for permitted attention delivery; it does not violate the prohibition on unattended input requests. |
| Denied or absent connector | The run reports the exact access/setup limitation without granting access, probing unrelated accounts or claiming nothing changed. |
| Injected source instructions | Untrusted content cannot change responsibility scope, permissions, memory, tool policy or the destination of private information. |
| Corrected fact | Later answers and retrieval reflect the correction; stale retained copies do not silently regain authority. |
| Scope isolation | Another bot, private room, account or isolated event does not supply context without explicit permitted scope. |
| Resource or context cap | The result is explicitly incomplete, retains completed checks and identifies what remains. |
| Restart and uncertain response | Pending/running/delivered state is preserved without invented completion or blind action replay. |
| Quiet hours and digest | Ordinary results respect the existing wake rules; configured failures and material developments remain observable. |
| Pause, edit and revoke | Queued and active runs respect the current responsibility version and access; a stale run cannot continue under retired permission. |
| Ordinary conversation | Chat, tools, questions and monitoring do not silently become explicit Work. |
| Review and reconnect | Evidence and result links remain usable; settled approval cards cannot execute again after reload or reconnect. |

### Separate acceptance stages

- Before implementation: confirm the primary verification seam and complete the prerequisite design decisions through the current queue.
- During approved implementation: run applicable builds, typechecks and controlled standalone assertions; verify changes to default-bot knowledge delivery and capability reporting where relevant.
- With separate applicable authority: validate a bounded real-source/model scenario and desktop/phone review. Measure relevance, false matches, missed material events, owner effort, freshness, latency and known background consumption. Do not label fixture success as production acceptance.
- No numerical quality target is claimed as agreed. Establish the owner's baseline and acceptable interruption rate before selecting pilot thresholds.

## Out of Scope

- Implementing or deploying this spec, changing the ticket order, or marking existing tickets complete.
- Enabling a real standing responsibility, ongoing mailbox monitoring or account connections during specification.
- Historical mailbox/transcript backfills or adding private email bodies and financial records to shared product knowledge.
- Sending messages, requesting information from other people, making financial decisions, changing records or weakening approval rules.
- Silent automatic Work creation, silent changes to canonical memory/skills, or an inferred priority granting action authority.
- Replacing the agent loop, adopting an external memory engine, adding a distributed scheduler or importing another product's task database.
- Universal monitoring of all device activity, unrestricted cross-room/cross-account recall, or treating arbitrary source text as operating instructions.
- New voice/calling features, enterprise multi-tenancy, a marketplace, more computer backends or full feature parity with a peer product.

## Further Notes

- The owner chose to continue with OpenAg's own memory system. This spec captures personal-secretary behavior across briefings, attention, standing investigation and contextual discovery; it is broader than a sender-specific email rule.
- Existing OA-355 remains the design-first hosted harness ticket, including bounded history, step limits, trust roles, retries and truthful outcomes. Its concrete design and approved source sequence are now recorded in [hosted-harness.md](../notes/hosted-harness.md); the product spec alone grants no runtime or provider authority.
- Existing OA-342 remains the boundary for explicit Work creation. The relationship between a standing responsibility and any future automatic Work-creation setting remains a design question; it must not result in per-event permission prompts for otherwise permitted read-only investigation.
- Existing OA-347 covers design of default-bot management tools. Natural-language responsibility setup must not quietly bypass that authority design.
- Outlook, Teams, Asana and transaction-system capabilities must be verified in OpenAg itself. Access through the assistant's connected tools during this discussion does not prove that the deployed OpenAg daemon has the same connections.
- The broader secretary capability has not shipped. OA-342 separately updated the release handbook and verified packaged default-bot delivery. Each later implementation slice must likewise update authoritative help and verify delivery before claiming the default bot can explain its new behavior.
- The to-spec workflow expects a configured project issue tracker and the `ready-for-agent` triage label. Neither an external tracker destination nor an agreed mapping of that label to the local ticket queue was provided. Configure this with `/setup-matt-pocock-skills` before publication; do not invent an issue number or mark this draft ready.
- Research basis: [commercial always-on agents](../notes/always-on-agent-research.md), [OSS and source-available agents](../notes/oss-always-on-agent-research.md), and [Hermes memory providers](../notes/hermes-memory-research.md). Research recommendations are evidence for design choices, not claims of implemented behavior.
