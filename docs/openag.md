# OpenAg

Always-on multi-agent desk you own — same job as Grok Bot / OpenAI Dots / Claude Duet.

**Host:** the always-on machine that runs `openagd`  

---

## Product shape

- **1 Primary** orchestrator (Boss) — routes work, owns continuity
- **Rooms** — optional named spaces with one or more bots and a lead; distinct from direct chats; @mention / @everyone. Owner/Full devices create them from the plus beside Rooms; see [room creation](notes/room-creation.md).
- **Proactive** — morning briefs, quiet check-ins, routines (only ping when worth it)
- **Permission sessions** govern action execution. A mode grants no new user intent or provider consent; background responsibilities still investigate/propose only.
- **Computer use required** on every serious bot
- **Local-first** state on the host machine; other Macs/phones are clients

---

## Desk consistency

The desk uses one shared control system across conversations, settings, integration setup and diagnostic views. Model selection keeps search and provider grouping while matching effort selection. Unsaved edits use Keep editing / Discard changes dialogs; pending saves require another navigation attempt after they finish. Reload warnings remain browser-owned. See [editing and interface behaviour](notes/settings-polish.md).

## Models

Bots are persistent agents, distinct from their models. Owners and Full devices can create a bot from the plus beside **Agents** in the sidebar. Display names may repeat; each agent has a unique, stable @handle. Creation itself starts no conversation, turn or Work and grants no room membership. After creation the desk opens the agent’s direct conversation through the existing chat action. See [bot creation and acceptance limits](notes/bot-creation.md).

- Any model the user has access to
- Cloud APIs (OpenAI, Anthropic, Nebius, etc.)
- **Local CLIs bound to subscriptions** (Claude Code, Codex, Grok CLI, Cursor, … via ACP-style)
- Optional Ollama / local servers

### Room router (optional)

| Mode | Behavior |
|---|---|
| Jev (TypeSafe) or OpenAI decision API | Auto-pick best bot in a room |
| **Default if missing** | Room **lead** answers; @mentions still work |
| Optional fallback | Cheap same-model “pick one bot” only if a chat model key exists |

---

## Local DB / memory (required hybrid)

1. **SQLite (WAL)** — bots, rooms, threads, approvals, routines, plugin configs, encrypted credentials  
2. **`MEMORY.md` per bot** — human-editable standing notes (capped head always in prompt)  
3. **Vector store required** — prefer **sqlite-vec** in the same DB for v1 (one backup); LanceDB if we outgrow it  
4. Index: memory chunks, thread summaries, plugin docs  
5. Redact secrets on write  
6. **Skills vs Memory** — facts → MEMORY; repeatable workflows → versioned agent-owned Skills, or owner-selected packages from a shared library. Discovery, assignment, dependency readiness and action approval are separate. See [the skills guide](notes/skills.md).

Nightly reflection saves validated memory notes automatically; users can remove notes in Saved memory. Agent-owned skill changes still require approval; reflection never edits the shared library.

---

## Computers

| Backend | Role |
|---|---|
| **Cua managed Linux** (`--tier slim --browser`) | **v1 default** durable computer (no local Docker required) |
| **CUA driver** | Computer use (must) — wraps the `cua` CLI |
| **Docker box** (Nightly-like) | Optional when Docker/OrbStack is available |
| **Browserbase** | Optional cloud computer |
| mini / VPS / E2B-style box | Always-on / bigger box when laptop sleeps |
| **Brave web search** | First-party search tool (optional; inert without key) |
| Human takeover | You grab the cursor, then hand back |

---

## Apps / plugins

- First-party **Apps** plugin SDK (Grok-style)
- Composio only as an *optional* bridge plugin — never the only path
- MCP servers as first-class connectors

---

## Conversation and explicit Work

Ordinary conversation and its approved tools, questions and saved results remain separate from Work. A model can propose Work through `create_work`; creation explicitly requires review (Never refuses) and produces a reviewed ready-to-start item. The owner starts it separately, and subsequent actions retain their own permission gates. Historical Work is preserved. See [explicit Work behavior and acceptance limits](notes/explicit-work.md).

## Continuity (all four modes)

The host machine is the single brain. Clients never fork a second DB.

1. **LAN** — default on the home network (`openag.local` / the host's LAN IP)  
2. **Tailscale** — optional private mesh for your Macs/phone  
3. **Cloudflare Tunnel** — optional public HTTPS (webhooks / no Tailscale); Access in front  
4. **Nightly-style WebRTC** — later: install app → join server without VPN (Signal + coturn pattern)

---

## Feature set (locked — all 12)

1. Heartbeat / quiet proactive + active hours  
2. Approval **Inbox** — Accept / Edit / Respond / Ignore  
3. Multi-backend computers — Cua managed (default) ↔ Docker ↔ Browserbase ↔ mini/VPS  
4. Subscription CLIs as first-class models (ACP-style)  
5. Automations as objects — cron, webhook, GitHub/Slack → bot + prompt  
6. `MEMORY.md` + nightly reflection; vectors index chunks  
7. Permission sessions per agent/conversation — Read Only / Workspace Write / Full access
8. Human takeover on the computer  
9. Visible Primary ledger in rooms  
10. Same bot on web + Slack (later)  
11. Skills vs Memory split  
12. Ambient watch — only speak on trigger  

---

## Coding stack (v1 opinion)

| Layer | Pick |
|---|---|
| UI | Next.js (Expo later for phone) |
| Language | TypeScript end-to-end |
| Agent harness | Mastra **or** AG-UI-compatible harness |
| DB | SQLite + MEMORY.md + sqlite-vec |
| Computers | Cua managed + CUA driver; Browserbase / Docker / VPS optional |
| Search | Brave |
| Jobs | Server cron + webhooks |
| Remote | LAN → Tailscale → CF Tunnel → WebRTC |

### What not to build first

Don’t invent a new agent loop, don’t force Composio, don’t make AutoGen/Crew Studio the core, don’t spam proactive without a “worth waking” filter.

### v1 ship bar

1 Primary + ≥2 specialists + 1 computer (Cua managed default) + SQLite/MEMORY/vectors + nightly reflection + Skills + In-chat approvals + morning Heartbeat + cron + ≥1 external automation trigger + LAN (+ Tailscale) + CF Tunnel for hooks.

---

## Cousins (inspiration only — not a fork mandate)

OpenHands (desk/automations/CLIs) · Letta (memory/proactive) · Cua (computer) · browser-use · Agent Zero Heartbeat · Nightly OpenBot (ACP + CUA + remote join) · OpenDuet (example UX only)

---

## Notes

- Product name: **OpenAg**  
- OpenDuet / CopilotKit / Nightly are references, not the chosen base until we decide  

*Written 27 Oct 2026 NZDT with Grok Bot from product chat. Computers + v1 ship bar updated 28 Oct 2026 after Phase 2 (Cua managed default).*

Composio is an optional browser-authenticated MCP connection in the App library, with no Composio API key required for that path. It uses the same approval and receipt rules as other tools; it is not the default connector path. Existing local API-key bridges remain available. See [Composio setup and limits](composio.md). Source implementation does not establish deployment or provider acceptance.

Standing-responsibility foundation (OA-368): the owner can review a source-scoped agreement separately from Work; controlled synthetic events exercise bounded investigation, evidence, proposed unsent replies and filtered delivery. The normal daemon has no live source adapter, and ACP investigations remain unsupported. See [responsibilities](notes/responsibilities.md) for implemented behavior and limits. This source change is not live Outlook monitoring or deployment.
Owner access: OpenAg retains its own credential. The host-authorized `pnpm desk:open` flow handles first browser sign-in and recovery; other devices pair from a trusted desk. See [owner access and recovery](notes/owner-access.md) for current behavior and limits.

Integration onboarding keeps installation ownership separate from provider consent. The daemon manages internal connector keys and token storage; the daemon selects a hosted or private callback route before consent, without ordinary users entering addresses. Browser/Host/forwarded input does not select that origin. Users connect and consent from Full access devices. A provider may still require operator-created client credentials. See [Composio](composio.md) for implemented setup and recovery, and the root glossary for terminology.

Agent avatars use bundled Open Bot Avatar characters and an installation-wide library of registered generated designs, with colour and motion preferences. Chat generation shows a validated preview; Full access can register it directly, while Read Only and Workspace Write require Inbox review; adding to the library and choosing an agent’s appearance are separate actions. Appearance is separate from agent identity; see [avatar behavior](notes/avatars/README.md).

Desk usability: primary destinations remain available on phones; agent replies have safe formatted text; computer inspection is separate from backend application; editable settings warn before discarding unsaved work. See the authoritative [conversation presentation](notes/conversation-model.md), [editing protection](notes/settings-polish.md) and [computer status/recovery](notes/cua.md) notes. These source changes require their own acceptance and deployment evidence.

Model selection uses a server-persisted catalogue with daily/manual refresh. Existing agents can switch between subscription runtimes and local Ollama while retaining identity and records. See [model selection](notes/model-picker.md) for setup, permissions, stale-data limits and acceptance scope.

Permission sessions use the daemon gate across API providers, Ollama and both ACP adapters. Native effects are disabled. Fresh installs start in Workspace Write; upgrades require owner review/adoption and retain old rules as an immutable archive. Full access uses Never, which refuses explicit review requests. Filesystem modes do not isolate reads or network effects. Supported execution worlds and limits are in [permission sessions](notes/permission-sessions.md) and [execution worlds](notes/permission-worlds.md). Source implementation does not establish deployment.

Agent-to-agent consultation and direct-chat guest mentions retain the initiating conversation without changing its membership. See [agent requests](notes/agent-requests.md) for behavior, permission limits and scoped acceptance.
