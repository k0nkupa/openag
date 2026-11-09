# OA-431 capability discovery acceptance — 4 November 2026

Scope: approved model-restriction removal on `codex/composer-dictation`, after
main merge `9e0b36e`. No production deployment, push, automatic model selection,
embedding-model switch or reindex.

## Implemented

- Shared persisted task capabilities and protocol evidence replace dictation ID
  enums, model-name chat filters, SDK model-list intersection, decision-family
  restrictions and hosted image-family regexes.
- Hosted metadata uses the bounded Models.dev v2 feed, with provider evidence
  taking precedence for reported fields. Downloaded URLs/SDK names never choose
  transport configuration. Eligibility matches the installed adapter protocol.
- Ollama records installed models separately from task eligibility, including
  unknown capabilities. Typesafe uses its dedicated decision-model listing.
- Existing settings survive; pre-capability caches upgrade on the next background
  check even within the daily interval. Catalogue generation is exposed separately
  from timestamps. New dictation selections require current per-model tokens.
- Routing save rechecks the catalogue generation and exposes no decision reasoning
  controls its transport does not send. Image MIME filtering also marks omitted
  attachments individually, preventing a false claim that their bytes were supplied.

## Controlled checks

All commands below ran without a unit/Jest/Vitest runner and passed:

- `pnpm -r build` (relay build is dry-run, not deployment).
- `node scripts/verify-model-capabilities.mjs`: unfamiliar identities, wrong chat
  protocol and realtime-only exclusion, unknown evidence, legacy cache upgrade,
  authenticated gateway settings/transcription, per-model selection tokens,
  routing generation validation, source-context change, failed/removed models,
  malformed/oversized capability feed, passive reads, untagged Ollama alias
  preservation and remote-Ollama exclusion from local dictation.
- `node scripts/verify-model-catalogue.mjs`: persistence/restart, shared refresh,
  generation guards and cached ACP/API/Ollama selection.
- `node scripts/verify-dictation.mjs`: real gateway and built desk, capture phases,
  drafts/attachments, cancellation, WAV conversion, errors and no replay.
- `node scripts/verify-select-chat.mjs`: built chat/settings controls and controlled
  adapter selection; discovered dictation menu, realtime exclusion, held refresh,
  disabled saving, unsaved draft retention and explicit save with new metadata.
- `node scripts/verify-uploads.mjs`: attachment boundaries, ACP/API/Ollama delivery,
  supported/unsupported image MIME types and accurate per-image omission context.
- `node scripts/verify-hosted-models.mjs`: installed provider transports, including
  an unfamiliar OpenAI model ID, reasoning serialization and returned identities.
- `node scripts/verify-permission-controls.mjs`: actual current permission UI,
  proposal boundary, revision cancellation and Unknown/no-replay handling.
- `node scripts/verify-capabilities.mjs`: independent tool capability offering.
- `node scripts/verify-bot-knowledge.mjs`: packaging plus API/Ollama/cached ACP-MCP
  default-agent delivery, replacement default and unattended restrictions. Explicit
  assertions cover the new shared-capability and dynamic-dictation help text.
- `node scripts/verify-desk-components.mjs`: 113 production TSX modules accounted
  for; visual coverage recorded separately in the component audit.
- Whitespace checks passed. Built-in uncommitted review found and prompted fixes
  for protocol mismatch, routing snapshot validation, decision controls, fixture
  protocols and mixed-image context. Final follow-up found no substantive defects.

An additional older `verify-bot-models.mjs` run stopped at its expectation of a
pending approval for a workspace write (line 73). The merged permission-session
flow supersedes that legacy assumption. It is not counted as a passing check;
current permission behavior is covered by `verify-permission-controls.mjs` above.
No application permission behavior was changed to satisfy that older verifier.

## Live discovery and isolated preview

Port 4750 uses `/tmp/openag-dictation-local-db4ba95`. A consistent private backup
was made before refresh; its path is recorded in the local
`/tmp/openag-capability-preview-state.json` handoff file. The final daemon runs
independently of the command session, with its log at
`/tmp/openag-capability-preview.log`.

Actual Claude Code and Codex catalogue probes, authenticated OpenAI model discovery,
and local Ollama tags/show completed successfully. CUA Chrome verified the real
OpenAI dictation menu on desktop and 390×844: existing choices plus Whisper and
diarization, no realtime-only model, selected target unchanged. A final explicit
Refresh models completed for all four configured sources. No inference prompt,
microphone recording or settings save was performed during these live checks.

Readback verified health, current built index, SQLite integrity, unchanged
bot/room/device counts and byte-identical saved dictation configuration. Port 4747
was not changed. The native component audit records the rendered scope and browser
cleanup. Other providers and new model inference/recognition remain unverified.

## Knowledge and limits

Updated delivered `docs/help/bots-models.md` and `docs/help/dictation.md`, plus the
authoritative model-picker, dictation, attachment and component-audit notes.
`model-capability-sources.md` records primary source contracts. No new agent tool
or action permission was added.

The external metadata feed is experimental and can omit models or report stale
capabilities. Unknown evidence is not a positive capability; failed refresh keeps
last-good data. Provider access and recognition quality require separate live
acceptance. Unit/Jest/Vitest and physical phone/Safari/screen-reader use were not
checked. Configurable routing/embedding defaults and concrete fixture/example
names remain; they are not model-choice allowlists.
