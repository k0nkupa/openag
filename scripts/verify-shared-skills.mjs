// Controlled gateway, runner, real API-runtime and ACP/MCP integration. Temporary packages only; no unit runner.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(root + 'apps/daemon/package.json');
const load = name => import(root + 'apps/daemon/dist/' + name + '.js');
const { openDb } = await load('db/index'), { createAuth } = await load('auth'), { createGateway } = await load('gateway');
const { createLedger } = await load('ledger'), { createApprovals } = await load('approvals'), { createRunner } = await load('runtimes/runner');
const rooms = await load('rooms'), { createSkillCatalogue, saveSkill, loadSkill } = await load('skills');
const { createFirstPartyTools } = await load('tools/firstparty'), { createMcpAccess, MCP_TOOL_NAMES } = await load('mcpserver');
const { createAcpRuntime } = await load('runtimes/acp'), { createApiRuntime } = await load('runtimes/api');
const { getSetting, setSetting } = await load('settings'), { getDefaultRedactor } = await load('redact');
const { createReflectionApplier } = await load('reflection-apply'), { REFLECTION_SKILL_TOOL } = await load('reflection-schema');
const { classify } = await load('policy'),{createPermissions}=await load('permissions');
const { ensureDataRepo } = await load('datagit');
const { MockLanguageModelV3 } = await import(require.resolve('ai/test'));
const { serve } = require('@hono/node-server'), { agent, methods } = await import(require.resolve('@agentclientprotocol/sdk/unstable'));
const { Client } = await import(require.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StreamableHTTPClientTransport } = await import(require.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'));
const dir = mkdtempSync(join(tmpdir(), 'oag-shared-skills-')), library = join(dir, 'library'), dataDir = join(dir, 'data');
const db = openDb(dataDir), ledger = createLedger(db), approvals = createApprovals(db, ledger), auth = createAuth({ db, ownerToken: 'controlled-skill-owner' });
const catalogue = createSkillCatalogue(db, dataDir, library);
const first = createFirstPartyTools({ db, skills: catalogue, computer: { capabilities: () => ({ shell: false, view: 'none', hosted: false }) }, pusher: { status: () => ({ enabled: false, configured: false }) } });
let runner, acp, server, action = async () => {}, applier, realApi = false, sessionsCreated = 0;
const prompts = [], calls = [], sessions = new Map();
function pkg(location, body = 'SHARED_WORKFLOW', name = 'weekly-review') {
 const p = join(library, location); mkdirSync(join(p, 'references'), { recursive: true });
 writeFileSync(join(p, 'SKILL.md'), `---\nname: ${name}\ndescription: >-\n  Review the week using the reference.\ncompatibility: Needs a reviewed local environment\n---\n${body}\n`);
 writeFileSync(join(p, 'references/guide.md'), 'REFERENCE_MARKER'); return p;
}
const mainPackage = pkg('weekly-review'), secondPackage = pkg('another-copy');
const original = readFileSync(join(mainPackage, 'SKILL.md'));
for (const [id, runtime, config] of [['a', 'api', {}], ['b', 'api', {}], ['acp', 'acp', { adapter: 'claude' }]]) rooms.createBot(db, { id, runtime, model: 'openai/fixture', config });
rooms.createRoom(db, { id: 'room', leadBotId: 'a' }); for (const id of ['a', 'b', 'acp']) rooms.addMember(db, 'room', id);
const limited = auth.createDevice('Limited', 'owner', 'limited'), full = auth.createDevice('Full', 'owner', 'full');
const app = createGateway({ db, ledger, auth, approvals, dataDir, skills: catalogue, skillsChanged: async () => acp?.invalidateSessions(), dispatch() {} });
const req = (path, body, token = 'controlled-skill-owner', method = body === undefined ? 'GET' : 'PUT') => app.request(path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const json = async response => { assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
const assign = (id, ids) => req(`/bots/${id}/skills/assignments`, { ids }).then(json);
const run = (id = 'a', meta) => runner.run(rooms.getRoom(db, 'room'), rooms.getBot(db, id), ledger.append('room', 'user', 'message', { text: 'Use the assigned workflow through OpenAg.' }), undefined, meta);
try {
 await ensureDataRepo(dataDir);
 assert.equal((await json(await req('/skills/library'))).enabled, false);
 assert.equal((await json(await req('/skills?botId=a'))).skills.length, 0);
 for (const path of ['/skills/library', '/settings/skillLibrary', '/bots/a/skills/assignments']) assert.equal((await req(path, path.endsWith('assignments') ? { ids: [] } : { enabled: true }, limited.token)).status, 403);
 assert.equal((await req('/settings/skillLibrary', { enabled: true })).status, 400, 'Generic settings cannot erase or bypass reviewed assignments');
 await json(await req('/skills/library', { enabled: true }, full.token));
 const inventory = (await json(await req('/skills?botId=a'))).skills;
 assert.equal(inventory.length, 2); assert.ok(inventory.every(s => !s.assigned && s.version === null));
 assert.equal(inventory.filter(s => s.name === 'weekly-review').length, 2); assert.notEqual(inventory[0].id, inventory[1].id);
 assert.equal((await json(await req('/skills/package?botId=a&id=shared:weekly-review'))).skill.body.trim(), 'SHARED_WORKFLOW');
 await assign('a', ['shared:weekly-review']); await assign('acp', ['shared:weekly-review']);
 assert.equal((await req('/bots/b/skills/shared%3Aweekly-review')).status, 404);
 assert.equal((await assign('a', ['shared:unknown']).catch(() => null)), null);
 console.log('PASS owner/Full controls, Limited refusal, portable YAML, distinct duplicates and explicit assignments');

 let base, access;
 acp = createAcpRuntime({ dataDir, mcp: { access: { issue: (...args) => access.issue(...args), revoke: (...args) => access.revoke(...args) }, baseUrl: () => base, tools: new Set(MCP_TOOL_NAMES) }, launcher: ({ profile }) => {
  const fake = agent({ name: 'shared-skills-controlled' })
   .onRequest(methods.agent.initialize, () => ({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { systemPrompt: {} } } }))
   .onRequest(methods.agent.session.new, ({ params }) => { assert.deepEqual(params._meta.claudeCode.options.skills, []); const id = 'skills-' + ++sessionsCreated; sessions.set(id, params.mcpServers[0]); return { sessionId: id, modes: { currentModeId: profile.safeMode, availableModes: [{ id: profile.safeMode, name: 'Ask' }] } }; })
   .onRequest(methods.agent.session.setMode, () => ({}))
   .onRequest(methods.agent.session.prompt, async ({ params }) => {
    prompts.push({ runtime: 'acp', text: JSON.stringify(params.prompt) });
    const endpoint = sessions.get(params.sessionId), client = new Client({ name: 'skills-acceptance', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: Object.fromEntries(endpoint.headers.map(h => [h.name, h.value])) } }));
    try { for (const args of [{ slug: 'shared:weekly-review' }, { slug: 'shared:weekly-review', path: 'references/guide.md' }]) calls.push(await client.callTool({ name: 'skill_load', arguments: args })); calls.push(await client.callTool({ name: 'openag_help', arguments: { topic: 'memory-skills' } })); }
    finally { await client.close(); }
    return { stopReason: 'end_turn' };
   }); return { target: fake, close() {} };
 } });
 const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
 const model = new MockLanguageModelV3({ doGenerate: async args => {
  prompts.push({ runtime: 'api', text: JSON.stringify(args.prompt) });
  const done = args.prompt.some(m => m.role === 'tool');
  return { content: done ? [{ type: 'text', text: 'Fixture completed' }] : [{ type: 'tool-call', toolCallId: 'skill', toolName: 'skill_load', input: '{"slug":"shared:weekly-review"}' }, { type: 'tool-call', toolCallId: 'reference', toolName: 'skill_load', input: '{"slug":"shared:weekly-review","path":"references/guide.md"}' }, { type: 'tool-call', toolCallId: 'help', toolName: 'openag_help', input: '{"topic":"memory-skills"}' }], finishReason: { unified: done ? 'stop' : 'tool-calls', raw: done ? 'stop' : 'tool_calls' }, usage, warnings: [] };
 } });
 const api = createApiRuntime({ model, tools: first.defs });
 runner = createRunner({ db, ledger, approvals, dataDir, skills: catalogue, tools: first.executors, runtimes: { api: { async runTurn(ctx) { if (realApi) return api.runTurn(ctx); return action(ctx); } }, acp } });
 access = createMcpAccess({ runner, dataDir, tools: () => first.defs });
 server = serve({ hostname: '127.0.0.1', port: 0, fetch: request => access.handle(request) });
 if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
 base = `http://127.0.0.1:${server.address().port}`;
 action = async ctx => {
  assert.equal(classify('skill_list'), 'read');
  const listed = await ctx.callTool('skill_list', {}); assert.equal(listed.ok, true); assert.equal(listed.result.skills.length, ctx.bot.id === 'a' ? 1 : 0);
  const loaded = await ctx.callTool('skill_load', { slug: 'shared:weekly-review' });
  assert.equal(loaded.result.found, ctx.bot.id === 'a');
  if (ctx.bot.id === 'a') {
   assert.ok(ctx.prompt.includes('shared:weekly-review')); assert.ok(!ctx.prompt.includes('shared:another-copy'));
   assert.ok(loaded.result.untrusted); assert.ok(loaded.result.skill.body.includes('SHARED_WORKFLOW'));
   const ref = await ctx.callTool('skill_load', { slug: 'shared:weekly-review', path: 'references/guide.md' }); assert.equal(ref.result.resource.text, 'REFERENCE_MARKER'); assert.equal(ref.result.resource.id,'shared:weekly-review');assert.equal(ref.result.resource.path,'references/guide.md');assert.equal(ref.result.resource.version,null);
   for (const path of ['../outside', '/etc/passwd', 'references/escape.md']) assert.equal((await ctx.callTool('skill_load', { slug: 'shared:weekly-review', path })).result.found, false);
  }
 };
 writeFileSync(join(mainPackage, '.env'), 'PRIVATE_HIDDEN_RESOURCE');
 assert.equal(catalogue.resource('a', 'shared:weekly-review', '.env'), null);
 writeFileSync(join(dir, 'outside'), 'OUTSIDE_MUST_NOT_LEAK'); symlinkSync(join(dir, 'outside'), join(mainPackage, 'references/escape.md'));
 await run(); await run('b');
 assert.ok(!catalogue.list('a').some(entry => entry.id === 'shared:another-copy'));
 setSetting(db, 'defaultBot', { botId: 'a' }); realApi = true; await run(); realApi = false; setSetting(db, 'defaultBot', { botId: 'acp' }); await run('acp');
 assert.ok(prompts.find(p => p.runtime === 'api' && p.text.includes('SHARED_WORKFLOW') && p.text.includes('REFERENCE_MARKER')));
 assert.ok(prompts.find(p => p.runtime === 'acp' && p.text.includes('shared:weekly-review')));
 assert.ok(prompts.some(p => p.runtime === 'api' && p.text.includes('newly discovered packages start unassigned')));
 assert.ok(JSON.stringify(calls).includes('newly discovered packages start unassigned'));
 assert.ok(JSON.stringify(calls).includes('SHARED_WORKFLOW')); assert.ok(JSON.stringify(calls).includes('REFERENCE_MARKER'));
 await run('acp'); assert.equal(sessionsCreated, 1);
 await assign('acp', []); await run('acp'); assert.equal(sessionsCreated, 2); assert.ok(!prompts.at(-1).text.includes('shared:weekly-review')); assert.ok(!JSON.stringify(calls.slice(-3)).includes('SHARED_WORKFLOW'));
 console.log('PASS actual API runtime, cached ACP/MCP loading, references, scope refusals and session refresh after assignment removal');

 // A loaded skill cannot bypass confined-mode refusal; interactive Full access permits the managed writer.
 action=async ctx=>{calls.push(await ctx.callTool('skill_save',{slug:'weekly-review',name:'A: reviewed name',description:'Agent-owned workflow',body:'EDITED_LOCAL_VERSION'}));};
 await run();assert.equal(calls.at(-1).status,'denied');assert.equal(loadSkill(dataDir,'a','weekly-review'),null);assert.deepEqual(readFileSync(join(mainPackage,'SKILL.md')),original);
 const permissions=createPermissions(db,ledger,dataDir,approvals),selection=permissions.ensure('a','room');permissions.select('a','room','full-access','controlled-owner',selection.revision);
 await run();assert.equal(calls.at(-1).ok,true);assert.equal(approvals.listPending().length,0);
 assert.equal(loadSkill(dataDir,'a','weekly-review').body.trim(),'EDITED_LOCAL_VERSION');
 assert.equal(loadSkill(dataDir, 'a', 'weekly-review').name, 'A: reviewed name');
 assert.deepEqual(readFileSync(join(mainPackage, 'SKILL.md')), original);
 const legacyDir = join(dataDir, 'bots/a/skills/legacy'); mkdirSync(legacyDir, { recursive: true });
 writeFileSync(join(legacyDir, 'SKILL.md'), '---\nname: A: legacy name\ndescription: true\nversion: 2\n---\nLEGACY_UNQUOTED');
 assert.equal(loadSkill(dataDir, 'a', 'legacy')?.name, 'A: legacy name', 'Previously written unquoted metadata must remain readable');
 const literalDir = join(dataDir, 'bots/a/skills/legacy-literal'); mkdirSync(literalDir, { recursive: true });
 writeFileSync(join(literalDir, 'SKILL.md'), '---\nname: A #literal\ndescription: Save #tags and their meaning\nversion: 2\ntriggers: 123\n---\nLEGACY_LITERAL');
 const literal = loadSkill(dataDir, 'a', 'legacy-literal');
 assert.equal(literal.name, 'A #literal'); assert.equal(literal.description, 'Save #tags and their meaning'); assert.deepEqual(literal.triggers, ['123']);
 const count = approvals.listPending().length; await run('a', { unattended: true }); assert.equal(calls.at(-1).status, 'denied'); assert.equal(approvals.listPending().length, count);
 action = async ctx => { calls.push(await ctx.callTool('skill_load', { slug: 'shared:weekly-review' })); }; await run('a',{isolated:true});assert.equal(calls.at(-1).status,'denied');
 applier = createReflectionApplier({ ledger, approvals, dataDir, saveSkill: (botId, input) => saveSkill(dataDir, botId, input) });
 const proposal = approvals.request({ roomId: '_reflection', botId: 'a', toolName: REFLECTION_SKILL_TOOL, toolClass: 'act-local', payload: { slug: 'reflected', name: 'Reflected', description: 'Local only', body: 'PROPOSAL' } });
 assert.equal(loadSkill(dataDir, 'a', 'reflected'), null);
 approvals.resolve(proposal.approvalId, { kind: 'accept' }, approvals.get(proposal.approvalId).reviewVersion); await applier.idle();
 assert.equal(loadSkill(dataDir, 'a', 'reflected').version, 1); assert.deepEqual(readFileSync(join(mainPackage, 'SKILL.md')), original);
 console.log('PASS confined refusal/Full managed save, legacy metadata roundtrip, unattended/isolation restrictions, reflection and byte-identical shared files');

 const privateLocation = 'identity-becomes-private-23456'; pkg(privateLocation); await assign('a', ['shared:' + privateLocation]); await assign('b', ['shared:' + privateLocation]);
 getDefaultRedactor().addSecret(privateLocation);
 assert.ok(!JSON.stringify(await json(await req('/bots/a/skills'))).includes(privateLocation));
 assert.ok(!JSON.stringify(await json(await req('/settings'))).includes(privateLocation));
 action = async ctx => { const result = await ctx.callTool('skill_list', {}); assert.ok(!JSON.stringify(result).includes(privateLocation)); }; await run();
 await assign('a', ['shared:weekly-review']);
 assert.ok(!JSON.stringify(getSetting(db, 'skillLibrary')).includes(privateLocation), 'Explicit assignment writes clean private references across agents');
 const toggleLocation = 'source-toggle-private-34567'; pkg(toggleLocation); await assign('a', ['shared:' + toggleLocation]); await assign('b', ['shared:' + toggleLocation]); getDefaultRedactor().addSecret(toggleLocation);
 await json(await req('/skills/library', { enabled: false }));
 assert.ok(!JSON.stringify(getSetting(db, 'skillLibrary')).includes(toggleLocation));
 await json(await req('/skills/library', { enabled: true })); await assign('a', ['shared:weekly-review']);
 const secret = 'controlled-private-skill-secret-12345'; getDefaultRedactor().addSecret(secret);
 writeFileSync(join(mainPackage, 'references/guide.md'), `REFERENCE ${secret}`);
 assert.ok(!catalogue.resource('a', 'shared:weekly-review', 'references/guide.md').text.includes(secret));
 writeFileSync(join(mainPackage, 'references', secret + '.md'), 'PRIVATE_NAME');
 assert.ok(!JSON.stringify(catalogue.load('a', 'shared:weekly-review')).includes(secret));
 assert.equal(catalogue.resource('a', 'shared:weekly-review', 'references/' + secret + '.md'), null);
 const refRead = await json(await req('/bots/a/skills/shared%3Aweekly-review?path=references%2Fguide.md'));
 assert.ok(refRead.resource.text.includes('REFERENCE')); assert.ok(!JSON.stringify(refRead).includes(secret));
 assert.equal((await req('/bots/b/skills/shared%3Aweekly-review?path=references%2Fguide.md')).status, 404);
 const escaped = [...secret].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
 const escapedPackage = pkg('escaped');
 writeFileSync(join(escapedPackage, 'SKILL.md'), `---\nname: "${escaped}"\ndescription: "${escaped}"\ncompatibility: "${escaped}"\n---\nSAFE`);
 assert.ok(!JSON.stringify(await json(await req('/skills/package?botId=a&id=shared:escaped'))).includes(secret), 'Decoded YAML metadata must be redacted');
 const fifoPackage = join(library, 'fifo'); mkdirSync(fifoPackage); execFileSync('mkfifo', [join(fifoPackage, 'SKILL.md')]);
 const inspectFifo = `const {openDb}=await import(${JSON.stringify(root + 'apps/daemon/dist/db/index.js')});const {createSkillCatalogue}=await import(${JSON.stringify(root + 'apps/daemon/dist/skills.js')});const db=openDb(${JSON.stringify(dataDir)});try{const entry=createSkillCatalogue(db,${JSON.stringify(dataDir)},${JSON.stringify(library)}).list('a',true).find(s=>s.id==='shared:fifo');if(entry?.availability!=='invalid')process.exitCode=1;}finally{db.close();}`;
 execFileSync(process.execPath, ['--input-type=module', '-e', inspectFifo], { timeout: 3000, stdio: 'pipe' });
 pkg('weekly-review', 'UPDATED_EXTERNALLY'); assert.ok(catalogue.load('a', 'shared:weekly-review').body.includes('UPDATED_EXTERNALLY'));
 rmSync(mainPackage, { recursive: true }); assert.equal(catalogue.load('a', 'shared:weekly-review'), null); assert.equal(catalogue.list('a').find(s => s.id === 'shared:weekly-review').availability, 'missing');
 assert.ok(!catalogue.index('a').includes('shared:another-copy'));
 const reopened = openDb(dataDir); assert.ok(getSetting(reopened, 'skillLibrary').assignments['agent:a'].includes('shared:weekly-review')); reopened.close();
 const linked = join(dir, 'linked-package'); mkdirSync(linked); writeFileSync(join(linked, 'SKILL.md'), '---\nname: linked\ndescription: Linked portable package\n---\nLINKED_MARKER'); symlinkSync(linked, join(library, 'linked'));
 await assign('a', ['shared:linked']); assert.ok(catalogue.load('a', 'shared:linked').body.includes('LINKED_MARKER'));
 for (const id of ['constructor', 'toString', '__proto__']) {
  rooms.createBot(db, { id, runtime: 'api', model: 'openai/fixture' }); rooms.addMember(db, 'room', id);
  assert.equal(catalogue.list(id).length, 0); assert.equal((await req(`/bots/${id}/skills`)).status, 200);
  let assigned = false;
  action = async ctx => { const result = await ctx.callTool('skill_load', { slug: 'shared:linked' }); assert.equal(result.result.found, assigned); };
  await run(id); await assign(id, ['shared:linked']); assigned = true; await run(id);
 }
 writeFileSync(join(library, 'bad'), 'not a directory'); const bad = pkg('malformed'); writeFileSync(join(bad, 'SKILL.md'), '---\nname: [broken\n---\ninvalid'); assert.equal(catalogue.list('a', true).find(s => s.id === 'shared:malformed').availability, 'invalid');
 const many = []; for (let i = 0; i < 45; i++) { const id = 'many-' + String(i).padStart(2, '0'); pkg(id, 'Many', id); many.push('shared:' + id); }
 await assign('a', many); assert.ok(catalogue.index('a').includes('more skills not listed'));
 action = async ctx => { const result = await ctx.callTool('skill_list', { query: 'many-44' }); assert.equal(result.result.skills[0].id, 'shared:many-44'); }; await run();
 await json(await req('/skills/library', { enabled: false })); assert.equal(catalogue.load('a', many[0]), null);
 assert.ok(catalogue.list('a').filter(s => s.source === 'shared').every(s => s.availability === 'missing'));
 assert.equal(catalogue.resource('b', 'shared:linked', 'SKILL.md'), null);
 assert.ok(ledger.list('room').every(e => !JSON.stringify(e).includes(secret)));
 assert.equal(db.prepare("SELECT count(*) n FROM turns WHERE status='failed'").get().n, 0);
 console.log('PASS external changes, missing identity, restart persistence, trusted directory links, invalid packages, bounded lookup, disable and redaction');
} finally {
 applier?.dispose(); runner?.shutdown(); await acp?.close(); if (server) await new Promise(resolve => server.close(resolve)); db.close(); rmSync(dir, { recursive: true, force: true });
}
