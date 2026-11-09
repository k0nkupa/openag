# OA-322 saved results

Implemented locally on 1 November 2026 after OA-315 (`394507c`), before the full OA-323 Work interface. The production daemon on 4747 is updated only after the approved chain is verified.

## Storage and trust boundary

Migration 016 adds immutable UTF-8 text versions in SQLite. Each version records its opaque result ID, Work, author bot, room, turn, actual `save_result` tool call, filename, kind, byte count and timestamp. Input uploads remain separate. The tool supports comparisons, drafts, code/diffs and notes, capped at 256 KiB after redaction and 100 saved versions per Work. Updating requires the same Work/room/author plus the latest `baseVersion`; a conflict never overwrites an earlier version. Repeated execution of the same tool-call identity returns its stored version.

Results are text rows under daemon-issued IDs, not caller-selected paths. No source-file read or path field is accepted; a display filename cannot dereference a file or symlink. Names reject separators/control characters and require an allowed text/code extension. Arbitrary HTML/binary kinds and extra fields are refused. All persisted names/content pass through the existing redactor. The save requires an active matching Work turn and its exact ledgered tool call, with no cancellation requested.

`save_result` is wired once through first-party tools to the API model, scoped ACP MCP endpoint and runner executor. It is `act-local`, asks by default, and uses existing owner-configured policy. An ignored/denied save creates no result. A saved document is always labelled **Proposed content**; persisting model text does not prove its described action ran. Actual tool outcomes remain in the ledger. Saving does not modify input attachments or run downloaded content.

Authenticated reads: `GET /results` (Work/room/bot filters and cursor), `GET /results/:id?version=N`, `/results/:id/versions`, `/results/:id/download?version=N`. Lists contain metadata only. Hidden rooms are excluded. Preview JSON and downloads have no-store; downloads are plain text with nosniff/attachment headers. The desk renders documents with React text in `<pre>`, never HTML.

The UI opens exact result versions from conversation events, the Files context tab and a minimal `#/work/:id` result host. Direct context shows only the selected bot across public rooms, with origin labels; group context is room-scoped. OA-323 replaces that minimal host with the full searchable lifecycle view. Stream refreshes are scoped/coalesced and stale responses are ignored. Result selection survives list refreshes.

`results` is reserved from static-file shadowing. Vite proxies `/work` and `/results`. WebRTC permits Work/results **GET** reads, still rejects encoded path segments and forwards encoded query values. New text replies are capped at 2 MiB; existing other reply caps stay 256 KiB. 8 KiB character chunks fit 64 KiB frames even with JSON escaping. Binary input uploads still require LAN/Tailscale. The MCP wire cap is 2 MiB because JSON escaping can expand 256 KiB of valid content sixfold; the persisted-content cap remains 256 KiB.

## Verification

- `pnpm -r build`: daemon/desk build and typechecks passed; existing bundle-size advisory remains.
- `node scripts/verify-results.mjs`: approved/ignored saves, strict input/byte/path/type bounds, redaction of generated content, active-turn/call checks, same-Work isolation, version/provenance links, stale and concurrent base-version conflicts, 100-version cap, cursor pagination, static shadow refusal, authenticated list/preview/download and exact inert bytes passed. A fresh Node process reopened the database and served the same original version/source IDs.
- The same script exercises actual MCP tools/list and tools/call, including 256 KiB of control text expanded beyond 1 MiB on the wire. Controlled RTC signaling/peer I/O drives the actual RTC service into the real gateway: Work/results reads, encoded-query handling, denied credentials/methods/paths, large JSON preview/plain-text download reassembly and every frame below 64 KiB passed. This is not a live WebRTC/ICE device check.
- Standalone `verify-uploads.mjs`, `verify-work.mjs`, `verify-desk-flow.mjs` passed after integration. No unit tests/Jest, per owner rule.
- Browser: exact version opens from conversation; its Work source link opens the result host; result opens there; versions switch; script markup remains literal text with zero script child nodes; authenticated browser download bytes match and the synthetic download was removed. Desktop and 390×844 light/dark have no overflow. Escape closes the sheet and restores focus after its closing transition. Reload retains saved data.
- Standards and Spec source reviews plus built-in source review were used; findings were fixed and re-reviewed before commit. No model account was used for this ticket. No production data writes during implementation.

Released with OA-323 source `8a19eeb` on 4747 after the approved dependency chain passed verification. Database schema16, history/configuration and static/API readback passed. See release evidence.
