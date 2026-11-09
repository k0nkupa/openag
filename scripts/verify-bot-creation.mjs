// OA-345: standalone gateway/storage acceptance; temporary data and controlled discovery only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newCreationRequestId as randomUUID } from '../apps/desk/src/lib/creationRequestId.ts';
import { openDb } from '../apps/daemon/dist/db/index.js';
import { createLedger } from '../apps/daemon/dist/ledger.js';
import { createAuth } from '../apps/daemon/dist/auth.js';
import { createApprovals } from '../apps/daemon/dist/approvals.js';
import { createGateway } from '../apps/daemon/dist/gateway.js';
import { getDefaultRedactor } from '../apps/daemon/dist/redact.js';
import { createBotModels } from '../apps/daemon/dist/botmodels.js';
const dir = mkdtempSync(join(tmpdir(), 'openag-new-bot-'));
let db = openDb(dir);
const token = 'controlled-new-bot-owner';
async function gateway() {
  const ledger = createLedger(db);
  const models = createBotModels({ db, ledger, env: {}, withIdleBot: (_, fn) => fn(), acp: {
    discover: async (_, target) => ({ target, model: 'fixture-model', models: [{ id: 'fixture-model', name: 'Fixture' }], controls: [], reason: null, source: 'Controlled adapter' }), stopBot: async () => {},
  }});
  await models.catalogue.refresh();
  return createGateway({ db, ledger, auth: createAuth({ db, ownerToken: token }), approvals: createApprovals(db, ledger), botModels: models, dispatch: () => { throw Error('Creation must not dispatch'); }, deskDir: join(dir, 'absent') });
}
let app = await gateway();
const call = (path, method = 'GET', body, credential = token) => app.request(path, { method, headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
try {
  const targets = await (await call('/bots/creation/targets')).json();
  assert.equal(targets.targets.find(t => t.id === 'openai').configured, false, 'missing provider credentials are passive metadata');
  assert.ok(targets.targets.every(t => typeof t.configured === 'boolean'));
  assert.ok(targets.targets.every(t => Object.keys(t).every(k => ['id', 'name', 'configured'].includes(k))), 'no environment values in picker metadata');
  const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
  let requestId;
  try { Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }); requestId = randomUUID(); }
  finally { if (descriptor) Object.defineProperty(crypto, 'randomUUID', descriptor); else delete crypto.randomUUID; }
  const discovery = await call('/bots/creation/discover', 'POST', { requestId, target: 'codex' });
  assert.equal(discovery.status, 200, await discovery.clone().text());
  const choices = await discovery.json();
  assert.equal(db.prepare('SELECT count(*) n FROM bots').get().n, 0, 'discovery persists no bot');
  const input = { requestId, name: 'Research', description: 'Find evidence', instructions: 'Use sources', target: 'codex', snapshotId: choices.snapshotId, model: choices.model, reasoning: {} };
  const response = await call('/bots', 'POST', input);
  assert.equal(response.status, 201, await response.clone().text());
  const { bot } = await response.json();
  assert.equal(bot.id, 'research');
  assert.equal((await (await call('/bots')).json()).bots.length, 1);
  for (const table of ['rooms', 'room_members', 'turns', 'work']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0, table);
  console.log('ok creation through real gateway, no conversation or execution');
  const replay = await call('/bots', 'POST', input);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).bot.id, bot.id);
  assert.equal((await call('/bots', 'POST', { ...input, name: 'Changed' })).status, 409);
  assert.equal((await (await call(`/bots/creation/requests/${requestId}`)).json()).bot.id, bot.id);
  assert.equal((await (await call(`/bots/creation/requests/${randomUUID()}`)).json()).bot, null);
  assert.equal((await call('/bots/creation/requests/not-valid')).status, 400);
  const sameName = async (name = 'Research') => {
    const requestId = randomUUID();
    const choices = await (await call('/bots/creation/discover', 'POST', { requestId, target: 'codex' })).json();
    return { ...input, name, requestId, snapshotId: choices.snapshotId };
  };
  const secondInput = await sameName();
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => call('/bots', 'POST', secondInput)));
  assert.equal(concurrent.filter(r => r.status === 201).length, 1);
  for (const response of concurrent) assert.equal((await response.json()).bot.id, 'research-2');
  assert.equal((await (await call('/bots', 'POST', await sameName('everyone'))).json()).bot.id, 'bot');
  assert.equal((await (await call('/bots', 'POST', await sameName('研究'))).json()).bot.id, 'bot-2');
  for (const name of ['User', 'Slack', 'Owner', 'Primary', 'Daemon', 'Scheduler', 'System', 'Poll', 'Constructor', 'Prototype']) {
    const response = await call('/bots', 'POST', await sameName(name)); assert.equal(response.status, 201);
    const created = (await response.json()).bot; assert.notEqual(created.id, name.toLowerCase()); assert.match(created.id, /^bot-\d+$/);
  }
  const creationBot = await call('/bots', 'POST', await sameName('Creation')); assert.equal(creationBot.status, 201);
  assert.equal((await creationBot.json()).bot.id, 'creation');
  for (const endpoint of ['settings', 'model']) assert.equal((await call(`/bots/creation/${endpoint}`)).status, 200, endpoint);
  const skills = await call('/bots/creation/skills'); assert.equal(skills.status, 200); assert.deepEqual(await skills.json(), { skills: [] });
  const full = (await (await call('/devices', 'POST', { name: 'Full fixture', access: 'full' })).json()).token;
  const limited = (await (await call('/devices', 'POST', { name: 'Limited fixture', access: 'limited' })).json()).token;
  for (const [path, method, body] of [['/bots', 'POST', input], ['/bots/creation/targets', 'GET'], ['/bots/creation/discover', 'POST', { requestId, target: 'codex' }], [`/bots/creation/requests/${requestId}`, 'GET']]) {
    assert.equal((await call(path, method, body, limited)).status, 403, path);
    assert.equal((await call(path, method, body, 'bad-token')).status, 401, path);
  }
  assert.equal((await call('/bots', 'POST', await sameName('Full bot'), full)).status, 201);
  for (const patch of [{ id: '_hidden' }, { name: '' }, { name: 'x'.repeat(41) }, { instructions: 'x'.repeat(8001) }, { reasoning: { bad: true } }, { snapshotId: randomUUID() }, { model: 'unavailable' }, { requestId: randomUUID() }, { target: 'unsupported' }, { runtime: 'acp' }]) {
    const response = await call('/bots', 'POST', { ...await sameName(), ...patch });
    assert.ok([400, 409].includes(response.status), JSON.stringify(patch).slice(0, 100));
  }
  const secret = 'oa345-controlled-secret-value'; getDefaultRedactor().addSecret(secret);
  const redacted = await sameName('Private bot'); redacted.instructions = `Keep ${secret} private`;
  const privateResponse = await call('/bots', 'POST', redacted);
  assert.equal(privateResponse.status, 201);
  const privateBot = (await privateResponse.json()).bot;
  assert.ok(!('instructions' in privateBot));
  const otherSecret = 'oa345-other-controlled-secret'; getDefaultRedactor().addSecret(otherSecret);
  assert.equal((await call('/bots', 'POST', { ...redacted, instructions: `Keep ${otherSecret} private` })).status, 409, 'changed redacted secrets are conflicting content');
  const stored = db.prepare('SELECT config_json FROM bots WHERE id = ?').get(privateBot.id).config_json;
  assert.ok(!stored.includes(secret)); assert.ok(stored.includes('REDACTED'));
  assert.ok(!JSON.stringify(db.prepare('SELECT payload_json FROM events').all()).includes(secret));
  assert.equal((await call(`/bots/${bot.id}/tool-modes`)).status,410,'Category authority is retired');
  for (const cls of ['act-external', 'secrets']) assert.equal((await call(`/bots/${bot.id}/tool-modes/${cls}`, 'PUT', { mode: 'auto' })).status, 410);
  const expiring = await sameName('Expired');
  const realNow = Date.now;
  try { Date.now = () => realNow() + 301000; assert.equal((await call('/bots', 'POST', expiring)).status, 201, 'Cached choices have no five-minute expiry'); } finally { Date.now = realNow; }
  const before = db.prepare('SELECT count(*) n FROM bots').get().n;
  db.exec("CREATE TEMP TRIGGER reject_creation BEFORE INSERT ON bot_creations BEGIN SELECT RAISE(FAIL, 'Controlled storage failure'); END");
  const failed = await sameName('Rollback');
  assert.equal((await call('/bots', 'POST', failed)).status, 503);
  db.exec('DROP TRIGGER reject_creation');
  assert.equal(db.prepare('SELECT count(*) n FROM bots').get().n, before);
  assert.equal((await (await call(`/bots/creation/requests/${failed.requestId}`)).json()).bot, null);
  const audit = db.prepare("SELECT count(*) n FROM events WHERE type = 'config' AND json_extract(payload_json, '$.action') = 'bot_created'").get().n;
  assert.equal(audit, before);
  db.close(); db = openDb(dir); app = await gateway();
  assert.equal((await (await call(`/bots/creation/requests/${requestId}`)).json()).bot.id, 'research');
  assert.equal((await call('/bots', 'POST', input)).status, 200, 'receipt survives restart without discovery snapshot');
  assert.equal(db.prepare('SELECT count(*) n FROM bots').get().n, before);
  for (const table of ['rooms', 'room_members', 'turns', 'work', 'tool_modes', 'settings']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0, table);
  console.log('ok same-name handles, concurrency, access, validation, redaction, retired category writes, rollback and restart recovery');

} finally { db.close(); rmSync(dir, { recursive: true, force: true }); }

// Exercise the real ACP discovery protocol and hosted discovery using existing controlled transports.
const { startFixture } = await import('./bot-models-fixture.mjs');
const integrationDir = mkdtempSync(join(tmpdir(), 'openag-bot-models-'));
const fixture = await startFixture(integrationDir, token);
const http = (path, method = 'GET', body) => fetch(fixture.url + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
try {
  const counts = () => ['rooms', 'room_members', 'turns', 'work'].map(table => fixture.db.prepare(`SELECT count(*) n FROM ${table}`).get().n);
  const before = counts();
  for (const target of ['codex', 'claude', 'openai', 'anthropic', 'openrouter', 'ollama']) {
    const requestId = randomUUID();
    const response = await http('/bots/creation/discover', 'POST', { requestId, target });
    assert.equal(response.status, 200, await response.clone().text());
    const choices = await response.json();
    const create = await http('/bots', 'POST', { requestId, target, name: `New ${target}`, model: choices.model, snapshotId: choices.snapshotId, reasoning: {} });
    assert.equal(create.status, 201, await create.clone().text());
    const { bot } = await create.json();
    assert.equal(bot.runtime, ['codex', 'claude'].includes(target) ? 'acp' : 'api');
    const model = await (await http(`/bots/${bot.id}/model`)).json();
    assert.equal(model.model, choices.model); assert.equal(model.target, target);
  }
  assert.deepEqual(counts(), before);
  assert.equal(fixture.stats.prompts.length, 0);
  for (const probe of fixture.stats.launches) {
    assert.ok(!probe.cwd.startsWith(integrationDir), 'creation probe outside installation');
    assert.equal(existsSync(probe.cwd), false, 'creation probe scratch directory removed');
  }
  for (const mode of ['adapter-unavailable', 'unavailable']) {
    fixture.mode(mode);
    const before = fixture.db.prepare('SELECT count(*) n FROM bots').get().n;
    const target = mode === 'adapter-unavailable' ? 'codex' : 'openai';
    await fixture.botModels.catalogue.refresh();
    assert.ok(fixture.botModels.catalogue.status().sources.find(s=>s.id===target).error);
    assert.equal((await http('/bots/creation/discover', 'POST', { requestId: randomUUID(), target })).status, 200, 'Last successful choices remain available');
    assert.equal(fixture.db.prepare('SELECT count(*) n FROM bots').get().n, before);
  }
  console.log('ok real ACP protocol + hosted/Ollama controlled discovery, scratch cleanup, no prompts and failed setup leaves no bot');
} finally { await fixture.close(); rmSync(integrationDir, { recursive: true, force: true }); }
