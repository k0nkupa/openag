# Part 3B — integration discovery, setup and management

## Destinations (OA-413)

App library owns discovery, requirements and initial setup. Settings, Connectors owns added/partially configured integrations and existing account/runtime actions. Both reuse AppLibraryProvider; there is no second catalogue or client data store. The old Installed tab is replaced by Manage connections.

Details use additive `#/app-library/:integrationId` and `#/connectors/:integrationId` addresses with encoded inventory IDs. List routes remain compatible. Discovery details offer setup or a link to management rather than existing runtime enable/disable controls. Unknown/removed entries remain explicit; a known unadded entry in Connectors links to its setup. Closing returns to the base list and restores the opening control or search field. The shared route guard continues to own navigation.

Native shadcn parts and the existing provider implementations remain in use. No provider action, installation, reload or permission request runs merely from opening discovery or setup. Specific consent, installation and management actions retain their existing authorization.

Evidence and limits: OA-413. Each following section records its own acceptance and limits.

## Guided local setup (OA-414)

Requirements precede package review. Source, version, target and access are visible before acknowledgement; Package details expands the exact SHA-256 and destination. Acknowledgement reveals the pinned command for a terminal on that machine. The browser never executes it. Reload and check installation explicitly scans Apps; Reconnect and check installation explicitly reconnects configured MCP servers. Fresh status and review are required; a changed digest, machine or command clears acknowledgement. Failed readback clears the old acknowledgement and cannot show a successful check. Rollback is secondary and preserves existing code/data. App detection links to Connectors, where Review and enable remains a separate hash-bound approval.

Evidence: OA-414.

## Account management (OA-415)

Management keeps existing account/service actions. Native AlertDialog confirmations focus Keep connection first; Escape, outside dismissal and Keep connection cancel. Failed disconnects stay open with their error. Google confirmation explicitly covers both Gmail and Drive; pause/resume and read checks still target one service. Composio disconnect removes local access and does not claim provider grant revocation. Existing Full-device enforcement, trusted sign-in URLs and cancellation remain authoritative.

Callback cleanup preserves only an integration destination. A validated session-only Gmail/Drive name restores Google context (Gmail fallback when unavailable); no code/token is stored. Composio uses its selected entry. Return to connection uses the shared inventory to choose management or initial setup. Missing/stale inventory falls back to selected setup; dismissal never waits for a network request. Direct callbacks still exchange a single-use code once under StrictMode; hosted return hints remain display-only, with authenticated readback. No callback origin or credential lifecycle changes.

Evidence: OA-415. Controlled manager checks establish UI/gateway behavior, not real Google/Composio consent or provider acceptance.

## Maintenance and freshness (OA-416)

Refresh status remains a passive inventory read and reports success/failure explicitly. Reload app folders and Reconnect MCP live under Advanced maintenance, including runtime-specific panels; MCP reconnect is explicitly all configured servers. No automatic repair or action retry was added. Known inventory states drive the primary next step. Connection details retains exact daemon-sanitized diagnostics, source/version and requirements. Routine permission/provider explanations live in help; explicit setup review and disconnect scopes remain at the decision.

One shared reader still coalesces/queues refreshes; the final read returns its fresh inventory or null. Stale snapshots remain visible with Status unavailable rather than a ready badge. Account actions and review acknowledgements stop on failed reads. Setup and enable acknowledgements clear, action notices stay hidden until successful readback, and failed readback offers read-only inspection without replaying the operation. Successful account readback cannot mask a failed shared-inventory read.

Evidence: OA-416. Part 3B source completion does not establish live-provider consent, deployment or physical-device/screen-reader acceptance.

## Custom MCP servers (OA-454)

Settings, Connectors owns them. The owner sees **Add MCP server** above the installed list and, inside a custom server's details (Overview), **Server settings**: an Enabled switch, an Offer tools to agents switch (both save at once with the file digest), Edit and Remove (Remove asks first). Cards of custom servers read "Custom MCP server"; built-in servers and managed connections explain who manages them, and a custom server that runs a command is read-only here until its command review exists (OA-456). A limited device sees no controls and the daemon refuses its writes.

The Add and Edit dialog keeps what you typed when the daemon refuses it and shows the reason with a one-line hint (`blocked private address`, `http requires allowPrivateNetwork`, a header reference that is not an `OPENAG_MCP_` variable, `missing env`). A stale digest (the file changed elsewhere) reloads it: fields you did not edit take the latest value and yours are kept, so a save never replaces another writer's change with an old copy. A hidden (redacted) header value is never resubmitted. Header values are references to `OPENAG_MCP_<NAME>` variables or to stored `${secret:NAME}` secrets. When a header refers to a secret the dialog shows a write-only password field (placeholder `Not set` or `Set, ending ####`, blank means keep, `Delete NAME` takes effect at once); typed values are sent after the server is saved, and if a secret is refused the dialog stays open and a retry sends only the secrets. The desk never shows a stored value. A custom command is added with **Add local command** (next to Add MCP server): a form (name, program, one argument per line, environment rows, timeout, offer switch) whose only action is **Review command**, which proposes an inline approval card (title "You asked OpenAg to review a command", buttons **Approve command** and **Cancel review**, no Edit or Respond) showing the program, arguments, environment names, working directory, review code and the not-sandboxed warning. Editing the form drops a proposal in progress. Approval saves and starts the command, then stores typed secrets bound to its exact program and arguments; Edit on a reviewed command opens the same dialog and an edit changes nothing until approved. Operator-written commands say they stay managed in mcp.json. A remote server can switch on **Sign in with OAuth** (and a scope) in Add or Edit; its settings then show a Sign-in section: a **Signed in** or **Needs sign-in** badge, **Sign in** (a pop-up opened first, then pointed at the provider; the panel polls the attempt and offers **Cancel sign-in**), **Disconnect** (local only), and a **Registered client** form with a write-only secret. No token, code or secret is ever rendered. A missing secret appears as `missing secret NAME` with a hint to open Edit.

**Check server** proposes a server check inside the dialog: the approval is shown there (`ApprovalCard`, without Edit or Respond, which mean nothing for a check; the cancel button reads Cancel check), nothing is contacted until you accept it, editing the form drops the proposal and any result, the result lists up to 50 tools as plain text, and nothing is saved. Evidence is `node scripts/verify-mcp-desk.mjs` (real components in jsdom against a real in-process gateway, manager, write service and check module, with a breakage for each guard). Limits: jsdom proves behaviour and text, not layout, so desktop and 390 px appearance and screen-reader use are not established by it.
