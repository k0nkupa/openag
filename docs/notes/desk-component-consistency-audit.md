# Desk component consistency audit

Baseline: 3 November 2026. Part 2 source reconciliation: 4 November 2026. Browser/state evidence and final review were recorded during the release; source inventory alone is not visual acceptance.

OA-403 follow-up: Slack setup/diagnostics were separated, agent sections now expand inline with mounted drafts, Full ledger moved to Activity, and agent actions use pointer-gated opacity with immediate keyboard/touch access. See follow-up evidence.

## OA-409 completion — 4 November 2026

All 111 production modules have a current disposition and family-specific evidence in the source audit. The remaining competing payload, attachment, card, navigation and ancestor control skins were corrected. The six OA-408 reopened rows are closed within this controlled acceptance scope. See verification and limits and the 390/900/1440 light/dark matrix. Specialist artwork, hidden file input, semantic document content and remote-viewer geometry remain explicit exceptions. Physical-device, screen-reader and live provider/computer acceptance are separate.

## Historical acceptance correction — 4 November 2026

The Part 2 completion claim did not establish fidelity to official shadcn compositions. Source inventory, behavior journeys and the earlier screenshot matrix remain useful evidence, but do not certify matching compositions. The owner found retained model-picker and composer differences. OA-406/407 removed the old model picker; OA-408 corrects Prompt Input. At that point the broader visual consistency gate was reopened. OA-409 above supersedes this historical gap list.

Source recheck found these remaining composition gaps, in priority order:

| Priority | Source | Confirmed gap / next check |
| --- | --- | --- |
| 1 | ActivityTrace, ReceiptView | Independently styled preformatted payload blocks remain; compare and migrate to the official CodeBlock composition while preserving exact evidence and bounded scrolling. |
| 2 | AttachmentChip | Received files still use a custom bordered card/button; compare with the same Attachment primitive now used by the composer, preserving authenticated lazy previews and downloads. |
| 3 | SettingsLayout, RoomRail | Caller-level navigation colours/radii and descendant tab-height overrides remain. Compare actual selected, hover, focus and phone states against official Sidebar/Tabs compositions. |
| 4 | BotEditor | Custom grouped-row/settings surfaces remain. Decide which are domain layout and which compete with native component treatment using rendered comparisons. |

These are source-confirmed differences, not completed browser audits or newly proved functional bugs. The rest of the inventory has not received a new reference-by-reference visual pass in OA-408. Part 1 behavior acceptance remains separate from this reopened visual gate.

## Agents sidebar static avatars — 5 November 2026

The Agents sidebar keeps its existing Sidebar composition, sizes, colours and artwork. Only its BotAvatar call forces static SVG rendering. Controlled renderer checks cover default and explicitly animated saved avatars with no animation frames; other callers retain animation. Rendered desktop/mobile comparison and performance measurements remain unverified.

## Goal and boundary

Make the whole shipped desk feel unified and consistent through native shadcn Base UI/base-nova components. A component already using shadcn can still fail consistency through per-screen overrides, conflicting defaults or incorrect state variants. A raw HTML element is not automatically a defect: hidden file inputs, semantic document structure and specialised graphics have legitimate uses.

The original pre-Part-1 audit inventoried 104 production TSX modules (33 shared UI and 71 feature/support). Part 2 started with 105 modules after Part 1 added MessageText. After this migration, the current tree contains 111 production modules: 35 shared UI and 76 feature/support modules. The ReasoningText module was retired; AlertDialog, NavigationDialogs, Disclosure and MessageText are included. Test files and the separate design reference are excluded from the counts. Counts below are source sites, not rendered instances or unique exported components. Repeated list elements and conditional branches can produce different runtime counts.

Evidence combines source review of all inventory rows, standalone controlled gateway checks and the 390/900/1440px light/dark browser matrix linked above. The inventory is source coverage; it does not claim every live state or device was exercised. Real phone keyboards/touch, screen readers and live provider/computer acceptance remain unverified.

## Baseline findings and migration matrix

| ID | Finding and evidence | Native shadcn target / required action | Priority |
| --- | --- | --- | --- |
| C01 | The shared model selector explicitly derives from Cuelark. Its 44 px custom transparent trigger and medium-weight label differ from the 32 px NativeSelect used for effort. Provider colours are calculated locally. Callers include agent creation, agent model settings and room routing. | Recompose the model picker from the official model-selector pattern and shared controls, retaining search, grouping, value handling and loading. Match the effort control's shared size, surface, border, label weight, focus and chevron. Do not discard provider metadata merely to make controls match. | First in Part 2 |
| C02 | Shared Input and Button default to 44 px, while NativeSelect and InputGroup start at 32 px. SettingsLayout stretches selected descendants to 44 px; sheets outside that ancestor do not get the same treatment. | Set a coherent size contract in shared components. Explicit compact variants are allowed; ordinary controls must not rely on their ancestor page to repair their size. Do not impose a single height on textareas or overlays. | First in Part 2 |
| C03 | Login has 5 raw button sites, 3 raw input sites and 1 raw textarea site, with its own labels, primary-button styling and warning-coloured errors. | Button, Field, Input, Textarea and Alert. Preserve pairing, host sign-in, legacy token handling, invite validation and credential privacy. | Part 2 |
| C04 | ComputerView has 9 raw button sites and a raw backend select. Its compact rendering already uses shared Button, so the same feature has two control systems. | Button, NativeSelect, Field, Card, Badge and Alert. Reuse shared lifecycle presentation in full and contextual views. Functional Unknown/missing recovery remains Part 1 and must not be hidden by restyling. | Parts 1–2 |
| C05 | LedgerView has 3 raw button sites, 2 raw selects, 1 raw input and a raw table. Filters and metadata pills have independent styles. This is a reachable diagnostic page. | Button, Input, NativeSelect, ToggleGroup, Table, Badge and shared detail surfaces. Keep exports, filtering, row selection, exact evidence and controlled horizontal scrolling. | Part 2 |
| C06 | McpInteractionCard generates 3 raw select branches and a raw input from remote form schema. They do not share ordinary form treatment. One select is a multiple-choice list and a boolean field has an unset state. | Field, Input and NativeSelect for single choices; compose supported multiple-choice controls from Checkbox/Field or an appropriate official pattern. Preserve missing versus false, typed values, optional fields, expiry, disabled state and server validation. Never convert a tri-state field to a two-state Switch. | Part 2 |
| C07 | App library combines shared Input with a raw Category select and custom filter CSS, in both browsing and installed-connection views. | Field and NativeSelect with matching sizing. Use the same filter composition in both views. | Part 2 |
| C08 | App enabling and reviewed integration setup each use a raw visible checkbox for security-relevant acknowledgement. | Checkbox plus linked FieldLabel. Preserve explicit acknowledgement, disabled states and the exact reviewed package/hash binding. Styling must not pre-check or bypass consent. | Part 2 |
| C09 | AppsPanel draws its own state/tool pills; McpPanel has an independently styled amber status pill in its unscoped view; PermissionGrid has custom 11–12 px tags; Ledger has its own event pills. Some Badge callers also use neutral variants for pending/failure states. | Shared Badge variants. Audit Apps, MCP, permissions, models, computer, receipts, devices, skills and Work by actual meaning. Not every Off or Limited state is a failure; use neutral metadata where appropriate. | Part 2 |
| C10 | ReceiptView maps failed and unknown to the same attention variant. ModelsPage uses outline for both responding and unreachable Ollama, and for a missing adapter. | Failed/denied states use destructive; unknown/unchecked/setup states use attention; verified affirmative states use success. Preserve distinctions between configuration, reachability and effect confirmation. | Part 2 |
| C11 | Notification and reflection panels render successful notices and errors using warning-coloured text. Other pages use Alert, FieldError or plain paragraphs. | Use one feedback convention: FieldError for field problems, Alert for relevant failures/warnings, and accessible saved/status text for successful local changes. Do not show success as a warning. | Part 2 |
| C12 | ReasoningText and the CSS agent-progress grid derive from AgentUI. Feed rotates unrelated joke phrases while displaying activity. Trace is already present for agent events. | Prefer the native shadcn Trace/reasoning composition with accurate short activity labels. Remove the separate decorative skin/phrase rotation if it adds no necessary behaviour. Preserve actual lifecycle semantics, reduced motion and screen-reader status; never invent hidden reasoning. | Part 2 |
| C13 | Composer has a custom mention list with a raw option button, alongside shared InputGroup controls. The hidden file input is intentional. | Align mention options with shared selection styling while preserving text-entry focus, caret insertion, IME behaviour, keyboard navigation and attachment handling. Do not replace the mention interaction wholesale unless the replacement preserves those contracts. Keep the hidden file input. | Part 2 |
| C14 | App library cards and provider lists use bespoke CSS surfaces. Approvals, receipts, result viewers and activity traces each define related payload blocks. | Reuse shared Card, Table, Collapsible and code/payload presentation where the semantics match. Keep Work rows and domain-specific evidence composition. Preserve exact payloads and diffs; syntax highlighting is optional. | Parts 2–3 |
| C15 | Overlays have caller-specific widths, padding, scrolling and action layouts. Conversation context uses full viewport width below 1180 px; other settings sheets use 560 px. | Define bounded desktop sheet/dialog treatment, phone detail treatment, consistent titles/Close/Back/actions and focus return. Preserve wide contextual inspectors. | Part 2 |
| C16 | Eight native details sites coexist with Collapsible. Not every disclosure needs replacement. A classic shell remains reachable through a query option, with legacy CSS. | Reconcile visible disclosure styling with Collapsible or record a native-semantic exception. Include the reachable classic shell in the consistency pass; do not silently remove it or certify its old styles. | Part 2 |
| C17 | Typography, card padding and control surfaces are set in both shared components and legacy/page CSS. Settings applies descendant overrides; library and provider metadata use separate sizing conventions. | Apply the existing design contract once through components/tokens. Retain layout-only page rules. Remove only superseded visual rules after checking callers, including compatibility views. | Part 2 |
| C18 | Status, empty, loading, errors, disabled controls and long content vary even on screens already importing native primitives. | Complete state-by-state visual and keyboard review across every inventory row. Reusing a component name alone is not acceptance. Preserve functionality and diagnostic truth. | Parts 2–3 |

Primary evidence: [model selector](../../apps/desk/src/components/ui/model-selector.tsx), `NativeSelect` (retired under OA-404), [InputGroup](../../apps/desk/src/components/ui/input-group.tsx), [SettingsLayout](../../apps/desk/src/components/SettingsLayout.tsx), [Login](../../apps/desk/src/components/Login.tsx), [ComputerView](../../apps/desk/src/components/ComputerView.tsx), [LedgerView](../../apps/desk/src/components/LedgerView.tsx), [McpInteractionCard](../../apps/desk/src/components/McpInteractionCard.tsx), [AppLibraryPage](../../apps/desk/src/components/AppLibraryPage.tsx), [AppsPanel](../../apps/desk/src/components/AppsPanel.tsx), [McpPanel](../../apps/desk/src/components/McpPanel.tsx), [PermissionGrid](../../apps/desk/src/components/PermissionGrid.tsx), [Feed](../../apps/desk/src/components/Feed.tsx), `ReasoningText` (retired), [RoomView](../../apps/desk/src/components/RoomView.tsx), and [global styles](../../apps/desk/src/styles.css).

## Source-site totals outside shared UI

| Element | Sites | Disposition |
| --- | ---: | --- |
| button | 19 | Migrate ordinary actions; preserve mention-option behaviour while using shared styling |
| input | 11 | 7 ordinary/check fields, 1 hidden file picker, 3 avatar radio source sites; classify by interaction before replacing |
| select | 7 | Migrate single selects; preserve schema-generated multi-select and unset semantics |
| textarea | 1 | Migrate Login to shared Textarea |
| label | 19 | Reconcile visible form composition; semantic or screen-reader-only labels are valid |
| table | 2 | Recompose Ledger and permissions with shared Table without changing table semantics |
| details | 8 | Use shared Collapsible where appropriate; record valid native disclosures explicitly |

These totals do not include hand-styled spans, cards or links. Those are covered separately in the matrix and source inventory. Raw HTML inside a shared shadcn implementation is expected.

## Allowed product-specific composition

These retained exception classes were checked at their shared-control boundaries; they do not allow an independent ordinary-control skin.

| Element | Why it may remain custom | Required shared treatment |
| --- | --- | --- |
| Agent avatar renderer, editor preview and brand marks | OpenAg-specific graphics and identity; generic Avatar does not reproduce the feature | Shared surrounding forms, focus, selection, spacing, motion preferences and feedback; preserve artwork/licences |
| Hidden attachment file input | Browser file-picker mechanism | Invoked by shared Button; no competing visible input style; preserve accessible label and upload limits |
| Avatar swatch and shape radios | Visual selection targets represent artwork/colour rather than ordinary text options | Prefer native shadcn RadioGroup when it preserves interaction; otherwise document native-radio semantics, shared focus/selection and phone targets |
| Mentions, sidebar ordering and computer viewer | Specialised text insertion, reorder or remote-control behaviour | Shared controls and overlays; retain keyboard alternatives, permission and takeover boundaries |
| Work, action receipts, server interactions, saved results and provenance | Domain-specific content, not primitive widgets | Compose from shared primitives; preserve exact evidence and domain meanings |
| Semantic HTML, plain text/code and disclosure | Appropriate native semantics can be simpler than an abstraction | No separate control skin; long content, keyboard and accessible states must remain usable |
| Classic shell | Existing reachable compatibility view | Apply shared visual primitives; no removal without separate authority |

## Completion gate for Part 2

1. Account for every production module below and any newly added UI module. Mark it migrated, reconciled or a justified retained exception, with evidence. Every row below has an explicit disposition; source and browser evidence remain distinct.
2. Ordinary visible controls use shared native shadcn components. Borrowed patterns use the same controls/tokens. No independent Cuelark/AgentUI skin remains.
3. Re-run a scoped source-site inventory. Every remaining raw interactive element or custom status/control treatment has a recorded reason and verification. Do not demand zero native HTML or remove valid semantics for a count.
4. Verify matching model/effort styling in agent creation, settings and room routing. Verify ordinary and compact control variants on pages and inside overlays without ancestor-specific repairs.
5. Review desktop, intermediate and phone widths; light/dark/system themes; keyboard entry/exit; reduced motion; long labels; and empty/loading/disabled/error/success/uncertain states. Preserve at least 44 px phone hit targets for ordinary controls.
6. Verify hidden/advanced routes and dialogs, including Login, Ledger, provider interactions and classic compatibility, rather than only the main pages.
7. Verify external behaviour through the agreed isolated-daemon browser seam. No unit tests or Jest. Run applicable builds and knowledge-delivery checks when implementation changes ship; do not claim those checks from this document-only audit.
8. Preserve authentication, policy, review versions, credential handling, exact action payloads, typed form values, takeover locks, drafts and existing data. Restyling must not grant authority or retry operations.

## Official references checked

- [Button](https://ui.shadcn.com/docs/components/base/button)
- [Native Select](https://ui.shadcn.com/docs/components/base/native-select)
- [Combobox](https://ui.shadcn.com/docs/components/base/combobox)
- [Model selector pattern](https://ui.shadcn.com/docs/ai-elements/base/model-selector)
- [Trace](https://ui.shadcn.com/docs/components/base/trace)

The CLI resolves primitive documentation; the model selector is an AI Elements composition rather than an installable primitive under that name. Prefer the installed preset and APIs, not an unreviewed wholesale upstream overwrite.

## Full source inventory

The following tables record the current disposition. Per-module source, native imports, controlled view families and applicable checks are in the linked OA-409 source audit. Rendered family coverage does not certify every conditional live state.

### Shared UI modules (35)

| Source | Intended disposition | Verification |
| --- | --- | --- |
| [alert](../../apps/desk/src/components/ui/alert.tsx) | Retain native Alert; reconcile plain warning-coloured errors and feedback. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [attachment](../../apps/desk/src/components/ui/attachment.tsx) | Official Base UI Attachment primitive; composer uses its media/content/actions composition. | Corrected native composition — shared native primitive; OA-409 scope and evidence. |
| [badge](../../apps/desk/src/components/ui/badge.tsx) | Retain semantic variants; migrate custom pills and correct callers by state. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [bubble](../../apps/desk/src/components/ui/bubble.tsx) | Retain native Bubble composition; safe formatted content remains Part 1. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [button](../../apps/desk/src/components/ui/button.tsx) | Retain native Button; reconcile regular/compact sizes, hit targets and callers. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [card](../../apps/desk/src/components/ui/card.tsx) | Retain native Card; reconcile custom feature surfaces and density. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [checkbox](../../apps/desk/src/components/ui/checkbox.tsx) | Retain native Checkbox; migrate acknowledgement fields without changing consent. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [collapsible](../../apps/desk/src/components/ui/collapsible.tsx) | Retain native Collapsible; assess native disclosure exceptions. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [code-block](../../apps/desk/src/components/ui/code-block.tsx) | Official native CodeBlock surface and scrollable content; no independent payload skins. | Corrected native composition — shared native primitive; OA-409 scope and evidence. |
| [command](../../apps/desk/src/components/ui/command.tsx) | Retain native Command/cmdk composition; reconcile item and input sizing. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [dialog](../../apps/desk/src/components/ui/dialog.tsx) | Reconcile caller widths, padding, scrolling, actions, motion and focus. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [dropdown-menu](../../apps/desk/src/components/ui/dropdown-menu.tsx) | Retain native menu; check item grouping, trigger and keyboard behaviour. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [empty](../../apps/desk/src/components/ui/empty.tsx) | Retain native Empty; reconcile feature empty/loading/error distinctions. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [field](../../apps/desk/src/components/ui/field.tsx) | Retain Field/FieldLabel/FieldError composition; reconcile ad hoc forms. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [input-group](../../apps/desk/src/components/ui/input-group.tsx) | Reconcile 32 px default with ordinary controls; preserve composer layout. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [input](../../apps/desk/src/components/ui/input.tsx) | Retain native Input; reconcile surfaces, size, focus and disabled/error states. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [label](../../apps/desk/src/components/ui/label.tsx) | Retain shared Label; preserve valid semantic and screen-reader-only labels. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [message-scroller](../../apps/desk/src/components/ui/message-scroller.tsx) | Retain @shadcn/react behaviour; preserve following, anchoring and latest action. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [message](../../apps/desk/src/components/ui/message.tsx) | Retain native Message composition; reconcile identities, typography and timestamps. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [model-selector](../../apps/desk/src/components/ui/model-selector.tsx) | Use the official grouped DropdownMenu composition in every model caller; search removed by owner request OA-407. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [select](../../apps/desk/src/components/ui/select.tsx) | Official Base UI Select with shared 44px sizing and grouped options; replaces retired NativeSelect. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [popover](../../apps/desk/src/components/ui/popover.tsx) | Retain native primitive; reconcile selection/command surfaces and focus. | Corrected native composition — shared native primitive; OA-409 scope and evidence. |
| reasoning-text (retired) | Decorative phrase animation removed; activity remains in native Trace. | Retired — held-turn gateway/browser check replaces its private verifier. |
| [separator](../../apps/desk/src/components/ui/separator.tsx) | Retain native Separator; use where a semantic separator is needed. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [sheet](../../apps/desk/src/components/ui/sheet.tsx) | Reconcile caller widths, padding, scrolling, actions, motion and focus. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [sidebar](../../apps/desk/src/components/ui/sidebar.tsx) | Retain native Sidebar; reconcile navigation states, mobile destinations and labels. | Corrected native composition — shared native primitive; OA-409 scope and evidence. |
| [skeleton](../../apps/desk/src/components/ui/skeleton.tsx) | Retain native Skeleton; reconcile loading placeholders. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [switch](../../apps/desk/src/components/ui/switch.tsx) | Retain native Switch; preserve track dimensions and labelled hit targets. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [table](../../apps/desk/src/components/ui/table.tsx) | Retain native Table; migrate Ledger/permissions while preserving headers and scrolling. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [tabs](../../apps/desk/src/components/ui/tabs.tsx) | Retain native Tabs; reconcile tab styles, overflow and selected state. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [textarea](../../apps/desk/src/components/ui/textarea.tsx) | Retain native Textarea; reconcile ordinary/composer variants and Login. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [toggle-group](../../apps/desk/src/components/ui/toggle-group.tsx) | Retain native ToggleGroup; migrate matching choice sets without changing selection semantics. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [toggle](../../apps/desk/src/components/ui/toggle.tsx) | Retain native Toggle; reconcile selected/focus/disabled states. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [tooltip](../../apps/desk/src/components/ui/tooltip.tsx) | Retain native Tooltip; preserve labels and focus/hover behaviour. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |
| [trace](../../apps/desk/src/components/ui/trace.tsx) | Retain native Trace; align activity and reasoning presentation with real states. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |

| [alert-dialog](../../apps/desk/src/components/ui/alert-dialog.tsx) | Official Base UI confirmation primitive, inspected through installed CLI; no Button overwrite. | Reconciled native composition — shared native primitive; OA-409 scope and evidence. |

### Feature and support modules (76)

| Source | Intended disposition | Verification |
| --- | --- | --- |
| [app-library](../../apps/desk/src/app-library.tsx) | Support/entry module: preserve API, auth, events and state boundary; verify visible loading/error wrappers and provider consumers. | Reconciled native composition — support; OA-409 scope and evidence. |
| [app](../../apps/desk/src/app.tsx) | Support/entry module: preserve API, auth, events and state boundary; verify visible loading/error wrappers and provider consumers. | Reconciled native composition — support; OA-409 scope and evidence. |
| [avatar-library](../../apps/desk/src/avatar-library.tsx) | Support/entry module: preserve API, auth, events and state boundary; verify visible loading/error wrappers and provider consumers. | Reconciled native composition — support; OA-409 scope and evidence. |
| [ActivityTrace](../../apps/desk/src/components/ActivityTrace.tsx) | Retain native conversation/Trace; reconcile activity skin, labels, payloads and state; safe formatting is Part 1. | Corrected native composition — conversation; OA-409 scope and evidence. |
| [AppLibraryPage](../../apps/desk/src/components/AppLibraryPage.tsx) | Migrate category select/fields; reconcile cards, header, maintenance controls and installed view. | Corrected native composition — integrations; OA-409 scope and evidence. |
| [ApprovalCard](../../apps/desk/src/components/ApprovalCard.tsx) | Reconcile native review/status/disclosure/payload surfaces; Part 3 simplifies hierarchy without hiding exact proposals. | Corrected native composition — work/evidence; OA-409 scope and evidence. |
| [AppsPanel](../../apps/desk/src/components/AppsPanel.tsx) | Migrate acknowledgement checkbox, feedback and custom status surfaces; preserve reviewed setup/enable consent. | Corrected native composition — integrations; OA-409 scope and evidence. |
| [AttachmentChip](../../apps/desk/src/components/AttachmentChip.tsx) | Reconcile empty/loading/error, actions, rows, panels and results; Part 3 owns workflow hierarchy and evidence. | Corrected native composition — conversation; OA-409 scope and evidence. |
| [AutomationHistory](../../apps/desk/src/components/AutomationHistory.tsx) | Reconcile native forms/tables/history/sheets and disclosures; Part 3 simplifies scheduling and purpose. | Corrected native composition — automations; OA-409 scope and evidence. |
| [AutomationsPanel](../../apps/desk/src/components/AutomationsPanel.tsx) | Reconcile native forms/tables/history/sheets and disclosures; Part 3 simplifies scheduling and purpose. | Corrected native composition — automations; OA-409 scope and evidence. |
| [AutomationsTable](../../apps/desk/src/components/AutomationsTable.tsx) | Reconcile native forms/tables/history/sheets and disclosures; Part 3 simplifies scheduling and purpose. | Reconciled native composition — automations; OA-409 scope and evidence. |
| [AvatarEditor](../../apps/desk/src/components/AvatarEditor.tsx) | Retain specialised graphics; reconcile selector radios, tabs, switches, actions and responsive hit targets. | Verified specialised graphics exception — artwork exception; OA-409 scope and evidence. |
| [AvatarPreview](../../apps/desk/src/components/AvatarPreview.tsx) | Retain product graphics/identity as documented exceptions; reconcile surrounding sizing, labels, motion and theme. | Verified specialised graphics exception — artwork exception; OA-409 scope and evidence. |
| [BotAvatar](../../apps/desk/src/components/BotAvatar.tsx) | Retain product graphics/identity as documented exceptions; reconcile surrounding sizing, labels, motion and theme. | Verified specialised graphics exception — artwork exception; OA-409 scope and evidence. |
| [BotEditor](../../apps/desk/src/components/BotEditor.tsx) | Reconcile forms, section/detail navigation, panels, badges and feedback; Part 1 owns draft protection. | Corrected native composition — agent; OA-409 scope and evidence. |
| [BotModelSettings](../../apps/desk/src/components/BotModelSettings.tsx) | Reconcile every model/effort caller, fields, loading and feedback; retain supported configuration discovery. | Corrected native composition — agent; OA-409 scope and evidence. |
| [BotSettingRow](../../apps/desk/src/components/BotSettingRow.tsx) | Reconcile forms, section/detail navigation, panels, badges and feedback; Part 1 owns draft protection. | Corrected native composition — agent; OA-409 scope and evidence. |
| [BotSettings](../../apps/desk/src/components/BotSettings.tsx) | Reconcile forms, section/detail navigation, panels, badges and feedback; Part 1 owns draft protection. | Corrected native composition — agent; OA-409 scope and evidence. |
| [BrandLogo](../../apps/desk/src/components/BrandLogo.tsx) | Retain product graphics/identity as documented exceptions; reconcile surrounding sizing, labels, motion and theme. | Verified specialised graphics exception — artwork exception; OA-409 scope and evidence. |
| [ClassicShell](../../apps/desk/src/components/ClassicShell.tsx) | Reconcile navigation/selection/menu styling, typography and compatibility; preserve ordering and keyboard alternatives. | Corrected native composition — navigation; OA-409 scope and evidence. |
| [Composer](../../apps/desk/src/components/Composer.tsx) | Reconcile InputGroup and mention options; retain hidden file picker, caret, IME, focus and upload contracts. | Corrected native composition — conversation; OA-409 scope and evidence. |
| [ComposioAccess](../../apps/desk/src/components/ComposioAccess.tsx) | Reconcile connection/consent views, loading/error/status, tabs and dialogs; preserve evidence and initiating-device authority. | Reconciled native composition — integrations; OA-409 scope and evidence. |
| [ComputerView](../../apps/desk/src/components/ComputerView.tsx) | Migrate raw controls/cards/status; unify full/context views; Part 1 owns truthful recovery. | Corrected native composition — operations; OA-409 scope and evidence. |
| [ConnectorAccess](../../apps/desk/src/components/ConnectorAccess.tsx) | Reconcile connection/consent views, loading/error/status, tabs and dialogs; preserve evidence and initiating-device authority. | Corrected native composition — integrations; OA-409 scope and evidence. |
| [ConnectorConnectReturn](../../apps/desk/src/components/ConnectorConnectReturn.tsx) | Reconcile connection/consent views, loading/error/status, tabs and dialogs; preserve evidence and initiating-device authority. | Reconciled native composition — access; OA-409 scope and evidence. |
| [DevicesPage](../../apps/desk/src/components/DevicesPage.tsx) | Reconcile access badges, forms, recovery disclosures and feedback; preserve access and revocation semantics. | Reconciled native composition — access; OA-409 scope and evidence. |
| [DevicesPanel](../../apps/desk/src/components/DevicesPanel.tsx) | Reconcile access badges, forms, recovery disclosures and feedback; preserve access and revocation semantics. | Reconciled native composition — access; OA-409 scope and evidence. |
| [EvidenceBlock](../../apps/desk/src/components/EvidenceBlock.tsx) | Native CodeBlock composition for exact payload text across approvals, receipts, activity, Ledger, results and skills. | Corrected native composition — conversation; OA-409 scope and evidence. |
| [AgentRequestsPanel](../../apps/desk/src/components/AgentRequestsPanel.tsx) | Shared Badge, Button, Alert, ReceiptLink and RequestDetails sheet; feature classes own layout only. | OA-465 source coverage; original compiled browser coverage recorded below. |
| [Feed](../../apps/desk/src/components/Feed.tsx) | Retain native conversation/Trace; reconcile activity skin, labels, payloads and state; safe formatting is Part 1. | Corrected native composition — conversation; OA-409 scope and evidence. |
| [HeldBack](../../apps/desk/src/components/HeldBack.tsx) | Migrate feedback action; reconcile list, empty/loading/error and recorded feedback state. | Corrected native composition — automations; OA-409 scope and evidence. |
| [HomeView](../../apps/desk/src/components/HomeView.tsx) | Reconcile empty/loading/error, actions, rows, panels and results; Part 3 owns workflow hierarchy and evidence. | Corrected native composition — work/evidence; OA-409 scope and evidence. |
| [Icon](../../apps/desk/src/components/Icon.tsx) | Retain product graphics/identity as documented exceptions; reconcile surrounding sizing, labels, motion and theme. | Verified specialised graphics exception — artwork exception; OA-409 scope and evidence. |
| [InboxView](../../apps/desk/src/components/InboxView.tsx) | Reconcile empty/loading/error, actions, rows, panels and results; Part 3 owns workflow hierarchy and evidence. | Reconciled native composition — work/evidence; OA-409 scope and evidence. |
| [IntegrationDetails](../../apps/desk/src/components/IntegrationDetails.tsx) | Reconcile connection/consent views, loading/error/status, tabs and dialogs; preserve evidence and initiating-device authority. | Corrected native composition — integrations; OA-409 scope and evidence. |
| [IntegrationSetup](../../apps/desk/src/components/IntegrationSetup.tsx) | Migrate acknowledgement checkbox, feedback and custom status surfaces; preserve reviewed setup/enable consent. | Corrected native composition — integrations; OA-409 scope and evidence. |
| [LedgerView](../../apps/desk/src/components/LedgerView.tsx) | Migrate controls, filters, Table, badges and detail surfaces; preserve export and exact evidence. | Corrected native composition — work/evidence; OA-409 scope and evidence. |
| [Login](../../apps/desk/src/components/Login.tsx) | Migrate raw actions/fields/errors; preserve pairing, host/legacy sign-in and invite contracts. | Corrected native composition — access; OA-409 scope and evidence. |
| [Logo](../../apps/desk/src/components/Logo.tsx) | Retain product graphics/identity as documented exceptions; reconcile surrounding sizing, labels, motion and theme. | Verified specialised graphics exception — artwork exception; OA-409 scope and evidence. |
| [McpInteractionCard](../../apps/desk/src/components/McpInteractionCard.tsx) | Migrate schema-driven fields; preserve typed choices, multi-selection, unset values, expiry and response meaning. | Corrected native composition — work/evidence; OA-409 scope and evidence. |
| [McpPanel](../../apps/desk/src/components/McpPanel.tsx) | (OA-454: now also hosts McpServerSettings, McpServerDialog and McpServerCheck, built from installed shadcn Dialog, AlertDialog, Field, Switch, Input, Alert, Badge and Button with no custom styling beyond layout; ApprovalCard reused for the check.) Reconcile feedback and reachable maintenance views; assess unscoped custom status pill without claiming it is always visible. | Corrected native composition — integrations; OA-409 scope and evidence. |
| [McpOAuthSettings](../../apps/desk/src/components/McpOAuthSettings.tsx) | (OA-457: sign-in section of a custom server; built from installed shadcn Alert, Badge, Button, Field and Input with no custom styling beyond layout.) Checked in jsdom against the real gateway and a fake authorization server by `scripts/verify-mcp-desk.mjs`; no browser, 390 px or screen-reader check. | Corrected native composition — integrations; jsdom evidence only. |
| [McpServerSettings](../../apps/desk/src/components/McpServerSettings.tsx) | (OA-454/OA-455: part of the custom MCP server management UI; built from installed shadcn Dialog, AlertDialog, Field, Input, Switch, Alert, Badge and Button with no custom styling beyond layout.) Checked in jsdom against the real gateway by `scripts/verify-mcp-desk.mjs`; no browser, 390 px or screen-reader check. | Corrected native composition — integrations; jsdom evidence only. |
| [McpServerDialog](../../apps/desk/src/components/McpServerDialog.tsx) | (OA-454/OA-455: part of the custom MCP server management UI; built from installed shadcn Dialog, AlertDialog, Field, Input, Switch, Alert, Badge and Button with no custom styling beyond layout.) Checked in jsdom against the real gateway by `scripts/verify-mcp-desk.mjs`; no browser, 390 px or screen-reader check. | Corrected native composition — integrations; jsdom evidence only. |
| [McpServerCheck](../../apps/desk/src/components/McpServerCheck.tsx) | (OA-454/OA-455: part of the custom MCP server management UI; built from installed shadcn Dialog, AlertDialog, Field, Input, Switch, Alert, Badge and Button with no custom styling beyond layout.) Checked in jsdom against the real gateway by `scripts/verify-mcp-desk.mjs`; no browser, 390 px or screen-reader check. | Corrected native composition — integrations; jsdom evidence only. |
| [McpCommandDialog](../../apps/desk/src/components/McpCommandDialog.tsx) | (OA-456: add or edit a local command; built from installed shadcn Dialog, Field, Input, Textarea, Switch, Alert and Button with no custom styling beyond layout; the inline review reuses ApprovalCard. Checked in jsdom against the real gateway: review card contents, cancel, approve, edit-drops-proposal, write-only secret fields. No browser, 390 px or screen-reader check.) | Corrected native composition — integrations; jsdom evidence only, see OA-456 Log. |
| [MemoryPage](../../apps/desk/src/components/MemoryPage.tsx) | Reconcile forms, section/detail navigation, panels, badges and feedback; Part 1 owns draft protection. | Corrected native composition — agent; OA-409 scope and evidence. |
| [ModelsPage](../../apps/desk/src/components/ModelsPage.tsx) | Reconcile provider rows/cards, status variants and setup feedback; preserve configuration/evidence distinctions. | Corrected native composition — operations; OA-409 scope and evidence. |
| [NewBotSheet](../../apps/desk/src/components/NewBotSheet.tsx) | Reconcile every model/effort caller, fields, loading and feedback; retain supported configuration discovery. | Reconciled native composition — agent; OA-409 scope and evidence. |
| [NewRoomSheet](../../apps/desk/src/components/NewRoomSheet.tsx) | Reconcile room headers, sheets, tabs, forms and status; preserve direct chat versus room identity. | Reconciled native composition — rooms; OA-409 scope and evidence. |
| [NotificationsPanel](../../apps/desk/src/components/NotificationsPanel.tsx) | Reconcile native forms and success/error feedback; preserve notification/proposal authority. | Corrected native composition — automations; OA-409 scope and evidence. |
| [OpsPanel](../../apps/desk/src/components/OpsPanel.tsx) | Reconcile state/feedback/forms/disclosures; preserve setup limitations, device and operational authority. | Reconciled native composition — operations; OA-409 scope and evidence. |
| [OwnerPanel](../../apps/desk/src/components/OwnerPanel.tsx) | Reconcile access badges, forms, recovery disclosures and feedback; preserve access and revocation semantics. | Reconciled native composition — access; OA-409 scope and evidence. |
| [PermissionGrid](../../apps/desk/src/components/PermissionGrid.tsx) | Use shared Table/Badge/feedback; preserve locked modes, reset semantics and responsive permissions. | Corrected native composition — agent; OA-409 scope and evidence. |
| [ProactiveCard](../../apps/desk/src/components/ProactiveCard.tsx) | Reconcile shared headings/cards/form sizes/tabs and feedback; remove caller-dependent visual repairs. | Reconciled native composition — automations; OA-409 scope and evidence. |
| [ProactivePage](../../apps/desk/src/components/ProactivePage.tsx) | Reconcile shared headings/cards/form sizes/tabs and feedback; remove caller-dependent visual repairs. | Reconciled native composition — automations; OA-409 scope and evidence. |
| [ReadinessPanel](../../apps/desk/src/components/ReadinessPanel.tsx) | Reconcile state/feedback/forms/disclosures; preserve setup limitations, device and operational authority. | Reconciled native composition — operations; OA-409 scope and evidence. |
| [ReasoningFields](../../apps/desk/src/components/ReasoningFields.tsx) | Reconcile every model/effort caller, fields, loading and feedback; retain supported configuration discovery. | Reconciled native composition — agent; OA-409 scope and evidence. |
| [ReceiptView](../../apps/desk/src/components/ReceiptView.tsx) | Reconcile native review/status/disclosure/payload surfaces; Part 3 simplifies hierarchy without hiding exact proposals. | Corrected native composition — work/evidence; OA-409 scope and evidence. |
| [ReflectionPanel](../../apps/desk/src/components/ReflectionPanel.tsx) | Reconcile native forms and success/error feedback; preserve notification/proposal authority. | Corrected native composition — automations; OA-409 scope and evidence. |
| [ResponsibilitiesPanel](../../apps/desk/src/components/ResponsibilitiesPanel.tsx) | Reconcile native forms/tables/history/sheets and disclosures; Part 3 simplifies scheduling and purpose. | Corrected native composition — automations; OA-409 scope and evidence. |
| [ResultsPanel](../../apps/desk/src/components/ResultsPanel.tsx) | Reconcile empty/loading/error, actions, rows, panels and results; Part 3 owns workflow hierarchy and evidence. | Corrected native composition — work/evidence; OA-409 scope and evidence. |
| [RoomRail](../../apps/desk/src/components/RoomRail.tsx) | Reconcile room headers, sheets, tabs, forms and status; preserve direct chat versus room identity. | Corrected native composition — rooms; OA-409 scope and evidence. |
| [RoomRoutingPanel](../../apps/desk/src/components/RoomRoutingPanel.tsx) | Reconcile every model/effort caller, fields, loading and feedback; retain supported configuration discovery. | Corrected native composition — rooms; OA-409 scope and evidence. |
| [RoomSettings](../../apps/desk/src/components/RoomSettings.tsx) | Reconcile room headers, sheets, tabs, forms and status; preserve direct chat versus room identity. | Reconciled native composition — rooms; OA-409 scope and evidence. |
| [RoomView](../../apps/desk/src/components/RoomView.tsx) | Reconcile room headers, sheets, tabs, forms and status; preserve direct chat versus room identity. | Reconciled native composition — rooms; OA-409 scope and evidence. |
| [RtcPanel](../../apps/desk/src/components/RtcPanel.tsx) | Reconcile state/feedback/forms/disclosures; preserve setup limitations, device and operational authority. | Corrected native composition — operations; OA-409 scope and evidence. |
| [SchedulePanel](../../apps/desk/src/components/SchedulePanel.tsx) | Reconcile shared headings/cards/form sizes/tabs and feedback; remove caller-dependent visual repairs. | Corrected native composition — automations; OA-409 scope and evidence. |
| [SectionViews](../../apps/desk/src/components/SectionViews.tsx) | Reconcile shared headings/cards/form sizes/tabs and feedback; remove caller-dependent visual repairs. | Reconciled native composition — navigation; OA-409 scope and evidence. |
| [SettingsLayout](../../apps/desk/src/components/SettingsLayout.tsx) | Reconcile shared headings/cards/form sizes/tabs and feedback; remove caller-dependent visual repairs. | Corrected native composition — operations; OA-409 scope and evidence. |
| [SettingsView](../../apps/desk/src/components/SettingsView.tsx) | Reconcile shared headings/cards/form sizes/tabs and feedback; remove caller-dependent visual repairs. | Corrected native composition — operations; OA-409 scope and evidence. |
| [Shell](../../apps/desk/src/components/Shell.tsx) | Reconcile navigation/selection/menu styling, typography and compatibility; preserve ordering and keyboard alternatives. | Corrected native composition — navigation; OA-409 scope and evidence. |
| [SidebarList](../../apps/desk/src/components/SidebarList.tsx) | Reconcile navigation/selection/menu styling, typography and compatibility; preserve ordering and keyboard alternatives. | Reconciled native composition — navigation; OA-409 scope and evidence. |
| [SkillsPanel](../../apps/desk/src/components/SkillsPanel.tsx) | Reconcile forms, section/detail navigation, panels, badges and feedback; Part 1 owns draft protection. | Corrected native composition — agent; OA-409 scope and evidence. |
| [SlackPanel](../../apps/desk/src/components/SlackPanel.tsx) | Reconcile state/feedback/forms/disclosures; preserve setup limitations, device and operational authority. | Corrected native composition — integrations; OA-409 scope and evidence. |
| [WorkView](../../apps/desk/src/components/WorkView.tsx) | Reconcile empty/loading/error, actions, rows, panels and results; Part 3 owns workflow hierarchy and evidence. | Corrected native composition — work/evidence; OA-409 scope and evidence. |
| [main](../../apps/desk/src/main.tsx) | Support/entry module: preserve API, auth, events and state boundary; verify visible loading/error wrappers and provider consumers. | Reconciled native composition — support; OA-409 scope and evidence. |
| [stream](../../apps/desk/src/stream.tsx) | Support/entry module: preserve API, auth, events and state boundary; verify visible loading/error wrappers and provider consumers. | Reconciled native composition — support; OA-409 scope and evidence. |

| [MessageText](../../apps/desk/src/components/MessageText.tsx) | Retain safe Markdown, bounded code/tables and existing theme. | Corrected native composition — conversation; OA-409 scope and evidence. |
| [NavigationDialogs](../../apps/desk/src/components/NavigationDialogs.tsx) | One route-independent native confirmation/operation host. | Reconciled native composition — navigation; OA-409 scope and evidence. |
| [Disclosure](../../apps/desk/src/components/Disclosure.tsx) | Shared native disclosure with mounted children and readable long titles. | Reconciled native composition — navigation; OA-409 scope and evidence. |

## Part 1 inventory delta

OA-397 adds `apps/desk/src/components/MessageText.tsx` as a safe presentation component using the existing desk theme. The baseline above remains the pre-migration inventory; Part 2 must include this additional production module and recheck the current tree. Part 1 does not complete the native-component migration.

| [ChatModelSettings](../../apps/desk/src/components/ChatModelSettings.tsx) | Composer model/effort controls share the existing model configuration contract. | Reconciled native composition — conversation; OA-409 scope and evidence. |

## Part 3A follow-up

OA-410 reconciles Work list density and detail hierarchy using the same native Card, Badge, Button and Disclosure primitives. No new production TSX module or specialised source exception is introduced. See Work coverage.

OA-411 changes approval content order and request labels using existing native Card/Disclosure/Badge parts. Exact review and typed schema interactions retain their contracts. Coverage. Production inventory remains unchanged.

OA-412 separates receipt decision/outcome and groups metadata using native Card/Badge/Alert/Disclosure/Field parts. Unknown inspection retains its exact policy and draft protection; legacy and no-Work receipts stay truthful. Coverage and limits. No new production module or exception.

OA-413 separates integration discovery and management with native Card/Dialog/Tab/Button compositions and additive selected-detail links. No new production TSX module or specialised exception. Coverage.

### OA-414/OA-415 — integration setup and account controls

IntegrationSetup retains Field/Checkbox/Textarea/Button/Disclosure for reviewed local setup; package details and rollback are secondary. ConnectorAccess/ComposioAccess use the installed AlertDialog composition for destructive disconnect, with safe initial/cancel/success focus. Callback return keeps a native Dialog and dismisses without awaiting network. No new competing control skin or production TSX module. OA-414 evidence and OA-415 evidence record responsive/theme, keyboard, controlled setup/account checks and limits.

### OA-416 — integration maintenance and failure-state closeout

AppLibraryPage, IntegrationDetails, IntegrationSetup, AppsPanel, McpPanel, ConnectorAccess, ComposioAccess and ConnectorConnectReturn retain installed native shadcn compositions. Maintenance and technical details use Disclosure; stale state uses attention Badge/Alert, with no fresh success claim. Account and setup actions keep explicit decision controls; generic footer copy and its unused CSS are removed. No production module was added; the 111-row inventory remains accounted for. OA-416 evidence includes 60 responsive/theme screenshots, Full/Limited and failed-read recovery, controlled real-gateway checks and known limits. Part 3B is delivered locally; live provider/deployment/device/screen-reader acceptance remains separate.

### Connection action icons — 4 November 2026

ConnectorAccess uses Lucide Check for Apple/Google read checks, Pause for pausing and Play for resuming, with the shared Button inline-start icon treatment. Desk build and shipped integration gateway check passed; CUA verified the Google check/pause/resume icons and scoped pause/resume. Help needs no change: these are decorative icons and the labels, actions and access rules are unchanged. Existing Vite chunk warning remains; no unit runners or live providers used.

### OA-417 — prospective automation timing

AutomationsPanel keeps native Field/Select/Checkbox/Button/Alert composition and adds daemon-derived schedule evidence, without a browser cron implementation or new TSX module. Current 111-module inventory passes. OA-417 evidence records 18 responsive/theme captures, keyboard and controlled real-gateway timing/save/race assertions; live-device/provider/scheduling acceptance remains separate.

### OA-418 — proactive choices

SchedulePanel/ProactivePage keep shared native cards, independent FieldSet/Field/Select/Switch/ToggleGroup saves, with checking frequency, proactive-alert hours/limits and morning brief grouped by owner choices. Existing drafts, value semantics and uncertain-save behavior are preserved. Automations uses Agent and purpose copy. OA-418 evidence records 24 responsive/theme captures, keyboard and real-gateway separate-save/lost-response coverage; 111-module inventory unchanged. Legacy Settings joined-flow Work expectation is recorded as a verification limit.

### OA-419 — secondary model diagnostics

BotModelSettings retains shared native selectors/save actions and collapses exact saved/requested/report evidence behind Disclosure. Report provenance uses semantic definition lists and shared stale-status Badge, with no inference from selection. ModelsPage setup copy follows current agent/chat configuration. No new production TSX module; inventory remains111. OA-419 evidence records 18 responsive/theme captures, keyboard and controlled shipped-gateway/model regression coverage and limits.

### OA-420 — navigation and final Part 3C closeout

Shell/ClassicShell, SettingsLayout/SectionViews, ProactivePage, AutomationsPanel/AutomationHistory and RoomView/BotSettings retain native Button/Tab/Sheet/Alert compositions. Automations has one Workspace identity; compatible tab/editor/run/panel URLs restore context without placing drafts in addresses. Same-context children remain mounted, while real exits keep the asynchronous leave guard. Both shells expose Skip to content. Creation waits for valid inventory and an available agent. No new production module or specialised exception; the current 111-row inventory passes. OA-420 evidence records 48 responsive/theme captures, keyboard/focus/reload/Back, controlled real-gateway regressions and known limits. Part 3C is delivered locally through OA-417–OA-420; live provider, deployment, physical-device and screen-reader acceptance remain separate.


## OA-434 request inspector — 4 November 2026

RequestDetails composes the installed Base UI Sheet (title/description/close), shared Disclosure, Badge, Skeleton, Alert, Empty and EvidenceBlock. ActivityTrace retains the existing Trace composition. Feature classes control layout; no competing control skins or new motion/dependency were added.

Compiled desk → real temporary gateway → controlled Ollama request → retained trace → inspector was exercised in the browser at the existing 1280×720 viewport and at 390×844. Summary and expanded Context states fit the sheet; the mobile sheet uses the shared scrolling region, and Escape returns focus to the Request details trigger. Viewport override was reset. Screenshot: `$HOME/.codex/visualizations/2026/11/03/01a1a32e-fdd1-7121-ae76-626d132abbac/request-provenance-mobile.png`.

The standalone desk/gateway journey additionally checks collapsed technical metadata, cross-device refresh, failed read clearing stale details, Retry without model dispatch, and historical Not recorded. These are automated DOM checks, not physical-phone or screen-reader acceptance. Real hosted-provider access is separate from this component audit.


| Before | After | Why |
| --- | --- | --- |
| Turn activity had no request inspector. | A compact Request details trigger opens the shared Sheet; context, attempts, receipts and technical metadata expand separately. | Keep ordinary conversation concise and make private diagnostics deliberate. |

Final compiled-bundle recheck used a fresh disposable gateway at `http://127.0.0.1:57588/#/room/main`: two-attempt grouping, Context expansion, actual mobile scrolling, Not recorded, and Escape focus return were observed. The viewport was reset and the preview was left open for owner review. Final artifacts in the same visualization folder: `request-provenance-desktop-final.png`, `request-provenance-mobile-final.png`, `request-provenance-empty-final.png`. The 51-step pagination/refresh case is verified through the actual component/gateway standalone journey.
## OA-432 composer dictation — 4 November 2026

Official Base UI InputGroup, Button, Field and Badge compositions were read through shadcn CLI documentation. Dictation reuses installed InputGroupButton variants (including shared 44px phone minimums), FieldGroup/Field/SelectField and SettingsSection. No private control skin or ancestor styling was added. Badges use secondary Off, success Configured, attention Needs setup; current errors use Alert.

Reachable controlled states: idle, starting permission, recording/Stop/Cancel, transcribing/Cancel, existing draft and concurrent edits, denied permission, late permission resolution, canceled result and repeated dictation are covered by the shipped-desk verifier. Chrome visual inspection covered dark desktop composer, recording/Stop/Cancel and preserved draft, Models enabled and saved Off states, native selector keyboard interaction, and dark/light 390px emulated settings/composer controls. The full-access phone recording row was also checked; its crowded inline status was moved to a separate InputGroupAddon line, then capture/Cancel was rechecked with clear icon spacing. Native local-provider selection picked LFM3-Omni and saved by readback. All new controls stayed within the composer/card at those views. Current full-device model controls were visually checked beside the microphone and recording controls; their implementation is unchanged. The initial minimal fixture had no chat model catalogue; the final fixture uses real bot-model state and has no Work runtime. Its unrelated Work 503 is not a production finding.

Local microphone capture reached Ollama and inserted a response, but the spoken test phrase was not recognized faithfully; recognition accuracy is unverified. Synthetic OpenAI/local-provider transcription was separately checked. Desktop light theme, physical Safari/phone and screen readers remain unverified. This is scoped coverage, not a blanket desk consistency claim.

| Module | Disposition | Verification |
| --- | --- | --- |
| [DictationSettings.tsx](../../apps/desk/src/components/DictationSettings.tsx) | SettingsSection, FieldGroup, Field, SelectField, Button, Badge and Alert; no raw controls | OA-432 dark desktop/390px form and native select/save; controlled settings API |

## OA-433 empty-composer dictation status — 4 November 2026

Composer keeps the installed InputGroup/InputGroupTextarea composition. Only the native textarea is inside a feature-owned grid; the noninteractive, aria-hidden prompt label shares its grid cell. Attachments remain in their existing preceding InputGroupAddon and the direct block-end toolbar continues to own column layout and height. The one existing active-dictation status remains mounted in its own addon through empty/nonempty draft changes, switching to `sr-only` rather than adding a second live region. The scoped opacity-only prompt animation follows the existing 1.2-second activity cadence and has an explicit reduced-motion override.

The controlled built-desk verifier has source coverage for Starting/Recording/Transcribing labels, a blank native placeholder and one live status when overlayed, prompt removal/restoration while typing or clearing, empty-to-filled transcript insertion, preserved attachment and Cancel/error restoration. Source-token contrast at the 0.65 minimum opacity is 6.31:1 on white and 6.95:1 on the conservative dark surface; it is a calculation, not browser measurement. Rendered CUA Chrome inspection at actual port 4750 verified dark desktop and dark/light 390px empty recording placement with no extra row or toolbar overlap, click-through textarea focus, typed/cleared drafts, Cancel restoration and emulated reduced-motion static feedback. Browser emulation was restored and preview left idle. Starting/Transcribing and attachment/error cases are covered by the controlled built-desk verifier. Physical Safari/phone, screen-reader use and slow-motion frame inspection remain unverified; this is scoped coverage.

## OA-430 compact reasoning icon shape — 4 November 2026

`ReasoningFields` now selects the shared Field horizontal orientation for compact composer controls. The default vertical Field variant applies `*:w-full`, which overrode the native icon button width inside an auto-width field and squeezed it into an oval. Horizontal orientation lets the native InputGroupButton own its square dimensions; no glyph, private sizing rule or shared primitive changed. Noncompact settings/creation/routing fields remain vertical. Actual port-4750 Chrome inspection confirmed a round centered reasoning icon aligned with the adjacent CPU/microphone buttons. Standalone composer/settings checks and the 112-module source inventory pass. Physical phone/Safari geometry was not checked.

## Main merge — permission component inventory

| Module | Disposition | Verification |
| --- | --- | --- |
| [PermissionAdoption.tsx](../../apps/desk/src/components/PermissionAdoption.tsx) | Shared Alert/Field/ToggleGroup/Checkbox/Button and Collapsible composition for archived-rule disclosure | Standalone historical migration/adoption checks; no automatic adoption |
| [PermissionControl.tsx](../../apps/desk/src/components/PermissionControl.tsx) | Shared Dialog, Field, SelectField, ToggleGroup, Checkbox, Badge and Alert | Standalone actual-desk permission controls |

The incoming permission modules were absent from the source inventory. The archived-rule disclosure now uses the installed Collapsible composition to satisfy the existing ordinary-control gate; its text and adoption behavior are unchanged. This is merge reconciliation, not a new permission design or a claim of full visual acceptance.

## OA-431 capability-based model choices — 4 November 2026

DictationSettings retains the installed Field/SelectField/SelectItem/Button/Badge
composition. Menu items now come from cached task-compatible models; empty/loading
and Limited states disable controls. A catalogue-refresh revision disables saving
until matching metadata arrives, retaining the user's draft. The status badge keeps
neutral Off, success Configured and attention Needs setup variants.

Actual CUA Chrome at port 4750 verified dark desktop and 390×844 dictation form and
expanded menu. The real refreshed OpenAI source exposed Whisper and diarization
choices alongside the existing models, with no realtime-only entry. Controls stayed
within the viewport; the existing selected target remained unchanged. Temporary
viewport was reset and the separate inspection tab closed. No setting was saved
through this visual check. Controlled built-desk checks cover selection, refresh draft
retention, explicit save, chat controls and Limited access. Other unchanged model
surfaces retain their earlier composition coverage; physical phone/Safari and screen
reader use are unverified. Final controlled check results are recorded in OA-431.

## OA-448 (implementation label OA-439) — Permission icons

Shared Tabler IconEye / IconShieldCode / IconShieldExclamation accompany existing labels in session/default controls and adoption choices. Native Button/ToggleGroup sizing and accessible names remain unchanged. CUA inspected session390px dark and default900px light. Adoption is covered by the actual controlled desk/adoption check; its new icons were source-reviewed, not separately browser-captured. No live permission writes.

## OA-449 (implementation label OA-440) — Compact composer disclosure

| Module | Composition | Coverage |
| --- | --- | --- |
| [Composer.tsx](../../apps/desk/src/components/Composer.tsx) | Existing InputGroup, menus and permission controls remain mounted. Compact input is one line with Add/Dictate/Send; focus and content disclose the current composition. | CUA390/900/1440 light/dark compact/expanded; pointer150ms measured height; keyboard/reduced instant; draft/menu retention. Controlled built-gateway upload, dictation and model behavior pass. |
| [input-group.tsx](../../apps/desk/src/components/ui/input-group.tsx) | Shared explicit compact sizing preserves inline icons,44px phone targets and overflow-free textarea. | Same matrix; standard size callers unchanged. |
| [RequestDetails.tsx](../../apps/desk/src/components/RequestDetails.tsx) | Retained from current main; shared Sheet/Disclosure/Badge/Skeleton/Alert/Empty/EvidenceBlock, as documented in its earlier narrative audit. | Inventory row reconciled with that existing source audit; not newly browser-audited under OA-440. |

ChatModelSettings publishes actionable child error/catalogue attention separately from execution blocking, so compact presentation never hides recovery. Initial error/readback recovery and clean collapse are verified through the shipped desk/gateway selector check.

## OA-441 — Add placement correction

Compact Add remains at the left edge; text sits between it and right-aligned Dictate/Send. InputGroup layout uses the existing mounted button and semantic controls, with no competing skin. CUA390/900/1440 light/dark checks confirm bounds/alignment and44px phone targets; expanded Add remains left. Native file chooser opens from compact Add..

## OA-442 — Plain composer icons

Composer Add/dictation/stop/cancel/send and compact model/effort triggers use the installed ghost variant. CUA390/900/1440 light/dark compact/expanded checks record fully transparent resting fill/border,44px phone targets and retained Add-left placement. Native keyboard focus shows its3px semantic ring; disabled feedback and hover/open feedback remain owned by Button. Full-size settings selectors retain outline..

## OA-443 — Composer icon legibility

Shared InputGroupButton icon-sm uses24px glyphs and semantic foreground instead of inherited muted text. All actual callers are composer actions/compact model/reasoning controls. CUA12 width/theme/state views confirm24px glyphs, unchanged44px phone/32px compact desktop targets, transparent borders/fills and correct light/dark foreground. Disabled opacity remains50%; enabled Send is100%..

## OA-444 — Matching Send color

Shared ghost submit icon styling retains full opacity when disabled. Native disabled state and dispatch guards are unchanged; non-submit disabled controls still dim. CUA light/dark confirms Add/Dictate/Send share foreground and opacity1 for an empty composer, with Send disabled; typing enables Send without changing its color..

## OA-445 — Bot-panel permissions

Composer no longer renders an agent/mode trigger beneath the input; its shared dialog remains available through `/permission`. BotSettings → Permissions replaces its old redirect paragraph with the existing session control, explicitly bound to the current room/agent and Full-access status from RoomView. CUA checked390px clean expanded composer,1440px bot panel and358px-wide nested phone dialog; shortcut opens one dialog without sending text. Source inventory114 and controlled permission/selector/gateway checks pass..

## OA-446 — Filled Send

Send uses the native primary fill and contrasting foreground again. Other composer icons remain ghost with semantic foreground. Shared icon-sm sizing keeps24px glyphs; its ghost-only color rule lets the primary variant own Send contrast. The superseded ghost-submit opacity exception was removed. CUA empty/ready phone light/dark checks confirm fill/arrow contrast,44px targets and native disabled feedback..

## OA-447 — Compact Send fill

Shared Button icon-primary variant centers a32px decorative circle behind the unchanged24px arrow. Actual Send button remains44px on phones/32px compact desktop, preserving native focus/disabled/hover behavior. No feature skin or reduced touch target. CUA eight390/900 light/dark empty/ready states verify glyph/fill/hit-area sizes, contrast and non-interactive decoration..

## OA-450 — Compact phone text alignment

Shared compact InputGroupTextarea uses10px vertical padding below768px, matching its24px line inside the44px control. Before:48px scroll height and text line2px below icon center. After:44px scroll height and zero center offset. CUA390/900/1440 light/dark verifies compact alignment and unchanged12px expanded/desktop padding..

## OA-452 — existing-room agent picker (4 November 2026)

Room settings now reuses NewRoomSheet’s installed Command/CommandInput/CommandList/CommandItem composition, Field, Button and BotAvatar. Checked actual desktop 1440×1000 and phone 390×844 rendered states in dark/light: idle, selected, existing members disabled, search-empty, saved, and permission error with draft retained. No new control skins or audited exceptions. Browser evidence and coverage limits.

## OA-453 — room field order (4 November 2026)

Moved Lead above Add agents with the existing Field/Select/Command compositions unchanged. Viewed rendered desktop 1440×1000 and phone 390×844 states, and asserted Lead’s top coordinate precedes the search input. Desktop, phone. Desk build passes. Knowledge requires no update: this changes only field order, with no change to labels, help steps or behavior.

## OA-459 reflection memory — 5 November 2026

ReflectionPanel changes explanatory copy and labels memory counts as notes. MemoryPage adds removal guidance to the existing Saved memory section; its Textarea and Button compositions are reused unchanged. Source, build and temporary gateway behavior checks pass. **Rendered/state comparison is blocked:** browser access is disabled in Work settings. No desktop/phone visual acceptance is claimed; OA-459 stays open. See scope and verification.

## OA-461 cancelled Recovery — 5 November 2026

InboxView changes explanatory text only. Recovery retains the existing shared attention Badge, Alert and Button compositions and layout; no new control or style is introduced. Controlled HTTP coverage verifies cancelled Recovery exposes review and refuses a fresh attempt. The built-screen check was attempted through CUA but local browser use is disabled in Work settings, so rendered comparison remains unverified. This entry makes no new visual-consistency claim.
## OA-460 user profile — 5 November 2026

Source coverage: Profile navigation and search entry, SettingsHeader/SettingsSection, labelled Field/Input, save/cancel Button, destructive Alert and existing AvatarEditor/Dialog composition; chat uses the existing Message/MessageAvatar. UserAvatar retains the existing initial badge as a semantic identity graphic exception and reuses BotAvatar for chosen characters. No control skins or status badge overrides added.

**Rendered coverage remains unverified.** Cua inventory reports “Local browser use is disabled in Work settings”. Desktop/phone Profile, draft/cancel/save/error/read-only states, avatar dialog character/colour/reset/motion/focus and changed chat appearance still need rendered comparison with installed shadcn compositions. Build/API checks do not close this gate.

## OA-462 uploaded user image — 5 November 2026

Profile now uses uploaded raster images and initials, leaving character avatars to agents. Source coverage: existing Dialog/Field/Input/Button/Alert and new shared Base UI Slider composition (Root, Control, Track, Indicator, Thumb); labelled zoom, zoom buttons and single-click arrow alternatives to drag. The circular crop geometry, hidden file input and raster image are explicit specialist graphic exceptions. Saved image/removal, file errors, loading/busy, read-only and legacy initials are covered by source review; JPEG validation/persistence, size refusals, legacy-name retention and crop geometry have standalone controlled checks.

Rendered comparison is still blocked: Cua reports local browser use disabled in Work settings. Desktop/phone crop, zoom, pointer/touch/keyboard, focus, cancellation, load/save errors and chat image states remain unverified. Source/build checks do not close the visual gate.

### Avatar idle animation — 5 November 2026

The existing shared BotAvatar renderer now honors Animate avatar outside the editor, including neutral sidebar/header/message instances. Character thumbnails remain static; existing controls, geometry and status semantics are unchanged. Controlled renderer/editor checks cover all 12 shapes, 100 instances sharing one frame loop, idle transform changes, motion-off and dynamic reduced motion. Rendered visual/performance comparison remains unverified: Cua browser inventory reports local browser use disabled in Work settings. See `docs/notes/avatars/replacement-acceptance.md`.

## OA-463 tool activity grouping (5 November 2026)

ActivityTrace retains the installed Trace/Collapsible/EvidenceBlock and receipt-link compositions. Feed, room activity and Work share the same lifecycle projection; raw LedgerView remains unchanged. Current-state labels replace duplicated stages, with Failed destructive and Unknown neutral/unconfirmed. No control skin or status badge override was added. Real-component SSR covers lifecycle/room/native-failure cases and both real adapter recordings; cua-driver Chrome checks cover desktop/light, 500px light/dark, Pending → Finished and expanded evidence. See scope, screenshots and limits. Chrome refused 390px geometry; physical phone and full installed-desk acceptance remain unverified.

OA-463 review follow-up: exact input matches take precedence over default-expanded subsets; ambiguous adapter records remain separate. Completed default-only inputs are covered. Final static source review found no blocking defects.


## OA-465 — Agent requests in direct chats

| Surface | Composition and coverage |
| --- | --- |
| Composer mentions | Existing listbox/InputGroup/Button composition; global eligible agents only in direct chats, stable handle in selection. Rendered at 1440×1000 and 390×844, phone light/dark; pointer selection and Send verified. |
| AgentRequestsPanel | Shared Badge/Button/Alert, wrapping rows in bounded scrolling region. Requested/Cancelled and Answered rendered; Cancel exercised against the actual temporary gateway. Other lifecycle/failed-delivery/input states covered by controlled gateway assertions and source mapping. |
| Request details | Existing shared Sheet/Disclosure/Badge composition; owner/Full scoped manifest rendered at phone and desktop widths. Closing the sheet returns to the same conversation. |
| Receipt navigation | Existing ReceiptView composition; origin navigation preserves private receipt scope. Automatic and inspected response routes covered by actual gateway assertions; no external action performed. |

Semantic mapping reviewed for every branch: completed/delivered success; failed/expired or failed delivery destructive; interrupted attention and cancelled neutral take precedence; other pending/running/incomplete attention; cancelled neutral secondary. Outstanding requests remain accessible, with only settled history capped. Production component inventory (115 modules) and built desk selector/provenance checks pass. Screenshots: OA-465 evidence. Physical phone/Safari and screen-reader use remain unverified.

## OA-466 — Conversation rendering performance

Feed retains MessageScroller/Message/Bubble and ActivityTrace retains native Trace/Collapsible, receipt links and evidence presentation. MessageText retains the existing Markdown/Table/CodeBlock composition. BotAvatar remains the audited artwork exception with its sized outer element. Composer retains InputGroup, menus, mentions and existing pointer/keyboard disclosure behavior. No new controls, badge states, feature skins or scroll library are introduced.

Controlled real-module DOM checks cover shared/split activity, native expansion, unchanged message rendering, hidden activity, avatar visibility/current-state resume, animation-off/reduced motion and draft/caret/focus/IME plus measured pointer collapse. Existing shipped-desk checks cover attachments, disclosure and offline guards. **Rendered comparison pending:** desktop/phone light/dark; off-screen reveal and row geometry; long-history scrolling/anchoring/latest; typing and menus during incoming events. Work settings disable local browser use, so source/DOM checks do not certify visual consistency or smooth frames. See [scope and journey](conversation-rendering.md).

## Conversation panel default — 5 November 2026

RoomView no longer opens the context panel merely because the viewport is at least 1180px wide. Explicit tab/Work routes still open it. Existing panel, Sheet, toggle and responsive compositions are retained. Build and source checks cover the default change; rendered desktop/phone and toggle comparisons remain unverified.

## Message composition — 5 November 2026

Feed follows the official [Base Message composition](https://ui.shadcn.com/docs/ai-elements/base/message): Message/MessageContent/Bubble/BubbleContent/MessageFooter. User rows align end with muted bubbles; agent rows align start with the installed tinted variant and a bubble-local primary token from the existing avatar palette. Sender avatars/name headers are removed; article labels and footer timestamps retain accessible identity and timing. Error bubbles remain destructive. Message/Bubble primitives and native spacing/radii/responsive widths are unchanged; no component or dependency is added.

Controlled DOM checks cover all 14 colours, automatic/missing metadata, appearance refresh, sender labels, timestamps, Markdown, literal user text, errors and absence of message avatar animation, alongside existing Trace/Composer/preview/approval checks. Visual comparison at 390/900/1440px in light/dark themes, actual contrast/overflow and scroll behavior remain open: Cua reports local browser use disabled in Work settings. No live data or deployment is implied.

Verification: `pnpm -r build` passed (hosted relay dry-run only); handbook repackaging and four `verify-bot-knowledge.mjs` delivery groups passed after the help edits. `verify-render-performance.mjs` and `verify-avatar-desk.mjs` passed, including the new bubble checks and existing approval/library render journey. Script syntax and whitespace checks passed. The broader `verify-desk-components.mjs` gate remains blocked by HEAD's existing missing ProfileImageEditor.tsx inventory entry; this change does not alter that module or claim that gate passed. No unit/Jest/Vitest runners, live provider calls, live data changes or deployment.

## OA-469 — receipt inspection removal (5 November 2026)

ReceiptView retains native Card, Badge, Disclosure, Button and evidence compositions. The target/reference and findings fields, inspection action, dirty-draft handling and generic Unknown warning are deleted. Status variants remain unchanged: Unknown/pending attention, failed/not-run destructive, completed success. Needs you no longer lists chat receipts as Recovery items; normal action approvals, server input and Work recovery remain.

Controlled shipped-bundle DOM acceptance covers completed/edited, legacy, pending-evidence and Unknown receipts, retained exact payloads, absence of inspection fields/button, no leave guard and no automatic replay. Gateway acceptance covers no chat receipt Recovery item and no historical-Unknown model lock. Real rendered desktop/phone consistency remains unverified: on this turn Cua inventory reported `Local browser use is disabled in Work settings`. No substitute screenshot or physical-device acceptance is claimed.

---

## OA-467 AI Elements adoption — 5 November 2026

| Component | Source coverage | Rendered coverage |
| --- | --- | --- |
| [item](../../apps/desk/src/components/ui/item.tsx) | Official base-nova Item composition installed through shadcn; existing Separator preserved. Simple inline confirmations use Item/Header/Content/Actions; complex avatar/reflection reviews retain Card. | Controlled DOM decisions, Edit/Respond reachability and exact proposal disclosure; browser comparison pending. |
| [profile](../../apps/desk/src/profile.tsx) | Existing nonvisual profile context and shared refresh; no UI composition. | No presentation change. |
| [UserAvatar](../../apps/desk/src/components/UserAvatar.tsx) | Existing semantic image/initial graphic exception used in Profile; message rows omit it. | Previous profile-image browser limits remain. |
| [slider](../../apps/desk/src/components/ui/slider.tsx) | Existing Base UI slider wrapper for image adjustment, inventoried without source changes. | Previous crop/keyboard/browser limits remain. |
| [ProfileSettings](../../apps/desk/src/components/ProfileSettings.tsx) | Existing native fields, buttons, dialogs and hidden image picker; implementation unchanged. | Inventory reconciliation only; previous browser limits remain. |
| [ProfileImageEditor](../../apps/desk/src/components/ProfileImageEditor.tsx) | Existing native Dialog/Button/Slider crop editor added to the source inventory. Its rendering and upload behavior are unchanged. | Existing profile limitations retained; this inventory correction is not new browser evidence. |

ActivityTrace uses one native summary and nested Trace per recorded turn within each contiguous activity segment. Settled historical groups start closed; running groups start open. Operation details remain lazy. Explicit failure/unconfirmed counts and existing receipt reconciliation prevent Unknown outcomes from becoming success. Command stdout/stderr are displayed only when present in recorded results; no output stream is invented. Work plan progress stays labelled as reported. Delegated Work opens its existing authorized activity reader only on expansion; agent requests use only events already visible in the same conversation. Copy uses ghost icon Button/Tooltip with success and refusal feedback. Shared spacing, semantic variants and control sizing remain native.

The source gate now accounts for the existing profile modules/Slider and explicitly permits the existing hidden ProfileSettings file picker, alongside the composer file picker and three artwork radios. No ordinary-control exception is added. This repairs the previously reported inventory gap without changing the profile implementation.

Reachable states covered by controlled checks: active/settled/failed/unknown/interrupted and missing tool results; collapsed/expanded summary, operation and exact proposal; recorded command output; all reported plan states and empty plan; Copy success/refusal; Accept/Ignore/JSON Edit and Respond reachability; delegated status/result/receipts and same-room activity filtering. Existing message alignment/palette, Markdown, previews, library approvals, composer drafts and off-screen avatar checks remain applicable. Desktop/phone light/dark reference comparison and real scrolling remain unverified while local browser use is disabled. User scroll anchoring and native scroll dependency are unchanged pending that evidence.

Initial OA-467 verification passed recursive build, standalone activity/render/pattern/avatar checks and the reconciled component gate (121 production modules, five explicit specialised input sites). Packaged/default API/Ollama/cached ACP-MCP/replacement-default knowledge delivery passed all four groups, including new activity/Copy/review wording. Final pinned-release checks and deployed readbacks are recorded in the dated release note. No unit/Jest/Vitest runners or live provider canaries.

## OA-468 Checkpoint

| Component | Source coverage | Rendered coverage |
| --- | --- | --- |


## OA-470 recorded evidence compositions

| Module | Native composition | Coverage |
| --- | --- | --- |
| [RecordedEvidence](../../apps/desk/src/components/RecordedEvidence.tsx) | Trace, Collapsible, Button, HoverCard and existing EvidenceBlock; recorded sources, file tree, TAP and stack frames. | Actual DOM and malformed/bounded evidence checks passed; rendered coverage recorded below. |
| [RequestUsage](../../apps/desk/src/components/RequestUsage.tsx) | HoverCard, Button and Progress, existing owner/Full metadata reader. | Lazy-read, missing-data and character-budget DOM checks passed; rendered coverage recorded below. |
| [hover-card](../../apps/desk/src/components/ui/hover-card.tsx) | Official installed base-nova PreviewCard composition. | No feature skin; shared primitive. |
| [progress](../../apps/desk/src/components/ui/progress.tsx) | Official installed base-nova Progress composition. | Recorded character budget only. |

WorkView reuses Tabs/Trace for reported Queue; Composer reuses Button for draft suggestions. Feed retains the existing bubble alignment, saved colour, accessible sender, native scroller and closed side-panel behavior. Runtime streaming/hidden reasoning and inferred answer citations are excluded.

Chrome became available during this batch. The built disposable desk was compared in desktop dark/light and 390×844 responsive layouts: file tree, returned source preview, recorded stdout/stderr/TAP/stack, usage/bar, Queue groups and draft suggestions retain native compositions. Side panel was closed and message alignment/tints retained. A real UI checkpoint fork created a distinct synthetic conversation without a turn. Missing/error and malformed states have controlled DOM coverage; complete physical-device and scroll/reconnect coverage is not claimed. See OA-470 evidence.

## OA-471 checkpoint removal

Removed the chat checkpoint row and unused ConversationCheckpoint/Marker modules. Message bubbles, footers, usage and Copy keep their native compositions. Existing forked rooms and attachment references are retained. Render checks assert that Checkpoint/Fork from here are absent; updated help describes existing forks only. Historical screenshots above retain the before-state.

Chrome reloaded the rebuilt disposable conversation: four message rows remained, Checkpoint text and Fork from here buttons were absent, and usage/Copy/tinted alignment and closed side panel remained visible. Evidence: chat without checkpoints. Desktop removal reviewed; mobile behavior follows the same removed row and controlled render assertions.

## OA-477 — conversation questions and decisions

| Component | Source coverage | Rendered coverage |
| --- | --- | --- |
| [ConversationRequests](../../apps/desk/src/components/ConversationRequests.tsx) | Native Message/MessageContent, existing ApprovalCard and McpInteractionCard, native Buttons and errors. Per-chat pending decisions survive history paging; no alternate input form for bot questions. | Mounted RoomView/gateway assertions pass, including reply selection, exact send, model-control target and stale draft retention. Actual browser comparison blocked. |

Composer uses native InputGroupAddon/InputGroupButton for Replying to/New message; existing textarea owns the draft. Question Reply uses the installed Button; Feed and pending decisions retain native Message compositions. Shell/ClassicShell drop Needs you navigation, counts and the old page. Shared attention colour values are unchanged while their former feature-specific token names become semantic `--attention` tokens. Existing badge variant mapping remains: pending attention, accepted success, denied/failed destructive. The removed InboxView row above is historical inventory.

Desktop/phone visual acceptance is not established by imports, typechecks, or mounted DOM. Record browser access and final verification in the ticket Log.

OA-477 browser access was rechecked through Cua on 5 November: local browser use is disabled in Work settings. Desktop/phone visual comparison remains blocked. No live desk or installed service was changed.

---

## OA-473 provider prompts in chat

Feed mounts the existing McpInteractionCard as a Message/MessageContent row outside the activity Trace. It reuses Field, SelectField, Checkbox, Input, Button, Alert and Badge; no feature control skins or new primitive are introduced. The open request's Response needed badge uses `attention`; accepted uses `success`, declined uses `destructive`, cancelled remains neutral, and expired/interrupted use `attention` in the retained Questions detail.

Controlled gateway/React/stream DOM coverage includes a live arriving permission form with activity hidden or shown, exactly one form after duplicate/forwarded-shaped events and chat remount, room separation, restricted-device omission, explicit Allow once submission, stale-response rejection, and removal after accepted/declined/cancelled/expired state. URL-mode prompts show their guarded link in chat and remove it on parent cancellation. The existing Questions form retains numeric, boolean, choice and other-device-decision coverage. The component inventory and actual Trace composition checks passed.

Visual comparison remains unavailable: on 5 November, Cua returned `Local browser use is disabled in Work settings`. No desktop/mobile screenshot, browser layout, overflow or physical-device acceptance is claimed. The source/DOM checks above do not replace that comparison; ticket OA-473 remains open for it.

## OA-474 invocation result and effect verification

ReceiptView retains the existing native Card, CardHeader, CardTitle, CardAction, CardContent and semantic Badge composition. New MCP receipts label the outcome Tool result, use Succeeded for completed invocations, and show External change verification: Not checked in the existing content stack. Failed/not-run use destructive, pending/unknown attention and completed success; older receipts keep their existing heading and labels. No control, layout skin or colour override was added.

The shipped-desk gateway/DOM receipt check covers Succeeded plus separately persisted Not checked evidence, alongside Failed, Pending, legacy/retained Unknown and missing historical receipt states. Component inventory and renderer checks remain separate from visual acceptance. Browser review remains unavailable because local browser use is disabled; no desktop/phone screenshot or screen-reader acceptance is claimed for the new text.

## OA-476 message replies — 5 November 2026

Reply actions use the existing MessageFooter Button (`ghost`, `icon-sm`) with Tooltip. Composer keeps InputGroup and uses its block-start Addon plus InputGroupButton (`ghost`, `icon-xs`) for Cancel reply. Shared touch-size variants, focus rings and semantic theme tokens remain authoritative. No status badge changes. MessageQuote is an explicit semantic-document exception: a plain-text blockquote with sender, a two-line excerpt and shared border/text tokens; it renders in both composer and BubbleContent. Installed shadcn CLI info confirms Base UI/base-nova; official InputGroup/Button/Tooltip compositions were located through the installed CLI.

| Module | Composition | Coverage |
| --- | --- | --- |
| [MessageQuote](../../apps/desk/src/components/MessageQuote.tsx) | Semantic quoted text; escaped React text nodes, bounded preview and shared tokens. | Built-desk DOM acceptance below; visual comparison pending. |

State coverage required: user/agent/attachment-only targets, select/replace/cancel/Escape, keyboard focus, sending lock, draft and quote retention on failure/uncertain response, acknowledged send, sent quote after reload, room change, direct/room/classic shell, long/multiline/hostile text, light/dark and phone/desktop sizes. Browser inventory currently reports **Local browser use is disabled in Work settings**. DOM assertions establish behavior and component structure only; rendered theme, size, wrapping and scroll comparison remains unverified. This visual gate remains open.

OA-476 controlled acceptance: `pnpm -r build`, `verify-message-replies`, `verify-hosted-context`, `verify-acp-continuity`, `verify-agent-requests` (38 cases), `verify-chat-display`, `verify-ai-patterns`, `verify-desk-components` (126 modules), `verify-bot-knowledge` (four delivery groups) and whitespace passed. Reply/Copy adjacency, native control slots, focus/Escape/cancel/replace, send lock, failure/lost-response retention, safe quoted text, persistence and direct/classic/mobile DOM paths are asserted against the shipped bundle and disposable real gateway. The phone media-query DOM path does not establish rendered phone layout. No browser screenshots, theme/wrapping/scroll comparison, real adapters/providers or deployment were performed.
