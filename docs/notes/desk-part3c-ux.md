# Part 3C — scheduling, proactive settings, model diagnostics and navigation

The owner approved four sequential slices on 4 November 2026. OA-417 timing is followed by OA-418 proactive choices, OA-419 secondary model diagnostics and OA-420 compatible navigation/final coverage. Each slice has its own evidence and local commit; source completion does not establish live-provider or physical-device acceptance.

## Automation timing (OA-417)

The schedule editor shows the daemon's effective IANA time zone and next scheduled time before saving. Existing explicit time zones are preserved; null means the server default, not the browser zone. Paused schedules show no next run. Event triggers and polling keep their separate existing meanings. Post in the room delivers the agent reply there; Notify when needed uses the existing wake filter, not guaranteed notification delivery.

`GET /automations/schedule-preview` is Full/owner-only, authenticated and no-store. It accepts only bounded cron/time-zone/output-mode/enabled fields and reuses the automation manager's clock, zone and validation (five fields; at least five minutes for room output or fifteen for notification watchers). It computes prospective timing without writing configuration, registering a job, starting a turn, performing provider requests or creating Work. Creation still validates independently; a scheduled timestamp is not execution or delivery evidence.

The desk debounces preview reads, aborts old requests and keys results to the complete schedule draft. Late results cannot replace a changed draft. Invalid or unavailable preview blocks schedule saves; retry is an explicit read. Reaching the predicted timestamp refreshes the read-only preview. Disabled schedules retain validation but report no next scheduled timestamp. The browser does not calculate cron timing.

Evidence: OA-417. All four slices are delivered locally; each evidence directory records its own coverage and limits.

## Proactive choices (OA-418)

Schedule groups Checking frequency, Proactive alerts (notification hours and limits), and Morning brief into separate native cards. Alert hours affect proactive pings, not check execution or approval notifications. Separate setting keys/saves remain unchanged. Daily notification limit, repeat suppression and minimum urgency retain the existing wake-filter values. Agent labels retain Default bot for the installation fallback. History describes held-back alerts. No check, notification, brief, permission or background operation is enabled by opening these views.

Evidence: OA-418.

## Secondary model evidence (OA-419)

Agent Model and reasoning keeps shared model/effort controls prominent. Model diagnostics is collapsed by default and exposes saved reasoning/model, daemon effective/requested model, configuration revision and source-qualified session/returned reports with timestamps and optional provenance/warnings. Historical reports keep their original freshness, source and values. No response identity is inferred from a selected/saved model. Chat remains on the shared saved-configuration flow, without diagnostic footers. Models provider setup copy now points to agent/chat selection rather than an obsolete server-only selection path.

Evidence: OA-419.

## Restorable context and keyboard navigation (OA-420)

Automations is a Workspace destination in the sidebar, command search and breadcrumb, with no duplicate Settings navigation entry. Old base addresses still work. Additive paths restore Proactive tabs (`#/settings/proactive/history`), automation edits (`#/automations/edit/:id`), scoped history (`#/automations/history/:id`), recorded runs (`#/automations/history/:id/run/:runId` or all-history `#/automations/history/run/:runId`), and conversation panels (`#/room/:id[/work/:workId]/panel/settings/model`). Agent section slugs are model/instructions/memories/skills/permissions; panel tabs remain work/files/computer/activity/settings. IDs are encoded; draft text, prompts, credentials and tokens never enter these addresses. Unknown editor/run identities show explicit errors and a return/close path.

Route parsing/generation stays centralized. A context change bypasses a leave prompt only where every editable child remains mounted: the same Proactive page, the same conversation and selected Work, or the same automation editor identity. Other navigation keeps the existing URL restoration, single-intent asynchronous discard/busy guard. Tab/section Back retains drafts; leaving still prompts. Reload restores selection and saved data, while unsaved reload warnings remain browser-owned.

Automation edit initialization waits for inventory and does not reset the mounted draft on refresh. Cancel uses the guard; successful Save clears the editor address after the save finishes. Recorded run links only inspect history, never replay it. Detail close restores the row action or a stable heading fallback. Skip to content is first in both shells and focuses a tabindex=-1 main region without fragment navigation.

Evidence: OA-420. No backend permissions, schema, provider/notification behavior or deployment changes are included.
