# Shared integration details (OA-387)

3 November 2026. Local source and disposable preview only.

AppLibraryPage delegates every selected entry to IntegrationDetails. The shared renderer owns the fixed brand/name/machine/status header, Overview and Tools tabs, optional Local setup tab, scrolling content and approval footer. Provider components own their existing API/action flows. Ready inventory cards omit the redundant reason line. Header status treats failed and needs-access states before a stale read-verification timestamp.

Composio has icon Connect/Reconnect and destructive-outline Disconnect, without a repeated connection heading or static Connected line. Privacy appears once on Overview. Google uses the same action labels/icons and destructive-outline variant, retaining its explicit Gmail-and-Drive disconnect confirmation. Selected local App/MCP panels omit directory/configuration introductions already covered by metadata/setup. Their reload actions, unavailable-tool reasons, enable review, hash guards and confirmation flows remain. Tools retain exact names/classes and expand their untrusted descriptions. Local setup and provider Overview remain mounted across tabs.

Verification:

- `pnpm -r build`: passed, including relay dry-run and handbook packaging.
- Final `pnpm --filter desk build`: passed after all source changes.
- `node scripts/verify-bot-knowledge.mjs`: PASS four controlled integration groups, including packaged help and replacement-default-bot delivery.
- `node scripts/verify-composio-desk.mjs`: passed. Real components with controlled transports: Full-only connect, invalid URL refusal, transient status retry, abort/cancel/deadline, callback cleanup and StrictMode single exchange. Shared dialog checks one header status, icon controls, destructive outline, optional setup tab, collapsed tool descriptions, expansion and retained confirmation across tab changes. Header state matrix covers connected, needs-access, failed with stale verification, and paused. Google confirmation cancellation makes no write; final confirmation makes one controlled disconnect call.
- `node --check` for preview-apple-access.mjs and verify-composio-desk.mjs, plus `git diff --check`: passed.
- Actual Chrome with disposable synthetic state: Composio Overview/actions, Tools list, scrolling to all twelve tools with fixed header/footer, generic MCP Overview without repeated config prose, and Apple Overview with preserved permission badges/Local setup tab. Screenshots: overview.png, tools.png, generic.png, apple.png. The preview was stopped after inspection.

Updated authoritative docs/composio.md and docs/notes/read-connectors.md, plus delivered computer-connectors help (both notes are already listed in the help manifest). Packaging and delivery verified above. Existing installations receive this explanation with the normal release.

No unit/Jest/Vitest runner, live provider consent/disconnect, physical-phone acceptance, merge or deployment. A synthetic preview does not establish live integration acceptance. No daemon source or approval policy change.
