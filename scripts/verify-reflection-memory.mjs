// Controlled gateway journey against temporary data; no model/provider calls or unit runner.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const load = name => import(`../apps/daemon/dist/${name}.js`);
const { openDb } = await load('db/index'), { createLedger } = await load('ledger');
const { createApprovals } = await load('approvals'), { createAuth } = await load('auth');
const { createGateway } = await load('gateway'), { createRunner } = await load('runtimes/runner');
const { registerReflection } = await load('reflection'), { createReflectionApplier } = await load('reflection-apply');
const { createScheduler } = await load('scheduler'), { createVectorMemory } = await load('vectors');
const { createBot, createRoom, addMember, getBot, getRoom } = await load('rooms');
const { ensureDataRepo, commitMemory, commitMemoryOrThrow } = await load('datagit'), { saveSkill } = await load('skills');
const { memoryPath, ensureMemoryFile, readMemoryHead } = await load('memory');
const { setSetting } = await load('settings'), { getDefaultRedactor } = await load('redact');
const dir = mkdtempSync(join(tmpdir(), 'openag-reflection-memory-'));
let db, runner, applier, server;
const preview = process.argv.includes('--preview');
try {
  await ensureDataRepo(dir);
  db = openDb(dir);
  createBot(db, { id: 'bot', name: 'Bot', runtime: 'api' });
  createRoom(db, { id: 'main', leadBotId: 'bot' });
  addMember(db, 'main', 'bot');
  setSetting(db, 'defaultBot', { botId: 'bot' });
  setSetting(db, 'reflection', { enabled: false, botId: 'bot', maxMemoryProposals: 2 });
  ensureMemoryFile(dir, { id: 'bot', name: 'Bot' });
  await commitMemory(dir, 'memory: initial');
  const ledger = createLedger(db), approvals = createApprovals(db, ledger);
  const auth = createAuth({ db, ownerToken: 'controlled-reflection-owner' });
  const full = auth.createDevice('Controlled full device', 'owner', 'full');
  const limited = auth.createDevice('Controlled limited device', 'owner', 'limited');
  const vectors = createVectorMemory({ db, embedder: { model: 'controlled', async embed(texts) { return texts.map(() => [1, 0, 0]); } } });
  const secret = 'controlled-reflection-secret-12345';
  getDefaultRedactor().addSecret(secret);
  let proposals = [
    { kind: 'memory_append', text: 'Prefers tea over coffee' },
    { kind: 'memory_append', text: 'prefers  tea over coffee' },
    { kind: 'memory_append', text: `Secret ${secret}` },
    { kind: 'memory_append', text: 'Over the configured cap' },
    { kind: 'skill', slug: 'weekly-review', name: 'Weekly review', description: 'Review the week', body: '1. List wins' },
  ];
  let ordinaryPrompt = '';
  const runtime = { async runTurn(ctx) {
    if (ctx.room.id === '_reflection') {
      for (const name of ['memory_append', 'reflection_memory', 'skill_save']) {
        assert.equal((await ctx.callTool(name, { text: 'bypass' })).ok, false);
      }
      ctx.ledger.append(ctx.room.id, ctx.bot.id, 'bot_output', { text: JSON.stringify({ proposals }), turnId: ctx.turnId });
    } else {
      ordinaryPrompt = ctx.prompt;
      ctx.ledger.append(ctx.room.id, ctx.bot.id, 'bot_output', { text: 'Controlled reply', turnId: ctx.turnId });
    }
  } };
  runner = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { api: runtime, acp: runtime }, tools: {}, vectors });
  const reflection = registerReflection({ db, ledger, approvals, runner, scheduler: createScheduler(), tz: 'UTC', dataDir: dir, skillsEnabled: true });
  applier = createReflectionApplier({ ledger, approvals, dataDir: dir, saveSkill: async (botId, skill) => {
    saveSkill(dir, botId, skill);
    await commitMemory(dir, 'skills: controlled reflection acceptance');
  } });
  const app = createGateway({ db, ledger, approvals, auth, reflection, vectors, dataDir: dir,
    deskDir: new URL('../apps/desk/dist', import.meta.url).pathname, dispatch: args => runner.dispatch(args) });
  const api = async (path, method = 'GET', body, token = full.token) => app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const run = async () => {
    assert.equal((await api('/reflection/run', 'POST')).status, 202);
    await reflection.idle();
    return reflection.status().runs[0];
  };
  const legacy = approvals.request({ roomId: 'main', botId: 'bot', toolName: 'reflection_memory', toolClass: 'act-local', payload: { text: 'Legacy pending note' } }).approvalId;
  assert.equal((await api('/reflection', 'GET', undefined, limited.token)).status, 200);
  assert.equal((await api('/reflection/run', 'POST', undefined, limited.token)).status, 403);
  assert.equal(reflection.status().runs.length, 0, 'Limited manual request must not start a run, even while disabled');
  const first = await run();
  assert.equal(first.status, 'finished');
  assert.equal(first.memoryProposals, 2);
  let memory = await (await api('/bots/bot/memory')).json();
  assert.match(memory.text, /Prefers tea over coffee/);
  assert.ok(!memory.text.includes(secret));
  assert.ok(!memory.text.includes('Over the configured cap'));
  assert.equal(approvals.listPending().filter(a => a.toolName === 'reflection_memory').length, 1);
  assert.equal(approvals.get(legacy).status, 'pending');
  const skill = approvals.listPending().find(a => a.toolName === 'reflection_skill');
  const skillFile = join(dir, 'bots/bot/skills/weekly-review/SKILL.md');
  assert.ok(skill);
  assert.equal(existsSync(skillFile), false);
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  assert.match(git('log', '-1', '--format=%an %s'), /openagd memory: reflection save/);
  assert.equal(await commitMemoryOrThrow(dir, 'memory: clean index is success'), false);
  const events = db.prepare("SELECT payload_json FROM events WHERE type IN ('reflection_started','reflection_finished')").all();
  assert.ok(!JSON.stringify(events).includes('Prefers tea'));
  console.log('ok automatic redacted saves, Full-only manual run, caps, counts-only audit, tool isolation, pending legacy and skill approval');

  proposals = [{ kind: 'memory_append', text: 'prefers tea over coffee' }];
  assert.equal((await run()).status, 'empty');
  assert.equal((readMemoryHead(dir, 'bot').match(/Prefers tea/g) ?? []).length, 1);
  const readCurrentMemory = async () => {
    const message = ledger.append('main', 'user', 'message', { text: 'Read your current saved memory' });
    await runner.run(getRoom(db, 'main'), getBot(db, 'bot'), message);
    await runner.idle();
    return ordinaryPrompt;
  };
  assert.match(await readCurrentMemory(), /Prefers tea over coffee/);
  vectors.indexMemoryFile('bot', memory.text);
  assert.ok(db.prepare("SELECT text FROM memory_chunks WHERE source='memory'").all().some(row => row.text.includes('Prefers tea')));
  const removed = memory.text.split('\n').filter(line => !line.includes('Prefers tea')).join('\n');
  assert.equal((await api('/bots/bot/memory', 'PUT', { text: removed }, limited.token)).status, 403);
  assert.equal((await api('/bots/bot/memory', 'PUT', { text: removed })).status, 200);
  memory = await (await api('/bots/bot/memory')).json();
  assert.equal(memory.text, removed);
  assert.ok(!readFileSync(memoryPath(dir, 'bot'), 'utf8').includes('Prefers tea'));
  assert.ok(!db.prepare("SELECT text FROM memory_chunks WHERE source='memory'").all().some(row => row.text.includes('Prefers tea')));
  assert.ok(!(await readCurrentMemory()).includes('Prefers tea'));
  assert.ok(!ordinaryPrompt.includes(secret));
  await commitMemory(dir, 'memory: controlled removal settled');
  assert.ok(!git('show', 'HEAD:bots/bot/MEMORY.md').includes('Prefers tea'));
  console.log('ok duplicate suppression, Full-only removal, reload, index cleanup, next-turn context and committed removal');

  const decide = async (id, decision) => {
    const review = await (await api(`/approvals/${id}`)).json();
    const response = await api(`/approvals/${id}`, 'POST', { ...decision, reviewVersion: review.approval.reviewVersion });
    assert.equal(response.status, 200);
    await applier.idle();
  };
  await decide(skill.id, { kind: 'accept' });
  assert.match(readFileSync(skillFile, 'utf8'), /List wins/);
  assert.equal(approvals.get(legacy).status, 'pending');
  await decide(legacy, { kind: 'ignore' });
  assert.ok(!readMemoryHead(dir, 'bot').includes('Legacy pending note'));
  console.log('ok skill saved only after API approval; ignoring legacy memory does not write');

  const beforeInvalid = readFileSync(memoryPath(dir, 'bot'), 'utf8');
  proposals = [{ kind: 'memory_append', text: '' }];
  assert.equal((await run()).status, 'invalid');
  assert.equal(readFileSync(memoryPath(dir, 'bot'), 'utf8'), beforeInvalid);
  renameSync(join(dir, '.git'), join(dir, '.history-disabled'));
  try {
    proposals = [{ kind: 'memory_append', text: 'Saved before history failure' }];
    const uncommitted = await run();
    assert.equal(uncommitted.status, 'failed');
    assert.equal(uncommitted.memoryProposals, 1);
    assert.match(readMemoryHead(dir, 'bot'), /Saved before history failure/);
  } finally {
    renameSync(join(dir, '.history-disabled'), join(dir, '.git'));
  }
  assert.equal((await run()).status, 'empty', 'uncertain commit must not cause another append');
  // A directory at the file path forces a deterministic filesystem failure, without touching real data.
  createBot(db, { id: 'blocked', runtime: 'api' });
  mkdirSync(memoryPath(dir, 'blocked'), { recursive: true });
  setSetting(db, 'reflection', { enabled: true, botId: 'blocked' });
  assert.equal((await run()).status, 'failed');
  setSetting(db, 'reflection', { enabled: true, botId: 'bot' });
  console.log('ok invalid output, history failure with retained saved count, no retry and filesystem failure');

  if (preview) {
    proposals = [{ kind: 'memory_append', text: 'Prefers tea over coffee' }];
    await run();
    const require = createRequire(new URL('../apps/daemon/package.json', import.meta.url));
    const { serve } = require('@hono/node-server');
    server = serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    console.log(`PREVIEW http://127.0.0.1:${server.address().port} — pair code ${auth.createPairingCode('owner', 'full').code}`);
    await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
  }
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await runner?.idle();
  await applier?.idle();
  applier?.dispose();
  db?.close();
  rmSync(dir, { recursive: true, force: true });
}
