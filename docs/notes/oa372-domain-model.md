# OA-372 domain-modeling pass

Baseline `89ceb85`, after OA-371 acceptance. This is a modeling record only: runtime, settings, schedules and ticket status are unchanged. Proposed behavior below is not a shipped capability. OA-372 extends existing automation history; it does not introduce a new routine engine.

## Domain distinctions

The glossary adds Automation, Scheduled occurrence, Automation run, Missed occurrence and Automation start refusal. Preserve Responsibility, Investigation, Work, Coverage gap, Turn outcome, Attention item and Action receipt. An automation is a configured trigger/instruction, not the full standing agreement represented by a responsibility.

| Concept | Meaning for OA-372 |
|---|---|
| Scheduled occurrence | A particular due opportunity under the enabled schedule/conditions then in force, not an execution or a notification. |
| Invocation | A scheduler, manual or authorized source request to consider starting an automation. It can be refused before a run exists. |
| Admission | The decision to accept an invocation for execution. A reserved history record is not proof that a model or provider was called. |
| Automation run | An admitted bounded attempt. It may check a source without starting a model turn. |
| Execution outcome | Existing quiet/completed/incomplete/failed/cancelled/interrupted reporting for the rooted attempt. A pre-launch diagnostic must not overwrite it. |
| Availability reason | Why starting is currently prevented, such as paused, busy, backoff or unavailable configuration. Current availability is not retrospective proof about a past occurrence. |
| Delivery evidence | A separate account of desk/digest/ping/suppression. No delivery does not establish that execution failed; a delivered partial result does not establish completion. |
| Coverage gap | A period or portion of a check that could not be established. Unknown history is not proof that nothing changed or that no action occurred. |

The core flow is occurrence/invocation → admission or refusal → any admitted execution → independent attention/delivery. A missing stage is evidence to explain, not permission to replay earlier stages.

## What counts as missing

1. A deliberately paused automation has no enabled execution obligation during its paused interval. Do not manufacture missed records from the cron expression alone.
2. Busy/overlap is a known skip when another execution or approval owns the required context. It is not a quiet check and does not become queued work.
3. A provider backoff is a known restriction with its own permitted time. Do not record each tick before that time as a missed check or shorten a persisted polling deadline.
4. An expected enabled scheduled opportunity that genuinely passed without admission can be missed, provided the applicable schedule/eligibility interval and absence of execution can be established.
5. A known setup/admission error before a run record exists is a pre-launch failure gap. Record its bounded reason and phase without pretending an execution started.
6. A setup/refusal after a run record already exists already has a place in history. Improve its reason if necessary; never append a second failed/missed record for the same invocation.
7. An admitted run interrupted by restart is interrupted, not missed. Retained outputs, receipts and any delivery references remain authoritative.
8. Missing old history alone is insufficient. If enabled state, schedule revision or execution cannot be established, retain a bounded coverage-gap/unknown explanation instead of inventing occurrence counts or definitive no-execution claims.

Taxonomy is conceptual here. The plan must choose the smallest storage/API representation for missed, skipped and pre-launch evidence, rather than treating these proposed names as already-supported RunOutcome values. Manual refusal need not create a scheduled-occurrence record; repeated Run now clicks must not generate missed-run spam or overwrite a useful existing backoff status.

## Occurrence identity and historical scope

A scheduled instant must be distinguishable from observation time and actual start time. The applicable automation/schedule revision and timezone explain what was expected; the identity needs an unambiguous instant, not only a display label such as “01:30”. During daylight-saving transitions, repeated local labels can represent different instants. A nonexistent local time must follow the installed scheduler's actual cron semantics; do not invent a due occurrence by arithmetic.

Disabled periods, schedule edits, deletion/recreation and the first observation after upgrade need explicit evidence boundaries. The current configuration cannot prove a schedule was active throughout an earlier outage. Preserve old run snapshots as captured; do not rewrite them to match today's bot, purpose or timing.

Reporting a gap must not enumerate an unbounded backlog. The next plan must settle a bounded reporting window/aggregation policy and lateness tolerance. Aggregate older unavailable coverage honestly when exact per-occurrence evidence cannot be retained. No grace duration or retention count is chosen by this modeling pass.

Repeated ticks, process restart and schedule synchronization must refer to the same supported occurrence/diagnostic identity. They cannot create duplicate history rows, duplicate delivery decisions or replay execution. No receipt or pending action is adopted merely because the run appears overdue.

## Current scheduler semantics that matter

At `scheduler.ts:79–100`, the due time is advanced before overlap/shouldRun checks. One late tick can start at most one job while older periods are skipped; it does not execute a backlog. Its callback receives observation time, not a distinct scheduled-occurrence identity. A live delayed tick and a fresh process registration are therefore different cases.

At `scheduler.ts:125–129`, registration derives the next cron instant from the current clock. A daemon restart does not retain the prior in-memory due cursor. Reporting missed downtime needs additional durable scheduling evidence; it cannot be reconstructed from this fresh registration alone. Preserve the existing no-replay behavior while adding that evidence.

Polling is not equivalent to cron. `automations.ts:1051–1069` uses a persisted poll_next_at; `:805–873` preserves cursor, ETag and backoff timing. A poll can legitimately be quiet after a baseline/304/no-new-items response without any model turn. A poll observation is not a new source event just because the scheduler visited it again.

## Concrete scenarios

| Scenario | Required distinction |
|---|---|
| Daily check was enabled and the daemon was offline at its due time | Report a supported missed occurrence or bounded unknown coverage, according to retained evidence. Do not run it on return. |
| Owner paused the same check before it became due | Paused, not missed; no failure ping merely because a calendar instant passed. |
| The previous run is still active or awaiting approval | Busy/overlap skip; no second model run, action or deferred execution queue. |
| GitHub has imposed backoff | Preserve poll eligibility/cursor and the known restriction; no synthetic misses for intermediate ticks. |
| Run now is refused while paused/busy/backing off | A bounded current refusal, not a missed scheduled occurrence or a new failed execution. |
| Configured bot or room membership disappeared before admission | A known pre-launch setup failure can be retained without a fabricated turn or Work item. |
| Bot disappears after the run history row was reserved | Finish that existing attempt with its known failure reason; do not add a second occurrence failure. |
| Scheduler callback/registration throws before a run exists | Preserve the known scheduling/admission diagnostic if possible. If storage is unavailable, do not promise a durable record was written. |
| Poll returns 304 or establishes its initial cursor | A successful source check can be quiet without a model turn; no missing-run diagnosis. |
| A model turn or specialist stops incomplete | Preserve OA-370/OA-371's rooted reason/wait reporting; do not relabel the run as missed. |
| A process stops after publishing a result but before finishing its run row | Recover interrupted with existing delivery evidence; never publish a second copy. |
| A clock jump crosses several due times while the process remains alive | Preserve current at-most-one admission behavior. The plan must decide how the observed late admission is attributed and which older supported occurrences are missed. |
| The schedule changes during an outage | Do not back-project the new cron into the outage or rewrite immutable old snapshots. |
| Restart repeats the same gap scan | At most one record/delivery for the same supported occurrence or aggregated gap, with no catch-up execution. |
| A genuine missed check is noticed during quiet hours | History remains visible. Any proposed owner attention must pass the existing wake filter; a missed check is not automatically urgent. |
| A webhook/email was never received and no source evidence exists | Do not invent a missed event or claim that a connector was monitored. Live connector monitoring is out of scope. |

## Delivery and attention

Existing automation history and owner alerts are separate. A durable missed/pre-launch record can have no owner delivery. If the implementation proposes any attention item, its stable source/identity and bounded reason must pass the existing dedupe, active-hours, urgency and budget rules. It cannot bypass them by directly posting a room message or push notification.

At-most-one owner delivery requires durable evidence tied to the occurrence/diagnostic, not repeated reliance on a temporary dedupe window. Recovered wake decision, desk event or digest references must be reused where present. A desk ping reference proves a desk message was produced; it does not prove a phone received a push. Do not claim exactly-once external delivery.

This pass does not select a new alert policy. Default to retaining history without unsolicited messages; any delivery behavior must be concrete and remain within the ticket's existing authority and wake filter. Existing explicitly configured room-output routines keep their current behavior; diagnostic reporting is not a reason to redesign their delivery.

## Source agreement and gaps

Read-only source observations at the baseline:

- `apps/daemon/src/scheduler.ts:55–61`: scheduler callback failures are caught and logged; no occurrence/outcome callback is supplied.
- `apps/daemon/src/scheduler.ts:79–100`: scheduling advances before overlap/shouldRun; some non-starts currently have no durable explanation.
- `apps/daemon/src/scheduler.ts:125–129`: new cron registration starts from now, with no durable prior due cursor.
- `apps/daemon/src/automations.ts:944–959`: unavailable/refused launch returns before runs.start, leaving no automation-run row. Paused/busy/manual poll backoff reasons already exist and must not be collapsed into generic missed/failure.
- `apps/daemon/src/automations.ts:960–965`: accepted attempts reserve durable history and snapshot before execution. The gap is not every failed/no-turn path.
- `apps/daemon/src/automations.ts:897–905`: setup and busy checks inside an admitted run already feed that attempt's status.
- `apps/daemon/src/automations.ts:977–1003`: rooted outcomes and provider waits are already aggregated. Extend, do not replace, those checks.
- `apps/daemon/src/automation-runs.ts:7`: RunOutcome currently has running/quiet/completed/incomplete/cancelled/failed/interrupted, but no missed or skipped representation.
- `apps/daemon/src/automation-runs.ts:34–45`: restart recovery retains observed delivery evidence and ends unsettled records interrupted. It does not schedule replay.
- `apps/daemon/src/wake.ts:215–304`: the attention decision and local delivery evidence are recorded through the wake filter. Existing dedupe alone is not an indefinite occurrence-level delivery receipt.

## Questions for the focused plan

- What minimal durable occurrence/schedule evidence establishes eligibility across restart and configuration changes, with a safe first-upgrade baseline?
- What lateness tolerance and bounded gap-reporting policy avoid false misses and unbounded history growth while retaining useful coverage?
- Which scheduler/manager refusal paths are genuinely unrecorded, and which already own a run row? Map each to exactly one retained reason/phase.
- How should existing history/API/desk show missed, known skip and pre-launch failure without fabricating startedAt, turnId, Work or execution evidence?
- How are occurrence/gap identity and any delivery references made idempotent, including restarts after a message was already produced?

No new ADR is needed: preserving no catch-up, explicit Work, receipt uncertainty and filtered attention follows the accepted harness design. This pass does not broaden scope to heartbeat, reflection, the brief, live connectors, production scheduling or a new notification system.
