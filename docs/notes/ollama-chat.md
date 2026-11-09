# Ollama chat bots (OA-211)

A bot with `runtime: "api"` and `model: "ollama/<name>"` runs through `runtimes/ollama.ts` (dispatched from
`createApiRuntime`). Seed one with `OPENAG_SEED_OLLAMA_MODEL=<name> pnpm --filter daemon seed` (bot id `local`).

- Endpoint `OPENAG_OLLAMA_URL` (default `http://127.0.0.1:11434`), separate from the embeddings config.
- `POST /api/chat`, non-streaming; tools are sent as JSON Schema (`z.toJSONSchema`); EVERY tool call goes through
  `ctx.callTool` (policy gate); bounded rounds; replies are cleaned of `<think>` blocks (including a lone `</think>`).
- Ollama down/unreachable/timeouts fail the turn with a fixed ledger error (`ollama is not reachable (is it running?)`), never a crash.
- Checked live with `huihui_ai/qwen3.5-abliterated:9b`: plain turn works. Tool calling was NOT tried live; small local models are weak at it and at arithmetic.

## Cached model selection

Existing agents can select Ollama through Model and reasoning. Chat models must report completion capability; embedding-only models are excluded. Reasoning options are cached per model and refreshed daily or manually in Settings → Models. Chat sends the saved thinking option without a per-turn reasoning probe. Provider rejection fails the turn without substituting another model. Runtime switching and cache behavior are authoritative in [model selection](model-picker.md). Memory embeddings remain separately configured.
