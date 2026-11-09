# Documentation index

Start with the guide for your task. Behavior notes describe the implementation; specs describe the agreed design. Dated acceptance and release records say what was actually checked or deployed. A plan, passing fixture and live provider result are different evidence.

## Using OpenAg

- [Quick start and project overview](../README.md)
- [Delivered bot handbook](help/overview.md): [chats](help/conversations.md), [rooms](help/room-creation.md), [agents/models](help/bots-models.md), [permissions](help/approvals.md), [Work](help/work.md), [memory/skills](help/memory-skills.md), [automations](help/proactive.md), [computer/connectors](help/computer-connectors.md), [dictation](help/dictation.md)
- [Product concepts and scope](openag.md)
- [Owner access and recovery](notes/owner-access.md), [device access](notes/devices.md)

The handbook manifest is [help/manifest.json](help/manifest.json). The build packages these topics; `node scripts/verify-bot-knowledge.mjs` checks delivery through the supported runtime paths. Shared product help must not contain credentials or private workspace records.

## Operating an installation

- [Always-on operations and shutdown](ops.md)
- [Local deployment, readback and rollback](local-deployment.md)
- [Backups and restoring data](backup.md)
- [Private remote access](tailscale.md), [public webhook ingress](cloudflare-tunnel.md), [optional sign-in relay](signin-relay.md)

## Harness and runtime

| Topic | Current behavior and limits | Design and decisions |
| --- | --- | --- |
| Permission modes and daemon execution | [Permission sessions](notes/permission-sessions.md), [execution worlds](notes/permission-worlds.md) | [Spec](specs/permission-modes.md), [ADR](adr/0004-permission-modes.md) |
| Request provenance and omitted context | [Request details](notes/request-provenance.md), [context selection](notes/hosted-context.md) | [Domain model](notes/request-provenance-domain-model.md), [spec](specs/request-provenance.md), [ADR](adr/0005-request-provenance-without-replay.md) |
| Tool results, uncertainty and retries | [Tool reliability](notes/tool-execution-reliability.md), [receipts](notes/action-receipts.md), [hosted outcomes](notes/hosted-outcomes.md), [model retries](notes/model-retries.md) | [Domain model](notes/tool-execution-domain-model.md), [spec](specs/tool-execution-reliability.md) |
| Cancellation, connection ownership and shutdown | [Execution ownership and acceptance](notes/execution-ownership.md), [operations](ops.md) | [Domain model and implementation contract](notes/execution-ownership-domain-model.md) |
| Adapter and integration boundaries | [ACP](notes/acp.md), [daemon MCP server](notes/mcp-server.md), [MCP client](notes/mcp.md), [MCP lifecycle](notes/mcp-lifecycle.md) | [Server interactions ADR](adr/0002-server-interactions.md) |
| Model setup and routing | [Model picker](notes/model-picker.md), [provider routing](notes/provider-routing.md), [Ollama](notes/ollama-chat.md) | [Model configuration](notes/oa-335-model-configuration.md) |

Full access does not bypass unattended/offline restrictions, human takeover or Unknown receipt fences. Stopping execution does not undo effects. Use the topic guides for the exact contract.

## Integrations and automation

- [Owner-installed Apps](apps.md), [Composio](composio.md), [connector reads](notes/read-connectors.md)
- [Computer use](notes/cua.md), [Browserbase](notes/browserbase.md), [Docker](notes/docker-computer.md)
- [Skills](notes/skills.md), [reflection](notes/reflection.md)
- [Automations](notes/automations/README.md), [external hooks](notes/hooks.md), [GitHub polling](notes/github-poll.md), [Slack](notes/slack.md)

## Developing and verifying

- [Repository rules](../AGENTS.md), [roadmap](../ROADMAP.md), [domain glossary](../GLOSSARY.md)
- Build: `pnpm -r build`. Follow the current owner rule: do not run unit/Jest/Vitest or trigger them through hooks.
- Use the standalone checks named in each feature's acceptance record. Checks against controlled transports do not establish real provider behavior. Commands with `--real-acp` use installed model subscriptions and require the applicable authority.
- [Execution ownership evidence](notes/execution-ownership.md), provenance and reliability release, [context-pressure acceptance](notes/context-pressure-acceptance.md)

## Research and historical notes

[DeepSeek Harness research](notes/deepseek-harness.md) and the [OSS harness comparison](notes/oss-agent-harness-comparison.md) explain the original proposals. Research recommendations are not implementation status. Use the build queue, behavior guides and dated evidence to establish what shipped; older notes retain historical checkpoints.
