# Provider and routing configuration

## Revised scope (2 November 2026)

The owner expanded the plan to all providers in the installed Mastra catalogue, with compatible provider choices for routing, and authorized implementation and unit/Jest/Vitest checks for this work. The implementation uses Mastra 1.79.0's 218 registered providers, plus Typesafe for decisions and the existing Ollama integration. The catalogue is read once at daemon startup; dependency upgrades update it without an application provider allow-list.

Provider means the service carrying the request. Model family/version and reasoning settings are separate choices. API-provider settings show the catalogue, credential presence and usage; they never accept credentials. Bot settings select provider, model and supported reasoning controls. Room routing selects Jev, OpenAI Decisions or a chat model, then a compatible provider and model. Brave remains under Tool APIs.

## Implementation

- `providers.ts` owns catalogue metadata, alternate credential variables and redactor registration. Netlify requires both its token and site id; other credential arrays are alternatives. ACP children lose every catalogue credential, including names such as `ABLIT_KEY` and `DIGITALOCEAN_ACCESS_TOKEN`.
- `hostedmodels.ts` shares discovery, capability controls, request-option mapping and validation between bots and routing. Existing OpenAI/Anthropic/OpenRouter account-list discovery and Ollama discovery are retained. Non-chat image/video/speech/decision families are excluded from text-model discovery (Mastra does not publish output modalities in this registry). Other providers use installed catalogue choices, explicitly labelled as not establishing account access or inference acceptance. No guessed `/models` URL is used.
- Reasoning controls come from Mastra metadata and the installed transport's options. Unmapped controls and unbounded budgets are not offered. Native Anthropic budgets still require a reported safe model output limit. Changing provider/model clears incompatible draft settings.
- SDK chat routing runs in a worker with only the selected provider credentials and endpoint settings. Its fetch refuses redirects and unapproved origins, caps responses at 64 KiB, bounds output and returned text, and is terminated after six seconds. Origins come from the selected catalogue endpoint and validated tenant configuration (Databricks/Snowflake/Neon domains and path-safe resource IDs); optional base-URL overrides cannot change the provider host. Netlify auth uses its fixed API origin and permits inference only on `https://ai-gateway.netlify.com`.
- Routing discovery snapshots are room-bound, expire after five minutes, and bind provider/model/controls to the current revision. Owner-only saves validate the snapshot, persist configuration and audit atomically, then the desk confirms by HTTP readback. An uncertain save is read back without sending another write.
- Migration 022 adds nullable `router_config_json`; existing enum values and events remain intact. Legacy Jev and OpenAI decision configurations keep OpenRouter, and legacy cheap-model configurations keep Anthropic and their administrator model overrides. Legacy model variables are redacted on room readback and cannot contain a registered credential. New configured rooms reject legacy writes that would discard their provider choice.
- Explicit mentions bypass routing. Results must identify a current room member. Missing credentials, invalid answers, low confidence and service errors fall back to the room lead, without switching providers.

## Verified contracts

- [Typesafe model list](https://docs.typesafe.ai/api/list-models): `GET https://api.typesafe.ai/v1/models`, `models[].name`.
- [Typesafe System One](https://docs.typesafe.ai/api/system-one): `POST /v1/systemone`, named choice questions and answers.
- [OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions): direct `POST https://api.openai.com/v1/decisions`, `input`, arrays of named questions/answers, currently `gpt-6-luna`.
- [OpenRouter Decisions](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request): `POST https://openrouter.ai/api/alpha/decisions`, `state`, maps of questions/answers. Decision model discovery requires the `decisions` output modality.
- Tenant constraints were checked against [Neon authentication](https://neon.com/docs/ai-gateway/authentication) and [Azure Databricks workspace URLs](https://learn.microsoft.com/en-us/azure/databricks/workspace/per-workspace-urls), alongside catalogue templates.
- Installed Mastra `llm/model/provider-registry.d.ts`, `gateways/base.d.ts`, `gateways/models-dev.d.ts`, and bundled transport implementations were inspected for registry, credential, model-override and reasoning behavior.

## Reviews

Standards and Spec reviews used initial commit `4d19262815761e903d666f6f3208d8e53fe49385` plus all uncommitted/untracked task changes. Both cleared after focused follow-up: the bounded SDK worker, complete endpoint resolution, credential handling and template-host validation were rechecked. Built-in `codex review --uncommitted` identified non-chat catalogue entries, dotted provider overrides and transient routing-load recovery. Each received a regression check and remedy. The final built-in focused review of loading/recovery and legacy secret redaction reported no substantive remaining defects; the broader change had already received the full uncommitted reviews. No merge or deployment was performed.

## Acceptance evidence

Commands run in this checkout:

| Check | Result |
|---|---|
| `pnpm build` | Passed daemon TypeScript and desk TypeScript/Vite; existing bundle-size warning remains |
| `pnpm --filter daemon exec vitest run src/models.test.ts src/botmodels.test.ts src/router.test.ts src/router-chat.test.ts` | 53 passed; includes selecting/saving every registered provider, endpoint resolution for every provider, routing HTTP permissions/snapshots/persistence and credential handling |
| `pnpm --filter desk exec vitest run src/components/ModelsPage.test.tsx src/components/RoomRoutingPanel.test.tsx src/components/BotModelSettings.test.tsx` | 12 passed |
| `node scripts/verify-bot-models.mjs` | Passed public HTTP/runtime checks, including restart persistence and existing policy paths |
| `node scripts/verify-hosted-models.mjs` | Passed installed native/compatible transport checks for OpenAI, Anthropic, OpenRouter, Google, Groq, Nebius, DeepSeek, xAI, Alibaba, Mistral, Cerebras, Perplexity and DeepInfra |
| `node scripts/verify-settings.mjs` | Passed Settings and joined-flow HTTP checks; unrelated regenerated temporary-path evidence was restored |
| `node scripts/verify-routing-transports.mjs` | Passed actual SDK worker against loopback: selected options, redirect refusal, oversized-response refusal and hard timeout |
| `node --import ./scripts/routing-fetch-fixture.mjs scripts/verify-routing-defaults.mjs` | Passed actual default-endpoint SDK workers for Nebius, Together, Vercel and Netlify, gateway reasoning and foreign Netlify origin refusal; all fetches intercepted |
| `pnpm -r --no-bail test --maxWorkers=4` | 1,727 passed, 137 failed (96 daemon, 41 desk). All 137 failing cases reproduced on unchanged `4d19262815761e903d666f6f3208d8e53fe49385`; asynchronous errors also reproduced in baseline MCP/app/automation suites. Affected checks were rerun after review remedies. |

Validation used `MASTRA_OFFLINE=1` where applicable. These are controlled checks, not provider-account acceptance. Checks use temporary databases, synthetic credentials and intercepted network requests; no paid model call or service cutover is part of this work. A provider's catalogue entry or credential presence does not prove account access. Google currently does not forward the returned model version through the inspected Mastra step response; the desk must retain Not reported rather than infer identity.

Browser verification was attempted through the connected UI tool, which reported `Local browser use is disabled in Work settings`. Component interaction checks cover provider changes, explicit saves, cancellation, errors and uncertain-save readback. Desktop/phone visual verification remains incomplete.

## Routing editor reset (PR #1 follow-up)

Cancel restores the room's saved strategy, provider, model and reasoning, and explicitly reloads the stored model's controls and discovery snapshot even when the strategy is unchanged. If discovery fails, the editor shows the error and withholds Save; another explicit Cancel can retry discovery. Reset does not save routing or send a model request. Normal save/readback confirmation remains unchanged.
