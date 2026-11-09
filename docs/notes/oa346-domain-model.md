# OA-346 domain model: new room

Status: historical design baseline from 3 November 2026, before implementation. The current contract and verification are documented in [room creation](room-creation.md). No live changes are authorized.

## Resolved language and boundaries

The canonical terms are recorded in [GLOSSARY.md](../../GLOSSARY.md): Room, Room identity, Room member, Room lead, Direct chat, Room creation and Proactive delivery destination. Agent and bot name the same persistent entity; the UI's member choices select existing agents, not models or copies of agents.

- A new named room has one or more existing agents and exactly one lead selected from those members. The lead is a role within that room, distinct from the installation's default bot and from owner access.
- A room's display name is not its identity. **Owner decision:** duplicate room names are allowed. Names need not become agent-style handles, and a name collision does not mean the same room already exists.
- Returning to an agent reuses that agent's direct chat. Creating a named room with the same sole agent creates a separate conversation space. Member count never changes the conversation's kind.
- The same agent can participate in several rooms without acquiring a new identity. Selecting a member grants no broader tool approval or owner authority; room history remains attached to its own conversation.
- Room creation starts no turn or Work. The chosen lead answers by default, subject to explicit mentions and configured routing; membership does not mean every member answers every message.
- Creating a room does not change the default bot, existing memberships, routing settings or proactive delivery destination. Proactive delivery changes only through its separate owner setting.
- One creation has one outcome, even when its response is lost or submitted twice. Recover the original outcome before treating the submission as a new creation. An intentional new creation can have the same name and members as an existing room.

## Scenario checks

| Scenario | Expected domain outcome |
| --- | --- |
| Create two rooms called Planning | Two distinct room identities; duplicate display names are valid |
| Double-click Create for one Planning draft | One creation, not two same-name rooms |
| Response is lost after creation | Keep the draft and reconcile the original creation; no blind second creation |
| Two independent Planning drafts use the same members and lead | Two rooms when both are deliberately created; equal content is not identity |
| Create Planning with only coder | A named room, separate from coder's reusable direct chat |
| coder and researcher have the same display name | Select members by stable agent identity; show handles to distinguish them |
| Remove the selected lead from the unsaved member selection | The draft needs a lead from the remaining members before submission |
| Select an unknown agent, repeated member or nonmember lead | Reject the draft; publish no partial room |
| Create Planning while delivery points elsewhere | Delivery remains unchanged |
| A Limited device submits the same request as a Full device | Limited access is refused; room membership and lead roles confer no creation authority |

## Current code versus OA-346

Checked against the current source at main `02ada20`:

- `apps/daemon/src/roomcreation.ts` already distinguishes direct chats from named rooms, reuses direct chats by agent identity, rejects duplicate/unknown members and duplicate room IDs, and creates the room, memberships and audit event in one transaction.
- The existing creation input requires a caller-supplied public room ID. Names are separate, accept Unicode and are limited to 80 characters after trimming, with control characters refused. Display-name uniqueness is not enforced.
- The helper currently allows zero members for a named room and chooses the first member as lead. It rejects a `lead` field. OA-346 must add the explicit lead selection and require at least one member for a new named room, while preserving direct-chat behavior and legacy stored data.
- A repeated room ID currently returns conflict; there is no named-room creation outcome receipt. Conflict or a matching name alone must not be treated as proof that an uncertain submission succeeded. The implementation plan must define stable creation identity, exact readback and reconciliation without weakening duplicate-ID rejection.
- `addressing.ts` selects explicitly mentioned member handles, all members for `@everyone`, or the lead by default. Configured routing remains a separate existing behavior.
- `POST /rooms` is owner/Full-only. Existing room lead edits already require the lead to be a member. No room-creation sheet exists yet.

## Scope for the next plan

Implement the sidebar action and one creation sheet for desktop/phone, member selection, explicit lead validation, stable creation/outcome handling, atomic audited publication and exact navigation/readback. Keep room deletion, existing membership changes, automatic subscriptions, model selection and proactive configuration outside OA-346.

The owner subsequently approved a scoped exception: OA-346 may use OA-345’s merged creation source as its prerequisite while OA-345’s separate real-runtime acceptance gate stays open. This does not authorize a real model turn or live changes.

No ADR is needed: these definitions clarify the existing room/direct-chat boundary and the approved creation scope; they introduce no costly new architectural commitment. This note records design intent, so delivered help is unchanged until behavior is implemented. The implementation must update authoritative room guidance and the packaged handbook, then verify delivery.
