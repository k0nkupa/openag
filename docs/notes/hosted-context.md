# Hosted conversation context

OA-369 source behavior, 2 November 2026. API/Mastra and Ollama share the daemon's structured context projection. ACP keeps its existing text prompt and adapter-owned history; this feature does not prepend a second transcript to ACP.

## Selection and roles

Trusted operating rules, daemon capability/tool-use guidance and owner-managed bot instructions enter system input. Standing memory, recall, help, skills and room/member descriptions are labelled supporting data in user input. They cannot grant permissions or override operating rules. Earlier assistant assertions are not approvals.

History includes the receiving bot's earlier conversation inputs and its own finished responses and, since OA-370, incomplete replies with their stop notices in the same authorized room. A message must have participated in that bot's turn; another bot's unrelated exchange is excluded. Explicit specialist handoffs are attributed forwarded data, not owner instructions or the receiving assistant's own response. Isolated, hidden, external-source and noIndex-origin exchanges are excluded, and such current turns receive no normal conversation history.

The daemon selects the latest 20 eligible messages and restores chronology. Model-facing history is capped at 24,000 characters, using a suffix of complete messages and dropping any leading orphan assistant response. The current request appears once. Historical attachments contribute bounded ID/name references only; bytes are neither resent nor refetched.

History has a durable upper anchor captured when the turn starts. Approval recovery reuses it rather than admitting later events to the same turn. A trusted internal lower boundary can exclude earlier inputs and their later responses. Boundaries survive relevant continuations; there is no new reset control, and changing the model does not reset history. Model content cannot set these boundaries.

## Text admission and failure

The declared instructions, current request, current attachment text and offered tool schemas share a 64,000-character admission ceiling. Optional older history and supporting data use the remaining space. Data fields are shortened before JSON serialization; serialized JSON is never cut. This bounds application text, not provider tokens, image capacity or model context size.

If required input cannot fit, the turn records a bounded context_limit failure before a model request or tool execution. Admission also precedes vector-recall embedding. Ollama checks admission before capability/thinking probes too. The current slice uses the existing failed outcome; typed incomplete reasons are OA-370. A provider may still reject input because its actual capacity is smaller; this feature does not retry or imply success.

The renderer and actual tool path use the same offered definitions. API schema-conversion failure refuses the request; Ollama retains its existing generic-schema fallback, measuring the schema it actually offers. All actual tool calls still use the policy gate, approval snapshots and action receipts.

## Privacy and limits

Memory and conversation history are different. Existing recall remains bot-scoped and may contain material from other conversations. A room-scoped history filter does not make the entire turn context room-private. Existing vector-indexing policy is retained. New history boundaries do not delete transcripts, memories, backups or artifacts.

No persistent summaries, memory replacement, connector access, permission expansion, reset UI, retry policy or execution-budget changes are part of OA-369. Context selection never creates Work. OA-369 initially recorded context_limit as failure; OA-370 now records it as incomplete, never as a completed turn or objective.

## Verification and delivery

The standalone hosted-context check uses the actual gateway, runner, SQLite ledger, shared projection, Mastra adapter and Ollama adapter with controlled model/transports. It observes model requests and public outcomes for continuity, roles, scope, history/text bounds, pre-request failure and approval recovery without replay. Existing input, upload, explicit-Work and bot-knowledge checks cover compatibility, including ACP.

The Conversations handbook topic links to this authoritative note and its manifest packages it. `verify-bot-knowledge.mjs` verifies the topic reaches controlled API/Ollama/default-bot and cached ACP/MCP delivery paths. This is source/package acceptance, not deployment or real hosted-provider acceptance. Exact results belong in the PR description and the relevant notes.

OA-370 extends context_limit to an explicit incomplete outcome. See [Hosted outcomes](hosted-outcomes.md) for current execution reporting and limits.
