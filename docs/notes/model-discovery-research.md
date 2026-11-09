# Model discovery cache and Ollama selection research

Research only, 2026-11-03. No implementation, adapter launch, inference, service change or tests.

## Findings from current source

- `apps/desk/src/components/BotModelSettings.tsx` filters model targets by the bot's existing runtime family. ACP bots only receive Claude/Codex; Ollama is offered to API bots. Its open handler reloads the catalogue every time.
- `apps/desk/src/model-catalogue.ts` clears catalogue state when disabled or reloaded and serially discovers every target. Its queue serializes work; it does not cache results or deduplicate identical requests.
- `apps/daemon/src/botmodels.ts` also rejects cross-runtime discovery. Its five-minute snapshots authorize/revalidate saves; they are not a discovery result cache. Removing the UI filter alone would fail at this gate. Existing bot runtime changes need an explicit lifecycle design rather than a picker-only change.
- `apps/daemon/src/runtimes/acp.ts` discovery connects a fresh probe adapter, starts a session, optionally selects the requested model, reads controls and closes the connection. Reopening currently repeats that startup work.
- `apps/daemon/src/hostedmodels.ts` uses Ollama tags for the model list and show for selected-model controls, but does not filter listed models by completion capability.

## Primary documentation checked

- ACP configuration belongs to a session. Initial options may arrive during setup. Selecting a model returns the complete configuration state because other controls, including reasoning options, can change with the model. Agent notifications also replace the complete configuration state. Therefore cache model-specific metadata separately; do not apply one model's controls to another. [ACP v1 Session Config Options](https://agentclientprotocol.com/protocol/v1/session-config-options).
- ACP sessions carry independent context/history/state. Loading or resuming requires advertised support. Reusing a cached list of model names does not establish that a closed probe session remains usable. Keep metadata caching separate from live session lifecycle. [ACP v1 Session Setup](https://agentclientprotocol.com/protocol/v1/session-setup).
- Ollama tags lists installed model names, digests and modification timestamps. It does not document this as a chat-only list. Show returns capabilities and optional thinking controls. Use show capabilities to exclude embedding-only models from chat selection; missing metadata should remain explicitly unknown. [Ollama List Models](https://docs.ollama.com/api/tags), [Show Model Details](https://docs.ollama.com/api-reference/show-model-details).
- Ollama thinking values can be booleans or model-defined strings, and omission means metadata is unavailable. Use the model's advertised values instead of a universal effort list. [Ollama Thinking](https://docs.ollama.com/capabilities/thinking).

## Original recommendation (superseded)

1. Retain catalogue state across panel close/reopen and display cached successful data immediately. Add an explicit Refresh action rather than always discarding it.
2. Add a bounded daemon memory cache for successful discovery metadata, plus one shared in-flight promise for identical requests. Proposed initial TTL: five minutes; this is an OpenAg policy choice, not an ACP/Ollama requirement. Scope entries to bot, model revision, target, requested model and relevant adapter/provider configuration generation. Never include credentials in cache contents, keys or logs. Do not cache transient failures as successful choices.
3. Keep save snapshots and revision checks separate from display data. Revalidate current selected-model controls before saving; issue a fresh bounded snapshot. Invalidate metadata on configuration changes, known credential/adapter changes, explicit refresh and expired entries. Ollama digest changes can invalidate per-model details.
4. Cache metadata only, not probe processes, session IDs, permission state or approvals. Preserve current gate, asking mode and runtime checks.
5. To expose Ollama on this existing ACP bot, separately implement an explicit idle-only runtime transition with session invalidation, compatible reasoning validation and preservation of bot identity/history/memory/permissions. Alternatively, use an API-runtime bot for Ollama under current behavior. Simply removing the filter is incomplete.

This establishes source causes and an implementation direction. It does not measure the current live daemon or prove account access, inference, runtime switching or latency after a fix.

## Owner-approved decision

The owner approved a persisted catalogue, daily/manual refresh, no live discovery on open/select/save, and existing-agent switching to Ollama. This replaces the five-minute cache and fresh-save-validation recommendation above. The implementation behavior is documented in [model selection](model-picker.md).
