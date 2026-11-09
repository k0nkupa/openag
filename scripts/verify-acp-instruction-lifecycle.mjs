// Standalone runner + actual ACP SDK integration against temporary data and controlled protocol peers.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(root + 'apps/daemon/package.json');
const load = name => import(root + 'apps/daemon/dist/' + name + '.js');
const { agent, methods, RequestError } = await import(require.resolve('@agentclientprotocol/sdk/unstable'));
const { openDb } = await load('db/index'), { createLedger } = await load('ledger'), { createApprovals } = await load('approvals');
const { createRunner } = await load('runtimes/runner'), { createPermissions } = await load('permissions');
const { createAcpRuntime, ACP_SESSION_INSTRUCTIONS, ACP_INSTRUCTION_VERSION, profiles } = await load('runtimes/acp');
const { createBot, createRoom, addMember, getBot, getRoom } = await load('rooms');
const directory = mkdtempSync(join(tmpdir(), 'openag-acp-lifecycle-'));
for (const adapter of ['claude', 'codex']) {
  const dataDir = join(directory, adapter), db = openDb(dataDir), ledger = createLedger(db), approvals = createApprovals(db, ledger), permissions = createPermissions(db, ledger, dataDir, approvals);
  createBot(db, { id: 'bot', runtime: 'acp', config: { adapter } }); createRoom(db, { id: 'main', leadBotId: 'bot' }); addMember(db, 'main', 'bot');
  const calls = [], sessions = new Set();
  let count = 0, support = true, rejectResume = false, closes = 0;
  const launcher = () => {
    const peer = agent({ name: 'instruction-lifecycle' })
      .onRequest(methods.agent.initialize, () => ({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {}, ...(support ? { systemPrompt: {} } : {}) } } }))
      .onRequest(methods.agent.session.new, ({ params }) => {
        assert.deepEqual(params.systemPrompt, { mode: 'append', content: [{ type: 'text', text: ACP_SESSION_INSTRUCTIONS }] });
        assert.ok(!params.systemPrompt.content[0].text.includes('UNTRUSTED_MARKER'));
        const sessionId = 'session-' + (++count); sessions.add(sessionId); calls.push({ method: 'new', sessionId });
        return { sessionId, modes: { currentModeId: profiles[adapter].safeMode, availableModes: [{ id: profiles[adapter].safeMode, name: 'Native restricted' }] } };
      })
      .onRequest(methods.agent.session.resume, ({ params }) => {
        calls.push({ method: 'resume', sessionId: params.sessionId });
        assert.ok(sessions.has(params.sessionId));
        assert.equal(params.systemPrompt.content[0].text, ACP_SESSION_INSTRUCTIONS);
        if (rejectResume) throw RequestError.invalidParams({ reason: 'Controlled busy session' });
        return { configOptions: [] };
      })
      .onRequest(methods.agent.session.setMode, ({ params }) => { assert.equal(params.modeId, profiles[adapter].safeMode); return {}; })
      .onRequest(methods.agent.session.prompt, ({ params }) => {
        calls.push({ method: 'prompt', sessionId: params.sessionId, text: params.prompt.filter(p => p.type === 'text').map(p => p.text).join('\n') });
        return { stopReason: 'end_turn' };
      });
    return { target: peer, close() { closes++; } };
  };
  let acp = createAcpRuntime({ dataDir, launcher });
  const runner = createRunner({ db, ledger, approvals, permissions, dataDir, tools: {}, runtimes: { acp: { runTurn: ctx => acp.runTurn(ctx), close: () => acp.close() } } });
  async function run(resume, meta) {
    const message = resume ? ledger.get(resume.state.messageId) : ledger.append('main', 'user', 'message', { text: 'UNTRUSTED_MARKER: no tools' });
    await runner.run(getRoom(db, 'main'), getBot(db, 'bot'), message, resume && { ...resume, prompt: 'Continue without tools.' }, meta);
    const id = ledger.list('main', { limit: 1000 }).findLast(e => e.type === 'turn_finished').payload.turnId;
    const row = db.prepare('SELECT * FROM turns WHERE id=?').get(id);
    return { row, state: JSON.parse(row.state_json), turnId: row.id };
  }
  async function reconnect() { await acp.close(); acp = createAcpRuntime({ dataDir, launcher }); }
  try {
    const first = await run(); assert.equal(first.row.status, 'finished'); assert.equal(first.state.acpInstructionVersion, ACP_INSTRUCTION_VERSION);
    const reused = await run(); assert.equal(reused.state.acpSessionId, first.state.acpSessionId);
    await reconnect();
    const resumed = await run(reused); assert.equal(resumed.row.status, 'finished'); assert.equal(resumed.state.acpSessionId, reused.state.acpSessionId);
    assert.ok(calls.some(c => c.method === 'resume'));
    for (const legacy of [undefined, 'old-bridge-version']) {
      await reconnect(); const before = calls.filter(c => c.method === 'resume').length;
      const fresh = await run({ ...resumed, state: { ...resumed.state, acpInstructionVersion: legacy } });
      assert.equal(fresh.row.status, 'finished'); assert.notEqual(fresh.state.acpSessionId, resumed.state.acpSessionId);
      assert.equal(calls.filter(c => c.method === 'resume').length, before, 'Legacy context must not resume');
    }
    const current = permissions.get('bot', 'main'); permissions.select('bot', 'main', 'read-only', 'fixture', current.revision);
    const revised = await run(); assert.notEqual(revised.state.acpSessionId, reused.state.acpSessionId);
    const limited = await run(undefined, { unattended: true, noNetwork: true });
    assert.equal(limited.state.acpSessionId, revised.state.acpSessionId, 'Static bridge remains reusable across turn ceilings');
    assert.ok(calls.at(-1).text.includes('"unattended":true') && calls.at(-1).text.includes('"noNetwork":true'));
    await reconnect(); rejectResume = true;
    const before = calls.filter(c => c.method === 'new').length;
    const failed = await run(limited); assert.equal(failed.row.status, 'failed');
    assert.equal(calls.filter(c => c.method === 'new').length, before, 'Resume failure must not silently start fresh');
    rejectResume = false; await reconnect(); support = false;
    const prompts = calls.filter(c => c.method === 'prompt').length;
    const unsupported = await run(); assert.equal(unsupported.row.status, 'failed');
    assert.equal(calls.filter(c => c.method === 'prompt').length, prompts);
    assert.ok(closes > 0); assert.equal(approvals.listPending().length, 0);
    if (adapter === 'claude') {
      support = true; await reconnect();
      const previous = profiles.claude.sessionMeta;
      try {
        profiles.claude.sessionMeta = { claudeCode: { options: { systemPrompt: 'competing carrier' } } };
        const conflicting = await run(); assert.equal(conflicting.row.status, 'failed');
        assert.equal(calls.filter(c => c.method === 'prompt').length, prompts);
      } finally { profiles.claude.sessionMeta = previous; }
    }
    console.log('PASS ' + adapter + ': fresh/reused/resumed, legacy/changed bridge, permission revision, per-turn ceilings, missing support, failed-resume stop and carrier conflicts');
  } finally { runner.shutdown(); await acp.close(); await runner.drain(); db.close(); }
}
