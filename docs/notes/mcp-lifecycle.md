> Current interaction model: Needs you and Recovery acknowledgements are removed. Questions and explicit decisions live in their originating conversation. See [conversation interactions](chat-interactions.md). Historical acceptance below describes its recorded version.

# MCP invocation and interaction contract

OA-384 implements the eight shared gaps recorded in [the historical audit](mcp-contract-audit/README.md). This describes source behavior; it does not establish local deployment or live provider acceptance.

## Shared invocation boundary

Configured stdio/HTTP servers and the managed connection use one client factory and invocation path. Clients advertise form and URL elicitation only. Roots, sampling and asynchronous tasks are not implemented. Server callbacks cannot grant tool permissions or select a bot, room or turn: the daemon binds them to the current invocation. Calls are serialized per upstream connection to keep callback ownership unambiguous.

Every tool retains the central policy gate. Only trusted administrator declarations can classify it as read/search/browse; remote hints do not confer trust. Writes and unknown tools remain approval-gated. A provider asking for input is not another approval to execute an OpenAg tool. Answering it creates no additional action receipt and does not resolve an existing Unknown receipt.

## Connection sessions and provider workflows

An MCP connection session negotiates capabilities; a provider workflow is context carried in tool arguments. They are distinct from the bot's conversation and from action approval. Reusing a provider workflow never reuses an earlier permission response.

Stateful HTTP connections retain their negotiated session. When an HTTP endpoint returns no MCP session ID, each invocation gets a fresh initialized client before dispatch, with a fifteen-second negotiation deadline covering headers and body, through the same shared path for configured and managed integrations. The catalogue connection is retained for offering/status. The invocation client loads the bounded complete catalogue, verifies the exact approved tool contract, and primes that tool's catalogue page so SDK output-schema validation and task restrictions remain active. Changed, duplicate, incomplete or unsupported contracts and failed negotiation stop as Not-run before tools/call. Stateful HTTP and stdio keep their existing invocation path.

The parent connection still serializes calls. Each stateless invocation owns its callback channel and closes it on completion or cancellation, preventing an earlier callback from being reassigned to the next invocation. Provider workflow arguments are passed unchanged. This does not reconnect provider accounts, weaken provider permission controls, replay a tool call after failure, or clear an Unknown receipt. It adds an initialization/catalogue exchange per stateless invocation; unsupported protocol versions still fail closed.

## Needs you: server input

During an interactive turn, open supported requests appear inline in their originating chat, even with technical activity hidden, and in **Needs you → Questions**, attributed to the originating bot and conversation. The chat uses the same response form and authenticated gateway; it removes the prompt when the request closes. The detail identifies the server and tool. A Full access device or the owner can submit a response, Decline, or Cancel. Limited devices cannot read the details or answer. The same narrow routes work over an authenticated device data channel; this exposes no MCP configuration or reload route.

Form inputs are explicit: defaults are never prefilled or silently submitted, and required values are validated against the requested schema. Supported fields are the SDK's flat primitive and choice forms, including titled single/multiple choices. Credential-shaped fields are refused; do not enter passwords, API keys or payment details. Redacted request/response evidence is retained for review. Form responses never enter browser storage. URL mode displays the destination host and requires the user to open an HTTPS page; it does not navigate automatically. Provider URLs may carry credentials, so they remain only in memory and are omitted from the database and ledger. A provider URL is untrusted and consent there remains separate from OpenAg access.

The request expires within two minutes, bounded by the invocation's remaining deadline. The provider may cancel sooner; the local deadline cannot extend its response window. These requests refresh the Needs you badge and Questions list. Newly opened requests also use the configured push service: one minimal response-needed notification per interaction ID, sharing enablement, topic, redaction, rate caps and transport-failure isolation with other notifications. Provider text, choices, form values and URLs are omitted. Decision events and chat reloads do not send a push; startup does not replay notifications. Opening a notification uses the existing configured desk URL and grants no consent. Multiple/overlapping requests share a two-minute human-wait budget; execution has its own configured timeout. A non-streaming tool response may wait for headers within that invocation budget; handshake and other protocol requests retain a separate fifteen-second header bound. At most four requests may be open and sixteen may be created per invocation. Cancellation, parent completion and shutdown settle outstanding callbacks. Startup marks saved open requests Interrupted; it never restores callbacks, reopens URLs or retries the tool. Stale revisions, stopped parents and duplicate answers are rejected. Unattended and isolated turns cannot solicit interactive input.

An MCP URL-interaction-required error can expose a bounded set of explicit URL requests through the same review path. The tool call remains a returned error and is never replayed, even when the owner visits the page.

## Tool catalogue integrity

Remote input schemas are converted and enforced before approval and execution for every integration. Unsupported schemas and tools declaring task support **required** are unavailable with a diagnostic in the connection details. No asynchronous task engine or synchronous fallback is implied. An integration with only unavailable tools is shown as unavailable in App library.

Pagination must terminate without repeated cursors, within twenty pages and two hundred tools. Incomplete/invalid listings are diagnosed instead of published as complete. Duplicate tool names are refused. Catalogue-change notifications suspend new offering, load a replacement catalogue atomically, and assign a new contract version. Pending approvals and queued calls from the old contract cannot dispatch. An already dispatched call keeps its connection while a valid replacement catalogue loads. A broken connection or invalid replacement can still make that invocation uncertain; no automatic replay follows.

## Returned evidence and cancellation

Replies preserve text, structured-only data and the error flag in a redacted untrusted envelope. Unsupported media/resource blocks have explicit omission markers. Large evidence is projected as bounded **valid JSON**, with truncation metadata and excerpts rather than a broken JSON prefix. Returned tool errors survive into the caller and action receipt; they are not reduced to a short message. Transport exceptions retain a bounded redacted diagnostic, not an invented successful reply.

Every returned MCP invocation completes or fails according to the protocol result, independently of permission class or tool-name recognition. Managed Composio envelopes also validate nested provider results before this verdict. Receipts, ledger results and bot responses carry `effectVerification: not-checked` separately; completed invocation does not establish an external change. Transport loss, timeout, cancellation or interruption without a returned result can still retain Unknown. Historical receipts are not rewritten. The scoped MCP error envelope preserves the failed invocation receipt and returned evidence. An apparent provider success never confirms a write or authorizes a retry. Caller cancellation reaches the SDK request; queued cancellation settles promptly without dispatch. Cancellation does not prove rollback of an external effect.

## Verification and limits

See [implementation verification](mcp-lifecycle-verification.md) for exact results. Tests use temporary databases and synthetic remote tools, including both real ACP adapters. They do not read Outlook, contact a live provider, reconcile receipt #6 or deploy source. The historical audit remains unchanged as before-fix evidence. Task support, roots, sampling, usable remote media and provider-specific business acceptance are outside this implementation.

Desk server-input forms use shared labelled fields. Multiple-choice lists use checkbox groups; booleans retain Choose/Yes/No so untouched values remain missing rather than becoming false. Numeric inputs retain numbers and decimal support. These controls do not grant action permission, replay an invocation or collect provider credentials.

## Connection ownership

Catalogue initialization has a fifteen-second deadline. Timeout, reload and shutdown cancel pending setup; every late connection is closed instead of published. Shutdown also awaits abandoned setup cleanup and in-flight handle closure. Handle-close failures are retained and make shutdown report incomplete cleanup; acquisition failure alone does not imply a leaked handle. Stdio closure waits for its owned child to exit, escalating from TERM to KILL after two seconds. This stops the local transport, not previously accepted remote effects; Unknown receipts and no-replay rules remain. See [execution ownership](execution-ownership.md) for source acceptance.

Tool inputs must have an explicit object root, including unions of object branches. Invalid remote catalogues remain unavailable; the client does not silently reinterpret an invalid provider contract. The Bivouac correction is in its API registry exporter: input-mode JSON Schema keeps defaults optional and adds the object root without dropping union constraints. A provider source fix does not establish deployment.
