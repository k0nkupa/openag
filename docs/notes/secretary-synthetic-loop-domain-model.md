# Personal-secretary slice B: synthetic responsibility loop

Status: focused domain model and implementation recommendations for owner review. Baseline `2c82f41`, with OA-342 and OA-369–367 accepted in source. No runtime, configuration, ticket status, connector or installed-service change is made by this record. The [product spec](../specs/personal-secretary.md), [accepted distinction between responsibility and Work](../adr/0001-responsibilities-and-work.md), and [broader design](personal-secretary-design.md#vertical-slices-and-dependencies) remain authoritative. This is slice B, not Outlook acceptance or the full personal-secretary product.

## Observable first proof

The owner reviews and enables one responsibility against an injected synthetic source. A synthetic sender `manuela@example.invalid` asks about `SAMPLE-001` and the configured allocation topic. The adapter supplies stable source/account/resource identity. OpenAg recognizes the configured sender AND topic, admits one bounded read-only investigation, reads synthetic current records and related evidence inside that binding, and retains findings, source references, uncertainty and an unsent reply. The owner can inspect it in the existing desk. Attention goes through the existing wake filter. No Work, approval, provider draft, outgoing email or accounting change is created.

All people/records/content in the verification fixture are synthetic. A controlled model response establishes the harness behavior, not real-model relevance or factual reasoning quality. An allocation record is evidence about a source observation; it does not authorize allocation or certify a business settlement.

## Domain decisions

The glossary adds Responsibility revision, Source binding, Investigation scope and Evidence reference. Existing Responsibility, Source event, Investigation, Work, Evidence, Result, Suggested reply and Coverage gap retain their meanings.

| Concept | First-slice contract |
| --- | --- |
| Responsibility | Owner-governed standing agreement; separate from an automation and explicit Work. Creation is disabled until the owner explicitly enables the reviewed revision and source readiness permits it. |
| Source binding | Exact source/account/resource association supplied by trusted daemon configuration. No credential, arbitrary URL or user-selected transport enters the model. |
| Source observation | A bounded redacted event plus source identity/version and the responsibility's relevance disposition. An observed item can be ignored, uncertain or blocked without becoming an investigation. |
| Matching | Exact configured sender identity plus bounded configured subject/topic terms. No numerical confidence score, sender-only match or automatic inference of new responsibilities. Ambiguous data stays uncertain. |
| Event identity | Responsibility + source binding + stable source event ID/version. Repeated or changed bytes under the same key do not create another attempt; conflicting duplicates are recorded as a bounded inconsistency, never overwritten. |
| Revision | Immutable approved scope snapshot for an admitted attempt. An edit invalidates pending use of the old scope rather than rewriting old evidence. A new revision alone does not make an old event new. |
| Investigation | A first attempt at a bounded question, not a silently created Work item. First-slice states: queued, running, completed, incomplete, blocked, interrupted and cancelled, each with a reason where needed. |
| Evidence | Daemon-retained output of an authorized source read, with source/binding/resource/time and opaque evidence ID. Model-proposed references must resolve to those observations; prose and raw input links do not establish provenance. |
| Result | A validated bounded report, evidence IDs, remaining uncertainty, optional one precise owner question and suggested reply. Completion concerns the bounded investigation, not an external business action. |
| Delivery | Durable intent and observed wake decision/message/digest references for one result version. Available result, successful investigation, desk message and phone receipt are distinct facts. |

Issue correlation across different event IDs, task import, next-action ranking, broad search and corrected long-term memory remain later slices. A new source event version can be considered once; whether it belongs to an existing issue remains tentative.

## Authority and scoped execution

Use one Responsibilities module beside the runner. It owns reviewed revision checks, observation deduplication, admission, result settlement and delivery intent. Owner-only management uses the existing full-access/owner checks, strict input schemas, revision conflict checks and redacted audit events. No bot management tool is added. Existing tools cannot enable a responsibility by producing a configuration-shaped payload.

A private trusted source-adapter observation entry supplies events. The fixture controls its injected transport; there is no unauthenticated endpoint, HTTP simulate switch, production synthetic source, new credential store or connector framework. The ordinary daemon exposes no usable real source in this slice; source readiness is unavailable until a real adapter is separately implemented and authorized. Owners cannot enable an arbitrary source name or account supplied by event text.

The runner gets a dedicated internal investigation entry with an immutable identity and persisted scope snapshot. It verifies the responsibility/revision and runtime before allocating the turn, then rechecks them after acquiring the bot/room slot. Do not turn an existing isolated hook/watcher into a tool-capable investigation. API/Ollama are supported first; ACP is rejected before a turn/provider/tool starts until native-tool scope enforcement has its own proven design. Ordinary ACP chat remains unchanged.

Only a curated investigation read operation is exposed. Its arguments contain bounded source references, not account IDs, URLs, shell commands or tool names. The runner supplies trusted investigation scope and cancellation to the executor. Offering is filtered, but every direct invocation is also checked at authorization and immediately before the adapter's resource read. Source adapters validate the referenced account/resource against that scope and record evidence from the actual returned observation. Unknown/disallowed tools, arbitrary resources, altered bindings, stale revisions and all writes are denied before I/O. The existing policy gate still applies: only permitted Auto reads proceed; Ask/Deny does not become automatic because a responsibility is enabled. There is no allowApprovals, delegation, request_input tool, generic network/computer/shell tool, canonical memory write or save_result call in an automatic investigation.

For this first proof, investigation context contains the responsibility question, trusted restrictions, current event and authorized evidence only. Do not load bot-wide MEMORY.md, vector recall, unrelated conversation history, skills or attachments. `noIndex` alone is insufficient. Context must remain labelled untrusted where appropriate; the source cannot promote its content to operating rules. This scope omission is deliberate until scoped retrieval is implemented later.

Activate the already-designed investigation allowance only on this trusted path: 12 model steps and 24 executor starts, within a five-minute investigation deadline. Reuse OA-370 outcomes and OA-371 request-level retry ownership. A source read observes remaining time/cancellation; retries never recreate the turn or replay effects. Suggested first-slice caps: 8 KB event content, at most 24 retained evidence excerpts of at most 2 KB each, and a 32 KB final report. Reject/mark incomplete rather than silently certify truncated structured content. These are recommended implementation limits for approval, not previously shipped defaults.

## Lifecycle, pause and recovery

Use daemon-owned transactions and unique keys. One active and at most one queued observation per responsibility keeps the first proof bounded; additional intake returns capacity/coverage information without acknowledging a source checkpoint as processed. A queued observation has not executed; admission rechecks source binding, source freshness, current revision and readiness. No distributed workers or generic workflow/lease engine is needed.

Pausing or editing invalidates the revision for pending reads, aborts active work at the next safe point and suppresses unpublished old-scope results/delivery. The next executor checks scope even if an in-flight adapter ignores abort. A late response after cancellation cannot publish evidence as a new finding or advance a source cursor. Retain bounded audit metadata about the interruption. Previously delivered content cannot be recalled from a device; pause does not claim otherwise.

Runner cancellation currently addresses Work only. Add a targeted internal signal/guard path for investigation turns, including turns waiting for the execution slot; do not fabricate a Work item to get a controller. Runtime support and scope must also be revalidated after that wait. Restart marks already-admitted unfinished investigations Interrupted and never restarts them automatically. Never-started queued observations may receive a first admission only after current scope/freshness/readiness checks; this is distinct from replay or scheduled catch-up. A stale/revoked queued item becomes blocked/cancelled, not freshly authorized by an old snapshot. Continuation of an interrupted investigation remains out of scope for B.

A blocked source, missing record, contradictory record, invalid/oversized model report and exhausted model allowance have distinct bounded reasons. Missing evidence is not a quiet result. A partial report must not acquire Completed solely because the model turn finished. Resolve evidence IDs against retained authorized reads before accepting a report. A reference check does not prove that natural-language conclusions are correct; retain quoted source state and uncertainty for owner review.

## Result provenance and attention

Existing saved results require a genuine gated save_result call. Do not invent a tool-call ID or auto-approve that write. Add an explicit investigation origin to saved results with a separate daemon-only settlement path. It verifies investigation/turn/revision/allowed destination and retained evidence, then stores the proposed result and stable delivery intent together. Preserve legacy tool/Work result rows, IDs, versions and receipt rules. The result's turn can be a private investigation execution while its approved destination is the owner-visible room; the provenance must express that distinction honestly.

Keep report content unavailable to public projections until publication checks pass. Recheck current binding/revision before any content release or automatic delivery. Retained private audit metadata can explain a withheld result; fetching old evidence is not itself authority to deliver it after scope is revoked. Existing published artifacts remain historical observations, not a promise of erasure on pause.

Delivery uses a stable key derived from investigation/result version. A pending intent is not a completed execution to be replayed. Reconcile only that intent after restart, rechecking scope. Add an optional durable idempotency key to the existing wake path so its decision, local ping/digest and reference can be committed together and found after a crash. Repeated keyed calls return prior evidence without creating another owner message or external callback. Keep existing unkeyed callers compatible. Do not depend only on the wake filter's time-limited dedupe window.

External notification callbacks run only after commit. A crash after the local commit but before a push callback can leave device delivery unknown; do not retry that uncertain external notification or claim exactly-once device receipt. Responsibility notices identify their source and expose a valid result reference through existing desk rendering. Active hours, urgency, budget, dedupe and configured destination selection remain owned by the wake filter. No direct main-room alert bypass, separate notification engine or connector-side draft is added.

## Worked acceptance scenarios

| Input or interruption | Observable result |
| --- | --- |
| Created but not enabled responsibility | No source check, model turn, Work or alert. |
| Matching sender and allocation topic | One bounded investigation, authorized reads, attributable proposed result and unsent reply. |
| Same sender, unrelated topic; wrong sender; uncertain topic | No automatic investigation; bounded disposition explains what is known. |
| Same event redelivered, including after edit/restart | One observation/attempt; no repeated source read or delivery. Conflicting duplicate bytes do not replace evidence. |
| New immutable source event version | Eligible for a separately bounded match; no guessed issue merge. |
| Event/body asks to send mail, change a record or widen resources | No corresponding offered tool; a direct forged call is denied before executor/provider I/O and creates no approval. |
| Read argument references another account/resource | Zero out-of-scope reads; retained refusal explains the blocker. |
| Bot memory/vector contains a private canary from another room | No canary in API/Ollama requests or investigation result. |
| ACP bot or a runtime changed to ACP while queued | Unsupported before execution; no CLI session, model call or fallback to unrestricted tools. |
| Pause/edit while queued, reading or awaiting final model output | No later read, late evidence publication, result delivery or cursor advancement under the stale scope. |
| Missing access, missing record, stale evidence or conflicting evidence | Distinct blocked/incomplete reason and explicit uncertainty; no fabricated completion. |
| Invalid evidence ID, missing report, deadline/step/tool cap | Incomplete with retained permissible partial evidence; no financial-success assertion. |
| Crash before/after result settlement or wake commit | Admitted execution stays interrupted or settled as observed; any pending delivery is reconciled once without rerunning model/tools. |
| Quiet hours, dedupe, urgency threshold or budget restriction | Existing wake downgrade/suppression; result remains inspectable where still authorized. |
| External push/device outcome is unknown | Desk evidence only; no automatic resend or device-receipt claim. |
| Existing chat, Work, automations, hooks and saved results | Original permission/isolation/recovery contracts remain intact. |

## Current code agreement and gaps

- `apps/daemon/src/runtimes/runner.ts:233`: normal run deduplicates chat dispatch and acquires a bot/room slot; it does not own a responsibility revision or scoped source identity.
- `apps/daemon/src/runtimes/runner.ts:250`: per-run controllers exist internally, but the public targeted cancellation path is Work-only (`:69`, `:802`). Add a trusted investigation path, not implicit Work.
- `apps/daemon/src/runtimes/runner.ts:373` and `:396`: memory and hosted vector recall are loaded independently of noIndex. Investigations require explicit context exclusion until scoped recall exists.
- `apps/daemon/src/runtimes/runner.ts:438`, `:508`: authorization and actual executor invocation are the two required scope checks. `tools/registry.ts:15` currently lacks investigation identity, source scope and cancellation in its executor context.
- `apps/daemon/src/runtimes/runner.ts:645`: delegation depends on role/isolation, so a new investigation flag must explicitly prevent it without changing existing watcher restrictions.
- `apps/daemon/src/runtimes/api.ts:63` and `runtimes/ollama.ts:114`: definitions are assembled per turn. Filter from the same trusted profile enforced by the runner/executor; do not create a second allow-list derived from model text.
- `apps/daemon/src/runtimes/hosted-execution.ts:10`: ordinary hosted defaults remain 20 steps/40 tool starts; the 12/24 investigation profile is not active yet.
- `apps/daemon/src/results.ts:43`, `:135` and `db/migrations/024_explicit_work.sql:25`: saved-result scope/schema requires a tool-call identity. Add a genuine investigation-origin path without weakening the old gated save path.
- `apps/daemon/src/wake.ts:211`, `:273`, `:297`: wake decisions/digest are committed before ping/message/notification effects, and no durable investigation result identity exists. The keyed path must join local decision/delivery persistence and keep external effects after commit.
- `apps/daemon/src/automations.ts:957` and `automation-runs.ts:21`: existing reservation, redaction and immutable snapshots are the patterns to mirror; their automation records are not investigation records.
- `scripts/automation-fixture.mjs`, `scripts/verify-routine-outcomes.mjs`, `scripts/verify-hosted-outcomes.mjs`, `scripts/verify-bot-knowledge.mjs`: reuse temporary gateway/runner/storage, controlled time/transports and public observation patterns. Never run unit/Jest/Vitest.

## Next implementation plan constraints

Deliver the first full synthetic path before adding more sources. Then harden that same path against duplicate/revocation/restart cases and prove API/Ollama parity with actual controlled runtime requests. Include owner configuration, history/result and phone-width inspection in this slice; do not defer all usability to a later phase. Proposed management/history routes use a reserved API segment; synthetic event injection stays private to the fixture/source adapter.

Allocate migrations against the tree at implementation time. Expected changes are Responsibilities module, trusted runner/profile/tool-context seams, results provenance, keyed wake persistence, gateway/main/static wiring, minimal existing-desk responsibility controls/history, release help and standalone acceptance. No dependency install, live source access, new memory engine, automatic Work creation, broad source management, continuous external scheduling or deployment is included.

No new ADR is proposed. The accepted ADR already records the hard-to-reverse distinction. Runtime/profile choices here remain recommendations awaiting the focused plan approval.

Implementation status: the owner approved this focused model/plan and OA-368 implements its first synthetic loop. The authoritative current behavior and limits are in [responsibilities](responsibilities.md); this baseline modeling record does not establish live source, provider, deployment or model-quality acceptance.
