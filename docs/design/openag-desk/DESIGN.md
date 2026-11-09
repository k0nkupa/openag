# Desk design contract

Reference: [runnable source](reference/src), [capture set](screenshots). Implementation status is in [ROADMAP.md](../../../ROADMAP.md), not this visual contract.

## Foundation

Use React 19 + Vite 8 + Tailwind 4 + shadcn **Base UI / base-nova**, neutral semantic colours, Lucide and locally bundled Geist. Production already has this foundation; this is a screen/component migration, not another framework setup. `apps/desk/components.json` owns component generation and aliases. `apps/desk/src/styles.css` remains the one production global stylesheet.

Keep business data in the existing API/hooks/stream boundary. Presentational components may follow the reference; its monolithic app and in-memory contexts are not the target module structure. Prefer existing component variants and semantic tokens over per-screen overrides. Community registries remain item-by-item choices, not an instruction to install all shortlisted packages.

## Native composition acceptance

The installed shadcn Base UI/base-nova parts own ordinary control, menu, dialog, card, table, attachment, code and navigation styling. Match official compositions, not only component names. Feature classes supply layout and readable content bounds; they must not add a second control skin or ancestor sizing repairs. Explicit 44px ordinary/phone targets and compact desktop variants remain intentional shared defaults. Preserve specialist avatars, bundled brand art, semantic document content and remote-viewer geometry; record each retained exception and check its surrounding native controls. The old reference is a product/layout guide, not authority to retain a competing skin.

## Tokens and control sizes

Production `apps/desk/src/styles.css` uses the official shadcn neutral light/dark tokens, with semantic status extensions. The older [reference/src/styles.css](reference/src/styles.css) documents role names and layout history; its surface colours and focus ring are superseded. Retain aliases only where they point to the same shared roles. Do not load the reference stylesheet globally beside the old stylesheet: both define common classes such as `.status`, `.list-row`, `.topbar` and `.page-heading`.

| Role | Reviewed value / rule |
| --- | --- |
| Primary labels, navigation, breadcrumbs, actions | `--text-body: 14px` |
| Descriptions, agent status, help and row details | `--text-secondary: 13px` |
| Compact metadata, timestamps, counts, picker labels | `--text-meta: 12px`; no mobile reduction below it |
| Headings | Keep the reference hierarchy, usually 16px section / 18px detail / 24–25px page; not a global font-size multiplier |
| Body font | Geist Variable; Geist Mono Variable for code and compact identifiers |
| Colours | `background/foreground`, `card`, `popover`, `muted/muted-foreground`, `primary`, `secondary`, `border/input/ring`, plus semantic attention/online/info/destructive roles |
| Radius | 12px base, with the existing shadcn radius scale |
| Layout | 232px desktop primary sidebar; settings sub-nav about 193px; content scrolls independently |
| Touch targets | Keep production's 44px default controls; desktop compact actions may use the reviewed `sm` variant, with 44px minimum targets on phones |
| Small action text | 14px; `xs` remains a deliberate compact 12px case, not the default action style |

### Theme reconciliation

Production currently follows system colour scheme with a media-query `dark` variant. The reference uses a `data-theme` attribute and an explicit toggle, defaulting its demo to dark. Preserve production's system default; an explicit user theme choice may override it. Resolve the effective theme once so semantic variables, `dark:` utilities, syntax highlighting and monochrome logos agree. Do not copy only one of the two theme mechanisms. No second theming library is needed for this decision.

### Compatibility aliases

| Existing production vocabulary | Semantic destination |
| --- | --- |
| `ground`, `bg` | `background` |
| `ink`, `fg` | `foreground` |
| `line` | `border` |
| `surface-1` / `card` | `card` |
| `surface-2` | `secondary` / muted surface |
| `mute` | `muted-foreground` (not `muted`, which is a surface) |
| `needs-you`, `warn` | attention text/surface/border |
| `driving`, `focus` | info / focus-ring roles |
| `danger` | `destructive` |

## Accepted composition and navigation

- Compact OpenAg wordmark. Align its icon with navigation/agent icons and its text with navigation labels; avoid double horizontal padding from both SidebarGroup and SidebarMenuButton.
- Keep machine/network details in Server & devices. No sidebar slogan, profile down-arrow, header Needs you duplicate, Preview badge, prototype branding footer or repeated simulation notices in the integrated product.
- Needs you has one shared count. Work and App library are primary destinations. Settings -> Connectors manages already-added connections; App library is discovery/add/setup.
- Distinguish a one-bot conversation from a group room. Show the bot's identity/settings and work context; no unrelated room member list or group-room settings.
- Use access badges for Full/Limited devices. Keep navigation, context and important controls readable at phone widths; a horizontally scrollable Settings sub-nav is acceptable.
- Layout A is conversation-first. Work / Files / Computer / Activity form the contextual inspector on wide screens; phones open equivalent detail sheets. The computer view follows actual backend capabilities and human-control state.
- Search uses the existing hash-route vocabulary and Cmd/Ctrl K. Menus, dialogs, sheets and tabs keep Base UI keyboard/focus behavior.

## Workflow behavior shown by the design

| Surface | Required meaning |
| --- | --- |
| Work card/detail | Owning bot, request, explicit plan/progress, next action/blocker, status and durable results |
| Saved files/results | Draft versus saved, provenance, version and authenticated preview/download |
| Exact action review | Named target/service/files and the actual proposed draft/diff/payload, with evidence and Accept/Edit/Respond/Ignore |
| Receipt | Decision and execution are separate. Approval is not a completed send. Unknown outcomes require inspection/reconciliation before retry |
| Needs you | All, Approvals, Questions, Recovery, Decided; deduplicated counts; answers do not grant tool permission |
| Automation | Purpose, owner, trigger, real next run, last outcome, pause and durable quiet/completed/failed/interrupted history |
| App library | Destination machine, source/version, requirements, tool access, setup and actual readiness; code access is distinct from bot approval modes |

## Avatars and brand assets

Avatars use original soft silhouettes, solid colours and dark eyes. The **whole body** sways, squashes and turns; changing only the eyes does not meet the reviewed behavior. Idle is restrained; thinking/happy are more expressive. Eyes may follow the pointer in the editor only. Preserve CSS `transform-style: preserve-3d` through the avatar wrappers: flattening a parent removes the visible volume. The reference uses depth slices only in the large editor, one SVG at small sizes, and compositor transforms for body motion.

Keep shape/colour selection, automatic colour, shuffle, reset, save/cancel, pointer/keyboard turning and a motion preference. System reduced motion wins and stops body/eye motion. Derive activity from real lifecycle state. Persist appearance through the daemon, not fixture state. Retain existing avatar IDs and permissions; the prototype's colour names are not a drop-in API schema. AI generation, upload/import, sound and export are not part of this pass.

Brand SVGs are in [reference/public/brands](reference/public/brands), with [source/version/licence details](reference/public/brands/SOURCES.md). Use the same identity in library cards, app detail, installed connections and Models. Neutral local utilities keep function icons. Monochrome marks adapt to theme; multicolour marks retain their colours. Bundle assets locally; no runtime logo CDN.

Typesafe owns Jev; OpenAI supplies its decision offering. The current router reaches both through OpenRouter. Show model provider, shared transport and actual readiness separately. An installed CLI adapter is not proof of a signed-in CLI; a chat API key is not proof that a decision route works.

## Known implementation traps

- Base UI Switch renders a span. A generic direct-child-span flex/min-width rule must exclude `[data-slot="switch"]`, as well as badges/icons/status. Tracks stay 32px (24px small), rather than stretching across a row.
- Don't bake fixture IDs (`direct-coder`, `supplier`, `a1`), names, model labels, timestamps or status text into production state.
- Source-level typography changes are preferable to piling more one-off overrides on old 7–11px declarations. Preserve reading sizes across responsive breakpoints.
- Keep simulated completion/unknown/run buttons and fake account/folder forms inside this reference. Production actions require the corresponding server capability and an honest unavailable state.
