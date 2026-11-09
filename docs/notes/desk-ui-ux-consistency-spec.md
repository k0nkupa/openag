# OpenAg desk UI and UX improvements

Status: specification prepared on 3 November 2026. Verification approach confirmed by the owner. Part 1 is implemented under OA-397; see its ticket Log for acceptance evidence. Part 2 is implemented and verified through OA-398–OA-402 for source and controlled/disposable coverage. Part 3A (Work, approvals and receipts) is implemented under OA-410–OA-412 with controlled acceptance recorded in each ticket and evidence directory. Part 3B integration discovery/setup/management is delivered locally through OA-413–OA-416. Part 3C is delivered locally through OA-417–OA-420: scheduling, proactive settings, secondary model diagnostics and restorable navigation; see docs/notes/desk-part3c-ux.md and each ticket’s evidence. Tracker publication and the `ready-for-agent` label are pending project tracker setup. This specification does not change ticket completion status or authorize deployment, provider actions, access changes or destructive operations.

## Problem Statement

The owner wants OpenAg to feel like one coherent application. Borrowed components currently retain different visual treatments; the model and effort selectors are a visible example. Several screens also make ordinary tasks harder through missing mobile navigation, unformatted replies, technical details ahead of useful information and unclear recovery actions.

The review covered the running desk in dark mode at desktop and 390 px phone width, plus related source. It found a concrete mobile navigation omission, raw Markdown in replies, mismatched form controls and an observed computer state showing Unknown/missing with Destroy as its only lifecycle action. Other findings are improvements or source-level risks, rather than proven runtime failures. In particular, loss of unsaved memory edits needs controlled reproduction before implementation.

## Solution

Retain native shadcn Base UI styling throughout the desk. Borrow behaviour and composition where useful, but render controls through OpenAg's shared components, semantic colours, typography, spacing and interaction states.

Deliver the work in three ordered parts:

| Part | Outcome | Depends on |
| --- | --- | --- |
| 1. Restore usability | Reach all primary destinations on phones, read formatted replies, understand computer recovery and retain unsaved edits | None within this specification |
| 2. Unify the interface | Audit and migrate every applicable visible component to the native shadcn system, reconcile existing uses, and document specialised exceptions | Part 1 accepted |
| 3. Simplify workflows | Faster Work review, understandable approvals and integration setup, clearer scheduling and navigation | Part 2 accepted |

Each part must be independently reviewable and retain the previous part's accepted behaviour. These are delivery boundaries, not a requirement for exactly three implementation tickets or commits. Future implementation tickets must follow the project's dependency, acceptance, log and commit rules.

## User Stories

### Part 1: Restore usability

1. As an owner using a phone, I want all primary destinations in navigation, so that I can reach Computer, Automations and App library without knowing their addresses.
2. As an owner switching devices, I want the same destination names and purposes, so that I do not have to relearn navigation.
3. As a conversation participant, I want readable paragraphs, headings, lists and emphasis, so that I can understand an agent's reply without interpreting Markdown.
4. As a conversation participant, I want usable links and readable code blocks, so that I can follow sources and inspect technical answers.
5. As an owner, I want untrusted message content rendered safely, so that formatting cannot execute scripts or unsafe navigation.
6. As an owner reviewing a long reply, I want formatting to preserve stream-follow and scroll position, so that incoming text does not disrupt reading.
7. As an owner opening Computer, I want a clear explanation of absent, stopped, running and unknown states, so that I know what is available.
8. As an owner facing an unknown computer state, I want a safe status check and a specific next step, so that I am not pushed toward destruction as the only recovery action.
9. As an owner editing memory or settings, I want unsaved changes preserved or an explicit leave warning, so that navigation does not silently discard my work.
10. As an owner saving an edit, I want a clear success, failure or uncertain result, so that I do not accidentally repeat an operation.

### Part 2: Unify the interface

11. As an owner configuring an agent, I want model and effort selectors to have matching control styling, so that the form feels consistent.
12. As an owner choosing among many models, I want to retain model search and provider grouping, so that visual consistency does not reduce usefulness.
13. As an owner moving between screens, I want consistent field heights, borders, backgrounds, padding, chevrons and focus states, so that controls are predictable.
14. As a keyboard user, I want borrowed controls to retain the shared component's keyboard and focus behaviour, so that every form remains operable.
15. As an owner opening details on a desktop, I want bounded panels that preserve useful context, so that a small setting does not unnecessarily replace the entire workspace.
16. As an owner opening details on a phone, I want a usable full-screen detail view with clear Back and Close actions, so that controls fit the available space.
17. As an owner reading status badges, I want affirmative, pending and failed states to have consistent meanings, so that colour does not contradict the label.
18. As an owner using light, dark or system appearance, I want all controls and overlays to follow the effective theme, so that borrowed elements do not look unrelated.
19. As an owner changing a setting, I want consistent saving, saved, failed and uncertain feedback, so that I know whether further action is needed.
20. As an owner who requests reduced motion, I want nonessential animation reduced or disabled, so that the desk respects my preference.
21. As an owner, I want every screen, dialog and advanced view to use the same native shadcn control system, so that consistency extends beyond the most visible pages.
22. As an owner, I want borrowed elements to adopt native shadcn styling and interaction states, so that their source does not create a different visual language.
23. As an owner, I want specialised custom elements retained only with a clear reason and shared surrounding controls, so that consistency preserves useful product behaviour.

### Part 3: Simplify workflows

24. As an owner reviewing Work, I want compact summaries of the request, owning agent, state, next step and updated time, so that I can scan several items quickly.
25. As an owner inspecting Work, I want execution counts, identifiers, history and saved results available in detail, so that compact summaries do not hide evidence.
26. As an owner reading a completed Work item, I want its reported result distinguished from external effect confirmation, so that completion does not imply an unverified action succeeded.
27. As an owner reviewing an approval, I want the proposed action and its target explained first, so that I can understand the decision before inspecting technical details.
28. As an owner approving an action, I want the exact reviewed proposal and supported edits available before acceptance, so that a summary cannot conceal what will run.
29. As an owner answering an integration's server interaction, I want it distinguished from tool approval and a Work question, so that my response grants no unintended authority.
30. As an owner facing an unknown action outcome, I want the related evidence and permitted inspection route made clear, so that I do not repeat an uncertain action.
31. As an owner browsing App library, I want discovery and setup clearly distinguished from management of installed connections, so that each destination has a useful purpose.
32. As an owner facing an integration failure, I want a readable cause and concrete next step, so that I can act without understanding internal recipe or transport terminology.
33. As an operator maintaining integrations, I want reload and reconnect controls available in an advanced area, so that maintenance remains possible without dominating ordinary setup.
34. As an owner configuring an agent, I want the selected model and effort shown first, so that stale runtime reports do not obscure my current choices.
35. As an owner investigating model behaviour, I want requested, saved and reported settings available separately, so that the interface does not claim runtime confirmation without evidence.
36. As an owner creating an automation, I want its effective time zone and next scheduled run shown before saving, so that I can predict when it will run.
37. As an owner configuring automated output, I want room posts and filtered notifications explained plainly, so that I know where results will appear.
38. As an owner configuring proactive behaviour, I want checking frequency, quiet hours, notification limits and the brief grouped around my choices, so that internal scheduler language is unnecessary.
39. As an owner returning to a request or settings tab, I want a stable link and sensible Back behaviour, so that refresh and navigation preserve context.
40. As a keyboard user, I want a skip-to-content link and predictable focus after opening or closing details, so that I can avoid repeated navigation.
41. As an owner asking the default bot for help, I want its delivered guidance to match the changed screens and limitations, so that instructions work on my existing installation.

## Implementation Decisions

### Shared constraints

- Keep React, Vite, Tailwind and the existing shadcn Base UI/base-nova foundation. Use existing component variants and semantic tokens before adding styling or dependencies.
- Reuse the daemon-owned API, hooks, hash routes and shared event stream. Preserve authentication, device access, WebRTC path restrictions, policy gates, redaction and durable evidence. Do not introduce browser-owned business state or a second application stream.
- Follow the existing desk design contract and accepted domain decisions. Ordinary conversation, investigation, responsibility and explicit Work remain separate. UI changes must not create Work automatically.
- Treat integration consent, server interaction responses, action approvals, invocation completion and effect confirmation as distinct. A clearer presentation changes neither authority nor historical outcomes.
- No schema or API changes are approved in advance. Reuse current contracts; document a concrete gap before proposing a narrow addition. Do not manufacture status or scheduling evidence in the browser.
- Update the authoritative product/help topics and delivered bot knowledge in each implementation part. Check delivery to configured default agents and existing installations. Do not add internal details to ordinary screens merely to document them.

### Part 1 decisions and acceptance

- Preserve primary navigation destinations at narrow widths. Navigation alone must not start a model turn, provider request, computer lifecycle operation or maintenance action.
- Render message Markdown through a safe presentation layer. Support paragraphs, emphasis, headings, lists, links and code. Raw HTML must not execute; reject unsafe URL schemes. Bound wide code or tables without causing page overflow.
- Preserve authenticated attachments, tool activity, approvals, saved-result links, message ordering, streaming updates and jump-to-latest behaviour. Formatting must not reinterpret data as instructions or effects.
- Trace computer status from backend reporting to available actions before changing the observed Unknown/missing case. Distinguish absence from an existing but unrecognised resource. Provide an explicit passive refresh and a truthful next step; never start, recreate, switch or destroy a resource automatically.
- Apply a consistent unsaved-edit rule to memory and editable settings. Reuse existing draft handling and leave protection where possible. Keep failed or uncertain saves available for inspection; never silently reset a draft or retry an uncertain write.
- Acceptance: browser walkthrough at desktop and phone widths reaches all primary destinations; representative streamed replies format safely; controlled absent/stopped/running/unknown computer cases show appropriate actions; edited drafts survive supported navigation or receive an explicit leave choice. Confirm existing chats, identities and saved data remain intact.

### Part 2 decisions and acceptance

- Cover the entire shipped desk, not only touched pages. Use the component consistency audit as the exhaustive migration checklist. It inventories 104 production TSX modules, including 33 shared UI modules; recheck and extend that inventory as implementation changes it. Reachable Login, Ledger, integration forms, contextual panels and classic compatibility views are included.
- Use native shadcn components wherever an appropriate equivalent exists, and reconcile already-native callers as well as migrating legacy ones. Preserve the current Base UI preset. Borrowed components may retain useful composition or behaviour, but not a competing control skin. No bulk registry install or blind shared-component overwrite.
- Account for every source module as migrated, reconciled or retained with a documented specialised reason and verification evidence. Custom avatars, graphics, hidden file inputs, semantic HTML and specialised interactions may remain where appropriate; they are not permission to keep independent button, field, badge or overlay styles.
- Standardise shared controls at the component level, including height, padding, text, borders, background, chevrons, disabled/loading/error states and focus. Preserve 44 px phone targets and explicit compact desktop variants.
- Keep searchable model selection and provider grouping. Provider marks may remain as metadata but must not introduce a separate control skin. Apply the shared treatment to agent creation, agent settings and room routing.
- Define consistent bounded desktop sheets and full-width phone detail views using existing Sheet/Dialog primitives. Preserve contextual inspectors on wide screens, accessible titles, independent scrolling and focus return. Keep primary actions visible or readily reachable without obscuring content.
- Use semantic Badge variants: success for affirmative states, attention for pending/unchecked/setup states, destructive for failures or denials, outline/secondary for neutral metadata. Audit every reachable state rather than only the current screenshot.
- Align page/section headings, descriptions, spacing and save feedback with the existing design contract. Consolidate conflicting per-screen overrides as affected screens adopt shared components; avoid unrelated stylesheet cleanup.
- Acceptance: complete every migration inventory row and account for remaining raw interactive elements and custom status/control styling. Inspect all UI families and every affected screen/overlay in light, dark and system themes at phone, intermediate and wide desktop widths; compare model/effort controls in every caller; verify every reachable status mapping and keyboard interaction; verify reduced-motion behaviour. Shared components alone are not evidence that their callers are consistent. Recheck all Part 1 journeys.

### Approved Part 2 navigation addition (4 November 2026)

The owner selected in-desk shadcn discard and pending-operation dialogs. `confirmLeave` is asynchronous and every caller waits for it. One pending intent restores the accepted URL before the choice; Keep editing, Escape, Close and outside dismissal preserve the mounted draft. Discard changes performs the captured navigation once. Agent selection is guarded before creating a direct chat, and edits during a delayed lookup require a fresh choice. Busy operations offer acknowledgement only and never navigate automatically on completion. Session replacement/unmount cancels pending prompts. Browser reload/tab-close warnings remain browser-owned.

Part 2 is delivered in five sequential source tickets/commits: shared controls, navigation/overlays, operational forms, conversation/evidence/navigation surfaces, then coverage/cleanup/review. The current source inventory and exception gate are recorded in the component audit; no daemon API/schema/policy change is included.

### Part 3 decisions and acceptance

- Prefer compact desktop Work rows, with readable phone summaries. Lead with request, owner, state, next step and recency. Retain detailed timestamps, identifiers, tool outcomes, history and saved-result provenance in the detail view. Do not rename a historical outcome to make it appear successful.
- Present action intent and target before technical payload. The exact reviewed proposal remains inspectable before acceptance, including required diffs and supported edits. Preserve the established Accept/Edit/Respond/Ignore decision meanings. Keep action receipts and unknown-outcome inspection visible.
- Retain App library for discovery/add/setup and Connectors for already-added integration management, as required by the current design contract. Clarify navigation and cross-links rather than combining their state or creating competing catalogues. Give Automations one consistent page identity and breadcrumb context.
- Put integration reload/reconnect actions in an advanced maintenance area. Display readable failures and specific next steps while retaining detailed diagnostic reasons. Do not automatically reload, reconnect, change access or provision anything in response to a passive page read.
- Keep selected model and reasoning controls prominent. Put saved/requested/reported settings and stale session evidence in an expandable diagnostic section. Preserve accurate distinctions and access to evidence.
- Show the effective automation time zone and a trustworthy next-run preview before creation. Reuse existing scheduling validation and runtime evidence. If a preview needs a new read-only contract, propose that narrow contract before implementing it. Distinguish event triggers and disabled schedules from a known scheduled next run.
- Use Agent consistently in ordinary UI, retaining Default bot where it names the defined installation fallback. Explain proactive controls through checking frequency, quiet hours, repeat-notification suppression, notification limits and the brief; retain authoritative technical explanations in help.
- Make important tabs and selected request/detail state restorable through the existing route system where appropriate. Preserve old links, browser Back and draft protection. Add skip-to-content and verify accessible names and focus throughout the affected journeys.
- Acceptance: an owner can scan Work, review an exact action, distinguish a server interaction, inspect an uncertain result, understand an integration failure and predict an automation schedule through the desk. Verify compatible old links, Back/refresh behaviour, preserved drafts and accurate delivered help. Recheck Parts 1 and 2.

## Testing Decisions

- The owner confirmed the primary verification seam: browser journeys through the existing desk connected to an isolated real daemon, with disposable data for saves, approvals and recovery. Prefer this seam over new component-specific harnesses.
- Check external behaviour: visible results, reachable actions, persisted readback, accessible interaction and durable server evidence. Avoid assertions tied to component internals, DOM snapshots or exact utility classes.
- Never run unit tests or Jest, directly or through scripts/hooks. Existing component tests are prior art for edge cases only; their existence or inspection is not verification. Do not use the workspace test command as an acceptance gate.
- Existing browser/design verification and real-daemon flows provide prior art for device access, room conversations, Work, approvals, receipts, model selection, integration inventory and automation scheduling. Reuse their real API boundaries and existing fixtures where suitable.
- Use controlled daemon responses for hard-to-reach visual states. Keep those checks explicitly labelled controlled; they do not prove live provider access, adapter behaviour or production recovery.
- For Part 1, cover narrow navigation, streamed Markdown, malicious links/HTML, long content, scroll position, computer states, drafts, successful saves and uncertain saves.
- For Part 2, cover every control state and semantic badge mapping, overlay sizes, focus entry/return, Escape behaviour, light/dark/system themes, reduced motion and touch targets.
- For Part 2, re-run the component inventory and compare remaining raw controls and custom visual treatments against the exception register. Verify schema-generated multiple-choice forms and unset/false values, acknowledgements, mentions, file pickers and compatibility views; migration must preserve their interaction and access contracts.
- For Part 3, cover dense Work lists, empty/loading/error states, exact action review, questions versus server interactions, unknown outcomes, integration setup explanations, model diagnostics, time zones, next-run preview, deep links and Back/refresh.
- Exercise Full and Limited device views on the isolated daemon. UI visibility must not become access authority. Do not change the owner's live devices, connections, approvals or computer for acceptance.
- Inspect build scripts before running the appropriate workspace builds to ensure they do not invoke prohibited tests. Run the bot-knowledge delivery verifier for changed help. For search, computer or notification capability changes, also run the capability verifier and inspect the corresponding authoritative guidance.
- Record desktop and phone browser coverage separately from real-device coverage. Real phone keyboard, safe-area and touch checks remain a separate acceptance item until actually exercised. Record screen-reader and light-mode checks explicitly rather than inferring them from source.
- A part is accepted only when its stated journeys, applicable build and knowledge checks pass and blocking defects are resolved. Report skipped gates and remaining limitations. Part 1 implementation verification is recorded under OA-397; Part 2 controlled/source acceptance is recorded through OA-409. Part 3A controlled acceptance is recorded under OA-410–OA-412; the remaining Part 3 milestones remain planned.

## Out of Scope

- Replacing the dashboard with Cuelark, changing the shadcn primitive library, introducing a second theme system or installing a complete component registry.
- Migrating Mastra/ACP to AI SDK Core, AI SDK UI transports or experimental HarnessAgent adapters. Evaluate those separately against a concrete runtime problem.
- Replacing daemon persistence, rewriting event transport, creating a generic connector framework or adding speculative schema/configuration.
- New model providers, integration capabilities, account connections, credentials, approval modes or permission expansion.
- Automatic recovery/replay of uncertain actions; live provider writes; computer destruction/recreation; installation changes, merge or deployment.
- Unrelated backend correctness fixes. If verification exposes one, record it with evidence and its dependency on the UI outcome; do not conceal it with presentation changes.
- A claim of exhaustive accessibility, performance or production acceptance from the earlier walkthrough.

## Further Notes

- The three-part order comes from the owner's UI review request. The owner explicitly wants borrowed elements to retain native shadcn styling.
- The existing design contract already distinguishes App library from Connectors and permits a settings sub-navigation. The work should reduce duplication and confusion within that contract, not silently replace it.
- Read the current glossary, accepted architecture decisions and desk design contract before implementation. Recheck source and installed behaviour because this specification describes a point-in-time review.
- The [accompanying component audit](desk-component-consistency-audit.md) contains the complete source inventory, concrete migration gaps, proposed native replacements and exception criteria. It is implementation evidence to reconcile, not a claim that those changes have been made.
- Tracker configuration and triage vocabulary are absent. Run `/setup-matt-pocock-skills` before publishing this specification and applying `ready-for-agent`; a GitHub remote alone does not select the project's issue tracker.
- This document is a planning artifact. It changes no shipped behaviour and therefore makes no new default-bot knowledge-delivery claim. Each implementation part owns the corresponding help and delivery verification.
