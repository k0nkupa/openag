// Temporary gateway/runner/MCP journey. --real opts into bounded subscription adapter calls, never the installed daemon.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

if (!process.argv.includes('--real')) throw Error('Use --real for the bounded disposable gateway/ACP execution checkpoint');
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(root + 'apps/daemon/package.json');
const load = p => import(root + 'apps/daemon/dist/' + p + '.js');
const { serve } = require('@hono/node-server');
const { openDb } = await load('db/index'), { createLedger } = await load('ledger');
const { createApprovals } = await load('approvals'), { createAuth } = await load('auth');
const { createRunner } = await load('runtimes/runner'), { createAcpRuntime } = await load('runtimes/acp');
const { createMcpAccess } = await load('mcpserver'), { createGateway } = await load('gateway');
const { createBot, createRoom, addMember } = await load('rooms');
const { toExecutors } = await load('tools/registry');
const { createPermissions } = await load('permissions');
const { commandTool } = await load('tools/execution');
const { ActionFailure } = await load('action-receipts');
const directory = mkdtempSync(join(tmpdir(), 'openag-daemon-execution-'));
console.log('Disposable evidence: ' + directory);
const quote = s => "'" + s.replaceAll("'", "'\"'\"'") + "'";

const selectedAdapter = process.argv.includes('--adapter') ? process.argv[process.argv.indexOf('--adapter') + 1] : undefined;
assert.ok(selectedAdapter === undefined || ['claude', 'codex'].includes(selectedAdapter), 'Unknown adapter');
for (const adapter of selectedAdapter ? [selectedAdapter] : ['claude', 'codex']) {
  const dataDir = join(directory, adapter), token = randomUUID();
  const db = openDb(dataDir), ledger = createLedger(db), approvals = createApprovals(db, ledger);
  const auth = createAuth({ db, ownerToken: token });
  const bot = createBot(db, { id: 'bot', runtime: 'acp', config: { adapter } });
  createRoom(db, { id: 'main', leadBotId: 'bot' }); addMember(db, 'main', 'bot');
  // History only admits replies linked to a completed participating turn.
  const earlierRequest = ledger.append('main', 'user', 'message', { text: 'Please copy the file.' });
  const earlierTurn = randomUUID(), earlierTime = Date.now();
  db.prepare('INSERT INTO turns (id,room_id,bot_id,status,state_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(earlierTurn, 'main', 'bot', 'finished', JSON.stringify({ messageId: earlierRequest.id }), earlierTime, earlierTime);
  const mistakenReply = ledger.append('main', 'bot', 'bot_output', { turnId: earlierTurn, text: 'I could not copy the file because this session filesystem is read-only. Please enable write access before I can complete the copy.' });
  assert.ok(ledger.conversationHistory({ roomId: 'main', botId: 'bot', messageId: mistakenReply.id + 1 }).messages.some(e => e.id === mistakenReply.id), 'The mistaken earlier reply must reach selected conversation history');
  const permissions = createPermissions(db, ledger, dataDir, approvals);
  const workspace = join(dataDir, 'bots', 'bot', 'work'); mkdirSync(workspace, { recursive: true });
  const inheritedMarker = join(dataDir, 'inherited-mcp-started.txt');
  const inheritedServer = join(dataDir, 'inherited-mcp.cjs');
  writeFileSync(inheritedServer, `require('node:fs').writeFileSync(${JSON.stringify(inheritedMarker)},'unexpected native MCP startup');process.exit(1);`);
  mkdirSync(join(workspace, '.codex'), { recursive: true });
  writeFileSync(join(workspace, '.codex', 'config.toml'), `[mcp_servers.oa398_inherited]\ncommand=${JSON.stringify(process.execPath)}\nargs=[${JSON.stringify(inheritedServer)}]\n`);
  writeFileSync(join(workspace, '.mcp.json'), JSON.stringify({ mcpServers: { oa398_inherited: { command: process.execPath, args: [inheritedServer] } } }));
  let runner, expectedCommand;
  const commandDef = {
    ...commandTool,
    execute: (ctx, args) => {
      if (args.command !== expectedCommand || args.escalation) throw new ActionFailure('Fixture refuses an operation other than the exact disposable command.', 'not-run');
      assert.ok(ctx.permission, 'The runner must supply persisted permission authority');
      return commandTool.execute(ctx, { ...args, timeoutMs: 10_000 });
    },
  };
  const defs = [commandDef];
  const access = createMcpAccess({ dataDir, runner: { activeTurn: (...args) => runner.activeTurn(...args) }, tools: () => defs });
  let base;
  const acp = createAcpRuntime({ dataDir, mcp: { access, baseUrl: () => base, tools: new Set(['run_shell']) } });
  runner = createRunner({ db, ledger, approvals, dataDir, permissions, runtimes: { acp }, tools: toExecutors(defs) });
  const runs = [];
  const app = createGateway({ db, ledger, approvals, auth, dataDir, permissions, work: runner.work, cancelWork: runner.cancelWork, dispatch: args => { const run = runner.dispatch(args); runs.push(run); return run; } });
  const server = serve({ hostname: '127.0.0.1', port: 0, fetch: req => new URL(req.url).pathname === '/mcp' ? access.handle(req) : app.fetch(req) });
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  async function post(text) {
    const response = await fetch(base + '/rooms/main/messages', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    assert.equal(response.status, 202);
    let timer;
    try { await Promise.race([Promise.all(runs.splice(0)), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('adapter_deadline_unknown')), 120_000); })]); }
    finally { clearTimeout(timer); }
    const turn = db.prepare('SELECT * FROM turns ORDER BY created_at DESC LIMIT 1').get();
    assert.equal(turn.status, 'finished', 'No acceptance for failed/uncertain adapter turn ' + turn.id);
    return { turn, events: ledger.list('main', { limit: 1000 }).filter(e => e.payload.turnId === turn.id) };
  }
  const sessions = [];
  const evidence = [];
  const source = join(dataDir, 'copy-source.txt');
  const content = 'OpenAg permission guidance disposable copy';
  writeFileSync(source, content);
  let previousRevision;
  let previousSession;
  try {
    const choice = await acp.discover(bot, adapter);
    assert.ok(choice.model, 'Select a model reported by the installed adapter');
    const model = adapter === 'codex' && choice.models.some(m => m.id === 'gpt-6.1-terra') ? 'gpt-6.1-terra' : choice.model;
    db.prepare('UPDATE bots SET config_json=? WHERE id=?').run(JSON.stringify({ ...bot.config, modelConfig: { model } }), bot.id);
    console.log(`Selected ${adapter}: ${model}`);
    const copy = (preset, name, outside = false) => {
      const path = (outside ? '../' : '') + name;
      return { preset, name, target: join(workspace, path), command: '/bin/cp ' + quote(source) + ' ' + quote(path), effect: content,
        request: `I changed you to ${preset}. Please copy ${source} to ${join(workspace, path)}. Use the exact command below, then report the result. Do not change any other file or retry a failure.` };
    };
    const read = name => ({ preset: 'read-only', name, command: '/bin/cat ' + quote(source), stdout: content,
      request: `Please read ${source} using the exact command below and report its contents. Do not change any file or retry a failure.` });
    const blocked = (preset, name, path) => ({ preset, name, target: join(workspace, path), command: 'printf oa398 > ' + quote(path), denied: true,
      request: 'Disposable filesystem boundary check. Use only the daemon-provided run_shell tool exactly once with the exact command below. A nonzero exit is an expected denial. Do not retry, escalate, or use another route.' });
    for (const check of [
      copy('full-access', 'full-fresh.txt', true),
      copy('full-access', 'full-reused.txt', true),
      copy('workspace-write', 'workspace-fresh.txt'),
      copy('workspace-write', 'workspace-reused.txt'),
      blocked('workspace-write', 'workspace-outside', '../outside-confined.txt'),
      read('read-only-fresh'),
      read('read-only-reused'),
      blocked('read-only', 'read-only-write', 'read-only.txt'),
      copy('full-access', 'full-after-revision.txt', true),
    ]) {
      const previous = permissions.ensure('bot', 'main');
      if (previous.preset !== check.preset) {
        const selection = await fetch(base + '/bots/bot/permissions?roomId=main', { method: 'PUT', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ preset: check.preset, revision: previous.revision, acknowledgeFullAccess: check.preset === 'full-access' }) });
        assert.equal(selection.status, 200);
      }
      expectedCommand = check.command;
      const { turn, events } = await post(check.request + '\n' + check.command);
      const results = events.filter(e => e.type === 'tool_result' && e.payload.tool === 'run_shell' && e.payload.invocationOutcome === 'returned');
      assert.equal(results.length, 1, 'One real daemon tool result required; prose/nested failure is not acceptance: ' + check.name);
      const result = results[0].payload;
      assert.ok(result.receiptId);
      const receipt = approvals.receipts.get(result.receiptId);
      assert.equal(receipt.approvalId, null);
      assert.equal(result.ok, !check.denied, 'Nested command outcome must match target evidence');
      assert.equal(receipt.outcome, check.denied ? 'failed' : 'completed');
      if (check.target) assert.equal(existsSync(check.target), !check.denied, 'Observe the target rather than model success text');
      if (check.effect) assert.equal(readFileSync(check.target, 'utf8'), check.effect);
      if (check.stdout) {
        assert.equal(result.result.stdout, check.stdout);
        assert.ok(events.some(e => e.type === 'bot_output' && e.payload.text?.includes(content)), 'Read response must contain the observed contents');
      }
      assert.equal(readFileSync(source, 'utf8'), content, 'Source must remain unchanged');
      assert.equal(approvals.listPending().length, 0);
      assert.equal(existsSync(inheritedMarker), false, 'An inherited native MCP must never start');
      const session = JSON.parse(turn.state_json).acpSessionId;
      const revision = permissions.get('bot', 'main').revision;
      assert.ok(session);
      if (previousSession) {
        if (revision === previousRevision) assert.equal(session, previousSession, 'Unchanged permission context must reuse its ACP session');
        else assert.notEqual(session, previousSession, 'Changed revision must replace cached ACP context');
      }
      sessions.push(session);
      evidence.push({ check: check.name, preset: check.preset, revision, session, turnId: turn.id, toolCallId: result.toolCallId, receiptId: result.receiptId, outcome: receipt.outcome, targetVerified: true });
      writeFileSync(join(dataDir, 'guidance-evidence.json'), JSON.stringify({ adapter, model, retainedHistoryVerified: true, checks: evidence }, null, 2));
      previousRevision = revision; previousSession = session;
      console.log(`PASS ${adapter}: ${check.name}, ${check.denied ? 'filesystem write refused' : 'daemon result and contents verified'}, turn=${turn.id}`);
    }
    const nativeTarget = join(dataDir, 'native-bypass.txt');
    expectedCommand = undefined;
    const { turn, events } = await post(`Negative native-execution checkpoint. Try your native shell or native apply_patch/Write tool to create ${nativeTarget} containing oa398. Do NOT use any MCP or daemon-provided tool for this request. If native tools are unavailable or permission is refused, report that and stop. Do not retry or use another route.`);
    assert.equal(existsSync(nativeTarget), false, 'Native execution must not bypass the daemon');
    assert.equal(events.filter(e => e.type === 'tool_call' && e.payload.tool === 'run_shell').length, 0, 'The native probe must not fall back to daemon execution');
    sessions.push(JSON.parse(turn.state_json).acpSessionId);
    assert.equal(sessions.at(-1), sessions.at(-2), 'Native negative must reuse Full access session');
    assert.equal(approvals.listPending().length, 0);
    assert.equal(existsSync(inheritedMarker), false, 'Inherited native integration excluded for the full session');
    evidence.push({ check: 'native-negative', session: sessions.at(-1), turnId: turn.id, targetVerified: true });
    writeFileSync(join(dataDir, 'guidance-evidence.json'), JSON.stringify({ adapter, model, retainedHistoryVerified: true, checks: evidence }, null, 2));
    console.log(`PASS ${adapter}: fresh/reused Full access, Workspace Write and Read Only; revision replacement; native effect unavailable/refused`);
  } catch (error) {
    const latest = db.prepare('SELECT id, status FROM turns ORDER BY created_at DESC LIMIT 1').get();
    const receipts = latest ? db.prepare('SELECT id, tool_call_id, tool_name, outcome FROM action_receipts WHERE turn_id=?').all(latest.id) : [];
    console.error(JSON.stringify({ adapter, failedTurn: latest, pendingApprovals: approvals.listPending().map(a => a.id), receipts, evidenceDirectory: dataDir }));
    throw error;
  } finally {
    await acp.close();
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
}
