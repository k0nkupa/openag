// Standalone integration acceptance. Temporary data, controlled model/ACP transports, loopback MCP only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, copyFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(root + 'apps/daemon/package.json');
const load = name => import(root + 'apps/daemon/dist/' + name + '.js');
const { serve } = require('@hono/node-server');
const { Client } = await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StreamableHTTPClientTransport } = await import(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'));
const { agent, methods } = await import(require.resolve('@agentclientprotocol/sdk/unstable'));
const { MockLanguageModelV3 } = await import(require.resolve('ai/test'));
const { loadKnowledge, knowledge, HELP_INDEX_MAX, HELP_TOPIC_MAX } = await load('knowledge');
const { openDb } = await load('db/index'), { createLedger } = await load('ledger');
const { createApprovals } = await load('approvals'), { createRunner } = await load('runtimes/runner');
const rooms = await load('rooms'), { setSetting, getSetting } = await load('settings');
const { createFirstPartyTools } = await load('tools/firstparty');
const { classify } = await load('policy');
const { createMcpAccess, MCP_TOOL_NAMES } = await load('mcpserver');
const { createApiRuntime } = await load('runtimes/api'), { createOllamaRuntime } = await load('runtimes/ollama');
const { createAcpRuntime } = await load('runtimes/acp'), { modelRevision } = await load('botmodels');
const { getDefaultRedactor } = await load('redact');
const dir = mkdtempSync(join(tmpdir(), 'openag-knowledge-'));
let db, runner, acp, server;
const passed = [];
const ok = label => { passed.push(label); console.log('ok ' + label); };
try {
  const bundle = JSON.parse(readFileSync(root + 'apps/daemon/dist/knowledge.json', 'utf8'));
  assert.match(knowledge.load('memory-skills').body, /saves validated memory notes automatically, without approval/);
  assert.match(knowledge.load('memory-skills').body, /delete the unwanted text in Saved memory/);
  assert.match(knowledge.load('memory-skills').body, /New-skill changes still require accepted or validly edited approval/);
  assert.match(knowledge.load('room-creation').body, /Add agents/);
  assert.match(knowledge.load('room-creation').body, /Save room details/);
  assert.match(knowledge.load('conversations').body,/Request details/);
  assert.match(knowledge.load('conversations').body,/Bot questions appear as ordinary messages/);
  assert.match(knowledge.load('conversations').body,/Needs you and its separate queues are removed/);
  assert.match(knowledge.load('approvals').body,/conversation/);
  assert.match(knowledge.load('conversations').body,/Limited devices cannot inspect/);
  assert.match(knowledge.load('conversations').body,/Activity groups turn operations/);
  assert.match(knowledge.load('conversation-forks').body,/checkpoint.*removed/);
  assert.match(knowledge.load('conversation-forks').body,/Existing forked conversations remain available/);
  assert.match(knowledge.load('approvals').body,/Local shell search includes `rg`/);

  assert.equal(bundle.topics.length, 13);
  assert.match(knowledge.load("dictation").body, /Stop transcribes/);
  assert.match(knowledge.load("dictation").body, /no automatic retry/);
  assert.match(knowledge.load("dictation").body, /rather\s+than a fixed model list/);
  assert.match(knowledge.load('approvals').body, /MCP invocation results are independent of tool permissions/);
  assert.match(knowledge.load('approvals').body, /External change verification: Not checked/);
  assert.match(knowledge.load('approvals').body, /trusted session-level explanation/);
  assert.match(knowledge.load('memory-skills').body, /save its instruction body and metadata with skill_save first/);
  assert.match(knowledge.load('approvals').body, /Native execution restrictions, including Codex's read-only setting, do not describe the boundary of OpenAg's daemon tools/);
  const mcpHelp = knowledge.load('mcp-servers').body;
  assert.match(mcpHelp, /OPENAG_MCP_<NAME>/);
  assert.match(mcpHelp, /\$\{secret:NAME\}/);
  assert.match(mcpHelp, /missing secret NAME/);
  assert.match(mcpHelp, /Add local command/);
  assert.match(mcpHelp, /not sandboxed/);
  assert.match(mcpHelp, /Sign in with OAuth/);
  assert.match(mcpHelp, /does not ask the provider to revoke/);
  assert.match(mcpHelp, /never accepts or shows an environment variable's value/);
  assert.match(mcpHelp, /OpenAg contacts the server only after you accept/);
  assert.match(mcpHelp, /Offering does not approve anything/);
  assert.match(mcpHelp, /not established by it/);
  assert.match(knowledge.load('computer-connectors').body, /MCP servers topic explains how/);
  assert.ok(!knowledge.load('computer-connectors').body.includes('All Composio meta-tools still need approval'));
  assert.match(knowledge.load('computer-connectors').body, /Reviewed tool\/skill discovery, schema retrieval and skill loading use explicit daemon read contracts/);
  assert.match(knowledge.load('computer-connectors').body, /explicit operation review under Never is refused/);
  assert.match(knowledge.load('approvals').body, /Other execution, connection\/wait, proxy, shell\/workbench, skill-change and feedback tools remain opaque operations requiring interactive Full access/);
  assert.match(knowledge.load('approvals').body, /A loaded skill grants no action authority/);
  assert.match(knowledge.load('approvals').body, /Opaque tools require interactive Full access/);
  assert.ok(Buffer.byteLength(knowledge.index()) <= HELP_INDEX_MAX);
  for (const t of bundle.topics) assert.ok(Buffer.byteLength(t.body) <= HELP_TOPIC_MAX);
  for (const invalid of ['constructor', '__proto__', '../defaultbot', '/etc/passwd', 'https://example.com']) assert.equal(knowledge.load(invalid).found, false);
  assert.match(knowledge.load('overview').body, /pnpm desk:open/);
  assert.match(knowledge.load('overview').body, /#\/settings\/profile/);
  assert.match(knowledge.load('overview').body, /Full-access devices can save; Limited devices can view/);
  assert.match(knowledge.load('overview').body, /5 MiB/);
  assert.match(knowledge.load('overview').body, /64 KiB/);
  assert.match(knowledge.load('overview').body, /Adjust your image/);
  assert.match(knowledge.load('computer-connectors').body, /generates and preserves its connector encryption key automatically/);
  assert.match(knowledge.load('computer-connectors').body, /Desk and callback addresses are separate/);
  assert.match(knowledge.load('computer-connectors').body, /damaged connector record does not disable another saved connection/);
  assert.match(knowledge.load('computer-connectors').body, /server completes the device-bound attempt/);
  assert.match(knowledge.load('computer-connectors').body, /there is no address-entry section/);
  assert.match(knowledge.load('computer-connectors').body, /hosted callback relay is used only when the operator has configured one/);
  assert.match(knowledge.load('computer-connectors').body, /stores only an encrypted callback/);
  assert.match(knowledge.load('computer-connectors').body, /sets up a private Tailscale callback automatically/);
  assert.match(knowledge.load('overview').body, /#\/settings\/devices/);
  assert.ok(bundle.topics.find(t => t.slug === 'overview').sources.includes('docs/notes/owner-access.md'));
  assert.match(knowledge.load('bots-models').body, /Use the plus beside Agents in the sidebar to open New bot/);
  assert.match(knowledge.load('bots-models').body, /without live discovery/);
  assert.match(knowledge.load('bots-models').body, /Refresh models/);
  assert.match(knowledge.load('bots-models').body, /shared cached model capabilities/);
  assert.match(knowledge.load('bots-models').body, /switch to Ollama and back/);
  assert.match(knowledge.load('bots-models').body, /Bot settings live in the selected agent’s conversation side panel/);
  assert.doesNotMatch(knowledge.load('bots-models').body, /Bot to configure|In Settings, Bots/);
  assert.match(knowledge.load('bots-models').body, /12 bundled Open Bot Avatar characters/);
  assert.ok(bundle.topics.find(t => t.slug === 'bots-models').sources.includes('docs/notes/avatars/README.md'));
  assert.match(knowledge.load('bots-models').body, /Full access adds the validated draft without an Inbox approval/);
  assert.match(knowledge.load('bots-models').body, /Read Only and Workspace Write require Inbox review/);
  assert.match(knowledge.load('work').body, /they do not create or promote Work/);
  assert.match(knowledge.load('work').body, /Creation requires explicit operation review/);
  assert.equal(loadKnowledge(pathToFileURL(join(dir, 'missing.json'))).load('overview').unavailable, true);
  const broken = join(dir, 'broken.json');
  for (const value of ['not json', JSON.stringify({ ...bundle, version: 'wrong' })]) {
    writeFileSync(broken, value);
    assert.equal(loadKnowledge(pathToFileURL(broken)).load('overview').unavailable, true);
  }
  const link = join(dir, 'link.json');
  symlinkSync(root + 'apps/daemon/dist/knowledge.json', link);
  assert.equal(loadKnowledge(pathToFileURL(link)).load('overview').unavailable, true);
  // A clean packaged copy has no source docs and is loaded in another working directory/process.
  const packaged = join(dir, 'package'); mkdirSync(packaged);
  writeFileSync(join(packaged, 'package.json'), '{"type":"module"}');
  for (const name of ['knowledge.js', 'knowledge.json', 'redact.js']) copyFileSync(root + 'apps/daemon/dist/' + name, join(packaged, name));
  symlinkSync(root + 'apps/daemon/node_modules', join(packaged, 'node_modules'));
  const isolated = execFileSync(process.execPath, ['--input-type=module', '-e', `const {knowledge}=await import(${JSON.stringify(pathToFileURL(join(packaged, 'knowledge.js')).href)});if(!knowledge.load('approvals').found)process.exit(1);console.log(knowledge.load('overview').version);`], { cwd: dir, encoding: 'utf8' });
  assert.equal(isolated.trim(), bundle.version);
  // Run the actual authoring/build interface against a disposable source tree.
  const buildRoot = join(dir, 'build-fixture');
  for (const path of ['scripts', 'docs/help', 'apps/daemon/dist']) mkdirSync(join(buildRoot, path), { recursive: true });
  for (const name of ['knowledge.js', 'redact.js']) copyFileSync(root + 'apps/daemon/dist/' + name, join(buildRoot, 'apps/daemon/dist', name));
  writeFileSync(join(buildRoot, 'apps/daemon/package.json'), '{"type":"module"}');
  symlinkSync(root + 'apps/daemon/node_modules', join(buildRoot, 'apps/daemon/node_modules'));
  copyFileSync(root + 'scripts/build-knowledge.mjs', join(buildRoot, 'scripts/build-knowledge.mjs'));
  const manifest = bundle.topics.map(({ body, ...entry }) => entry);
  const manifestPath = join(buildRoot, 'docs/help/manifest.json');
  for (const t of bundle.topics) {
    writeFileSync(join(buildRoot, 'docs/help', t.slug + '.md'), t.body);
    for (const source of t.sources) { const target = join(buildRoot, source); mkdirSync(join(target, '..'), { recursive: true }); writeFileSync(target, 'Controlled reference'); }
  }
  const build = entries => { writeFileSync(manifestPath, JSON.stringify(entries)); return execFileSync(process.execPath, [join(buildRoot, 'scripts/build-knowledge.mjs')], { cwd: dir, stdio: 'pipe' }); };
  build(manifest);
  assert.throws(() => build([...manifest, manifest[0]]), 'Duplicate topics fail authoring');
  assert.throws(() => build([{ ...manifest[0], slug: '../escape' }]), 'Traversal fails authoring');
  assert.throws(() => build([{ ...manifest[0], sources: ['docs/../../outside'] }]), 'Bad references fail authoring');
  const firstTopic = join(buildRoot, 'docs/help', manifest[0].slug + '.md');
  for (const content of ['x'.repeat(HELP_TOPIC_MAX + 1), 'oag_' + 'x'.repeat(40)]) {
    writeFileSync(firstTopic, content); assert.throws(() => build(manifest), 'Oversized/credential content fails authoring');
  }
  rmSync(firstTopic); symlinkSync(root + 'docs/help/overview.md', firstTopic);
  assert.throws(() => build(manifest), 'Symlinked source fails authoring');
  ok('packaged handbook, limits, unknown topics, missing/corrupt assets, symlink refusal and invalid authoring rejection');

  db = openDb(join(dir, 'data'));
  const ledger = createLedger(db), approvals = createApprovals(db, ledger);
  for (const [id, runtime, model] of [['api', 'api', 'openai/fixture'], ['local', 'api', 'ollama/fixture'], ['acp', 'acp', 'claude-code'], ['probe', 'api', 'openai/fixture']]) {
    rooms.createBot(db, { id, runtime, model, config: { instructions: 'Preserve my custom instructions.' } });
  }
  for (const id of ['room', 'private', '_iso-check']) {
    rooms.createRoom(db, { id, leadBotId: 'api' });
    for (const bot of rooms.listBots(db)) rooms.addMember(db, id, bot.id);
  }
  setSetting(db, 'defaultBot', { botId: 'api' });
  const first = createFirstPartyTools({ db, computer: { capabilities: () => ({ shell: false, view: 'none', hosted: false }) }, pusher: { status: () => ({ configured: false, enabled: false }) } });
  const defs = first.defs.filter(d => ['openag_help', 'openag_status', 'openag_capabilities'].includes(d.name));
  assert.equal(defs.length, 3);
  for (const d of defs) { assert.equal(classify(d.name), 'read'); assert.ok(MCP_TOOL_NAMES.includes(d.name)); }
  const status = first.executors.openag_status;
  assert.throws(() => status.validate({ path: '/settings' }));
  assert.throws(() => first.executors.openag_help.validate({ topic: '../secrets' }));
  const synthetic = 'synthetic-secret-for-status-filter';
  getDefaultRedactor().addSecret(synthetic);
  const bot = rooms.getBot(db, 'api');
  ledger.append('room', 'api', 'model_report', { source: 'session', revision: modelRevision(bot), model: 'configured-fixture', effort: 'high', warnings: [synthetic], sessionId: synthetic });
  ledger.append('room', 'api', 'model_report', { source: 'response', revision: modelRevision(bot), model: 'served-fixture' });
  ledger.append('private', 'api', 'model_report', { source: 'response', model: 'PRIVATE_ROOM_MODEL' });
  ledger.append('room', 'probe', 'model_report', { source: 'response', model: 'OTHER_BOT_MODEL' });
  const before = db.prepare('SELECT total_changes() AS n').get().n;
  const projection = await status({ botId: 'api', roomId: 'room' }, {});
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before);
  assert.equal(projection.model.requested, 'openai/fixture');
  assert.equal(projection.model.reports.length, 2);
  assert.equal(projection.model.reports.find(r => r.source === 'response').model, 'served-fixture');
  assert.equal(projection.model.reports.find(r => r.source === 'session').effort, 'high');
  assert.equal(projection.model.reports[0].freshness, 'last-reported');
  assert.ok(projection.observedAt > 0);
  assert.deepEqual(Object.keys(projection.features), ['heartbeat', 'reflection', 'brief']);
  for (const excluded of [synthetic, 'PRIVATE_ROOM_MODEL', 'OTHER_BOT_MODEL', 'sessionId', 'warnings', 'instructions']) assert.ok(!JSON.stringify(projection).includes(excluded));
  assert.equal((await status({ botId: 'api', roomId: 'missing' }, {})).unavailable, true);
  rooms.createRoom(db, { id: 'not-a-member' });
  assert.equal((await status({ botId: 'api', roomId: 'not-a-member' }, {})).unavailable, true);
  setSetting(db, 'heartbeat', { ...getSetting(db, 'heartbeat'), enabled: true });
  assert.equal((await status({ botId: 'api', roomId: 'room' }, {})).features.heartbeat.enabled, true);
  rooms.updateBot(db, 'api', { model: 'openai/new-config' });
  assert.equal((await status({ botId: 'api', roomId: 'room' }, {})).model.reports[0].freshness, 'previous-configuration');
  ledger.append('room', 'api', 'model_report', { source: 'session', revision: modelRevision(rooms.getBot(db, 'api')), model: 'new-session', effort: 'low' });
  const nextReports = (await status({ botId: 'api', roomId: 'room' }, {})).model.reports;
  assert.equal(nextReports.find(r => r.source === 'response').model, 'served-fixture', 'A new session must not erase previous response evidence');
  assert.equal(nextReports.find(r => r.source === 'session').effort, 'low');
  ok('status projection, room/bot filtering, timestamps, configuration freshness and no writes');

  const prompts = [], results = [], sessions = new Map();
  let base, access;
  const connect = async endpoint => {
    const c = new Client({ name: 'knowledge-acceptance', version: '1' });
    await c.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: Object.fromEntries(endpoint.headers.map(h => [h.name, h.value])) } }));
    return c;
  };
  acp = createAcpRuntime({ dataDir: dir, mcp: { access: { issue: (...a) => access.issue(...a), revoke: (...a) => access.revoke(...a) }, baseUrl: () => base, tools: new Set(MCP_TOOL_NAMES) }, launcher: ({ profile }) => {
    let count = 0;
    const fake = agent({ name: 'knowledge-controlled' })
      .onRequest(methods.agent.initialize, () => ({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { systemPrompt: {} } } }))
      .onRequest(methods.agent.session.new, ({ params }) => { const sessionId = 'knowledge-' + (++count); sessions.set(sessionId, params.mcpServers[0]); return { sessionId, modes: { currentModeId: profile.safeMode, availableModes: [{ id: profile.safeMode, name: 'Ask' }] } }; })
      .onRequest(methods.agent.session.setMode, () => ({}))
      .onRequest(methods.agent.session.prompt, async ({ params }) => {
        prompts.push({ kind: 'acp', text: params.prompt.filter(p => p.type === 'text').map(p => p.text).join('\n') });
        const c = await connect(sessions.get(params.sessionId));
        try {
          for (const [name, args] of [['openag_help', { topic: 'approvals' }], ['openag_help', { topic: 'computer-connectors' }], ['openag_help', { topic: 'conversations' }], ['openag_help', { topic: 'proactive' }], ['openag_help', { topic: 'overview' }], ['openag_help', { topic: 'room-creation' }], ['openag_help', { topic: 'bots-models' }], ['openag_help', { topic: 'agent-requests' }], ['openag_help', { topic: 'conversation-forks' }], ['openag_status', {}], ['openag_capabilities', {}]]) results.push({ kind: 'acp', name, result: await c.callTool({ name, arguments: args }) });
        } finally { await c.close(); }
        return { stopReason: 'end_turn' };
      });
    return { target: fake, close() {} };
  } });
  const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
  const model = new MockLanguageModelV3({ doGenerate: async args => {
    prompts.push({ kind: 'api', text: JSON.stringify(args.prompt) });
    const done = args.prompt.some(m => m.role === 'tool');
    return { content: done ? [{ type: 'text', text: 'Controlled help response' }] : [{ type: 'tool-call', toolCallId: 'help', toolName: 'openag_help', input: '{"topic":"approvals"}' }, { type: 'tool-call', toolCallId: 'connectors', toolName: 'openag_help', input: '{"topic":"computer-connectors"}' }, { type: 'tool-call', toolCallId: 'conversations', toolName: 'openag_help', input: '{"topic":"conversations"}' }, { type: 'tool-call', toolCallId: 'proactive', toolName: 'openag_help', input: '{"topic":"proactive"}' }, { type: 'tool-call', toolCallId: 'overview', toolName: 'openag_help', input: '{"topic":"overview"}' }, { type: 'tool-call', toolCallId: 'room-creation', toolName: 'openag_help', input: '{"topic":"room-creation"}' }, { type: 'tool-call', toolCallId: 'avatars', toolName: 'openag_help', input: '{"topic":"bots-models"}' }, { type: 'tool-call', toolCallId: 'agent-requests', toolName: 'openag_help', input: '{"topic":"agent-requests"}' }, { type: 'tool-call', toolCallId: 'conversation-forks', toolName: 'openag_help', input: '{"topic":"conversation-forks"}' }, { type: 'tool-call', toolCallId: 'status', toolName: 'openag_status', input: '{}' }, { type: 'tool-call', toolCallId: 'capabilities', toolName: 'openag_capabilities', input: '{}' }], finishReason: { unified: done ? 'stop' : 'tool-calls', raw: done ? 'stop' : 'tool_calls' }, usage, warnings: [] };
  } });
  const ollama = createOllamaRuntime({ tools: defs, env: {}, fetch: async (url, init) => {
    assert.ok(String(url).endsWith('/api/chat'), 'Only controlled chat transport expected');
    const body = JSON.parse(init.body); prompts.push({ kind: 'ollama', text: JSON.stringify(body.messages) });
    const done = body.messages.some(m => m.role === 'tool');
    const routingDone = body.messages.some(m => m.role === 'tool' && m.content.includes('Cancel restores the saved configuration'));
    // Ollama accepts four tool calls per response; fetch the extra help topic in the next step.
    const avatarDone = body.messages.some(m => m.role === 'tool' && m.content.includes('12 bundled Open Bot Avatar characters'));
    const message = avatarDone ? { role: 'assistant', content: 'Controlled help response' } : routingDone ? { role: 'assistant', content: '', tool_calls: [{ function: { name: 'openag_help', arguments: { topic: 'bots-models' } } }, { function: { name: 'openag_help', arguments: { topic: 'agent-requests' } } }, { function: { name: 'openag_help', arguments: { topic: 'conversation-forks' } } }] } : { role: 'assistant', content: '', tool_calls: done
      ? [{ function: { name: 'openag_help', arguments: { topic: 'conversations' } } }, { function: { name: 'openag_help', arguments: { topic: 'proactive' } } }, { function: { name: 'openag_help', arguments: { topic: 'overview' } } }, { function: { name: 'openag_help', arguments: { topic: 'room-creation' } } }]
      : [{ function: { name: 'openag_help', arguments: { topic: 'approvals' } } }, { function: { name: 'openag_help', arguments: { topic: 'computer-connectors' } } }, { function: { name: 'openag_status', arguments: {} } }, { function: { name: 'openag_capabilities', arguments: {} } }] };
    return Response.json({ model: 'fixture-served', message, done: true });
  } });
  let probeRequirement='allow';
  const helpPermission=first.executors.openag_help.permission;first.executors.openag_help.permission=(ctx,args)=>ctx.botId==='probe'?{approval:probeRequirement}:helpPermission(ctx,args);
  const probeCalls = [];
  const probe = { async runTurn(ctx) { prompts.push({ kind: 'probe', text: ctx.prompt }); probeCalls.push(await ctx.callTool('openag_help', { topic: 'overview' })); } };
  runner = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { api: { runTurn: ctx => ctx.bot.id === 'probe' ? probe.runTurn(ctx) : createApiRuntime({ model, tools: defs, ollama }).runTurn(ctx) }, acp }, tools: first.executors, capabilityGuidance: first.capabilityGuidance });
  access = createMcpAccess({ runner, dataDir: dir, tools: () => defs });
  server = serve({ hostname: '127.0.0.1', port: 0, fetch: req => access.handle(req) });
  if (!server.listening) await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const run = async (id, meta, roomId = 'room') => {
    const room = rooms.getRoom(db, roomId), bot = rooms.getBot(db, id);
    await runner.run(room, bot, ledger.append(roomId, 'user', 'message', { text: 'Explain approvals and check current status.' }), undefined, meta);
  };
  for (const id of ['api', 'local', 'acp']) { setSetting(db, 'defaultBot', { botId: id }); await run(id); }
  for (const kind of ['api', 'ollama', 'acp']) assert.ok(prompts.some(p => p.kind === kind && p.text.includes(bundle.version) && p.text.includes('Preserve my custom instructions.')), kind + ' receives current help and custom instructions');
  for (const kind of ['api', 'ollama', 'acp']) assert.ok(prompts.some(p => p.kind === kind && p.text.includes('A native read-only sandbox describes native execution, not the effective daemon filesystem boundary above.')), kind + ' receives effective-permission guidance');
  for(const id of ['api','local']){
    const manifests=ledger.list('room',{limit:1000}).filter(e=>e.actor===id&&e.type==='request_prepared').map(e=>e.payload);
    assert.ok(manifests.some(m=>m.messages.some(message=>message.toolReferences?.some(ref=>ref.source?.kind==='help'&&ref.source.identity==='conversations'&&ref.source.version===bundle.version))),id+' records the actually supplied help source version');
  }
  for (const id of ['api', 'local', 'acp']) for (const tool of ['openag_help', 'openag_status', 'openag_capabilities']) assert.ok(db.prepare("SELECT 1 FROM events WHERE actor=? AND type='tool_result' AND json_extract(payload_json,'$.tool')=? AND json_extract(payload_json,'$.ok')=1").get(id, tool), id + ' executed ' + tool);
  assert.ok(results.every(r => !r.result.isError));
  assert.ok(JSON.stringify(results).includes('Full access uses Never'));
  for (const kind of ['api', 'ollama']) assert.ok(prompts.some(p => p.kind === kind && p.text.includes('Add agents') && p.text.includes('Save room details')), kind + ' receives room membership help');
  for (const kind of ['api', 'ollama']) assert.ok(prompts.some(p => p.kind === kind && p.text.includes('Calendar reads use native EventKit')), kind + ' receives connector help');
  assert.ok(JSON.stringify(results.filter(r => r.kind === 'acp')).includes('Calendar reads use native EventKit'), 'ACP receives connector help');
  for (const kind of ['api', 'ollama']) assert.ok(prompts.some(p => p.kind === kind && p.text.includes('generates and preserves its connector encryption key automatically')), kind + ' receives Composio help');
  for (const kind of ['api', 'ollama']) assert.ok(prompts.some(p => p.kind === kind && p.text.includes('there is no address-entry section')), kind + ' receives isolated key import help');
  assert.ok(JSON.stringify(results.filter(r => r.kind === 'acp')).includes('generates and preserves its connector encryption key automatically'), 'ACP receives Composio help');
  assert.ok(JSON.stringify(results.filter(r => r.kind === 'acp')).includes('there is no address-entry section'), 'ACP receives isolated key import help');
  for (const kind of ['api', 'ollama']) assert.ok(prompts.some(p => p.kind === kind && p.text.includes('Cancel restores the saved configuration')), kind + ' receives routing reset help');
  assert.ok(JSON.stringify(results.filter(r => r.kind === 'acp')).includes('Cancel restores the saved configuration'), 'ACP receives routing reset help');
  for (const kind of ['api', 'ollama']) assert.ok(prompts.some(p => p.kind === kind && p.text.includes('#/settings/profile') && p.text.includes('Full-access devices can save; Limited devices can view') && p.text.includes('Adjust your image') && p.text.includes('64 KiB')), kind + ' receives shared profile help');
  assert.ok(JSON.stringify(results.filter(r => r.kind === 'acp')).includes('Adjust your image'), 'ACP receives uploaded profile image help');
  for (const kind of ['api', 'ollama']) assert.ok(prompts.some(p => p.kind === kind && p.text.includes('Hide technical activity')), kind + ' receives chat display help');
  assert.ok(JSON.stringify(results.filter(r => r.kind === 'acp')).includes('Hide technical activity'), 'ACP receives chat display help');
  for(const kind of ['api','ollama'])assert.ok(prompts.some(p=>p.kind===kind&&p.text.includes('Owner receipt inspection is required before a conflicting write')),kind+' receives chat receipt recovery help');
  assert.ok(JSON.stringify(results.filter(r=>r.kind==='acp')).includes('Owner receipt inspection is required before a conflicting write'),'ACP receives chat receipt recovery help');
  for (const kind of ['api','ollama']) assert.ok(prompts.some(p=>p.kind===kind&&p.text.includes('Transient model-request failures')&&p.text.includes('two retries')&&p.text.includes('Bounded execution and incomplete results')&&p.text.includes('40 executed tools')&&p.text.includes('Recent conversation context')&&p.text.includes('24,000 characters')&&p.text.includes('64,000 characters')),kind+' receives hosted-context limits');
  assert.ok(JSON.stringify(results.filter(r=>r.kind==='acp')).includes('Transient model-request failures'),'ACP receives current hosted-context help');
  for(const kind of ['api','ollama'])assert.ok(prompts.some(p=>p.kind===kind&&p.text.includes('Automation history separates execution from scheduling diagnostics')&&p.text.includes('without catch-up')),kind+' receives routine-outcome help');
  assert.ok(JSON.stringify(results.filter(r=>r.kind==='acp')).includes('Automation history separates execution from scheduling diagnostics'),'ACP receives routine-outcome help');
  for(const kind of ['api','ollama'])assert.ok(prompts.some(p=>p.kind===kind&&p.text.includes('Automatic investigations use an approved source binding')&&p.text.includes('Outlook is unavailable')),kind+' receives scoped responsibility limits');
  assert.ok(JSON.stringify(results.filter(r=>r.kind==='acp')).includes('ACP investigations are unsupported'),'ACP receives responsibility runtime limits');
  for (const kind of ['api', 'ollama']) assert.ok(prompts.some(p => p.kind === kind && p.text.includes('pnpm desk:open')), kind + ' receives owner-access recovery help');
  assert.ok(JSON.stringify(results.filter(r => r.kind === 'acp')).includes('pnpm desk:open'), 'ACP receives owner-access recovery help');
  for (const kind of ['api', 'ollama']) assert.ok(prompts.some(p => p.kind === kind && p.text.includes('#/settings/devices')), kind + ' receives the new Devices location');
  assert.ok(JSON.stringify(results.filter(r => r.kind === 'acp')).includes('#/settings/devices'), 'ACP receives the new Devices location');
  for (const kind of ['api', 'ollama']) assert.ok(prompts.some(p => p.kind === kind && p.text.includes('Names may repeat; each room has its own identity')), kind + ' receives room creation help');
  assert.ok(JSON.stringify(results.filter(r => r.kind === 'acp')).includes('Check creation status'), 'ACP receives room creation recovery');
  for (const kind of ['api', 'ollama']) assert.ok(prompts.some(p => p.kind === kind && p.text.includes('12 bundled Open Bot Avatar characters')), kind + ' receives avatar help');
  const beforeCached = results.length;
  await run('acp'); // Cached ACP session still receives the current bundle.
  for (const kind of ['api', 'ollama']) assert.ok(prompts.some(p => p.kind === kind && p.text.includes('Tool names retain their exact case')), kind + ' receives tool-identity help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('Tool names retain their exact case'), 'Cached ACP receives tool-identity help');
  for (const kind of ['api', 'ollama']) assert.ok(prompts.some(p => p.kind === kind && p.text.includes('OpenAg refuses an ambiguous tool name before approval or execution')), kind + ' receives collision help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('OpenAg refuses an ambiguous tool name before approval or execution'), 'Cached ACP receives collision help');
  for (const kind of ['api', 'ollama']) assert.ok(prompts.some(p => p.kind === kind && p.text.includes('Fresh ACP sessions after restart') && p.text.includes('awaiting input')), kind + ' receives continuity help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('Fresh ACP sessions after restart'), 'Cached default ACP receives continuity help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('generates and preserves its connector encryption key automatically'), 'Cached ACP receives Composio help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('there is no address-entry section'), 'Cached ACP receives isolated key import help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('Cancel restores the saved configuration'), 'Cached ACP receives routing reset help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('Hide technical activity'), 'Cached ACP receives chat display help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('Owner receipt inspection is required before a conflicting write'),'Cached default ACP receives chat receipt recovery help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('12 bundled Open Bot Avatar characters'), 'Cached ACP receives avatar replacement help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('Full access adds the validated draft without an Inbox approval'), 'Cached ACP receives session-gated avatar library help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('Automation history separates execution from scheduling diagnostics'),'Cached ACP receives routine-outcome help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('Automatic investigations use an approved source binding'),'Cached ACP receives responsibility help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('pnpm desk:open'), 'Cached ACP receives owner-access recovery help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('#/settings/devices'), 'Cached ACP receives the new Devices location');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('Names may repeat; each room has its own identity'), 'Cached ACP receives room creation help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('Add agents'), 'Cached ACP receives room membership help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('trusted session-level explanation'), 'Cached ACP receives current session instruction help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes("Native execution restrictions, including Codex's read-only setting, do not describe the boundary of OpenAg's daemon tools"), 'Cached default ACP receives effective-permissions help');
  assert.ok(prompts.filter(p => p.kind === 'acp').at(-1).text.includes('A native read-only sandbox describes native execution, not the effective daemon filesystem boundary above.'), 'Reused ACP receives current effective-permission guidance');

  for(const kind of ['api','ollama'])assert.ok(prompts.some(p=>p.kind===kind&&p.text.includes('agent_request_cancel')),kind+' receives agent consultation help');
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('agent_consult'), 'Cached ACP receives agent consultation help');
  assert.ok(knowledge.load('agent-requests').body.includes('neither') || knowledge.load('agent-requests').body.includes('Neither'), 'Packaged agent request topic is delivered');
  setSetting(db, 'defaultBot', { botId: 'api' }); await run('acp');
  assert.ok(!prompts.filter(p => p.kind === 'acp').at(-1).text.includes(bundle.version), 'Old default loses orientation on its next turn');
  for(const kind of ['api','ollama'])assert.ok(prompts.some(p=>p.kind===kind&&p.text.includes('Request details')&&p.text.includes('Limited devices cannot inspect')),'Request details guidance delivered to '+kind);
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('Limited devices cannot inspect'),'Cached ACP receives Request details guidance');
  for (const phrase of ['Activity groups turn operations', 'Copy copies original text', 'Accept/Edit/Respond/Ignore keep their meanings', 'Request usage', 'not verified answer citations', 'Starter prompts prepare an editable draft', 'Reply to a message', 'Cancel reply', '1,200 characters']) {
    for (const kind of ['api','ollama']) assert.ok(prompts.some(p=>p.kind===kind&&p.text.includes(phrase)),kind+' receives current AI Elements help');
    assert.ok(JSON.stringify(results.slice(beforeCached)).includes(phrase),'Cached ACP receives current AI Elements help');
  }
  for(const kind of ['api','ollama'])assert.ok(prompts.some(p=>p.kind===kind&&p.text.includes('The chat checkpoint and')),'Checkpoint removal help reaches '+kind);
  assert.ok(JSON.stringify(results.slice(beforeCached)).includes('The chat checkpoint and'),'Cached ACP receives checkpoint removal help');
  ok('API, Ollama and cached ACP/MCP delivery, same gated tools, replacement default and custom instructions');

  await run('probe', { unattended: true }); assert.equal(probeCalls.at(-1).ok, true);
  probeRequirement='review';
  await run('probe', { unattended: true }); assert.equal(probeCalls.at(-1).status, 'denied');
  assert.equal(approvals.listPending().length, 0);
  probeRequirement='allow';
  await run('probe', { isolated: true }, '_iso-check'); assert.equal(probeCalls.at(-1).status, 'denied');
  probeRequirement='deny';
  await run('probe'); assert.equal(probeCalls.at(-1).status, 'denied');
  ok('unattended eligibility, explicit operation review/refusal and isolation preserved');
  assert.equal(db.prepare("SELECT count(*) AS n FROM turns WHERE status='failed'").get().n, 0);
  console.log(`PASS ${passed.length} integration groups; no real providers, adapters or live data used.`);
} finally {
  runner?.shutdown();
  if (runner) await runner.idle();
  await acp?.close();
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  db?.close();
  rmSync(dir, { recursive: true, force: true });
}
