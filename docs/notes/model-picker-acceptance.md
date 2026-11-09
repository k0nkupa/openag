# OA-376 controlled acceptance

3 November 2026. Source and disposable local fixtures only. The installed service and real accounts were unchanged.

| Before | After | Why |
| --- | --- | --- |
| Select Adapter/provider, then Refresh model choices | Open the sheet and use one searchable picker grouped by source | Removes a technical setup step and the normal refresh action |
| Controls loaded through a separate refresh | Model selection reloads its supported reasoning controls | Keeps effort and numeric budgets valid for the selected model |
| Narrow fixed popup | Viewport-bounded popup and 44px trigger | Fits the 390px phone viewport without horizontal overflow |

## Browser evidence

Used the actual built desk and gateway with `scripts/bot-models-fixture.mjs` in its own temporary data directory. Hosted fetches and ACP protocol sessions were controlled; routing inference was explicitly refused.

- New-agent sheet automatically loaded Codex, Claude Code, configured hosted and Ollama groups. No Adapter/provider dropdown or Refresh model choices action remained.
- Created `Preloaded Agent` from the picker with Fixture B/high. In agent settings, changed its source to Claude Code/Fixture B/high and confirmed the saved source-specific effort field by UI readback.
- Search returned matching groups; an impossible search returned “No model found.”
- API agent settings selected Claude fixture from the same picker and saved thinking mode `enabled` plus numeric budget `2048`; UI reported Saved and the matching configuration.
- Room routing automatically loaded Anthropic/OpenAI/OpenRouter/Ollama groups after choosing Chat model. Selected OpenAI fixture/high, saved, and confirmed the success status. No routing model turn ran.
- Controlled hosted discovery outages left ACP choices usable. Unavailable-source details exposed errors and a read-only Try again action. Restoring the fixture and using Try again recovered groups.
- At 390 × 844, the popup stayed inside the viewport and the document had no horizontal overflow. Temporary viewport override was reset.
- A Limited device had disabled New bot and New agent actions; model configuration remained disabled and displayed the Full-access requirement. Gateway standalone checks also asserted owner/Full/Limited boundaries.
- On the initial Bots route with hidden settings sheets, fixture counters were zero adapter launches, zero provider requests, zero prompts, zero turns and zero Work items. Opening selection sheets caused discovery, not model prompts.

Screenshots: new-agent picker, grouped picker, phone picker, partial source failure.

## Commands

- `pnpm -r build`: passed (TypeScript, desk bundle, handbook packaging; relay deploy is dry-run only).
- `node --experimental-strip-types scripts/verify-bot-creation.mjs`: passed, including passive configured-source metadata, creation permissions/validation/idempotency and no conversation/turn execution.
- `node scripts/verify-bot-models.mjs`: passed controlled ACP/hosted/Ollama configuration and permission-gate flows.
- `node --import ./scripts/routing-fetch-fixture.mjs scripts/verify-routing-defaults.mjs`: passed intercepted SDK routing requests. An initial invocation omitted the required fixture preload and failed; the documented invocation passed.
- `node scripts/verify-bot-knowledge.mjs`: passed four packaged delivery integration groups, including API/Ollama/cached ACP/MCP and replacement default bot.
- Unit/Jest/Vitest runners were not run. Existing component fixtures were updated without executing them.

Standards and Spec reviews and final built-in `codex review --uncommitted` found no blocking defects. The first built-in review found a background-discovery/save race; saves now wait for catalogue loading to finish. Final TypeScript, browser save feedback and whitespace checks passed. No new dependency, deployment, live provider/model acceptance or production data change is claimed.
