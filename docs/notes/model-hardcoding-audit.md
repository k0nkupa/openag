# Model hardcoding audit — 4 November 2026

Baseline audit after main merge `9e0b36e`, before OA-431 implementation.
For current implemented behavior, see [model discovery](model-picker.md). Scope: model
identities, model-dependent capability rules, discovery, defaults and user choice
through the daemon, desk, migrations, setup scripts and supporting fixtures.
This is an inventory, not an implementation or provider acceptance check.

## Restrictions and capability assumptions

| Area | Source | Current behavior and consequence |
| --- | --- | --- |
| Dictation settings | `apps/daemon/src/settings.ts:169` | Four model IDs in a strict enum; only `lfm3-omni` may pair with Ollama. Every other transcription model is refused before reaching the provider. |
| Dictation UI and types | `apps/desk/src/components/DictationSettings.tsx:14,41,42`; `apps/desk/src/types.ts:289` | Same four IDs repeated in defaults, provider-switch behavior, menu items and the TypeScript union. Changing the backend alone cannot expand the picker. |
| Dictation availability text | `apps/daemon/src/transcription.ts:30` | Setup guidance names LFM3-Omni. The actual status probe checks the selected model's reported `audio` capability, and the request forwards its selected ID. Transport itself does not contain the four-model list. |
| Hosted image attachments | `apps/daemon/src/attachment-prompt.ts:13`; caller `apps/daemon/src/runtimes/api.ts:64` | Regexes admit only named OpenAI/Anthropic families. For example `openai/gpt-6` cannot match the OpenAI regex. Nonmatching models receive attachment text/metadata without image bytes, even if their actual model supports vision. This is source-path evidence, not a live inference result. |
| Chat model classification | `apps/daemon/src/providers.ts:5` | Name-pattern exclusion list infers chat eligibility from terms such as audio, live, transcribe and known image/speech families. It can misclassify future or unusually named models. The source explicitly marks this as a shortcut because its SDK registry omits output modalities. |
| Hosted chat catalogue | `apps/daemon/src/hostedmodels.ts:51,73` | Most providers use the installed Mastra model list. OpenAI/Anthropic/OpenRouter fetch provider lists but intersect them with that installed registry. A model absent from the SDK catalogue is excluded even when the provider lists it. This is a dependency-version restriction rather than a locally written model-ID array. |
| Decision routing | `apps/daemon/src/hostedmodels.ts:104` | Direct OpenAI decision discovery admits exactly `gpt-6-luna`. Typesafe and OpenRouter use `jev-`/`typesafe/jev`/`openai/` name prefixes in addition to the applicable provider filtering. Other compatible decision models may not appear. |

## Defaults, examples and adapter identities

| Area | Source | Classification |
| --- | --- | --- |
| Legacy room routing | `apps/daemon/src/router.ts:106,108,201,293` | Defaults `typesafe/jev-1.13` and `claude-haiku-5-5`, overridable by environment configuration; saved room router configuration takes precedence. These are active fallback requests, not picker allowlists. |
| Embeddings | `apps/daemon/src/vectors.ts:37`; status mirror `apps/daemon/src/models.ts:130` | Default `nomic-embed-text`, overridable through `OPENAG_EMBED_MODEL` or the embedder constructor. No fixed embedding-model allowlist found. Vector dimensions are read from returned vectors and capped at 8192; rows carry model identity. Do not silently switch embedding models. |
| API setup error | `apps/daemon/src/runtimes/api.ts:50` | `openai/gpt-4o-mini` is an example in error text, not an executed fallback. Missing model configuration throws. |
| Seed/default bot identities | `apps/daemon/src/seed.ts`; `apps/daemon/src/defaultbot.ts`; `apps/daemon/src/botmodels.ts` | `claude-code` and `codex` identify adapters, not pinned underlying model versions. Explicit environment models and discovered session choices remain separate. |
| Fixtures, help and examples | `scripts/*fixture*`, `scripts/preview-*`, verification scripts, tests, README and help/notes | Concrete model names provide repeatable scenarios or setup examples. They do not by themselves restrict production choices. Generated Cloudflare worker declarations also enumerate vendor model names; these are generated platform types, not OpenAg's model picker. |

## Existing discovery to retain

- `apps/daemon/src/botmodels.ts:45` routes refresh through hosted discovery or ACP
  adapter discovery. `apps/daemon/src/runtimes/acp.ts:720` builds choices from
  adapter-reported model options. No application-owned model-version list found
  on the Claude Code/Codex selection path.
- `apps/daemon/src/hostedmodels.ts:27` enumerates installed Ollama models and uses
  `/api/show` completion capabilities. Ollama attachment handling independently
  reads the selected model's vision capability in `runtimes/ollama.ts:126`.
- `apps/daemon/src/model-catalogue.ts` persists discovered choices with generation
  checks. The desk's generic model selector renders supplied choices. Neither
  contains a fixed list of model versions.
- Provider transports, credential lookup, allowed endpoints, schema/size bounds
  and reasoning-option serialization contain explicit supported contracts. These
  are separate from model-ID hardcoding; removing them would not establish new
  provider or protocol support.

## Recommended order

1. Replace duplicated dictation enums/menus with discovered compatible choices,
   using the existing catalogue lifecycle where practical. Keep protocol checks.
2. Replace hosted attachment family matching with model capability metadata.
3. Review SDK-list intersection and name-based chat/decision filtering together
   with transport compatibility, so discovery does not advertise unsupported calls.
4. Decide whether configurable model defaults remain acceptable. They are a
   different policy from restricting which model a user may select.

Verified by source searches and caller tracing only. No code, settings, preview,
service or provider changes; no unit tests, builds or live model calls were run.
