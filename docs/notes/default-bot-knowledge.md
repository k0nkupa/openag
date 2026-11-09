# Default bot knowledge: research and recommendation

Researched: 2 November 2026 (Pacific/Auckland). Scope: design research, not implementation or deployment. Sources: current OpenAg source and official protocol documentation. Local code references describe the inspected working tree; they do not prove the running service has the same behavior.

## Recommendation

Give the default bot a small, release-bundled OpenAg handbook, a short handbook index in each turn, and one first-party read tool to load a topic. Add carefully scoped live status separately. Use the existing prompt builder and authoritative tool gate. Start without embeddings, a new agent loop, a separate MCP server, or copies of product facts in every bot's MEMORY.md.

This is an engineering recommendation from the integration paths below, not a protocol requirement. The three sources answer different questions:

| Source | Example question | Freshness |
| --- | --- | --- |
| Short prompt introduction and topic index | “What can you help me do in OpenAg?” | Rebuilt each turn from the installed release |
| On-demand handbook topic | “How do approvals and permissions work?” | Same bundle as the daemon |
| Explicit live read tool, later stage | “Is my heartbeat enabled?” | Timestamped, bounded read of current state |

## What exists today

- `ensureDefaultBot` creates a bot with one generic instruction sentence, only when no default is configured. Updating that constant would affect new bots, not existing customized defaults. The configured default can be resolved through `getDefaultBotId`. [Source: defaultbot.ts](../../apps/daemon/src/defaultbot.ts)
- The runner already rebuilds context each turn from bot instructions, the room roster, the memory head, vector recall and a skill index. It does not load a product manual. [Sources: runner.ts](../../apps/daemon/src/runtimes/runner.ts), [prompt.ts](../../apps/daemon/src/prompt.ts)
- Hosted API, Ollama and ACP all consume `ctx.prompt`. The API runtime supplies it as model input; Ollama supplies it in a user message; ACP sends it for each turn, including turns on a cached session. Therefore a common context addition can cover these runtimes, but it is not a new system-level security boundary. [Sources: api.ts](../../apps/daemon/src/runtimes/api.ts), [ollama.ts](../../apps/daemon/src/runtimes/ollama.ts), [acp.ts](../../apps/daemon/src/runtimes/acp.ts)
- First-party `ToolDef`s provide a shared description, schema, class and executor. The MCP endpoint registers tools and calls `ctx.callTool` on the active bot/room turn. ACP exposure also has an explicit `MCP_TOOL_NAMES` allow-list; adding only a tool definition would miss this path. There is no product-resource registration in the inspected MCP server. [Sources: registry.ts](../../apps/daemon/src/tools/registry.ts), [firstparty.ts](../../apps/daemon/src/tools/firstparty.ts), [main.ts](../../apps/daemon/src/main.ts), [mcpserver.ts](../../apps/daemon/src/mcpserver.ts)
- Skills already demonstrate a compact prompt index plus a `read` tool that loads bounded content as data. Their storage is per bot and writable through approval; that storage should not become the canonical publisher of release-owned product help. [Sources: tools/skills.ts](../../apps/daemon/src/tools/skills.ts), [skills.ts](../../apps/daemon/src/skills.ts)
- The current daemon build compiles TypeScript and copies migrations, but has no handbook asset copy step. A source Markdown file alone would not establish packaged runtime availability. [Source: daemon package.json](../../apps/daemon/package.json)

## Protocol findings and options

MCP resources expose application context through URIs, but the host application chooses how to include it. Advertising a resource does not force the model to read it. Resources are useful for a future help browser; they are not the smallest dependable delivery path here. [Official MCP resources specification, version 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)

MCP tools are model-controlled and include discoverable descriptions and schemas. That fits a question-driven `openag_help` read tool through OpenAg's existing gate. Protocol annotations are not authorization: the server must enforce the read-only implementation and OpenAg policy. [Official MCP tools specification, version 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

ACP v1 supports text prompt blocks as a baseline; embedded resource blocks require negotiated `embeddedContext`. Embedded context is an option when supported, not a prerequisite for a plain-text index. OpenAg already negotiates this capability for attachments. [Official ACP initialization](https://agentclientprotocol.com/protocol/v1/initialization), [official ACP content](https://agentclientprotocol.com/protocol/v1/content), [local ACP implementation](../../apps/daemon/src/runtimes/acp.ts)

These versioned protocol pages support the design comparison. They are not a claim that OpenAg has migrated to any newer protocol draft or that installed adapters automatically consume server resources.

| Option | Assessment |
| --- | --- |
| Put the full manual in each prompt | Simple transport, but pays for unrelated content every turn. Keep only a small introduction and index there. |
| Copy facts into default-bot instructions, MEMORY or skills | Existing mechanisms, but copies drift, mix product facts with personal data, and require existing-install/default-switch updates. Avoid as the release source. |
| MCP resources only | Appropriate representation of documentation, but host inclusion and cross-runtime consumers require extra integration. Defer. |
| Bundled topics + shared read tool | Recommended. Matches existing prompt/tool paths and works without network or embedding services. |
| Vector retrieval over the whole repository | Unnecessary first step. Tickets and design notes mix plans with shipped behavior. Revisit search only if the curated manual becomes too large for a clear topic index. |

## Stage 1: product knowledge delivery

The following names and limits are proposals, not existing interfaces.

1. Author curated, user-facing topics in a source-controlled help folder, for example `docs/help/`. Start with a short overview and topics for bots/models, direct chats/rooms, Work versus chat, approvals/permissions, memory/skills, proactive features/automations, and computer/connectors. Explain where controls live, what needs approval, prerequisites and known limits. Include only behavior verified against source; label unfinished or unverified behavior. Treat `docs/openag.md` as product context to reconcile, not a ready-to-ship manual: it contains product direction and candidate capabilities. [Source: product notes](../openag.md)
2. Keep a small explicit topic manifest: slug, title, question-oriented description and canonical source references. Copy or generate the handbook bundle during the daemon build. The bundled text is a release artifact, not a second independently edited source. Exclude tickets, AGENTS/CLAUDE instructions, user memory, arbitrary repository files and secrets.
3. Add the guide introduction/index at the common runner/prompt boundary. Resolve the default identity from settings each turn; do not identify it by the literal handle `bot` or rewrite stored custom instructions. Existing installations and a replacement default then receive current help on their next turn. Keep the product facts separate from execution instructions and user input. [Integration sources: defaultbot.ts](../../apps/daemon/src/defaultbot.ts), [runner.ts](../../apps/daemon/src/runtimes/runner.ts), [prompt.ts](../../apps/daemon/src/prompt.ts)
4. Add `openag_help({topic})`, a strict-schema `read` ToolDef registered once and added to the ACP MCP allow-list. Return a bounded topic body, title, source reference, bundle version/hash, and an explicit not-found result. Allow topic IDs only; accept no file paths, URLs, SQL or shell commands. Mirror the existing skill-load data boundary while keeping release-owned help immutable to bots. [Integration sources: registry.ts](../../apps/daemon/src/tools/registry.ts), [tools/skills.ts](../../apps/daemon/src/tools/skills.ts), [mcpserver.ts](../../apps/daemon/src/mcpserver.ts)
5. Apply fixed limits, for example a 2 KB introduction/index and 12 KB per topic. Reject oversized authoring input instead of silently cutting essential instructions. Resolve files from the packaged asset location, never the bot working directory or `$OPENAG_DATA`. Validate allow-listed paths and reject symlinks if assets are read from disk. Return an explicit unavailable state for missing/bad assets; never substitute model recall as verified help.
6. Include the bundle version in every turn's index and every topic response. Serve a single immutable bundle per daemon process and replace it with a release/restart. Cached ACP conversation history may contain older answers: instruct the bot to use the current bundle and re-read the topic when answering product questions. Do not restart active sessions or replay pending tools merely to update prose.

Public product help can safely be offered to all bots; the default should always get the explicit orientation/index. This is simpler than treating public documentation as privileged. If v1 limits the tool to the default, validate that identity in the executor, not only by hiding its description. Either policy must leave isolated turns tool-free and preserve unattended mode restrictions. [Sources: runner authorization](../../apps/daemon/src/runtimes/runner.ts), [policy.ts](../../apps/daemon/src/policy.ts)

## Stage 2: live read-only introspection

Implement a separate bounded status tool only after defining its visibility. Start with current bot/current room and non-sensitive feature readiness booleans. Useful fields are configured default, requested versus last-reported model with timestamps, current bot permission modes, and readiness/unavailable reasons. Report configuration separately from observed runtime acceptance. Reuse daemon services directly rather than loopback HTTP calls with owner credentials. [Sources: defaultbot.ts](../../apps/daemon/src/defaultbot.ts), [botmodels.ts](../../apps/daemon/src/botmodels.ts), [readiness.ts](../../apps/daemon/src/readiness.ts)

The default-bot role is not owner authorization. `ToolExecContext` carries bot/room/turn identity but no originating device access flag. Therefore global settings, cross-room approvals, private bot instructions and integration details cannot be exposed merely because this is the default. Broader inspection needs an explicit authorization design that also covers shared rooms, Slack and unattended turns. [Sources: ToolExecContext](../../apps/daemon/src/tools/registry.ts), [auth.ts](../../apps/daemon/src/auth.ts), [ingress.ts](../../apps/daemon/src/ingress.ts), [slack.ts](../../apps/daemon/src/slack.ts)

Use explicit output projections, not `GET /settings` or an arbitrary GET proxy. Even existing status responses need review: Models status includes provider-key suffixes, which this tool does not need. Strip secret fragments, push topics, invite URLs, token material, environment values, private content and raw provider errors; apply the existing redactor as an additional defense. Include `observedAt`, visibility scope and unavailable reasons. Status reads must not create a direct room, start a model or computer, probe a provider at cost, refresh credentials, or change readiness settings. [Sources: models.ts](../../apps/daemon/src/models.ts), [redact.ts](../../apps/daemon/src/redact.ts), [readiness.ts](../../apps/daemon/src/readiness.ts)

## Keeping knowledge current

The new rules in AGENTS.md and CLAUDE.md require same-change knowledge maintenance and evidence that the default bot can receive it. Make that concrete in the eventual implementation: feature authors update affected canonical help topics and source references, rebuild the handbook, and record changed topics plus verification in the ticket Log. If no help is affected, record why. A manifest/build check can prove assets and links exist; it cannot prove the explanation matches feature behavior. Review must still compare affected help with the source change. [Sources: AGENTS.md](../../AGENTS.md), [CLAUDE.md](../../CLAUDE.md)

Keep installation facts out of this manual. Use release version/hash for static help and observed timestamps for live state. Do not claim an updated checkout means an updated daemon or correct real-model answers.

## Proposed acceptance checks

Use builds, TypeScript checks and standalone assert-based scripts; no unit/Jest/Vitest runner.

- Build from clean output and verify the packaged assets load with a different working directory and no source-doc directory available.
- Validate all manifest references, unique slugs, byte limits and bundle hashes; assert bad topics, traversal and symlink cases cannot escape the allow-list.
- Capture the constructed prompt for existing/default-replacement bots and all three runtime paths. Verify updated index/version delivery without overwriting custom instructions, memory, skills or approval state.
- Run a controlled tool call through both API and ACP/MCP boundaries. Verify the same executor, policy classification, caps and failure shapes. Confirm isolated denial and unattended read-policy behavior.
- Use synthetic facts to check that status results omit secrets and other-room/private data; verify reads have no write or lifecycle side effects.
- Later, with applicable authority, ask the real default bot representative questions: how to add a bot, where permissions live, why a tool asks, whether a specific feature is configured, and what remains unavailable. Inspect the answer and actual tool calls. Prompt capture and stubbed calls establish transport, not model behavior.

Concrete answer checks (ticket states must be refreshed when implementing):

| User question | Required behavior |
| --- | --- |
| “How do I create a bot?” | If OA-345 is still pending, say the New bot flow is not implemented; do not invent a working button. |
| “Why does every message become Work?” | Distinguish the UI visibility fix from OA-342's pending separation of chat execution and Work creation; do not claim hiding cards fixed the data model. |
| “What model am I using?” | Distinguish requested configuration from last-reported runtime model/reasoning and timestamp; use Not reported when evidence is absent. |
| “Is heartbeat enabled?” | Read authorized live state, report observation time, and omit tokens, topics and key fragments. Without authorized status access, explain how to check instead of guessing. |

Ticket and reporting sources: [ROADMAP.md](../../ROADMAP.md), [botmodels.ts](../../apps/daemon/src/botmodels.ts), [models.ts](../../apps/daemon/src/models.ts).

## Limits of this research

No implementation, build, tests, deployment, live configuration reads/writes or paid model calls were performed. Source and current official docs were inspected; installed adapter behavior for a new help tool remains to be verified. The document is an implementation recommendation, not a completed runtime capability.

## Implementation handoff

The approved design is now implemented in source. The research above records the original findings; this section describes the resulting implementation.

- Canonical user help lives in `docs/help/manifest.json` and eight topic Markdown files. `scripts/build-knowledge.mjs` validates them and publishes an immutable, content-hashed `apps/daemon/dist/knowledge.json` during the daemon build. Runtime loading uses the packaged location, not the checkout working directory. Invalid/missing assets produce an explicit unavailable state.
- `knowledge.ts` owns topic validation, fixed limits and loading. The runner resolves the configured default each turn and supplies its handbook orientation without rewriting bot instructions or memory. Public help remains callable by other bots.
- `openag_help` and `openag_status` are read-class first-party tools shared by API/Ollama and the allow-listed ACP MCP path. Existing isolated/unattended restrictions remain authoritative.
- Status exposes only the caller bot's permissions and requested/last-reported model in the current room, plus the installation-wide heartbeat/reflection/brief enabled booleans approved in the plan. It returns an observation timestamp, no private cross-room content, credentials, key fragments, arbitrary settings or provider errors. It performs no network probes or configuration/lifecycle changes.
- AGENTS.md and CLAUDE.md identify the handbook and acceptance command as part of same-change knowledge maintenance. Update the affected topic whenever implementation changes; planned work must stay labelled as unavailable until built. Do not edit generated JSON or copy this material into personal MEMORY.

Verification: `pnpm -r build` passed (existing desk chunk-size warning remains). `node scripts/verify-bot-knowledge.mjs` passed four integration groups: packaged delivery and asset failures; status visibility/freshness/no writes; real runtime interfaces with controlled API/Ollama/ACP transports including cached sessions/default replacement; and unattended/isolated/denied read policies. All checks used temporary data; no unit/Jest/Vitest runner, real provider, paid model call, production data or daemon restart was used. Real model answer accuracy and deployed delivery are still unverified.

Review follow-up: the shared handbook schema rejects recognized or registered credentials before packaging; runtime help also applies redaction. The acceptance script runs the actual packager against disposable malformed source fixtures (duplicates, traversal, bad references, oversized topics, credentials and symlinks). These cases pass.

Codex review follow-up: status preserves the latest report separately for each evidence source (session and response), filtered to this bot and room, with individual timestamps and configuration freshness. This avoids losing session reasoning when a later response reports only a model, or losing response evidence when a new session starts. The standalone acceptance covers both sequences.

Review gate: local Standards and Spec reviews passed after the credential safeguard and negative-build fixtures. Built-in `codex review --uncommitted` reviewed an isolated copy of the intended diff against `4d19262815761e903d666f6f3208d8e53fe49385`, excluding unrelated `.claude/worktrees/`. Its model-evidence finding was fixed and validated; the focused re-review reported no remaining concrete blockers. Both Codex reviews were source-only and ran no builds, tests or live actions.
