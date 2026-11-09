# New room (OA-346)

Owners and Full devices can use the plus beside **Rooms** in the redesigned sidebar, on desktop or mobile. Enter a room name, select 1–50 existing agents and choose a lead from those members. Agent names are accompanied by their existing avatars and stable handles. The search stays above a 240px scrolling result area, including with 100 agents; filtering keeps that height stable. Removing the selected lead from the draft requires another lead choice. A room is optional, and creating one starts no turn or Work.

Room names may repeat and can contain Unicode and punctuation; the name is separate from the stable room ID. Names are trimmed, limited to 80 characters and cannot contain control characters. The daemon redacts secrets. A named one-agent room remains separate from that agent's reusable direct chat. Creating a room changes neither the default bot nor the proactive delivery destination, existing memberships or routing configuration.

The sheet retains its draft on errors. It locks submission while busy and retains one creation request identity until the outcome is known. After an uncertain response it reads creation status; if that read also fails, the form stays locked with **Check creation status**. It never automatically retries a write. A confirmed absence permits an explicit retry using the same identity. A recorded room that differs from the submitted draft is not silently accepted: the sheet shows its saved name, agents and lead, then offers **Open recorded room**. This also handles a secret-redacted name. The draft stays locked until that explicit acknowledgement; no further creation is sent. Drafts last for the current page session, not browser reloads.

## Contract and compatibility

`POST /rooms` retains the existing `id`, `name`, `members` and optional `kind` fields. Optional `lead` must identify a member; legacy callers omitting it retain first-member lead selection. New named rooms require 1–50 distinct existing members. Existing stored empty rooms remain untouched. `direct` still requires exactly one member and reuses that agent's existing direct chat; explicit conversation kind is never inferred from member count.

A named-room caller may provide UUID `requestId`. Migration 029 adds `room_creations`: the request identity, room identity and a canonical payload hash. One transaction commits room, membership, lead, receipt and redacted audit. `ledger.atomic` publishes the audit only after commit. Exact replay returns the original room with `created:false`; different content under the same request identity returns 409. Member order is not meaningful; lead choice is. Different requests using an existing room ID still return 409. Calls without a request identity retain duplicate-ID conflict behavior.

Owner/Full-only `GET /rooms/creation/requests/:requestId` returns the recorded room's current state or null and uses `Cache-Control: no-store`. A receipt identifies a creation; it does not prevent later authorized room edits. The sheet compares the returned identity, name, kind, membership and lead to its submitted draft. Unknown fields, hidden/reserved IDs, repeated or unknown members and a nonmember lead are rejected. No credential or original name is stored in the receipt; its payload is represented by a hash.

The classic fallback desk does not gain a new creation control. No room deletion, member removal, automatic subscriptions or bot management tool is added.

## Verification

Use `node scripts/verify-room-creation.mjs` after building for standalone gateway/storage acceptance with temporary data. Browser evidence and the exact commands/results belong in `docs/notes/room-creation-acceptance.md`. Source acceptance, deployment and real model execution remain separate. OA-346 requires no inference acceptance because creation dispatches no turn.

## Add agents to an existing room

Owner/Full devices use Room settings → Add agents → Save room details. The picker uses the full agent catalogue; existing room members stay checked and cannot be removed. Search matches names and handles. Newly added agents become lead candidates after saving.

`PATCH /rooms/:id` accepts optional `addMembers` (1–50 distinct known agent IDs). Additions are a set union, so stale or repeated requests cannot remove existing members. The resulting room is capped at 50 agents. Hidden rooms and direct chats refuse additions. Membership, other submitted details and the `room_updated` audit commit atomically; normal configuration events refresh room state and mention candidates. No history is moved and no turn is dispatched. Existing details-only patches remain compatible.

Standalone acceptance: `node scripts/verify-room-membership.mjs` after building. Uses temporary gateway/storage data, no model or unit runner.
