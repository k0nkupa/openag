// Real subscription adapters, production daemon tools, temporary databases and package destinations only.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

assert.ok(process.argv.includes('--real'), 'Use --real for bounded disposable subscription-adapter acceptance');
const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(root + 'apps/daemon/package.json');
const load = name => import(root + 'apps/daemon/dist/' + name + '.js');
const { serve } = require('@hono/node-server');
const { parse: parseYaml } = require('yaml');
const { openDb } = await load('db/index'), { createLedger } = await load('ledger'), { createApprovals } = await load('approvals');
const { createRunner } = await load('runtimes/runner'), { createPermissions } = await load('permissions');
const { createAcpRuntime, ACP_SESSION_INSTRUCTIONS, ACP_INSTRUCTION_VERSION } = await load('runtimes/acp');
const { createMcpAccess } = await load('mcpserver');
const { createBot, createRoom, addMember, getRoom, getBot } = await load('rooms');
const { writeFileTool } = await load('tools/files');
const { writeTarget } = await load('effect-scope');
const isolation=process.argv.includes('--isolation');
const { inspectionTools } = await load('tools/inspection');
const { commandTool } = await load('tools/execution'), { createSkillTools } = await load('tools/skills');
const { openagHelpTool } = await load('tools/knowledge'), { toExecutors } = await load('tools/registry');
const { createSkillCatalogue, loadSkill } = await load('skills');
const { ensureDataRepo } = await load('datagit');
const parent = mkdtempSync(join(tmpdir(), 'openag-skill-install-'));
console.log('Disposable evidence: ' + parent);
const fixture = join(parent, 'fixture-package'); mkdirSync(join(fixture, 'references'), { recursive: true });
const marker = 'FIXTURE_REFERENCE_' + randomUUID();
writeFileSync(join(fixture, 'SKILL.md'), '---\nname: fixture-package\ndescription: A disposable instruction and reference package.\n---\nWhen asked the reference heading, read references/guide.md and report it.\n');
writeFileSync(join(fixture, 'references/guide.md'), '# ' + marker + '\nA bounded local reference.\n');
writeFileSync(join(fixture, 'references/second.txt'), 'Preserve this second resource exactly.\n');

function inventory(directory) {
  const files = {};
  function walk(path) {
    for (const name of readdirSync(path)) {
      const file = join(path, name), info = lstatSync(file);
      assert.ok(!info.isSymbolicLink(), 'Package must not contain symlinks');
      if (info.isDirectory()) walk(file);
      else { assert.ok(info.isFile()); files[relative(directory, file)] = createHash('sha256').update(readFileSync(file)).digest('hex'); }
    }
  }
  walk(directory); return files;
}
function deadline(promise, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ': outcome unknown; inspect evidence, no retry')), 300_000); })]).finally(() => clearTimeout(timer));
}

const selected = process.argv.includes('--adapter') ? process.argv[process.argv.indexOf('--adapter') + 1] : undefined;
assert.ok(!selected || ['claude', 'codex'].includes(selected));
const selectedPackage = process.argv.includes('--package') ? process.argv[process.argv.indexOf('--package') + 1] : undefined;
assert.ok(!selectedPackage || ['fixture-package', 'accredo'].includes(selectedPackage));
for (const source of [fixture, `${homedir()}/Projects/BW/bw-codex-plugins/plugins/accredo/skills/accredo`]) {
  if (selectedPackage && basename(source) !== selectedPackage) continue;
  for (const adapter of selected ? [selected] : ['claude', 'codex']) {
    const slug = basename(source), dataDir = join(parent, adapter + '-' + slug), sourceFiles = inventory(source);
    const db = openDb(dataDir), ledger = createLedger(db), approvals = createApprovals(db, ledger), permissions = createPermissions(db, ledger, dataDir, approvals);
    const bot = createBot(db, { id: 'bot', runtime: 'acp', config: { adapter } });
    createRoom(db, { id: 'main', leadBotId: 'bot' }); addMember(db, 'main', 'bot');
    const permission = permissions.ensure('bot', 'main'); permissions.select('bot', 'main', 'full-access', 'disposable-acceptance', permission.revision);
    await ensureDataRepo(dataDir);
    const defs = [...inspectionTools,writeFileTool, commandTool, openagHelpTool, ...createSkillTools(db)], catalogue = createSkillCatalogue(db, dataDir);
    const destination = join(dataDir, 'bots/bot/skills', slug);
    let runner, acp, base;
    const lifecycle = [], checks = [];
    let roomId='main',expectedUnknownId=null;
    const access = createMcpAccess({ dataDir, runner: { activeTurn: (...args) => runner.activeTurn(...args) }, tools: () => defs });
    function runtime() {
      return createAcpRuntime({ dataDir, mcp: { access, baseUrl: () => base, tools: new Set(defs.map(d => d.name)) }, launcher: async options => {
        const handle = await options.profile.spawn(options), writer = handle.target.writable.getWriter();
        const writable = new WritableStream({
          write(message) {
            if (['session/new', 'session/resume'].includes(message.method)) {
              assert.equal(message.params.systemPrompt.mode, 'append');
              assert.equal(message.params.systemPrompt.content[0].text, ACP_SESSION_INSTRUCTIONS);
              lifecycle.push({ method: message.method, sessionId: message.params.sessionId ?? null, instructionVersion: ACP_INSTRUCTION_VERSION });
            }
            return writer.write(message);
          }, close: () => writer.close(), abort: reason => writer.abort(reason),
        });
        return { target: { readable: handle.target.readable, writable }, close: () => handle.close() };
      } });
    }
    acp = runtime();
    runner = createRunner({ db, ledger, approvals, permissions, dataDir, tools: toExecutors(defs), runtimes: { acp: { runTurn: ctx => acp.runTurn(ctx), close: () => acp.close() } } });
    const server = serve({ hostname: '127.0.0.1', port: 0, fetch: req => access.handle(req) });
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    const unsubscribe = ledger.subscribe('main', event => {
      if (event.type === 'tool_result' && event.payload.tool) console.log(adapter + '/' + slug + ': ' + event.payload.tool + ' ' + (event.payload.executionOutcome ?? event.payload.status));
    });
    const save = () => writeFileSync(join(dataDir, 'acceptance.json'), JSON.stringify({ adapter, slug, expectedUnknownId, instructionVersion: ACP_INSTRUCTION_VERSION, lifecycle, checks }, null, 2));
    async function turn(text, resume) {
      const before = ledger.list(roomId, { limit: 1000 }).at(-1)?.id ?? 0;
      const message = resume ? ledger.get(resume.state.messageId) : ledger.append(roomId, 'user', 'message', { text });
      await deadline(runner.run(getRoom(db, roomId), getBot(db, 'bot'), message, resume && { ...resume, prompt: text }), adapter + '/' + slug);
      const events = ledger.list(roomId, { afterId: before, limit: 1000 });
      const finished = events.findLast(e => e.type === 'turn_finished');
      assert.equal(finished?.payload.status, 'finished', 'Turn must finish without uncertainty or refusal');
      const row = db.prepare('SELECT * FROM turns WHERE id=?').get(finished.payload.turnId);
      const results = events.filter(e => e.type === 'tool_result' && e.payload.tool);
      assert.ok(results.every(e => e.payload.ok), 'A nested tool failure is not acceptance');
      assert.ok(!events.some(e => e.type === 'tool_result' && !e.payload.tool && e.payload.status === 'failed'), 'Adapter/MCP validation failure is not acceptance');
      assert.equal(approvals.listPending().length, 0);
      assert.equal(db.prepare("SELECT count(*) n FROM action_receipts WHERE outcome='unknown' AND inspected_at IS NULL AND id!=?").get(expectedUnknownId??'').n, 0);
      if(expectedUnknownId){assert.equal(approvals.receipts.get(expectedUnknownId).outcome,'unknown');assert.equal(approvals.receipts.get(expectedUnknownId).inspectedAt,null);}
      const record = { turnId: row.id, sessionId: JSON.parse(row.state_json).acpSessionId, tools: results.map(e => ({ tool: e.payload.tool, receiptId: e.payload.receiptId, outcome: e.payload.executionOutcome })) };
      checks.push(record); save();
      return { row, events, results, record, output: events.filter(e => e.type === 'bot_output').map(e => e.payload.text ?? '').join('\n') };
    }
    try {
      const choice = await acp.discover(bot, adapter);
      const model = adapter === 'codex' && choice.models.some(m => m.id === 'gpt-6.1-terra') ? 'gpt-6.1-terra' : choice.model;
      db.prepare('UPDATE bots SET config_json=? WHERE id=?').run(JSON.stringify({ ...bot.config, modelConfig: { model } }), bot.id);
      console.log('Starting ' + adapter + '/' + slug + ' with ' + model);
      const install = await turn(`Install the skill package from ${source} into your agent-owned skills as ${slug}, at ${destination}. The destination and its parent skills directory may not exist yet. Include its complete reference bundle and preserve the source unchanged. Use the supported managed skill format. Invoke every tool through its exact offered OpenAg MCP identity, including the server namespace; bare native aliases are unavailable. Use list_files and read_file for file inspection instead of shell reads; list_files reports a missing directory without failing. Verify that the installed skill can be discovered and loaded. This is a disposable local acceptance installation. Change no other files, configure no integrations, contact no external services and execute no package scripts. Stop on failure or uncertainty; do not retry.`);
      assert.ok(install.results.some(e => e.payload.tool === 'skill_save'), 'Installation must use the managed writer');
      const identity = 'agent:bot:' + slug;
      assert.ok(install.results.some(e => e.payload.tool === 'skill_list' && e.payload.result?.skills?.some(s => s.id === identity && s.availability === 'available')), 'Bot must receive discovery of the installed identity');
      assert.ok(install.results.some(e => e.payload.tool === 'skill_load' && e.payload.result?.found && e.payload.result.skill?.id === identity && e.payload.result.skill?.source === 'agent'), 'Bot must receive the installed managed instructions');
      assert.ok(catalogue.list('bot').some(s => s.slug === slug && s.availability === 'available'));
      const saved = loadSkill(dataDir, 'bot', slug);
      const sourceText = readFileSync(join(source, 'SKILL.md'), 'utf8');
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(sourceText);
      assert.ok(match);
      const metadata = parseYaml(match[1]);
      assert.equal(saved?.version, 1);
      assert.equal(saved.name, metadata.name);
      assert.equal(saved.body.trim(), match[2].trim(), 'All source instructions must survive the managed save');
      assert.ok(saved.description.length > 0 && saved.description.length <= 200);
      if (metadata.description.length <= 200) assert.equal(saved.description, metadata.description);
      const installed = inventory(destination);
      for (const [file, digest] of Object.entries(sourceFiles)) if (file !== 'SKILL.md') assert.equal(installed[file], digest, 'Complete resource bundle: ' + file);
      assert.deepEqual(inventory(source), sourceFiles, 'Original package must be unchanged');
      const reference = slug === 'accredo' ? 'references/table-object-catalog.md' : 'references/guide.md';
      const heading = readFileSync(join(source, reference), 'utf8').split('\n')[0].replace(/^#\s*/, '');
      let useText = `Use your installed ${slug} skill. Load its instructions and read the heading from the installed reference ${join(destination, reference)}. Return that heading. Use skill_load and read_file through their exact offered OpenAg MCP identities; do not use shell or native aliases for inspection. Read only; do not reinstall or modify anything, execute scripts or contact external services.`;
      function verifyReference(step) {
        assert.ok(step.results.some(e => e.payload.tool === 'skill_load' && e.payload.result?.found), 'Managed instructions must be loaded');
        const calls = step.events.filter(e => e.type === 'tool_call' && ((e.payload.tool === 'read_file' && e.payload.args?.path === join(destination, reference)) || (e.payload.tool === 'run_shell' && e.payload.args?.command.includes(join(destination, reference)))));
        assert.ok(calls.some(call => step.results.some(result => result.payload.toolCallId === call.payload.toolCallId && ['read_file','run_shell'].includes(result.payload.tool) && (result.payload.result?.text??result.payload.result?.stdout??'').includes(heading))), 'Observe a successful daemon read of the installed reference, not a remembered answer');
        assert.ok(step.output.includes(heading));
      }
      const installedSnapshot = inventory(destination);
      function verifyReadOnly(step) {
        assert.ok(!step.results.some(e => (isolation?['skill_save','memory_append']:['skill_save', 'write_file', 'memory_append']).includes(e.payload.tool)), 'Reference use must not reinstall or rewrite managed data');
        assert.deepEqual(inventory(destination), installedSnapshot, 'Existing installation must remain byte-identical, including managed metadata');
      }
      if(isolation){
        createRoom(db,{id:'earlier-chat',leadBotId:'bot'});addMember(db,'earlier-chat','bot');
        const earlier=permissions.ensure('bot','earlier-chat');permissions.select('bot','earlier-chat','full-access','disposable-isolation',earlier.revision);
        expectedUnknownId=approvals.receipts.automatic({roomId:'earlier-chat',botId:'bot',turnId:'synthetic-lost-response',toolCallId:'synthetic',toolName:'write_file',toolClass:'act-local',args:{path:'uncertain.txt',content:'synthetic marker'}},permissions.ensure('bot','earlier-chat'),undefined,{parents:[],effectScope:{kind:'paths',paths:[writeTarget(join(dataDir,'bots/bot/work/uncertain.txt'))]}});
        approvals.receipts.start(expectedUnknownId,'synthetic-lost-response','synthetic');
        approvals.receipts.finish(expectedUnknownId,{outcome:'unknown',detail:'Synthetic isolation fixture only; no actual uncertain action or provider write.'});
        createRoom(db,{id:'independent-chat',leadBotId:'bot'});addMember(db,'independent-chat','bot');
        const independent=permissions.ensure('bot','independent-chat');permissions.select('bot','independent-chat','full-access','disposable-isolation',independent.revision);roomId='independent-chat';
        const marker='ISOLATED_'+randomUUID();
        useText=useText.replace('Read only; do not reinstall or modify anything, execute scripts or contact external services.',`Also use write_file to write exactly ${marker} to the relative private-workspace file independent.txt. Do not modify the installed skill, run scripts or contact external services.`);
        const fresh=await turn(useText);verifyReference(fresh);verifyReadOnly(fresh);
        assert.ok(fresh.results.some(e=>e.payload.tool==='write_file'&&e.payload.ok));assert.equal(readFileSync(join(dataDir,'bots/bot/work/independent.txt'),'utf8'),marker);
        assert.notEqual(fresh.record.sessionId,install.record.sessionId,'A different chat must create its own ACP session');
        useText=useText.replace('independent.txt','independent-reused.txt');
      }
      const reused = await turn(useText);
      verifyReadOnly(reused);
      assert.equal(reused.record.sessionId, isolation?checks.at(-2).sessionId:install.record.sessionId);
      verifyReference(reused);
      if(isolation)assert.ok(reused.results.some(e=>e.payload.tool==='write_file'&&e.payload.ok),'Reused session must dispatch an independent write');
      await acp.close(); acp = runtime();
      const beforeResume = lifecycle.length;
      if(isolation)useText=useText.replace('independent-reused.txt','independent-resumed.txt');
      const resumed = await turn(useText, { turnId: reused.row.id, state: JSON.parse(reused.row.state_json) });
      assert.ok(lifecycle.slice(beforeResume).some(e => e.method === 'session/resume'), 'Must exercise actual persisted ACP resume, not fresh history replay');
      assert.equal(resumed.record.sessionId, reused.record.sessionId);
      verifyReference(resumed);
      if(isolation)assert.ok(resumed.results.some(e=>e.payload.tool==='write_file'&&e.payload.ok),'Resumed session must dispatch an independent write');
      verifyReadOnly(resumed);
      assert.deepEqual(inventory(source), sourceFiles);
      const resumedFiles = inventory(destination);
      for (const [file, digest] of Object.entries(sourceFiles)) if (file !== 'SKILL.md') assert.equal(resumedFiles[file], digest);
      if(isolation){for(const file of ['independent-reused.txt','independent-resumed.txt'])assert.ok(readFileSync(join(dataDir,'bots/bot/work',file),'utf8').startsWith('ISOLATED_'));assert.equal(approvals.receipts.get(expectedUnknownId).inspectedAt,null);}
      checks.forEach((check,index)=>check.stage=(isolation?['fresh-install','independent-fresh','independent-reused','independent-resumed']:['fresh-install','reused-reference','resumed-reference'])[index]); save();
      console.log('PASS ' + adapter + '/' + slug + ': managed installation, complete resources, catalogue, fresh/reused/resumed reference use'+(isolation?'; independent chat writes with retained Unknown':'' ));
    } catch (error) {
      save();
      console.error(JSON.stringify({ adapter, slug, evidenceDirectory: dataDir, receipts: db.prepare('SELECT id,turn_id,tool_name,outcome FROM action_receipts ORDER BY seq DESC LIMIT 12').all(), pendingApprovals: approvals.listPending().map(a => a.id) }));
      throw error;
    } finally {
      unsubscribe(); runner.shutdown(); await acp.close(); await runner.drain();
      await new Promise(resolve => server.close(resolve)); db.close();
    }
  }
}
