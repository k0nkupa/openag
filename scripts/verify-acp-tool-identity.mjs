// Standalone acceptance: temporary data and loopback fixture tools; --real opts into subscription adapters.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

if (process.argv.includes('--real')) for (const key of Object.keys(process.env)) if (!['PATH', 'HOME', 'LANG', 'TMPDIR'].includes(key)) delete process.env[key];
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(root + 'apps/daemon/package.json');
const load = name => import(root + 'apps/daemon/dist/' + name + '.js');
const { serve } = require('@hono/node-server');
const { z } = require('zod');
const { agent, methods } = await import(require.resolve('@agentclientprotocol/sdk/unstable'));
const { Client } = await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StreamableHTTPClientTransport } = await import(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'));
const { openDb } = await load('db/index'), { createLedger } = await load('ledger');
const { createApprovals } = await load('approvals'), { createRunner } = await load('runtimes/runner');
const { createAcpRuntime } = await load('runtimes/acp'), { createMcpAccess } = await load('mcpserver');
const { createBot, createRoom, addMember, getBot, getRoom } = await load('rooms');
const { enabledTools, toExecutors } = await load('tools/registry');
const { createActionReceipts } = await load('action-receipts');
const names = ['mcp.composio-connect.COMPOSIO_SEARCH_TOOLS', 'mcp.example.READ_ITEMS', 'mcp.example.Read_Items', 'mcp.example.read_items', 'app_example_read_items'];
const real = process.argv.includes('--real');
const cases = [
  ...names.map(name => ({ name, decision: 'accept' })),
  { name: names[1], decision: 'ignore' },
  { name: names[1], deny: true },
  ...['foreign-server', 'missing-identity', 'unoffered-tool', 'case-mismatch', 'non-dynamic'].map(invalid => ({ name: names[1], invalid, decision: 'ignore' })),
  { name: names[1], collision: 'mcp_example_READ_ITEMS' },
  { name: names[1], collision: 'mcp_example.READ_ITEMS' },
  { name: names[1], collision: 'mcp_example_READ_ITEMS', disabledCollision: true },
  { name: names[1], rawClaude: true, decision: 'accept' },
];
const options = [
  { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'always', name: 'Always', kind: 'allow_always' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
];
const dir = mkdtempSync(join(tmpdir(), 'openag-tool-identity-'));
let passed = 0;
try {
  for (const adapter of ['claude', 'codex']) {
    for (const scenario of real ? [{ name: names[1], decision: 'accept' }, { name: names[2], decision: 'accept' }, { name: names[4], decision: 'accept' }, (adapter === 'codex' ? { name: 'mcp_example_READ_ITEMS', collision: names[1] } : { name: names[1], collision: 'mcp_example_READ_ITEMS' })] : cases) {
      if (adapter === 'codex' && (scenario.rawClaude || scenario.invalid === 'non-dynamic')) continue;
      const dataDir = join(dir, String(passed));
      const db = openDb(dataDir), ledger = createLedger(db), approvals = createApprovals(db, ledger);
      const executed = [], requested = [], selected = [], sessions = new Map(), mcpMethods = [];
      let runner, acp, server, unsubscribe, failure;
      const baseNames = real ? [scenario.name] : names;
      const offeredNames = scenario.collision ? [...baseNames, scenario.collision] : baseNames;
      const defs = offeredNames.map(name => ({
        name,permission:()=>({approval:scenario.deny?'deny':'review'}), class: 'act-external', description: `Harmless local fixture named ${name}. Returns a synthetic marker; no mailbox or external service. This is a distinct tool; do not substitute it for a differently named tool.`, input: z.object({}).strict(),
        enabled: () => name !== scenario.collision || !scenario.disabledCollision,
        execute: async () => { executed.push(name); return { name, marker: 'LOCAL_FIXTURE_OK' }; },
        confirm: () => ({ outcome: 'completed', detail: 'Controlled executor recorded the exact requested name.' }),
      }));
      const offered = () => enabledTools(defs);
      try {
        createBot(db, { id: 'bot', runtime: 'acp', config: { adapter, instructions: `This is a local integration acceptance check. Call ${scenario.name} exactly once with {} through the daemon-provided openag-* MCP server. You may discover/load this fixture tool if necessary. No other actions, commands, file operations, external accounts or test runners. Do not retry a refused call. Return the fixture marker, or explain that the call was refused.` } });
        createRoom(db, { id: 'main', leadBotId: 'bot' }); addMember(db, 'main', 'bot');
        const access = createMcpAccess({ runner: { activeTurn: (...args) => runner.activeTurn(...args) }, dataDir, tools: offered });
        server = serve({ fetch: async req => { const body = await req.clone().json().catch(() => ({})); const response = await access.handle(req); if (body.method) { const value = await response.clone().json().catch(() => ({})); mcpMethods.push({ method: body.method, status: response.status, tools: value.result?.tools?.map(t => t.name), error: value.error }); } return response; }, hostname: '127.0.0.1', port: 0 });
        if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;
        acp = createAcpRuntime({ dataDir, mcp: { access, baseUrl: () => base, tools: { has: name => offered().some(d => d.name === name), values: () => offered().map(d => d.name) } }, launcher: real ? undefined : ({ profile }) => {
          const fake = agent({ name: 'tool-identity-controlled' })
            .onRequest(methods.agent.initialize, () => ({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { systemPrompt: {} } } }))
            .onRequest(methods.agent.session.new, ({ params }) => {
              sessions.set('session', params.mcpServers[0]);
              return { sessionId: 'session', modes: { currentModeId: profile.safeMode, availableModes: [{ id: profile.safeMode, name: 'Ask' }] } };
            })
            .onRequest(methods.agent.session.setMode, () => ({}))
            .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
              const endpoint = sessions.get(params.sessionId);
              const serverName = scenario.invalid === 'foreign-server' ? 'other-server' : endpoint.name;
              const tool = scenario.invalid === 'unoffered-tool' ? 'mcp.example.UNOFFERED' : scenario.invalid === 'case-mismatch' ? 'mcp.example.read_ITEMS' : scenario.name;
              const rawInput = { server: serverName, tool, arguments: {} };
              // Replay Claude's observed wire name, not an invented canonical tool name.
              const claudeName = scenario.rawClaude ? tool : tool.replace(/[^a-zA-Z0-9_-]/g, '_');
              const title = adapter === 'codex' ? `mcp.${serverName}.${tool}` : `mcp__${serverName}__${claudeName}`;
              const toolCallId = 'identity-call';
              const notify = update => client.notify(methods.client.session.update, { sessionId: params.sessionId, update });
              if (scenario.invalid !== 'missing-identity') await notify({ sessionUpdate: 'tool_call', toolCallId, title, kind: 'execute', status: 'pending', rawInput });
              const toolCall = adapter === 'codex' ? { toolCallId, kind: 'execute', status: 'pending' } : {
                toolCallId, title, name: title, kind: 'other', status: 'pending', rawInput: {},
                ...(scenario.invalid === 'missing-identity' ? {} : { _meta: { claudeCode: { toolName: title, mcpServer: { name: serverName, source: scenario.invalid === 'non-dynamic' ? 'project' : 'dynamic' } } } }),
              };
              const permission = await client.request(methods.client.session.requestPermission, { sessionId: params.sessionId, toolCall, options });
              const choice = permission.outcome.outcome === 'selected' ? permission.outcome.optionId : 'cancelled';
              selected.push(choice);
              let result;
              if (choice === 'once') {
                const mcp = new Client({ name: 'identity-acceptance', version: '1' });
                try {
                  await mcp.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: Object.fromEntries(endpoint.headers.map(h => [h.name, h.value])) } }));
                  result = await mcp.callTool({ name: tool, arguments: {} });
                } finally { await mcp.close(); }
              }
              await notify({ sessionUpdate: 'tool_call_update', toolCallId, status: result && !result.isError ? 'completed' : 'failed' });
              return { stopReason: 'end_turn' };
            });
          return { target: fake, close() {} };
        } });
        runner = createRunner({ db, ledger, approvals, dataDir, runtimes: { acp }, tools: toExecutors(defs) });
        // Resolve from the ledger notification, after the request has registered its waiter; no polling.
        unsubscribe = ledger.subscribe('main', event => {
          if (event.type !== 'approval_requested') return;
          requested.push(event.payload.toolName);
          queueMicrotask(() => {
            try {
              const proposal = approvals.get(event.payload.approvalId);
              approvals.resolve(proposal.id, { kind: proposal.toolName === scenario.name && (scenario.decision === 'accept' || ((adapter === 'codex' || scenario.disabledCollision) && scenario.collision)) ? 'accept' : 'ignore' }, proposal.reviewVersion);
            } catch (error) { failure = error; runner.shutdown(); }
          });
        });
        const message = ledger.append('main', 'user', 'message', { text: `Call ${scenario.name} exactly once with {}. Discover/load it from the daemon-provided openag-* MCP server if necessary. Make no other action and do not retry a refused call. Return the local fixture marker or report refusal.` });
        if (real) console.log(`starting real ${adapter}: ${scenario.name}${scenario.collision ? ' (collision)' : ''}`);
        let timeout;
        try {
          await Promise.race([
            runner.run(getRoom(db, 'main'), getBot(db, 'bot'), message),
            new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Approval flow deadline exceeded')), real ? 120000 : 15000); }),
          ]);
        } finally { clearTimeout(timeout); }
        if (failure) throw failure;
        const label = `${real ? 'real ' : ''}${adapter}: ${scenario.invalid ?? scenario.name} (${scenario.collision ? (scenario.disabledCollision ? 'disabled collision with ' : 'collision with ') + scenario.collision : scenario.rawClaude ? 'legacy raw name' : scenario.deny ? 'policy deny' : scenario.decision})`;
        const events = ledger.list('main');
        assert.ok(!events.some(e => e.type === 'error'), label + ': no runtime error');
        const ambiguous = adapter === 'claude' && !!scenario.collision && !scenario.disabledCollision;
        const accepted = !scenario.invalid && !scenario.deny && !ambiguous && (scenario.decision === 'accept' || !!scenario.collision);
        assert.deepEqual(executed, accepted ? [scenario.name] : [], label + ': exact execution count/name');
        assert.equal(requested.length, scenario.invalid || scenario.deny || ambiguous ? 0 : 1, label + ': approval count');
        if (!scenario.invalid && !scenario.deny && !ambiguous) assert.equal(requested[0], scenario.name, label + ': approval identity');
        if (!real) assert.equal(selected[0], scenario.invalid || ambiguous ? 'reject' : 'once', label + ': forwarding permission');
        if (ambiguous) assert.ok(events.some(e => e.type === 'tool_result' && e.payload.status === 'denied' && /ambiguous/i.test(e.payload.message)), label + ': explicit ambiguity refusal');
        assert.equal(events.filter(e => e.type === 'turn_finished').at(-1)?.payload.status, 'finished', label + ': finished turn');
        assert.equal(approvals.listPending().length, 0, label + ': no pending approval');
        if (accepted) {
          const result = events.find(e => e.type === 'tool_result' && e.payload.tool === scenario.name);
          assert.equal(result?.payload.executionOutcome, 'completed', label + ': daemon confirmed completion');
          if (real) assert.ok(events.filter(e => e.type === 'bot_output').some(e => e.payload.text?.includes('LOCAL_FIXTURE_OK')), label + ': actual adapter received result');
          assert.equal(createActionReceipts(db, ledger).get(result.payload.approvalId).outcome, 'completed', label + ': no unknown receipt');
        }
        console.log('ok ' + label);
        passed++;
      } catch (error) {
        console.error(JSON.stringify({ adapter, requested, executed, mcpMethods, events: ledger.list('main', { limit: 100 }).filter(e => ['bot_output', 'tool_call', 'tool_result', 'error'].includes(e.type)).map(e => ({ type: e.type, payload: e.payload })) }));
        throw error;
      } finally {
        unsubscribe?.(); runner?.shutdown();
        await acp?.close();
        if (runner) await runner.idle();
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        db.close();
      }
    }
  }
  console.log(`PASS ${passed} ${real ? 'real-adapter' : 'controlled'} approval flows; synthetic local tools and temporary data only.`);
} finally { rmSync(dir, { recursive: true, force: true }); }
