# Room router (OA-210)

Provider-selectable routing now extends the original implementation. See [provider-routing.md](provider-routing.md) for the current model/provider choices, migration, validation and acceptance limits. The endpoint and environment details below describe the preserved legacy configuration.

Per-room `router` (`lead` default | `jev` | `openai-decision` | `cheap-same-model`), set by the OWNER only
(`PUT /rooms/:id/router`, 409 with the reason when the strategy is unavailable). `GET /router` lists availability.
Only a message with NO explicit @mention (and not @everyone) reaches the router; its answer must be a member of that room;
any failure (no key, timeout, bad answer, low confidence) falls back to the lead. The message is redacted and clipped to
1000 chars before leaving the machine. The route event carries `router: {strategy, reason, confidence}` (never response text).

## Verified API surface (checked against OpenRouter docs when built; the alpha endpoint can change)
- Jev = TypeSafe's decision model served through OpenRouter's Decisions API:
  `POST https://openrouter.ai/api/alpha/decisions`, `Authorization: Bearer $OPENROUTER_API_KEY`, model `typesafe/jev-1.13`
  (`~typesafe/jev-latest` also accepted). The request is a choice question whose `criteria` are the member ids; the
  response has `answers.target.choice`, `confidence`, `probabilities`.
- `openai-decision`: same endpoint, model id supplied by the owner (`OPENAG_ROUTER_OPENAI_MODEL`).
- `cheap-same-model`: Anthropic Messages API (`https://api.anthropic.com/v1/messages`, `ANTHROPIC_API_KEY`, small model).
- NOT verified with a live key (none available): the strategies are covered by unit/gateway tests with a fake `fetch` only.

## Env
`OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAG_ROUTER_JEV_MODEL`, `OPENAG_ROUTER_OPENAI_MODEL`, `OPENAG_ROUTER_CHEAP_MODEL`, `OPENAG_ROUTER_MIN_CONFIDENCE` (default 0.4). Keys come ONLY from env; hosts are fixed; with no key the strategy reports unavailable and is inert.
