# Slack channel (OA-213)

Socket Mode, outbound only (no tunnel, no public URL). Verified against docs.slack.dev (Socket Mode, chat.postMessage):
- `POST https://slack.com/api/apps.connections.open` with `Authorization: Bearer xapp-…` (app-level token) returns `{ok:true,url:"wss://wss.slack.com/link/?ticket=…"}`; the URL must be `wss` on a Slack host (checked by `isSlackSocketUrl`).
- Frames: `hello` (connected), `events_api` envelopes `{envelope_id, type, payload:{type:"event_callback", event}}`, `disconnect` (`warning`, `refresh_requested`, `link_disabled`). Every envelope is acked with `{"envelope_id": "…"}`. Connections are refreshed regularly, so reconnect with back-off (1 s to 60 s).
- Replies: `POST https://slack.com/api/chat.postMessage` (`Authorization: Bearer xoxb-…`, JSON), `channel`, `thread_ts`, `text` (<= 4000 recommended), `parse:"none"`, `link_names/unfurl_*:false`. Errors come as `{ok:false,error}`; 429 has `Retry-After` (retried once, max 30 s).
- NOT verified live: no Slack workspace/app was available. Everything is covered by unit tests with a fake socket and fetch (`slack.test.ts`, `gateway.slack.test.ts`).

## Slack app setup (manual)
1. Create an app, enable **Socket Mode**, create an app-level token with `connections:write` (xapp-).
2. Bot token scopes: `chat:write`, `channels:history` (public) and/or `groups:history` (private). Subscribe to the bot events `message.channels` / `message.groups`. Install it and invite the bot to the channel.
3. Daemon env: `SLACK_APP_TOKEN=xapp-…`, `SLACK_BOT_TOKEN=xoxb-…` (never in the DB or API).
4. Desk, Connectors, Slack (Full access): room id, channel id, the allowed Slack user ids, enable. The connection badge reflects observed state; changing the enable switch alone is not a saved configuration. Server setup and Connection activity are collapsed disclosures. Credentials remain outside the form.

## Rules
- Only the one configured channel; only the listed user ids (empty list = nobody); bots, edits, joins, files, DMs are ignored.
- An inbound message is a normal user message (actor `slack`, text prefixed `[Slack]`, redacted), rate limited to 10 per user per minute and de-duplicated. Same policy gate and approvals as the desk.
- Approvals are never decided from Slack. Slack only gets "Waiting for your approval in the OpenAg desk." (no tool, no payload, no id).
- Only replies to Slack-originated messages go to Slack, in that message's thread (including the lead's answer after a delegation). Text is escaped (`& < >`) so a bot cannot ping `@channel` or create links.
- A delegated specialist stays silent in Slack (its output and approval notices stay in the desk); the lead's answer after the delegation returns to the same thread.
- Trust: an allowed Slack user talks to the bot with the same authority as a desk message (auto tools run unprompted, MEMORY/recall are in the prompt) and the reply is visible to EVERYONE in the channel. Only add users and channels you trust with that. Slack turns are vector-indexed like desk turns. Approvals do not say they came from Slack (Phase 4 idea: a source tag in the Inbox).
- No liveness ping: a half-open socket (sleep, Wi-Fi change) is only noticed when the OS closes it; `POST`ing a settings save (reload) reconnects.
- Slack bot tokens and the app token are stripped from bot (ACP) processes.
