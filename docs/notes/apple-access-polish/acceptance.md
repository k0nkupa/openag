# Apple access panel (OA-385)

3 November 2026. Local source and disposable preview only.

The Apple apps dialog uses installed shadcn Base UI Dialog, Tabs, Collapsible, Badge, Button and Skeleton components. The header and approval reminder stay fixed; the selected task scrolls. App access keeps runtime state visible and separates granted macOS permission from verified reads. Expand an app row for its requirements and actions. Connection details retains diagnostics, tools and reload; Local setup retains the existing explicit review/rollback flow.

Verified:

- `pnpm install --frozen-lockfile`: passed, unchanged lockfile.
- `pnpm -r build`: passed, including relay dry-run and packaged handbook.
- `pnpm --filter desk build`: passed after final source edit.
- `node scripts/verify-bot-knowledge.mjs`: PASS 4 integration groups, including packaged help delivery to API/Ollama/cached ACP, replacement default bot and custom instructions; controlled transports only.
- `node --check scripts/preview-apple-access.mjs` and `git diff --check`: passed.
- Actual Chrome, `node scripts/preview-apple-access.mjs`: seven rows; failed runtime displayed beside granted app permissions; expanded Mail read check disabled when disconnected; request-permission click reached only the synthetic Mail endpoint. After synthetic connection, Check read access reached only the synthetic Mail verify endpoint and produced Read verified plus timestamp. All three tabs inspected; row and notice survived tab changes. Setup remained an explicit review action. Desktop and approximately 502 CSS-pixel narrow desktop layout inspected, with fixed header/footer and no visible horizontal clipping. Screenshots: desktop.png, expanded.png, narrow.png.

Knowledge updated: docs/help/computer-connectors.md and authoritative docs/notes/read-connectors.md (already included by the help manifest). Packaged delivery verified above. Existing running installs need the normal release before they receive this update.

No unit/Jest/Vitest runners, live app reads, permission prompts, provider changes or deployment. No real-phone acceptance. Chrome responsive emulation was not reliable during native input, so it is not counted as phone validation. Browser console showed extension-origin warnings; these are outside this change. The existing setup-recipe failure in the supplied screenshot is preserved, not repaired by a UI redesign.

## OA-386 logo and badge correction

The Apple apps card/header/details use the local Apple brand mark through BrandLogo (Iconify Logos 1.2.18, same CC0 collection already bundled). Permission rows show Granted/success, Not checked and Needs setup/attention, Not granted and Check failed/destructive; Read verified remains success. AGENTS.md and CLAUDE.md now give the same semantic badge rule and require checking reachable states.

`pnpm --filter desk build`, `node scripts/build-knowledge.mjs`, `node scripts/verify-bot-knowledge.mjs` (four integration groups), and `git diff --check` passed. Actual Chrome inspected a synthetic mix of granted, denied, failed and unknown permissions; badge-states.png records the logo and all requested colours. The preview fixture now includes denied/failed states. No unit runner, live permission change or deployment. Help and authoritative read-connectors documentation updated and packaged.
