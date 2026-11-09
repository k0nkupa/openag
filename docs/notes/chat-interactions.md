# Conversations own questions and decisions

OA-477, owner-approved implementation on 5 November 2026. Source behavior only until separately deployed.

## Chat interaction

Needs you, its navigation/counts, global attention endpoints and Recovery acknowledgements are removed. Questions, action approvals and provider input belong to their originating conversation. Normal permissions, owner/Full decision authority, single-use action execution, and honest outcome history remain.

A bot uses `request_input` for a concrete missing fact, which publishes a normal bot message and pauses that request. The normal composer can reply to that question. One loaded pending question is selected automatically only when all pending request pages have been read; a concise Replying to context shows its target. New message detaches that target. With several questions, select Reply on the relevant message. Selection remains fixed while another question arrives. Ordinary messages do not silently answer outstanding questions.

The message endpoint validates the explicit question id/revision and conversation, records the plain user answer, and uses the existing durable continuation machinery. It sends only to the original bot, not to mentions inside the answer. Duplicate answers, including identical attachment replies after a lost response, do not dispatch twice. Changed attachments are rejected rather than discarded. Later model history retains the question-answer relationship while the visible message stays plain. Composer model and permission controls belong to the selected question’s bot. Cancelled/stale questions reject the answer and retain the composer draft. Continuation restores applicable source/permission restrictions; an answer is information, not action permission. Native execution remains disabled for both ACP adapters.

## Pending decisions and history

Pending action cards and live provider input cards are rendered at the end of the conversation, independent of loaded history. Existing exact arguments, edited decisions, rejection, owner/Full checks and provider deadlines remain. Provider participation is separate from action approval. A closed provider callback cannot resume a dead invocation or authorise a replay.

The per-conversation request read is passive and paged; it is not another global queue. Provider requests from a specialist project to the initiating conversation without disclosing the private execution room or credential-bearing provider URL in the catalogue. Provider detail stays owner/Full-only. Existing open questions are published once into their original conversation on recovery; closed questions and historical outcomes are preserved.

Work still reports Waiting for input, Failed, Incomplete or Interrupted. Historical incomplete/missing tool results and open questions no longer require manual acknowledgement before changing a model or requesting another agent. Active execution and pending action reviews/receipts still prevent unsafe configuration changes. Interruptions no longer manufacture generic What should I do next questions. Nothing replays a failed or uncertain action automatically.

Old `#/inbox` bookmarks open the default conversation. Approval/receipt URLs remain readable. Current main’s scoped receipt-conflict rules and per-receipt owner inspection remain separate from the removed global Recovery acknowledgement workflow. Push still identifies the bot/action and now directs users to that bot's conversation; briefs link to originating conversations. Existing notification settings and rate caps are unchanged. Unattended/isolated runs retain their existing restrictions and gain no new right to solicit input.

## Compatibility and knowledge

Historical database tables and event/decision records remain; no migration deletes user history or rewrites outcomes. The underlying question detail/answer interfaces remain for compatibility, but the desk sends replies through the conversation-message endpoint. `/attention`, `/attention/summary` and Work recovery acknowledgement endpoints are absent.

Delivered help and trusted bot/tool instructions explain questions and decisions in chat. The ACP instruction hash invalidates cached/resumed obsolete guidance. Packaged help delivery must be verified for API, Ollama, cached ACP/MCP and replacement-default configurations. Installed help changes only with deployment.

## Acceptance

See the OA-477 ticket Log for exact commands and results. Coverage must include public gateway/runner behavior, real Claude/Codex fresh/reused/resumed continuity, mounted chat/composer/provider controls, pending requests beyond loaded history, authority/duplicate/stale/restart cases, failure history and model admission, native compositions, packaged knowledge and source review. Unit/Jest/Vitest runners are prohibited. Browser checks depend on local browser access; source/build/DOM checks do not establish rendered acceptance.

## Source verification on 5 November 2026

The ticket command checks passed, including build, mounted composer/gateway/runner, real Claude and Codex pause/reuse/restart, exact approval/attachment/provider decisions, duplicate/stale/limited/cross-room requests, paging and historical question publication. Hosted-context checks cover bounded model-history selection and isolation. The component source audit covers 125 modules; packaged knowledge checks cover four delivery groups. Standards and Spec reviews finished clear. Built-in uncommitted review identified three defects; all were fixed, checked and cleared in its focused follow-up.

Rendered desktop/phone acceptance remains blocked: local browser use is disabled in Work settings. The extra settings acceptance script still expects automatic Work from ordinary messages and times out at that existing assumption. These are recorded limitations, not passing results. No unit/Jest/Vitest, merge, deployment or live provider business action was performed.

## Local-main reconciliation

The owner authorized merging and local deployment after implementation. The combined source retains quoted message replies, provider-cancellation notifications, avatars, MCP invocation reporting and current scoped receipt-conflict rules. A selected pending question uses its exact id/revision; a quoted ordinary message stays an ordinary message. Selecting either clears the other composer target. Provider prompts appear once through the paged conversation projection; Feed-only consumers retain their event-backed display. This removal was renumbered OA-477 because current main already assigned OA-472 elsewhere.
