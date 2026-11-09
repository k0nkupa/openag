# OpenAg UI foundation and registry selection

Checked 31 October 2026. This is the Tailwind/shadcn setup and registry selection requested by the owner, ahead of the older feature queue.

## Reviewed desk handover

The later UI review is captured in [docs/design/openag-desk](../design/openag-desk/README.md), with an isolated runnable reference, final design decisions and a migration checklist. Use that handover for OA-319–330; this note remains the record of the earlier foundation and registry research.

## Installed foundation

The desk uses Tailwind CSS 4.3.3 through the Vite plugin and shadcn 4.23.0, Base UI 1.9.0, base-nova, neutral colours, Lucide and locally bundled Geist Variable. React/Vite and the existing gateway remain the application stack.

- `apps/desk/components.json` owns the shadcn setup and the `@/components/ui` alias.
- `apps/desk/src/styles.css` remains the one global stylesheet. Its OpenAg colours feed the shadcn semantic variables and Tailwind's `@theme inline` roles.
- Dark mode continues to follow the operating system. The Tailwind `dark` variant follows that same media query.
- Existing desk styles are retained in the components layer so utilities can override them during screen migration. Native-control defaults exclude shadcn's `data-slot` controls.
- The old text-colour variable `--muted` became `--muted-foreground`; shadcn reserves `--muted` for a surface colour. Other OpenAg colours and avatars are retained.
- Official source components installed: Button, Input, Alert, Field, Label and Separator. Owner actions uses the new Button/Input/Field/Alert components. Its token checking and memory-only credential handling are unchanged.
- Default buttons and inputs are 44 px high. Buttons use explicit transition properties and disable transitions under reduced motion.

This is the working foundation for migrating the supplied OpenAg Desk.html boards. The other screens still use their existing markup/CSS; this setup does not mean all 15 boards have been implemented.

Add an official component from the repository root:

```sh
pnpm dlx shadcn@latest add @shadcn/dialog -c apps/desk
pnpm dlx shadcn@latest info --json -c apps/desk
```

Use the existing semantic tokens, `cn()`, built-in component variants and Base UI composition. Keep the supplied OpenAg design as the visual reference. Install community components individually, inspect their imports and dependencies, and map their callbacks to the existing APIs.

## Directory coverage

All **508** registry names and descriptions from the [official directory JSON](https://ui.shadcn.com/r/registries.json) were screened. The retrieved directory snapshot was cached by the retrieval provider on 30 October; it was read on 31 October. The [directory page](https://ui.shadcn.com/docs/directory) is the public entry point.

Ten publisher pages were read directly: AgentUI, Creance, SureUI, JSON View, tablecn, coss, Tool UI, AI Elements, prompt-kit and assistant-ui. Six concrete items were inspected through `shadcn view`: AgentUI approval-card, Creance approval-prompt, SureUI tool-approval, JSON View json-view, tablecn data-table and Tool UI approval-card.

The [complete 508-entry screening](ui-registry-screening.json) records each description, URL, disposition and reason. This is directory-level screening plus focused source/dependency inspection, not an exhaustive code, accessibility, licence or installation audit of 508 projects. No third-party registry component was installed.

## Recommendation

Start with the current official shadcn chat primitives and AI patterns for conversation, tool activity and attachment presentation. The [old AI Elements site](https://elements.ai-sdk.dev/) says it is moving to shadcn/ui and will be deprecated at the end of November 2026. The [current migration guide](https://ui.shadcn.com/docs/ai-elements) recommends official shadcn components for new projects.

Use community registries only where a particular component saves work:

| Registry | Where it fits OpenAg | Recommendation and limits |
| --- | --- | --- |
| [SureUI](https://sureui.com/) | Confirming device revocation, computer destruction and other consequential owner actions | Strong Base UI match. Use a confirmation gesture appropriate to the action. Its inspected tool-approval takes an approval-response callback; adapt to OpenAg's API rather than introducing AI SDK state. An undo animation cannot undo an external send. Publisher states MIT. |
| [JSON View](https://json-view-cn.vercel.app/) | Expanding redacted tool arguments, results and ledger payloads | Best small specialist addition. Inspected item has one source file, Lucide, Button and Tooltip dependencies, and identifies Base UI support. Preserve redaction and the existing payload caps. Licence terms still need checking before adoption. |
| [Tool UI](https://www.tool-ui.com/) | Structured tool results and compact action-review surfaces | Good source-level candidate. Homepage currently redirects to assistant-ui Elements, while the namespace still resolves. Inspected approval-card has 11 source files, Lucide/Zod and Button/Separator dependencies, with portability adapters and no Next imports. Its binary approval UI does not replace OpenAg's Accept/Edit/Respond/Ignore flow by itself. |
| [AgentUI](https://www.agentui.pro/) | Agent activity, reasoning/tool traces, composer and multi-step review | Strong product fit. The inspected approval-card has controlled callbacks and no Next imports, but brings Motion, clsx, tailwind-merge, Lucide and 16 files, including its own motion controls. Borrow a focused pattern; reduce repeated motion and avoid importing a full chat app. Licence terms still need checking. |
| [coss ui](https://coss.com/ui) | Settings controls, connector selection and application-layout patterns | Compatible Base UI vocabulary and a restrained product focus. Use as a supplement/reference where the official components do not cover a need; do not replace the foundation with a second set of equivalent primitives. Individual dependencies and licence remain item-specific checks. |
| [tablecn](https://table-cn.vercel.app/) | A larger Ledger with filtering, sorting and row detail; richer automation lists later | Supports Base UI. The inspected data-table has 43 source files plus TanStack Table/Virtual, QueryCN and dnd-kit dependencies. No Next imports were found in that item, but its URL adapter must fit OpenAg's hash routes. Start with the official Table for small lists; add this only when the filtering work warrants it. Licence still needs checking. |
| [Creance](https://creance.pages.dev/) | Needs-you Inbox, run timelines, diff review and handback/control states | Best supervision-design reference. Publisher states MIT and documents Vite support. It has its own CSS/theme and uses Radix for some overlays, so importing the whole kit would create another design layer. The inspected approval-prompt has two direct files plus six registry dependencies. Do not expose an always-allow action for OpenAg's locked tool classes. |

These are recommendations for later screen work, not approvals to install all seven. Selection is based on component fit and integration cost, not on decorative effects or directory health scores.

## Alternatives and exclusions

- [assistant-ui](https://www.assistant-ui.com/) supports custom backends and Mastra, but adds a frontend runtime that owns thread/stream/tool state. It is a larger architectural choice than OpenAg needs for this setup.
- [prompt-kit](https://www.prompt-kit.com/) is a useful chat reference, but the current official shadcn chat components are the first choice.
- [data-table-filters](https://data-table.openstatus.dev/) is another Ledger reference; its complete server/Drizzle examples should not replace the existing Hono/SQLite API.
- Basecn duplicates the chosen foundation. Kibo and the other agent registries remain specialist alternatives recorded in the inventory.
- Marketing effects, glass/retro themes, commerce/auth providers, media/3D kits and non-React platforms were not selected for the current desk.

## Verification

- `pnpm -r build`: passed for daemon and desk (TypeScript, migration copy and Vite production build).
- Browser: existing login rendered after enabling Tailwind; the migrated Owner actions form rendered in a temporary local preview at 390×844 dark and 1440×900 light. Both had no horizontal overflow. Button and Input measured 44 px on desktop. Keyboard Tab reached Input then Button, with a visible focus ring. Reduced-motion emulation produced `transition-property: none`.
- The temporary preview used no owner token and submitted no authentication request. Its initial import issue was corrected before the checks above; the temporary page is removed after checking.
- Unit tests were not run, as required by the owner's instruction. No installed service or live data was changed. Credential submission, all authenticated screens and complete design-board parity remain outside this setup verification.
