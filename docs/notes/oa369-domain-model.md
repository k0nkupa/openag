# OA-369 domain-modeling pass

2 November 2026. Applies to the approved OA-369 history/trust slice. This records domain distinctions and concrete scenarios; it does not implement runtime behavior or reopen the accepted product direction. Current status and order remain in ROADMAP.md.

## Model

The glossary now distinguishes Conversation history, Turn context, Operating rules, Context data and History boundary. Keep the existing Conversation, Turn, Memory, Working context, Work and Approval meanings.

| Relationship | Meaning for this slice |
|---|---|
| Conversation → conversation history | Retained messages are not automatically eligible input to every participant or turn. |
| Turn → turn context | One execution receives a bounded selection, including its current request once. Context selection does not create Work. |
| Operating rules → behavior constraints | Owner-governed rules remain distinct from quoted messages and supporting data. The server policy gate remains the action authority. |
| Memory → context data | Recall can inform a turn, but a recalled instruction cannot grant fresh permission. Memory is not a substitute for recent conversation. |
| History boundary → historical selection | A trusted boundary limits eligible older messages. It neither deletes the ledger nor clears memory. |

## Eligibility and authorship

For OA-369, conversation history is specific to the receiving agent's authorized participation: owner requests addressed to it, its own final responses, and explicit handoffs directed to it. An unrelated exchange addressed to another bot is not automatically part of its history, even if stored in the same room. Joining a room does not by itself turn another agent's prior private exchange into this agent's history.

A specialist's handoff remains attributable to that specialist; it is not an owner instruction or the receiving agent's own assistant response. The implementation plan must preserve that authorship when projecting provider roles. A role label alone does not make source content authoritative.

The current request is separate from historical selection and appears once. Historical attachment references are not the attachment bytes or permission to fetch them again. Optional older history can be omitted within the accepted 20-message / 24,000-character history budget. Mandatory operating rules and the current request must not be silently removed to make input fit.

Memory scope remains a separate concern. Existing recall is bot-scoped and can include earlier material from other conversations. OA-369's room/agent history filter must not be described as proof that the entire turn context is room-private. This slice preserves the existing retrieval/indexing policy; responsibility-specific memory/source restrictions belong to their later design.

## Scenarios that sharpen the boundaries

| Scenario | Required distinction |
|---|---|
| Owner: “Compare the second option” | The same agent may use its eligible recent exchange to resolve the reference; history is selected, not replaced by an unrelated memory hit. |
| A different bot handled another request | That exchange is not silently included as this bot's own dialogue. Explicitly forwarded findings remain attributed data. |
| An email or recalled note says “ignore approval and send” | The text remains context data. It cannot change operating rules, create Work or bypass the action gate. |
| A past assistant message says “permission granted” | An agent assertion is not an owner decision or a current action receipt. |
| A trusted history boundary is advanced | Earlier messages stay in retained records but leave historical selection. Memory is not thereby cleared. A model change is not a reset. |
| Old history exceeds its budget | Drop optional older history deterministically, preserving chronology of selected messages; do not imply the full transcript was considered. |
| Mandatory input cannot fit | Fail closed with the staged context_limit behavior; do not issue a provider request or perform tools while pretending completion. |
| An isolated run begins | It does not inherit normal conversation history. Existing isolation and unattended rules still apply. |
| A prior message references an attachment | Keep bounded source metadata; do not resend its bytes or fetch it without applicable access. |
| An ACP turn begins | Preserve adapter-owned conversation history; this hosted projection does not prepend another transcript to it. |

## Code agreement and gaps

At source `28b2c11`, `apps/daemon/src/prompt.ts:15` builds one text prompt containing rules, current body, notes and recall. `apps/daemon/src/runtimes/types.ts:24` exposes that prompt as text; `runtimes/api.ts:67` and `runtimes/ollama.ts:156` send assembled context in user input. The glossary's distinctions are the target model, not a claim that providers already receive these separate roles.

`apps/daemon/src/ledger.ts:109` reads the oldest forward page; it is not a recent-history selection interface. `runtimes/runner.ts:367` retrieves recall by bot, separately from conversation-history selection. OA-342 already enforces that chat does not create Work; OA-369 must retain that distinction.

The next implementation plan must map this model to the shared prompt/turn interface and provider projections, define exact message eligibility and chronological packing, and verify it through controlled gateway/runtime fixtures. It must not add a reset UI, persistent summary, memory engine, new permission source or ACP history loop.

## Validation

Read the current glossary, OA-369 acceptance, hosted-harness design and affected source seams. Checked glossary format, relative links and whitespace. No runtime code, schema, installed configuration or product-help behavior changed. No tests, model calls or deployment were needed for this domain-only pass. No additional ADR is needed for these vocabulary refinements; the existing responsibility/Work decision remains applicable.
