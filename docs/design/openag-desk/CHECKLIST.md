# Implementation and review checklist

Use this with the acceptance checks recorded for each item in the former ticket queue (replaced by [ROADMAP.md](../../../ROADMAP.md)). This checklist does not mark a ticket complete. Unit tests/Jest are prohibited by the owner's rule; inspect commands/hooks and use builds plus focused standalone API/browser assertions with temporary data and controlled adapters.

## 1. Establish the migration seam — OA-319

- [x] Read DESIGN.md, INTEGRATION.md and the affected existing production modules before copying any UI.
- [x] Confirm shadcn Base UI / base-nova and aliases; diff shared component files and keep production behavior/variants.
- [x] Define one reversible way to select the new presentation without duplicating auth, API state, stream or database.
- [x] Reconcile semantic variables, legacy aliases, effective theme and portal/highlighter/logo theme behavior.
- [x] Apply 14/13/12 reading roles, compact wordmark alignment and a 12px minimum at phone widths.
- [x] Preserve all old routes and settings capabilities; make new/unavailable features honest until their APIs exist.

OA-319 evidence: [integrated shell checks](../../notes/desk-shell/README.md). No production highlighter is introduced by this ticket; reference-only renderer behavior remains for later feature migration.

## 2. Prove one complete existing flow — OA-314/315/320

- [ ] Sign in/pair, verify identity, open a real room and reuse/create the correct one-bot conversation.
- [ ] Send a message through ingress; observe real stream activity without duplicate messages/sockets.
- [ ] Review an actual pending payload; exercise accept, validated edit, respond and ignore without double execution.
- [ ] Reconcile tool/turn/ledger state after reconnect/reload and a temporary-daemon restart.
- [ ] Preserve an unsent message/edit draft during unrelated stream updates.
- [ ] Check offline, forbidden, expired/revoked access and stale request handling.
- [ ] Attachments are not marked uploaded until OA-315 provides actual server resources.

## 3. Add the new durable features — OA-321–328

- [x] Work records are linked to turns, bot/room, approval, plan/progress and durable results; include every reviewed state.
- [x] Draft/saved result previews/downloads have provenance, limits, redaction and authorization.
- [x] Direct-bot context and group-room context cannot leak/mix unrelated work.
- [x] The action receipt separates the decision from execution; a possible side effect with a lost response stays unknown.
- [ ] Questions resume work without granting tool permission; cancelled work is not a generic Recovery retry.
- [ ] Automation history retains quiet/completed/failed/interrupted runs and reports a true next run in the configured timezone.
- [ ] App library and Settings -> Connectors agree after reload; setup/readiness comes from the runtime, not a fixture label.
- [ ] The local administrator install/configuration step, expected digest and rollback are reviewable; preserve existing Apps/MCP security boundaries.

## 4. Complete identity and settings — OA-329/330

- [ ] Old avatar payloads still render/save. New shapes/colours validate; appearance updates all views and survives reload.
- [ ] Whole-body motion is observable; motion off and system reduced motion stop it. Editor turning works with pointer and keyboard.
- [ ] Brand marks load locally in both themes with source/licence files included.
- [ ] Models distinguishes CLI installation/sign-in, chat keys, Typesafe/Jev, OpenAI decisions and OpenRouter readiness; room-lead fallback still works.
- [ ] Failed/forbidden setting changes remain unsaved and visible; owner secrets stay in memory/env as currently defined.
- [ ] Existing readiness/ops/backups/push/Slack/RTC and permissions remain accessible.

## Required state matrix

| State | Expected visible behavior | Required evidence |
| --- | --- | --- |
| Loading | Stable shell and semantic loading content | Delayed controlled response; no fake Connected/Ready |
| Empty | Clear explanation and available next action | Empty server data |
| Success | Server-confirmed result and timestamp/status | API readback + stream reconciliation |
| Invalid input | Inline error; draft preserved | Refused payload and unchanged durable state |
| Forbidden/limited | Readable restriction; applicable owner flow | 403 and no broadened permission |
| Offline/reconnect | Honest connection state; no false completion | Interrupted transport + recovered canonical state |
| Approval pending | Actual target/payload and four decisions | Daemon pending approval |
| Outcome unknown | Reconciliation needed; no blind external retry | Controlled side effect + lost response |
| Failed/interrupted | Saved results and a safe next step | Runtime failure/interruption persisted across restart |
| Human control | Agent input paused; correct viewer capability | Actual takeover/handback state |
| App needs setup | Not presented as connected | Missing/failed runtime/configuration |

## Visual and interaction pass for each migrated screen

- [ ] Compare against the source and current capture set at 1440x960 and 390x844, plus a mid-width layout.
- [ ] Light/dark/system theme, keyboard focus, reduced motion and all overlay portals agree.
- [ ] No page overflow, clipped action labels, tiny copy, stretched Switch tracks or accidental double sidebar padding.
- [ ] Test navigation/back/deep links, long names/payloads, wrap/scroll behavior and scrolled-to-bottom chat updates.
- [ ] No console errors, leaked credentials, unsafe HTML rendering or unexpected third-party logo/font requests.
- [ ] Record exact build/API/browser checks and screenshots in the ticket Log; distinguish fixture checks from live outcomes.

## Handoff and cutover

- [ ] All required ticket dependencies and acceptance criteria are satisfied; unresolved manual checks are explicit.
- [ ] A real model/action/connector and second device have been checked only with the applicable authorization.
- [ ] The new desk has no imported fixture state, simulated completion buttons or hard-coded machine/account/provider readiness.
- [ ] Document how to return to the previous desk without losing daemon data; no speculative data migration or second DB.
- [ ] Obtain applicable authority for deployment/service restart. A successful source build is not deployment or provider acceptance.
