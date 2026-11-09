# OSS Apple app connectors

Checked 2 November 2026 against upstream documentation and selected source files. Research only: no install, permission grant, app access, or runtime acceptance check.

## What the screenshot represents

The screenshot identifies `MrGo2/icloud-mcp` and displays a version of 1.1.0. That display alone does not establish the underlying MCP package version: a marketplace/plugin version can differ from its dependency version. Upstream `package.json` currently says **2.1.3**. The package is `mcp-icloud`, MIT licensed, Node 20+, and uses MCP over stdin/stdout; it opens no listening port. [Package](https://github.com/MrGo2/icloud-mcp/blob/main/package.json), [README](https://github.com/MrGo2/icloud-mcp#readme).

It has two distinct backends:

| Backend | Services and mechanism | Access |
| --- | --- | --- |
| Local, default | Mail, Calendar, Contacts, Reminders, Notes, Messages, Safari through native macOS apps. AppleScript/JXA runs through `osascript`; Messages history additionally runs `imsg`. | No Apple password or OAuth. macOS Automation grants per app; Messages history also needs Full Disk Access for the launching host process. Runs against the apps/accounts on the Mac executing the server. |
| Cloud | Email via IMAP/SMTP, Calendar via CalDAV, Contacts via CardDAV. The other four services reject cloud-mode calls. | iCloud address and app-specific password; Apple account must have two-factor authentication. Can run on other operating systems. |

Sources: [README access, permissions and limitations](https://github.com/MrGo2/icloud-mcp#readme), [osascript executor](https://github.com/MrGo2/icloud-mcp/blob/main/utils/applescript.js), [Messages handlers](https://github.com/MrGo2/icloud-mcp/blob/main/messages/index.js).

This is an app-automation bridge, not one Apple cloud API covering all seven services. Local Mail/Calendar can reach accounts configured in those apps; cloud mode is explicitly iCloud. Local large-mailbox and large-calendar reads have documented AppleScript timeout problems. The README describes an EventKit calendar backend as planned, not implemented. Local tool execution also does not mean the contents stay local: returned text is available to the connected AI client/model. [README](https://github.com/MrGo2/icloud-mcp#readme).

## Alternatives and reusable patterns

| Project | Actual approach | Assessment |
| --- | --- | --- |
| [supermemoryai/apple-mcp](https://github.com/supermemoryai/apple-mcp) | Broad, MIT-licensed Apple MCP bundle, Bun/TypeScript, local AppleScript. Advertises Messages, Notes, Contacts, Mail, Reminders, Calendar and Maps. | Archived on 1 January 2026. Its Calendar source constructs a dummy event in `getEvents` and returns an empty search result rather than querying real events. Treat it as a reference, not evidence that advertised capabilities work. [Calendar source](https://github.com/supermemoryai/apple-mcp/blob/main/utils/calendar.ts). |
| [openclaw/remindctl](https://github.com/openclaw/remindctl) (original `steipete/remindctl` URL redirects here) | Focused Swift CLI using Apple's public EventKit APIs; JSON output, explicit status/authorize commands. macOS 14+, full Reminders permission. | A cleaner pattern for structured Reminders access than screen automation. Public API limits remain: no native sections/tags/smart lists/attachments/private Urgent toggle. Shared-list moves can fail; the tool deliberately avoids lossy copy/delete workarounds. [README](https://github.com/openclaw/remindctl#readme). |
| [openclaw/imsg](https://github.com/openclaw/imsg) (original `steipete/imsg` URL redirects here) | Focused Swift CLI: opens local `~/Library/Messages/chat.db` read-only for history, sends using Messages.app automation; NDJSON and stdio JSON-RPC. | Standard reads need Full Disk Access; sends need Automation → Messages; SMS needs iPhone forwarding. Linux can inspect a copied database but cannot connect to iMessage or send. Advanced private-framework features require SIP changes; exclude those from an ordinary connector. [README](https://github.com/openclaw/imsg#readme). |

## Implications for OpenAg

Recommended design inference from these implementations:

- Reuse a pinned, reviewed MCP package or focused CLI; the catalog entry is setup/status UI over an existing protocol, not a reason to build another agent loop.
- Label Apple access with the executing Mac, for example **Apple apps on host**. A phone browser connecting to the daemon does not move the connector to the phone or another Mac.
- Separate **installed**, **permission granted**, and **verified read** states. An MCP connection alone proves neither app permissions nor usable calendar/mail data.
- Keep macOS grants separate from OpenAg action approval. macOS permission lets the process reach the app; OpenAg must still gate send/create/update/delete per operation. Do not trust MCP behavioral hints as the authority for tool classification.
- Start with read-only Mail/Calendar/Reminders and a small real-data acceptance check. Keep write tools separately approved. For scale, investigate a public EventKit Calendar/Reminders bridge; retain AppleScript where no suitable public API exists.

No runtime reliability, packaged-version integrity, daemon/launchd permission behavior, or complete security audit was established by this research.
