// Standalone integration checks: temporary DB/computers and controlled transports only.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const load = p => import(root + 'apps/daemon/dist/' + p + '.js');
const { openDb } = await load('db/index'), { createLedger } = await load('ledger');
const { createApprovals } = await load('approvals'), { createRunner } = await load('runtimes/runner');
const rooms = await load('rooms'), { setSetting, getSetting } = await load('settings');
const { createFirstPartyTools } = await load('tools/firstparty'), { createCapabilityCatalogue } = await load('capabilities');
const { createComputer } = await load('computer'), { createDriverComputer } = await load('computer/driver');
const { createComputerRouter } = await load('computer/router'), { createComputerBackends } = await load('computer/backends');
const { createPusher } = await load('push');
const { enabledTools, toolAvailability } = await load('tools/registry'), { MCP_TOOL_NAMES } = await load('mcpserver');
const { classify } = await load('policy');
const dir = mkdtempSync(join(tmpdir(), 'openag-capabilities-'));
const savedSearch = process.env.BRAVE_API_KEY, savedComputer = process.env.OPENAG_COMPUTER;
let db, runner;
try {
  delete process.env.BRAVE_API_KEY; delete process.env.OPENAG_COMPUTER;
  db = openDb(join(dir, 'db'));
  const ledger = createLedger(db), approvals = createApprovals(db, ledger);
  rooms.createBot(db, { id: 'bot', runtime: 'api', model: 'openai/fixture' });
  rooms.createRoom(db, { id: 'room', leadBotId: 'bot' }); rooms.addMember(db, 'room', 'bot');
  let remote = 0, cli = 0, starts = 0, stops = 0, creates = 0, inspect = 0;
  const pusher = createPusher({ db, fetch: async () => { remote++; return new Response(null, { status: 200 }); } });
  const cua = createComputer({ dataDir: dir, run: async () => { cli++; return { code: 3, stdout: '', stderr: '' }; } });
  const first = createFirstPartyTools({ db, computer: cua, pusher });
  const catalogue = createCapabilityCatalogue(db, () => first.defs);
  const {createPermissions,executionPolicy}=await load('permissions'),permissions=createPermissions(db,ledger,dir,approvals);
  const ctx = { botId: 'bot', roomId: 'room', dataDir: dir, turnPolicy: {},permission:executionPolicy(permissions.ensure('bot','room')),permissionApproval:'ask' };
  const describe = (family, context = ctx) => catalogue.describe(context, family);
  const find = (name, context = ctx) => describe(undefined, context).tools.find(t => t.name === name);
  const capTool = first.defs.find(t => t.name === 'openag_capabilities');
  assert.equal(classify(capTool.name), 'read'); assert.ok(MCP_TOOL_NAMES.includes(capTool.name));
  assert.equal(capTool.input.safeParse({ botId: 'other', family: 'search' }).success, false);
  assert.equal(capTool.input.safeParse({ family: 'secrets' }).success, false);
  assert.equal(describe(undefined, { ...ctx, turnPolicy: undefined }).unavailable, true);
  assert.equal(describe(undefined, { ...ctx, roomId: 'missing' }).unavailable, true);
  const changes = db.prepare('SELECT total_changes() AS n').get().n;
  assert.equal(find('brave_search').availability.code, 'missing_configuration');
  assert.equal(enabledTools(first.defs).some(t => t.name === 'brave_search'), false);
  process.env.BRAVE_API_KEY = 'synthetic-search-key-only';
  assert.equal(find('brave_search').availability.code, 'configured');
  assert.equal(enabledTools(first.defs).some(t => t.name === 'brave_search'), true);
  assert.ok(!JSON.stringify(describe()).includes(process.env.BRAVE_API_KEY));
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changes);
  assert.equal(remote + cli, 0);
  assert.throws(() => enabledTools([{ name: 'foreign', enabled() { throw Error('Legacy error stays visible'); } }]), /Legacy error stays visible/);
  const failedAvailability = toolAvailability({ name: 'selected', capability: { family: 'search', availability() { throw Error('secret-provider-error'); } } });
  assert.equal(failedAvailability.code, 'unknown'); assert.ok(!JSON.stringify(failedAvailability).includes('secret-provider'));
  console.log('ok search discovery, dynamic offering, strict scope, no secrets/writes/probes');

  assert.equal(find('notify_user').availability.code, 'disabled');
  setSetting(db, 'push', { ...getSetting(db, 'push'), enabled: true, topic: null });
  assert.equal(find('notify_user').availability.code, 'missing_configuration');
  const syntheticTopic = 'synthetic-notification-topic-only';
  setSetting(db, 'push', { ...getSetting(db, 'push'), topic: syntheticTopic });
  assert.equal(find('notify_user').availability.code, 'configured');
  assert.equal(find('notify_user').permission.mode, 'auto');
  assert.ok(!JSON.stringify(describe()).includes(syntheticTopic));
  assert.equal(remote, 0); assert.equal(approvals.listPending().length, 0);
  assert.equal(find('brave_search').permission.mode,'auto');
  assert.equal(find('computer_click').permission.mode,'deny','Opaque input has no confined filesystem contract');
  assert.equal(find('brave_search', { ...ctx, turnPolicy: { noNetwork: true } }).permission.turnRestriction, 'offline');
  assert.equal(find('notify_user', { ...ctx, turnPolicy: { unattended: true } }).permission.turnRestriction, 'unattended');
  assert.equal(find('notify_user', { ...ctx, turnPolicy: { unattended: true, allowApprovals: true } }).permission.turnRestriction, null);
  assert.equal(find('brave_search', { ...ctx, turnPolicy: { isolated: true } }).permission.turnRestriction, 'isolated');
  console.log('ok notification reasons, shared session resolver, offline/unattended/isolation explanations');

  assert.equal(find('computer_screenshot').availability.code, 'not_observed');
  assert.equal(find('computer_shell').availability.offered, true);
  assert.equal(cli, 0);
  await cua.status(); assert.equal(cli, 1);
  const absent = find('computer_screenshot').availability;
  assert.equal(absent.code, 'absent'); assert.ok(absent.observation.observedAt > 0);
  cua.setInputGuard(() => 'synthetic-holder-name-and-viewer-token');
  assert.equal(find('computer_click').availability.code, 'human_control');
  assert.equal(find('computer_screenshot').availability.code, 'absent');
  assert.ok(!JSON.stringify(describe()).includes('synthetic-holder'));
  process.env.OPENAG_COMPUTER = 'off'; assert.equal(find('computer_screenshot').availability.code, 'disabled');
  assert.equal(find('computer_screenshot').availability.offered, false); delete process.env.OPENAG_COMPUTER;

  let wanted = 'browserbase', state = 'stopped', release;
  const gate = new Promise(r => { release = r; });
  const info = () => ({ state, status: 'ready', image: null, kind: null, runtime: null });
  const makeDriver = kind => {
    creates++;
    return createDriverComputer({ kind, name: 'fixture', capabilities: { shell: kind !== 'browserbase', hosted: kind === 'browserbase', view: 'none' },
      inspect: async () => { inspect++; return info(); },
      start: async () => { starts++; await gate; state = 'running'; },
      stop: async () => { stops++; state = 'stopped'; },
      destroy: async () => {}, screenshot: async () => { throw Error('Unexpected screenshot'); }, act: async () => { throw Error('Unexpected input'); }, shell: async () => { throw Error('Unexpected shell'); }, viewLink: async () => ({ kind: 'none' }),
    }, { dataDir: dir });
  };
  const router = createComputerRouter({ create: { cua: () => cua, browserbase: () => makeDriver('browserbase'), docker: () => makeDriver('docker'), ssh: () => makeDriver('ssh') }, unavailable: { cua: () => null, browserbase: () => null, docker: () => null, ssh: () => null }, wanted: () => wanted, shell: { cua: true, browserbase: false, docker: true, ssh: true } });
  const routed = createFirstPartyTools({ db, computer: router, pusher });
  const routedCatalogue = createCapabilityCatalogue(db, () => routed.defs);
  const routedFind = name => routedCatalogue.describe(ctx).tools.find(t => t.name === name).availability;
  assert.equal(routedFind('computer_shell').code, 'unsupported');
  assert.equal(creates + inspect, 0);
  await router.status(); assert.equal(creates, 1); assert.equal(inspect, 1);
  assert.equal(routedFind('computer_screenshot').code, 'stopped');
  const started = router.start();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(routedFind('computer_screenshot').code, 'busy');
  release(); await started;
  assert.equal(routedFind('computer_screenshot').code, 'running');
  router.setInputGuard(() => 'human-secret');
  assert.equal(routedFind('computer_click').code, 'human_control');
  assert.equal(routedFind('computer_screenshot').code, 'running');
  router.setInputGuard(undefined);
  wanted = 'docker';
  const before = { creates, inspect, starts, stops, cli, remote };
  for (let i = 0; i < 3; i++) {
    assert.equal(routedFind('computer_click').code, 'backend_switch_pending');
    assert.equal(routedFind('computer_click').observation.backend, 'browserbase');
    assert.equal(routedFind('computer_click').observation.requestedBackend, 'docker');
    enabledTools(routed.defs);
  }
  assert.deepEqual({ creates, inspect, starts, stops, cli, remote }, before);
  assert.equal(router.peek().backend, 'browserbase', 'Catalogue must not apply backend switch or release hosted session');
  // Real backend configuration can be read without constructing a backend or disclosing provider errors.
  const inert = createComputerBackends({ dataDir: dir, wanted: () => 'browserbase', env: {}, fetch: async () => { throw Error('No provider probe allowed'); } });
  const inertDefs = createFirstPartyTools({ db, computer: inert, pusher });
  const inertCatalogue = createCapabilityCatalogue(db, () => inertDefs.defs);
  assert.ok(inertCatalogue.describe(ctx, 'computer').tools.every(t => !t.availability.offered && t.availability.code === 'missing_configuration'));
  console.log('ok passive Cua/driver/router observations, busy/human state and pending-switch preservation');

  const captured = [];
  let pendingResolved;
  const approvalRaised = new Promise(r => { pendingResolved = r; });
  const unsubscribe = ledger.subscribe('room', event => { if (event.type === 'approval_requested') pendingResolved(); });
  const runtime = { async runTurn(turn) {
    assert.equal(turn.prompt.includes('Tool capability catalogue:'), turn.state.isolated !== true);
    const result = await turn.callTool('openag_capabilities', { family: 'notification' });
    captured.push(result);
    if (turn.message.payload.text === 'tamper') {
      assert.throws(() => { turn.state.unattended = false; }, TypeError);
      assert.throws(() => turn.saveState({ allowApprovals: true }), TypeError);
      assert.equal(turn.state.unattended, true);
      captured.push(await turn.callTool('notify_user', { text: 'Must remain blocked' }));
    }
    if (turn.message.payload.text === 'send') captured.push(await turn.callTool('notify_user', { text: 'Synthetic message' }));
  } };
  runner = createRunner({ db, ledger, approvals, dataDir: dir, tools: first.executors, capabilityGuidance: first.capabilityGuidance, runtimes: { api: runtime } });
  const run = (text, meta) => runner.run(rooms.getRoom(db, 'room'), rooms.getBot(db, 'bot'), ledger.append('room', 'user', 'message', { text }), undefined, meta);
  await run('read'); assert.equal(captured.at(-1).ok, true); assert.equal(remote, 0); assert.equal(approvals.listPending().length, 0);
  await run('read', { unattended: true }); assert.equal(captured.at(-1).result.tools[0].permission.turnRestriction, 'unattended');
  await run('tamper', { unattended: true }); assert.equal(captured.at(-1).status, 'denied'); assert.equal(remote, 0); assert.equal(approvals.listPending().length, 0);
  await run('read', { isolated: true }); assert.equal(captured.at(-1).status, 'denied');
  await run('send');unsubscribe();assert.equal(remote,1);assert.equal(captured.at(-1).ok,true);assert.equal(approvals.listPending().length,0,'Explicit HTTP contract requires no human approval in Workspace Write');
  console.log('ok actual runner/gate restrictions and explicit remote contract without a fabricated human approval');
} finally {
  runner?.shutdown(); if (runner) await runner.idle(); db?.close();
  if (savedSearch === undefined) delete process.env.BRAVE_API_KEY; else process.env.BRAVE_API_KEY = savedSearch;
  if (savedComputer === undefined) delete process.env.OPENAG_COMPUTER; else process.env.OPENAG_COMPUTER = savedComputer;
  rmSync(dir, { recursive: true, force: true });
}
// Shared controlled runtime fixture also verifies catalogue transport on API, Ollama and cached ACP/MCP.
await import('./verify-bot-knowledge.mjs');
console.log('PASS capability catalogue integration acceptance; no live services or unit/Jest/Vitest runners.');
