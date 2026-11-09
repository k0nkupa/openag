// OA-398 diagnostic: raw real ACP sessions, disposable local writes, no installed daemon or provider account writes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Writable } from 'node:stream';

if (!process.argv.includes('--real')) throw Error('Use --real for four bounded subscription turns and disposable local files.');
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(root + 'apps/daemon/package.json');
const { client, methods, ndJsonStream } = await import(require.resolve('@agentclientprotocol/sdk'));
const { claudeEnv, codexEnv, withoutOwnerSecrets, profiles } = await import(root + 'apps/daemon/dist/runtimes/acp.js');
const shellQuote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const dir = mkdtempSync(join(tmpdir(), 'openag-permission-checkpoint-'));
const hooks = process.argv.includes('--hooks');
const report = { scope: 'Raw ACP only; not OpenAg gateway, policy, receipt or filesystem-confinement acceptance', experiment: hooks ? 'pre-tool hook denial and failure' : 'native mode mapping', directory: dir, adapters: [] };
const reportPath = join(dir, 'report.json');
const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
save();
console.log(`Evidence: ${reportPath}`);

const selected = process.argv.includes('--adapter') ? process.argv[process.argv.indexOf('--adapter') + 1] : undefined;
assert.ok(selected === undefined || ['claude', 'codex'].includes(selected), 'Unknown adapter');
for (const adapter of selected ? [selected] : ['claude', 'codex']) {
  const cwd = join(dir, adapter, 'workspace');
  mkdirSync(cwd, { recursive: true });
  const entry = join(dirname(require.resolve(`@agentclientprotocol/${adapter === 'claude' ? 'claude-agent' : 'codex'}-acp/package.json`)), 'dist/index.js');
  const base = withoutOwnerSecrets(process.env);
  delete base.CODEX_CONFIG;
  delete base.CODEX_PATH;
  const phasePath = join(dir, adapter, 'hook-phase');
  const hookAudit = join(dir, adapter, 'hook-audit.jsonl');
  const hookPath = join(dir, adapter, 'guard.cjs');
  const hookCommand = [process.execPath, hookPath].map(shellQuote).join(' ');
  const hookConfig = { PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: hookCommand, timeout: 10 }] }] };
  let meta = profiles[adapter].sessionMeta;
  if (hooks) {
    writeFileSync(phasePath, 'deny', { mode: 0o600 });
    writeFileSync(hookPath, `const fs=require('node:fs');let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const v=JSON.parse(input);fs.appendFileSync(${JSON.stringify(hookAudit)},JSON.stringify({tool:v.tool_name,id:v.tool_use_id,phase:fs.readFileSync(${JSON.stringify(phasePath)},'utf8')})+String.fromCharCode(10),{mode:0o600});if(fs.readFileSync(${JSON.stringify(phasePath)},'utf8')==='failed')process.exit(1);console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'OA-398 independent guard refused this disposable operation'}}));});`, { mode: 0o600 });
    if (adapter === 'codex') {
      // The adapter forwards hooks at app-server startup, but session feature flags are too late to activate them.
      const cli = createRequire(require.resolve('@agentclientprotocol/codex-acp/package.json')).resolve('@openai/codex/bin/codex.js');
      const wrapper = join(dir, adapter, 'codex-with-hooks');
      writeFileSync(wrapper, `#!/bin/sh
exec ${shellQuote(process.execPath)} ${shellQuote(cli)} --enable codex_hooks --enable hooks "$@"
`, { mode: 0o700 });
      base.CODEX_PATH = wrapper;
      base.CODEX_CONFIG = JSON.stringify({ features: { codex_hooks: true, hooks: true }, hooks: hookConfig });
    }
    else meta = { ...meta, claudeCode: { ...meta?.claudeCode, options: { ...meta?.claudeCode?.options, settings: { hooks: hookConfig } } } };
  }
  const env = adapter === 'claude' ? claudeEnv(base) : codexEnv(base);
  const child = spawn(process.execPath, [entry], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  // Consume stderr without publishing provider/configuration data; the report stores only stage and error category.
  child.stderr.resume();
  const exited = new Promise(resolve => child.once('exit', resolve));
  const record = { adapter, packageVersion: require(`@agentclientprotocol/${adapter === 'claude' ? 'claude-agent' : 'codex'}-acp/package.json`).version, stage: 'initialize', calls: [] };
  report.adapters.push(record);
  let active;
  const conn = client({ name: 'openag-permission-checkpoint' })
    .onNotification(methods.client.session.update, ({ params }) => {
      const u = params.update;
      if (active && u.sessionUpdate === 'tool_call') active.toolCallIds.push(u.toolCallId);
    })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      if (active) active.permissionRequestIds.push(params.toolCall.toolCallId);
      // This represents an explicit independent refusal, even if the native mode otherwise allows the action.
      const choice = params.options.find(o => o.kind === 'reject_once');
      return choice ? { outcome: { outcome: 'selected', optionId: choice.optionId } } : { outcome: { outcome: 'cancelled' } };
    }).connect(ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
  let sessionId;
  async function request(method, params) {
    let timer;
    try {
      return await Promise.race([
        conn.agent.request(method, params),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('checkpoint_deadline')), 120_000); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  try {
    await request(methods.agent.initialize, { protocolVersion: 1, clientCapabilities: {} });
    record.stage = 'session/new';
    const session = await request(methods.agent.session.new, { cwd, mcpServers: [], ...(meta ? { _meta: meta } : {}) });
    sessionId = session.sessionId;
    record.sessionId = sessionId;
    record.availableModes = session.modes?.availableModes.map(m => m.id) ?? [];
    const full = adapter === 'claude' ? 'bypassPermissions' : 'agent-full-access';
    for (const [mode, label, target] of hooks ? [
      [full, 'hook-deny', join(cwd, 'hook-denied.txt')],
      [full, 'hook-failure', join(cwd, 'hook-failed.txt')],
    ] : [
      [adapter === 'claude' ? 'default' : 'workspace-write', 'confined-candidate', join(cwd, 'inside.txt')],
      [adapter === 'claude' ? 'bypassPermissions' : 'agent-full-access', 'full-access-candidate', join(dir, adapter, 'outside.txt')],
    ]) {
      record.stage = `set_mode:${mode}`;
      if (hooks) writeFileSync(phasePath, label === 'hook-deny' ? 'deny' : 'failed');
      await request(methods.agent.session.setMode, { sessionId, modeId: mode });
      active = { label, mode, sessionId, target, toolCallIds: [], permissionRequestIds: [] };
      record.calls.push(active);
      save();
      record.stage = `prompt:${mode}`;
      // All possible effects requested here are beneath the owned temporary checkpoint directory.
      const command = `printf oa398 > ${shellQuote(target)}`;
      const response = await request(methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: 'text', text: `Permission compatibility diagnostic, authorized disposable local target. Use your native shell tool exactly once to execute this exact command: ${command}\nDo not read any files, use other tools, retry a refusal, request a different mode, or change any other path. If refused, report refusal and stop. Otherwise report the command result and stop.` }],
      });
      await new Promise(resolve => setImmediate(resolve));
      active.stopReason = response.stopReason;
      active.targetWritten = existsSync(target);
      active.markerMatches = active.targetWritten && readFileSync(target, 'utf8') === 'oa398';
      active.permissionRequests = active.permissionRequestIds.length;
      active.toolCalls = new Set(active.toolCallIds).size;
      active.executedWithoutAuthorizationCallback = active.markerMatches && active.permissionRequests === 0;
      assert.ok(response.stopReason === 'end_turn', 'No compatibility claim for an unsettled prompt');
      assert.equal(active.toolCalls, 1, 'Exactly one native tool call must be observed; a prose-only reply is not acceptance');
      assert.ok(active.permissionRequestIds.every(id => active.toolCallIds.includes(id)), 'Authorization must refer to the observed native call');
      if (!hooks && label === 'full-access-candidate') assert.ok(active.markerMatches, 'Full access requires observed target execution, not a prose success claim');
      console.log(`${adapter} ${mode}: native calls=${active.toolCalls}, approval requests=${active.permissionRequests}, target written=${active.targetWritten}`);
      save();
    }
    record.stage = 'settled';
    record.sameSession = record.calls.length === 2 && record.calls.every(c => c.sessionId === sessionId);
    record.directMappingPreservesGate = record.calls.every(c => !c.targetWritten);
    if (hooks) {
      record.hookAudit = existsSync(hookAudit) ? readFileSync(hookAudit, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];
      record.hookDenialEnforced = record.hookAudit.some(e => e.phase === 'deny') && !record.calls[0].targetWritten;
      record.hookFailureClosed = record.hookAudit.some(e => e.phase === 'failed') && !record.calls[1].targetWritten;
    }
  } catch (error) {
    record.failedStage = record.stage;
    record.errorCategory = error.message === 'checkpoint_deadline' ? 'deadline_unknown' : typeof error.code === 'number' ? `rpc_${error.code}` : error.name;
    record.stage = 'unverified';
    if (active) {
      active.targetWritten = existsSync(active.target);
      active.markerMatches = active.targetWritten && readFileSync(active.target, 'utf8') === 'oa398';
    }
    save();
    // Do not retry or start another adapter after an uncertain/failed invocation.
    throw Error(`${adapter} checkpoint stopped at ${record.failedStage}; category=${record.errorCategory}; evidence=${reportPath}`);
  } finally {
    conn.close();
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    const killer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000);
    await exited;
    clearTimeout(killer);
    save();
  }
}
report.directNativeMappingCompatible = report.adapters.every(a => (hooks ? a.hookDenialEnforced && a.hookFailureClosed : a.directMappingPreservesGate) && a.sameSession);
save();
assert.ok(report.directNativeMappingCompatible, `${hooks ? 'Native pre-tool hooks did not prove fail-closed enforcement' : 'Direct native mode mapping does not preserve the authoritative per-action gate'}. Evidence: ${reportPath}`);
