# Explicit Work and independent chat

OA-342 source implementation, 2 November 2026. Authorized by the owner's approval of the personal-secretary design and first implementation slices. This note describes the intended build; deployment and real-model acceptance are separate. The applicable acceptance gates are now satisfied; see the ticket Log for controlled, browser and real-adapter evidence.

## Behavior

Normal messages, replies, plans, tool calls and delegation execute as turns without creating Work. A later event does not retrospectively turn the original chat into Work. The daemon retains independent chat admission/turn history, policy approvals, receipts, questions and saved results.

`create_work` is a shared first-party act-local tool with a bounded title, description and optional assignee. It is exposed through the existing API/Ollama definitions and scoped ACP MCP allow-list. Caller, source message, turn and room are daemon-derived; an assignee must be a current member of that room. Hidden conversations are refused. Unattended/isolated restrictions remain in force.

Work creation always asks unless policy denies it; setting the broader local-action class to Auto does not authorize automatic creation. No per-operation Auto opt-in is implemented. Accept creates exactly one reviewed item, while edited proposals are revalidated, including membership. Ignore, Respond, expiry and cancelled waits create none. A stable proposal identity binds the originating message, caller, room and original proposal. The first committed reviewed fields win. A repeated original proposal returns that existing Work and its actual fields, including after an edited acceptance; later edits do not overwrite it. Overlapping identical actions retain the receipt gate, so one may be refused while another is running. Neither duplicate approval nor recovery can create a second item.

Creation writes a separate assignment message and queues explicit Work. It records the original chat message/turn as provenance. That assignment remains ready to start; it is not dispatched by creation. The owner or full-access device starts it through Work's Start Work control. Start is revision-guarded and repeated requests never restart execution. Starting permits normal execution under existing policy, not blanket authority for its tools. Sending, publishing, payments, allocations and other external actions retain their independent reviews.

Delegation within assigned Work adds turns to that same Work, preserving its approval, cancellation and recovery scope without creating another Work item. Ordinary chat delegation stays chat. If a delegated handoff is incomplete at restart, Work remains interrupted for review. Only one input question may be open per Work; a different turn receives an explicit error rather than borrowing that question.

The Work list displays persisted Work without activity-based chat heuristics. Historical automatic Work records remain unchanged and may therefore be visible. This change neither deletes nor converts historical records.

## Chat questions, results and recovery

Questions and saved results now permit a null Work reference with genuine conversation/turn/tool provenance. Asking for input still requires an interactive visible conversation and cannot overlap a pending action review/execution. An answer is versioned, scoped to the original bot/room and continues chat without fabricating Work. Queued answers can recover after restart; interrupted actions still use the existing approval/pregrant route. Chat admission and initial turn binding are durable and atomic. A queued turn that has never begun can resume with its saved restrictions; a begun interrupted chat requires an owner response instead of automatic replay. Recovery follows the route tree so an existing approval, question or queued child keeps its original recovery path; delivered results do not open another question. Delegated chat admission is committed with its route.

Saved conversation results retain their real gated save_result call. Updates must remain in the same bot/conversation and Work origin, with a current baseVersion. The per-Work version cap also applies to a chat bot/conversation scope. A conversation result is proposed content, not proof of downstream acceptance.

Automation outcomes follow the trusted route tree from their root turn. A denied/failed delegated tool or a missing child turn cannot be reported as Completed; pending/unknown actions and interrupted delegated turns remain Interrupted. This uses turn, route and receipt evidence without requiring Work.

Unknown chat action receipts retain their uncertainty and block later external actions in that conversation until owner target inspection. A new Work item does not bypass a prior unknown chat outcome. The receipt page and existing inspection route remain authoritative.

## Migration

Migration 024 makes question/result Work links nullable while copying existing rows and rebuilding their indexes. It adds explicit-creation identity/provenance to Work and independent chat dispatch admission. Work, turns, approvals and receipts are preserved. The daemon remains the sole database owner.

All new persisted text and audits use the existing redactor/ledger paths. No real email body, transaction payload, account credential or production database is required for controlled acceptance.

## Verification

`scripts/verify-explicit-work.mjs` exercises a real temporary database, runner, gateway, shared first-party tools and controlled runtime. It checks ordinary chat/plans/delegation/tools without Work, chat questions/answers/results, Ask despite local Auto, edited membership, separate owner start, duplicate delivery, Ignore/Respond/expiry, background restrictions, stopped-runner approval recovery, atomic admission rollback, incomplete delegated handoffs and migration preservation. The existing standalone Work, Work-view API, input-runtime, receipt, saved-result, automation and visibility checks use explicit synthetic assignments where needed; the input-runtime checks also cover API/Ollama/scoped ACP chat without Work. No fixture silently restores implicit Work in production. It runs as standalone assertions, never a unit/Jest/Vitest runner.

Required source gates include the full build, daemon typecheck, affected standalone checks, packaged default-bot knowledge delivery, local Standards/Spec reviews and separate built-in Codex review. The full build, daemon typecheck and nine standalone checks passed. Standards, Spec and separate built-in Codex reviews identified restart, idempotence, delegation, quota, automation and transport defects; those were fixed and checked with focused assertions and independent follow-up review. Results and remaining gates are recorded in the ticket Log and handoff. Controlled runtime success does not establish real provider/model behavior or desktop/phone visual acceptance.

Knowledge sources updated: this authoritative behavior note, the Work handbook topic/manifest, product concepts and shared prompt/tool guidance. The bot-knowledge integration check verifies that the packaged topic reaches controlled API/Ollama/scoped ACP/default-bot paths, including cached sessions. An existing installed service receives the change only after an independently authorized deployment.

## Acceptance and next slice

Desktop (1440×900) and phone-width (390×844) browser acceptance passed on 2 November 2026 against an isolated temporary instance. Plain chat, approval wait, accepted provenance, separate Start and ignored creation were verified through the rendered desk and API records. Installed Codex ACP also passed ordinary chat, actual shared-MCP Work proposal/approval wait, accepted ID return and a separately started execution. This establishes this adapter's local acceptance on synthetic data; other live providers and actual phone hardware were not exercised. OA-342 is complete. The installed live desk was not changed or deployed.

After that acceptance, the next approved source slice is OA-355: bounded conversation context for hosted bots, correct trust roles, explicit incomplete outcomes and limited model-call retries. It prepares the controlled standing-investigation loop from the approved personal-secretary design. It does not establish an Outlook/Teams/Asana connection or authorize external actions.
