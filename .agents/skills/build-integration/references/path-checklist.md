# Path checklist

For each row, name the check that exercises it, or write "GAP".

| Layer | Question | Check |
|---|---|---|
| Tool identity | Do offered names (any case/charset) survive registration, adapter recognition and policy lookup unchanged? Names differing only by case stay distinct. | |
| Classification | Is each tool's class declared by the owner/daemon, never by the server's hints? Unknown tools ask? | |
| Adapter: Claude | Native tools disabled for the test? Permission mapping reaches `ctx.callTool`? | |
| Adapter: Codex | Same, including its config overrides? | |
| OpenAg gate | Exactly one approval per action; accept executes once; deny prevents execution? | |
| MCP session | Fresh client per stateless call? Second call in the same agent session works? Reconnect/timeouts handled? | |
| Provider consent | Is there a provider-side prompt or elicitation? Is the client capable of answering it? | |
| Result interpretation | Does a nested failure, failed batch item or provider HTTP error fail the check rather than pass on an outer success? | |
| Receipts | Any unknown-outcome receipt that fences later actions? Resolved from evidence, not by retry? | |
| Evidence | Independent baseline and provider execution log matched to the returned account/payload? | |
