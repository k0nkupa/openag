# Migration and data handover

Read [DESIGN.md](DESIGN.md) first. Ticket IDs below refer to the former internal ticket queue (replaced by [ROADMAP.md](../../../ROADMAP.md)). The reference is a visual/interaction source; `apps/desk` and `apps/daemon` own production behavior.

## Keep the existing state boundary

The current entry point, `apps/desk/src/app.tsx`, verifies device identity before rendering and handles owner-token conversion, revoked access, connectivity and transport selection. Keep that boundary. New views consume the existing `Api`, hooks and shared `StreamProvider`; they must not instantiate their own per-screen WebSockets or copy the reference's independent fake state into production.

| Preserve | Owning production source |
| --- | --- |
| REST, owner-only retry and typed errors | `apps/desk/src/api.ts` |
| Device identity and pairing | `apps/desk/src/auth.ts`, Login, connectivity and RTC modules |
| Memory-only owner secret | `apps/desk/src/ownerSession.ts` |
| One stream, reconnect and revocation | `apps/desk/src/stream.tsx` |
| Hash routes and compatibility | `apps/desk/src/route.ts` |
| Authorization, policy and tool execution | daemon gateway, runner, policy, approvals and tool registry |
| Durable state and redaction | daemon SQLite/ledger/redactor; never a browser copy of the DB |

## Component ownership map

Paths in the reference column are relative to `reference/src/`. Production components are under `apps/desk/src/components/` unless stated otherwise.

| Reference | Production seam / implementation decision |
| --- | --- |
| `app.tsx` AppSidebar/Header | Shell; keep route/auth/connectivity hooks. Migrate the shell before individual features (OA-319) |
| `components/ui/*`, `styles.css` | Existing shadcn source + production global stylesheet. Diff shared components; don't overwrite them blindly |
| `app.tsx` RoomPage/VariantA/Composer | RoomView, Feed, Composer; keep room/event/message APIs and stream reconciliation (OA-320) |
| `work-data.ts` | Fixtures and a design vocabulary only. Daemon Work/result/receipt schemas need OA-321/322/324 |
| `work-state.ts` | Demonstration transitions. Replace with server state; no production import |
| `work-ui.tsx` | Presentational Work cards, detail/inspector, review, result and history views (OA-323–326) |
| `demo-context.ts` | Reference composition only. Do not use it as a second application store or API facade |
| `app-library-state.ts` | Example catalogue/setup state, not an installer or connector registry. Adapt Apps/MCP inventory (OA-327/328) |
| `app-library.tsx` | Library cards/detail and installed connections; use the same backend inventory in both destinations |
| `avatar-editor.tsx`, `bot-avatar.tsx` | BotEditor/BotAvatar plus shared avatar API validation/types (OA-329). Preserve legacy IDs/permissions |
| `brand-logo.tsx`, `public/brands/*` | Small reusable presentational identity layer. Bundle source/licence files with assets |
| Settings pages in `app.tsx` | ModelsPage, ProactivePage, MemoryPage, SectionViews, SettingsView/SettingsLayout and existing panels (OA-330) |

### Components and dependencies

Both projects declare Tailwind 4.3.3, shadcn 4.23.0, Base UI 1.9.0, React 19.3.1, Vite 8.3.5 and the same `base-nova` config/aliases. Lockfiles decide exact resolved versions. Production has Button, Input, Field, Alert, Label and Separator already; their control sizing and behavior must survive any source merge.

The reference additionally contains AlertDialog, Attachment, Badge, Bubble, Card, CodeBlock, Collapsible, Command, Dialog, Empty, InputGroup, Marker, Message, MessageScroller, NativeSelect, Sheet, Sidebar, Skeleton, Switch, Table, Tabs, Textarea, Tooltip and Trace. Add/diff only components needed by the ticket. Use the shadcn CLI against `apps/desk`, preserving the Base UI preset and semantic variants. Inspect generated imports/dependencies; don't run init again or replace the application with a registry demo.

| Reference-only direct package | Why it is present | Migration gate |
| --- | --- | --- |
| `@fontsource-variable/geist-mono` | Locally bundled mono font | Add when typography migrates |
| `@shadcn/react` | MessageScroller behavior | Add with the chat primitive; retain one application stream |
| `cmdk` | Command search | Add with Command; map selections to real routes/IDs |
| `shiki` | Result/code highlighting | Add with CodeBlock; lazy-load heavy languages/themes or use readable plain code until needed |

These are candidates, not blanket approval for package churn. Keep production-only dependencies such as qrcode. The reference's >500KB JavaScript warning is a known integration item; avoid shipping every reference screen/highlighter eagerly.

### Route translation

| Reference route | Current production support | Required action |
| --- | --- | --- |
| `#/room/:id` | Supported | Use actual server IDs/membership; never infer a direct chat solely from `direct-` fixture prefixes |
| `#/inbox`, `#/computer`, `#/ledger` | Supported | Replace views while preserving data/auth paths |
| `#/bots[/id]`, `#/connectors`, `#/automations` | Supported | Keep existing deep links and mutations |
| `#/settings/models`, `/proactive`, `/memory` | Supported | Existing settings APIs; migrate views |
| `#/settings/server` | Not a named production subsection; currently falls back to default `#/settings` | Support an explicit alias or canonicalize deliberately; keep old `#/settings` links working |
| `#/work[/id]`, `#/room/:id/work/:workId` | OA-323 searchable/filterable Work, conversation cards and contextual inspector | Uses OA-321 lifecycle and OA-322 saved results; question workflow remains OA-325 |
| `#/approvals/:id` | OA-324 review and durable decision/execution receipt | Unknown stays separate from permission; inspection requires owner authority |
| `#/app-library` | New | OA-327/328; distinguish browsing from installed connection settings |

### API and capability map

Existing methods below are from `apps/desk/src/api.ts`; endpoint behavior belongs to the daemon. Proposed capabilities must be implemented under their tickets, not presented as existing routes.

| Surface/action | Existing API / source | Gap / ticket |
| --- | --- | --- |
| Rooms, members, messages, history | listRooms/getRoom/listBots/listEvents/sendMessage; `/rooms/*` | OA-314/OA-320 integrated; sendMessage also accepts OA-315 attachment IDs |
| Composer uploads | uploadAttachment/removeAttachment/downloadAttachment; `/rooms/:id/uploads` | OA-315 verified; bounded/authenticated input files, separate from results |
| Pending approvals and four decisions | listPending/decide; `/approvals` | OA-324 exact versioned review, durable execution receipts and owner target inspection; broader attention categories remain OA-325 |
| Work/plans/questions/cancellation | OA-321 `/work` lifecycle; OA-323 UI, scoped activity and revision-checked cancellation | Question workflow: OA-325 |
| Saved result versions and downloads | OA-322 `save_result` tool; `/results` list/versions/preview/download | Bounded redacted text, immutable versions, source links; see `docs/notes/saved-results.md` |
| Computer / takeover | Existing controls plus OA-323 shared-computer context and linked Work activity | Controlled takeover/viewer/handback verified; live provider acceptance remains separate |
| Automations | list/create/update/delete/runAutomation; lastRunAt/lastStatus | Durable quiet/outcome history and scheduler-derived next run: OA-326 |
| Apps | listApps/reloadApps/enableApp(hash)/disableApp | Owner-installed folders; catalogue/setup/install flow: OA-327/328 |
| MCP | getMcpServers/reloadMcp | Administrator-owned file; no browser writes to commands/env/config |
| Models / routing | getModelsStatus/getRouterStrategies/setRoomRouter | Accurate model-owner/transport/readiness display; no fake API keys or sign-in detection |
| Bots / avatars / tool modes | get/putBotSettings, listBots, tool-mode APIs | Extend validated avatar schema; keep limited-device avatar-only behavior |
| Memory / Skills | get/putBotMemory, searchMemory, list/getSkill | Preserve redaction, owner checks and unavailable-embedding states |
| Proactive / devices | get/putSetting, wake/digest/brief/reflection APIs, device APIs | Use real persisted settings/access; no optimistic success after a rejected save |

## Payload and state translation

- Prototype `Approval.body` is convenient sample text. Production `Approval.payload` is a tool-specific object and `Decision.edit.payload` must validate through the existing tool schema. Bind the review to the server's payload/version; don't post an entire generic textarea as if every tool accepted a string.
- Production approval status does not contain execution completion. A decision receipt needs correlated tool/turn/provider evidence. Keep accepted/edited distinct from pending/completed/failed/unknown/not-run execution. A lost external response can be unknown even if the turn failed.
- `WorkItem`, `ResultFile`, `DecisionReceipt` and `RoutineRun` in `work-data.ts` are fixtures to inform schema design. Add migrations, caps, indexes, redaction, permissions and restart behavior in the daemon. Do not persist the fixture JSON wholesale or infer completed work from model prose.
- An answer to a question resumes work; it is not approval for a send/purchase. An interrupted task is not automatically safe to retry. Cancellation is only confirmed when execution actually stops, with uncertainty preserved for possible side effects.
- Reference avatar shape/colour unions differ from the daemon's six shapes and existing colours. Retain old IDs (`yellow`, `mint`, `violet` included) and add/map new ones explicitly. Persist an animation preference through a defined schema; system reduced motion always overrides it.
- Reference `decision` routing value must map to production `openai-decision`; `jev` and `lead` already exist. Preserve `cheap-same-model` as an existing option even though the simplified reference omits it. Server availability/fallback is authoritative.
- In App library, a label/account example does not establish a connection. Distinguish missing code, missing env/account access, configured runtime, paused runtime and a verified service check. Public marketplace/OAuth/arbitrary remote installers are not implied by the current UI.

## Capabilities outside the reference

Retain Login/pairing/sign-out, revoked/offline handling, memory-only Owner actions, permissions, readiness, backups/operations, push, Slack, RTC and backend-specific computer controls. The reference is not a complete replacement specification for those existing panels. Keep them reachable in the old desk or an appropriate integrated settings section until migrated and verified. Never delete working functionality because a mockup does not show it.

Review Vite's dev proxy when adding API calls: its current proxy list covers only selected top-level routes. Use a temporary daemon for integration checks; do not silently point a new mock-development server at host. Add new daemon API segments to static.ts so a static SPA route cannot shadow an API.

## Rollout boundary

Read the existing OA-314–317 logs before implementation. They contain unfinished/manual checks and must not be auto-closed by this handover. OA-319 establishes a reversible presentation path inside the existing application boundary; OA-320 proves message -> approval -> decision -> ledger before adding the new Work domain. Complete OA-321–330 in queue/dependency order. Any temporary UI selection mechanism is a rollout aid, not a second auth/state system. Primary-desk cutover, launchd restart and real account actions need their own authority and evidence.

## OA-319 implementation status

The shared production shell is implemented locally with `?desk=classic` as its presentation fallback. See [the implementation and checks](../../notes/desk-shell/README.md). The frozen reference remains unchanged. Feature-specific rows above still require their listed tickets; no live cutover has occurred.

OA-330 implementation and acceptance evidence: [Settings integration](../../notes/settings/README.md). Physical second-device and fresh real-model/action gates remain open; the classic shell is retained.
