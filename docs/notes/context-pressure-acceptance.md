# Context acceptance — 4 November 2026

Owner requested local main merge/redeployment, then context checks using known work/preferences. Local main was already `ce88bae`; it was rebuilt with frozen dependencies and redeployed as `<releases>/harness-ce88bae`. Health, served index, unchanged configuration and zero rollout model turns were checked. PID 9638 → 9220. Verified backup: `openag-20261104-210326.db`; private readback/previous plist are under `$OPENAG_DATA/backups/context-pressure-ce88bae/`.

## Scope and method

Real OpenAI, local Ollama and installed Claude/Codex ACP models ran through a disposable real OpenAg gateway, runner, permission gate, read-tool executor and retained provenance. Twelve compiled runtime modules were byte-compared with the deployed release. This proves the same runtime artifact behavior in the temporary installation; these were not turns in the installed user's chats or configured default bot.

Standing notes used Alex's known preferences: short plain English, distinct source/deployment/provider evidence, and DEV authority that does not extend to PROD. Project Alder and all planning records were synthetic. No production conversations, customer records or connected business tools were imported. The only offered tool returned in-memory sample text and declared trusted read effects. Owner/device settings and installed model choices were unchanged.

Per model: a short standing-notes query, a second same-chat marker query, long seeded history, and one tool-result query. Hosted models additionally received an oversized tool-result case. Long history contains 24 invented user/assistant pairs; the assistant entries are fixtures, not actual previous model responses. It saves model calls while testing actual history admission. The latest planning label and environment are absent from the new question and must come from context.

The smaller tool sample has 12,000 filler characters and random values at the beginning, middle and end. Those values are not in the request, so echoing the question cannot pass. The oversized sample has 30,000 filler characters, crossing the existing 20,000-character encoded hosted-result ceiling. These are character units, not token/context-window measurements.

## Observations

| Actual model | Short answer | Same-chat marker | Long history | Smaller tool result | Oversized tool result |
| --- | --- | --- | --- | --- | --- |
| OpenAI gpt-4.1-mini | Pass | Pass | Pass | All three random values | Incomplete/output_truncated; no next model request |
| Ollama lfm3-omni:latest | Omitted requested marker from first answer | Pass | Pass | Read completed; next model request hit 90-second deadline; Incomplete | Incomplete/output_truncated; no next model request |
| Ollama huihui_ai/qwen3.5-abliterated:9b, thinking off | Pass | Pass | Pass | All three random values | Incomplete/output_truncated; no next model request |
| Claude ACP, discovered sonnet | Pass | Pass; same session | Pass | All three random values | Child-internal behavior unavailable; not asserted |
| Codex ACP, discovered gpt-6.1-sol | Pass | Pass; same session | Pass | All three random values | Child-internal behavior unavailable; not asserted |

All five long-history traces recorded 28 omitted eligible events and still supplied the latest planning label ALDER_23 and DEV environment. The oldest 14 synthetic pairs were outside the 20-event window; the latest 10 pairs (21,180 characters) were selected without additional text-budget clipping. This exercised the history window, not exhaustion of the 64,000-character input budget. All observed standing-note text was selected: 338 characters for hosted requests, 337 for ACP after trimming its final newline. Hosted manifests observe the request; ACP manifests observe OpenAg's handoff and reused-session fingerprint. They do not reveal ACP's retained internal context or subsequent child model requests.

Twenty-three scenarios exercised the expected daemon recording/settlement contracts; there were no Unknown receipts in the final run. Of 20 requested answer checks, 18 passed and two LFM3 checks failed. All three hosted oversized-result guards passed. The process exits **1**, intentionally: model-answer failures are not presented as an all-green acceptance. A completed read is separate from a completed answer; LFM3's retained completed receipt coexists with its Incomplete turn.

Initial fixture failures are excluded from final acceptance. An early version omitted trusted read-effect metadata, so its static sample produced an Unknown receipt in an isolated temporary database. That run stopped; the record was neither cleared nor reused. After correcting the declaration, an initial LFM3 result did not invoke the tool at all. The final oracle uses unprompted random values and separates non-exercised tool paths, answer failures and runtime failures. No business effect was possible in these fixtures.

## Conclusion

This sample supports the existing bounded-selection behavior. It does **not** establish a need for automatic summarization or pruning. The latest facts survived the deliberately limited history on every model. The LFM3 observations show missing requested output and a timed-out generation after a returned tool result; they do not establish that OpenAg dropped its context or explain the model's internal cause. No model setting or runtime behavior was changed in response.

Large hosted results currently stop the turn rather than silently summarizing and continuing. A future context-reduction proposal must decide whether controlled continuation is useful, preserve original evidence and stay separate from action replay. It is not implemented by this check.

## Evidence and reproduction

Sanitized records retain turn/manifest/receipt references, model replies, measured omissions, selected source lengths, session fingerprints and provider-reported usage where available. The full temporary fixture directory is recorded in the execution log; it is separate from installed data.

Run `node scripts/verify-context-pressure.mjs --real` with the configured OpenAI key supplied only through the process environment when OpenAI is selected. Optional positional targets are `openai`, `ollama`, `ollama-qwen`, `claude`, `codex`; for example `--real claude codex`. Adapter models are discovered. Existing local Ollama models are used without downloads or installation changes. The sample script contains no key or persistent service changes. All gateway listeners and adapter processes close after completion.

Evidence separates the checkout revision from SHA-256 hashes of executed core modules; the script does not infer that Git HEAD produced dist. Ordinary answer success requires a finished turn, not just expected values in partial output. Outer deadline/invocation failures retain a failed scenario with available turn, manifest, tool/receipt and pending-approval references before teardown, then stop without resubmission. `--deadline-ms=N` can shorten the default 125000 ms bound (1–125000). One-millisecond Codex and Ollama probes exercised real gateway timeout paths: one submitted message each, retained failed turn references and zero tool invocations/receipts. Teardown now awaits the active dispatch after cancellation, before closing the database. Both probes stopped cleanly. ACP deadline evidence and hosted deadline evidence are separate from the 23 answer/contract scenarios; their expected exit status is 1.

Syntax and whitespace checks passed. Review found and corrected partial-answer false positives, checkout/build attribution, missing outer-deadline evidence and dispatch/database teardown ordering. Final `codex review --uncommitted` found no actionable defects. Review did not rerun live models; retained answers were rechecked against the tightened completion/oracle rules, and both deadline paths were exercised separately. These verification-only files add no product or bot capability; the deployed provenance/help contract is unchanged, so no delivered handbook change is needed. No unit/Jest/Vitest, external business writes, test turns in production chats, pushes, shared-memory edits or automatic context reduction. Other remote providers retain prior controlled-transport coverage; no live DeepSeek call is claimed. This is bounded empirical acceptance, not a guarantee across arbitrary conversations or provider-internal context handling.
