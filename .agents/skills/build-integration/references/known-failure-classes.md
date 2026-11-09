# Known failure classes

Each class below caused or could cause a repeat fix round. For a new or changed integration, answer every row with "shared path handles it (where)" or "needs work". Sources: `docs/notes/mcp-lifecycle.md`, `docs/notes/mcp.md`, `docs/notes/mcp-server.md`, `docs/notes/mcp-contract-audit/README.md`.

| Class | Check for this integration |
|---|---|
| Tool identity | Tool names keep their original case and charset through registration, adapter recognition and policy lookup, in both Claude and Codex. Names differing only by case stay distinct. No provider-specific carve-outs. Lookups use own-property checks. |
| Classification | Class comes from an owner or reviewed daemon declaration for the exact server and tool name. Server hints and annotations are ignored. Writes and unknown tools ask. `secrets` and `act-external` never resolve to `auto`. |
| Approval vs provider prompt | OpenAg approval and any provider consent or elicitation are separate gates. A provider asking for input is not another OpenAg approval. One approval per action, and executing once after accept. |
| Session model | Does the endpoint return an MCP session id? If not, each call gets a fresh initialised client with a negotiation deadline. A second call in the same agent session must work. A provider workflow carried in arguments never reuses an earlier permission response. |
| Elicitation | Client advertises form and URL elicitation only. Credential-shaped fields are refused. The wait is bounded and expires on timeout, disconnect or turn end. |
| Unsupported tools | Tools requiring async tasks or with unsupported schemas are unavailable with a diagnostic, not silently dropped or run synchronously. |
| Catalogue integrity | Pagination terminates without repeated cursors, within the page and tool caps. Duplicate names refused. Catalogue-change notifications swap the catalogue atomically with a new contract version. |
| Result interpretation | An outer success with a nested failure, a failed batch item or an upstream HTTP error must not complete as a read. Large results become bounded valid JSON with truncation metadata. Results are wrapped untrusted and redacted. |
| Receipts | A write or unknown operation stays Unknown until effect evidence supports more. Apparent provider success never confirms a write or authorises a retry. An unresolved receipt fences later external actions; reconcile from evidence, never by retry. |
| Harness honesty | Test fails when the nested or provider result fails. Native tools cannot bypass the MCP route. The event watched actually proves the outcome. Concurrent runs cannot block each other. |
| Credentials | Env or encrypted store only, redactor registered, stripped from bot processes, never in DB, ledger or logs. Provider consent never establishes OpenAg ownership. |
| Knowledge delivery | Help topic, notes and tool descriptions updated; delivery to the default bot verified, including existing installs. |
