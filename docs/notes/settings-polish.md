# Settings interface

The five Settings destinations and Workspace Automations share OpenAg's existing theme and installed shadcn Base UI components. Cards group related controls; Fields associate labels and descriptions; Tabs separate tasks; Collapsible keeps secondary detail available; automation rows use Table and DropdownMenu. No provider, device or tool authority changes.

- Server: summary, then Overview / Operations / Connection / Appearance. Overview shows incomplete required checks before collapsed completed and optional checks. Operations contains backup settings/files, daily turn limits and diagnostics. Backup and limit drafts remain mounted across tab switches. Appearance is browser-local. Last backup is the latest audited attempt, restored on restart; filenames without audit evidence are not called successful runs.
- Workspace, Automations: New automation in the header; Automations / Responsibilities / History tabs. Rows show purpose, owner, trigger, next run/timezone and last outcome. Full prompts remain in Edit. Each row has an enabled switch and an actions menu. Delete and secret rotation require a dialog confirmation. Secret values remain one-time component state.
- Bot settings: select an agent in the sidebar, open its conversation side panel, Settings. Brain / Knows / Rules sections expand inline, one at a time. Agent identity and the other section triggers remain visible; closing a section keeps its draft mounted. There is no nested Back step. The default marker sits beside the agent name. Full ledger is in the Activity tab. No Bots page or bot selector remains in Settings.
- Connectors: installed connections and Slack setup use shared Cards. Existing connection/consent and app integrity rules remain. Slack separates its connection state and labelled setup fields from collapsed Server setup and Connection activity details.
- Models: configured providers remain separate from the searchable supported catalogue. Browse all supported providers opens discovery; Setup reveals examples. Configuration labels do not imply provider acceptance.
- Proactive: Schedule / Reflection / Notifications / History tabs, shared Cards and Fields, day selection through ToggleGroup, and read-only decision detail collapsed. Existing save boundaries and unattended rules remain.
- Devices: existing list, pairing and access dialogs remain; shared heading and shadcn Access & recovery disclosure.

Local visual acceptance uses scripts/preview-settings.mjs: a disposable loopback gateway and database with seeded agents/automations, actual local backup service, disabled inference and no connected accounts. Its screenshots demonstrate the controlled build, not deployment or live provider acceptance.

## Unsaved changes

Memory, agent details, model/effort, room/routing, proactive schedules, notification, Slack, WebRTC and operations editors register their dirty/save state with one desk navigation guard. An open automation form also requires an explicit leave choice. Changing the address through navigation or browser Back/Forward checks the guard before replacing the current screen. The shared shadcn dialog offers Keep editing (initial focus) or Discard changes. Escape, Close and outside dismissal retain the draft. Browser Back/Forward restores the accepted address before showing it; confirmation replays only the chosen navigation. A pending save/check instead shows an acknowledgement-only dialog and never navigates when it finishes. Reload/closing the browser uses its native unsaved-change warning. A pending save or configuration check must finish before desk navigation or user sign-out.

Mounted tabs, agent subsections and conversation-panel dismissal retain their drafts in memory. Returning to the same mounted editor does not reload over the draft. Leaving the page with explicit discard can lose it. The guard stores only dirty/busy flags, never draft text or credentials, and introduces no browser persistence or autosave. Immediate-save preferences and assignments keep their existing behaviour. A failed or uncertain save retains its draft and error and is not automatically retried. Forced sign-out on revoked credentials is never blocked by a draft.

## Native control sizing

Ordinary actions and fields use shared 44px controls, including model and effort selection inside agent creation, agent settings and room routing. Model selection uses grouped shadcn radio menus throughout the app. Compact desktop variants remain explicit; phones retain 44px targets. These defaults belong to shared controls, not the Settings page ancestor.

Operational forms, sign-in and integration acknowledgements use shared Fields and controls. Successful saves use accessible status text; failures use destructive alerts. Status badges distinguish verified affirmative states, pending/setup/unknown states, failures/denials and neutral metadata. No change to setting authority or persistence is implied by styling.

## Overlay sizing and coverage

Standard sheets use a 560px desktop maximum; evidence and result sheets use 680px. Below 768px, sheets fill the available viewport width. The wide conversation inspector retains its responsive layout, and nested portals retain their own focus and scrolling. Dialogs keep content-specific widths, including the specialised avatar preview. See Part 2 evidence for controlled acceptance and remaining device limits.

Agent sidebar action menus fade in on row hover for fine pointers (125ms opacity transition). Keyboard focus reveals actions immediately; touch, pinned indicators and an open menu remain visible. Reduced motion removes the fade. No row movement or keyboard-navigation animation is added.

## Select menus and composer configuration

Ordinary single-value dropdowns use the installed shadcn Base UI Select, with a shared 44px trigger and custom option popup. NativeSelect was retired. Empty values, defaults, disabled items and schema booleans retain their previous meaning. Model choice uses shared DropdownMenu radio groups and provider headings. Chat places compact model and enumerated effort/thinking controls in the composer footer; numeric reasoning budgets remain in agent Settings. See [model configuration](oa-335-model-configuration.md) for saved-agent scope and authority.

Model and effort menus omit routine scope/provider-verification disclaimers. Configuration scope and report semantics remain documented in the model help; current errors and recovery actions remain visible.

Chat model and effort controls use the official shadcn DropdownMenu/InputGroupButton composition, with provider groups and checked selections. Settings, creation and room routing now use the same grouped DropdownMenu model picker; the former searchable Cuelark-derived presentation is removed.

OA-408 corrects the composer against official Prompt Input: native InputGroup surface, padded textarea, circular InputGroupButton actions, right-aligned model/effort menus and Attachment chips in the top addon. The whole-app composition acceptance gate is reopened in the component audit; earlier source coverage is not reference fidelity.

OA-409 finishes the remaining native compositions across the desk: shadcn CodeBlock for code/evidence, Attachment for received files, Card for review/list/library/Work surfaces, native navigation/Button defaults, Popover for composer mentions and shared semantic badges. Legacy ancestor control skins and superseded CSS are retired. Specialist avatars/brand marks and remote viewer geometry remain scoped exceptions..

OA-420 gives Automations one Workspace breadcrumb and removes its duplicate Settings navigation entry. Proactive tabs and same-conversation panel sections have compatible additive URLs. These context changes retain editable children; actual destination/editor-identity changes still use the shared leave guard. Both shells expose Skip to content before navigation, focusing the main region without changing the route. See docs/notes/desk-part3c-ux.md.

## Profile

The Profile destination (`#/settings/profile`) edits the shared human display name/avatar. It uses the existing Settings section, Field, Input, Button and image crop dialog components. See [Profile behavior](profile.md) for access, persistence and limits.
