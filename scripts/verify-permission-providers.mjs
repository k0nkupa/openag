// Controlled provider HTTP transports + actual gateway/runner/gate and actual confined subprocesses. No live API calls.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(root + 'apps/daemon/package.json');
const load = p => import(root + 'apps/daemon/dist/' + p + '.js');
const { serve } = require('@hono/node-server'), { z } = require('zod');
const { openDb } = await load('db/index'), { createLedger } = await load('ledger'), { createAuth } = await load('auth');
const { createApprovals } = await load('approvals'), { createRunner } = await load('runtimes/runner');
const { createGateway } = await load('gateway'), { createBot, createRoom, addMember } = await load('rooms');
const { createApiRuntime } = await load('runtimes/api'), { createOllamaRuntime } = await load('runtimes/ollama');
const { toExecutors } = await load('tools/registry');
const { executeCommand } = await load('execution'), { modelProviders } = await load('providers');
const { createPermissions } = await load('permissions');
const { getDefaultRedactor } = await load('redact');
const secret = 'fixture-κλειδί-value-398'; getDefaultRedactor().addSecret(secret);
const directory = mkdtempSync(join(tmpdir(), 'openag-permission-providers-'));
console.log('Disposable evidence: ' + directory);
const originalFetch = globalThis.fetch;
let base, command, step = 0, modelName, wire = [];
const sse = items => new Response(items.map(item => 'data: ' + JSON.stringify(item) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (base && url.startsWith(base + '/')) return originalFetch(input, init);
  assert.ok(/^https:\/\/(api\.openai\.com|api\.anthropic\.com|openrouter\.ai|generativelanguage\.googleapis\.com|api\.groq\.com|api\.tokenfactory\.nebius\.com|api\.x\.ai|api\.deepseek\.com|api\.perplexity\.ai|dashscope-intl\.aliyuncs\.com|api\.mistral\.ai|api\.cerebras\.ai|api\.deepinfra\.com)\//.test(url) || url.startsWith('http://127.0.0.1:1/api/'), 'Unexpected network request refused');
  const body = init.body ? JSON.parse(init.body) : {};
  if (url.endsWith('/api/show')) return Response.json({ capabilities: ['tools'], details: { family: 'fixture' } });
  if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'fixture' }] });
  const call = step++ === 0;
  wire.push({ url, tools: body.tools ?? [], body });
  const args = JSON.stringify({ command }), id = 'call_permission';
  if (url.endsWith('/api/chat')) return Response.json({ model: 'fixture', done: true, done_reason: 'stop', message: call ? { role: 'assistant', content: '', tool_calls: [{ function: { name: 'run_shell', arguments: { command } } }] } : { role: 'assistant', content: 'Settled fixture result.' } });
  const functionItem = { id: 'fc_permission', type: 'function_call', call_id: id, name: 'run_shell', arguments: args, status: 'completed' };
  const textItem = { id: 'msg_permission', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Settled fixture result.', annotations: [] }] };
  const response = { id: 'resp_permission', object: 'response', created_at: 1, model: modelName, status: 'completed', output: [call ? functionItem : textItem], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, output_tokens_details: { reasoning_tokens: 0 } } };
  if (url.includes('perplexity.ai')) return Response.json(response);
  if (url.includes('googleapis.com')) {
    const google = { candidates: [{ index: 0, content: { role: 'model', parts: call ? [{ functionCall: { name: 'run_shell', args: { command } } }] : [{ text: 'Settled fixture result.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }, modelVersion: modelName };
    return url.includes('streamGenerateContent') ? sse([google]) : Response.json(google);
  }
  if (url.includes('/responses')) {
    if (!body.stream) return Response.json(response);
    const item = response.output[0];
    return sse([
      { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: call ? { ...item, status: 'in_progress', arguments: '' } : { ...item, status: 'in_progress', content: [] } },
      call ? { type: 'response.function_call_arguments.delta', item_id: item.id, output_index: 0, delta: args } : { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'Settled fixture result.' },
      ...(call ? [{ type: 'response.function_call_arguments.done', item_id: item.id, output_index: 0, arguments: args }] : []),
      { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response },
    ]);
  }
  if (url.includes('anthropic.com')) {
    const block = call ? { type: 'tool_use', id, name: 'run_shell', input: { command } } : { type: 'text', text: 'Settled fixture result.' };
    const message = { id: 'msg_fixture', type: 'message', role: 'assistant', model: modelName, content: [block], stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!body.stream) return Response.json(message);
    return sse([{ type: 'message_start', message: { ...message, content: [], stop_reason: null } }, { type: 'content_block_start', index: 0, content_block: call ? { ...block, input: {} } : { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: call ? { type: 'input_json_delta', partial_json: args } : { type: 'text_delta', text: 'Settled fixture result.' } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 1 } }, { type: 'message_stop' }]);
  }
  const completion = { id: 'chat_permission', object: 'chat.completion', created: 1, model: modelName, choices: [{ index: 0, message: call ? { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'run_shell', arguments: args } }] } : { role: 'assistant', content: 'Settled fixture result.' }, finish_reason: call ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
  if (!body.stream) return Response.json(completion);
  return sse([{ ...completion, object: 'chat.completion.chunk', choices: [{ index: 0, delta: call ? { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name: 'run_shell', arguments: args } }] } : { role: 'assistant', content: 'Settled fixture result.' }, finish_reason: null }] }, { ...completion, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: call ? 'tool_calls' : 'stop' }] }]);
};
const models = ['ollama/fixture', 'deepseek/deepseek-v4-flash', 'openai/gpt-5', 'anthropic/claude-opus-4-6', 'google/gemini-2.5-pro', 'openrouter/openai/gpt-5', 'groq/openai/gpt-oss-120b', 'nebius/Qwen/Qwen3.8-27B', 'xai/grok-4.6', 'alibaba/qwen3.8-flash', 'mistral/magistral-small-latest', 'cerebras/gpt-oss-120b', 'deepinfra/deepseek-ai/DeepSeek-V4-Pro', 'perplexity/sonar-pro'];
for (const provider of modelProviders()) for (const key of provider.envVars) process.env[key] = 'synthetic-permission-fixture';
for (const key of Object.keys(process.env)) if (/^OPENAG_.+_MODEL$/.test(key) || key === 'OPENAG_OVERRIDE_MODEL') delete process.env[key];
const quote = s => "'" + s.replaceAll("'", "'\"'\"'") + "'";
function outcomes(value) {
  if (typeof value === 'string') { try { return outcomes(JSON.parse(value)); } catch { return []; } }
  if (!value || typeof value !== 'object') return [];
  if (typeof value.ok === 'boolean' && value.result && Object.hasOwn(value.result, 'exitCode')) return [value];
  return Object.values(value).flatMap(outcomes);
}
try {
  for (const model of models) {
    const dataDir = join(directory, model.split('/')[0]), token = randomUUID();
    const db = openDb(dataDir), ledger = createLedger(db), approvals = createApprovals(db, ledger), auth = createAuth({ db, ownerToken: token });
    createBot(db, { id: 'bot', runtime: 'api', model }); createRoom(db, { id: 'main', leadBotId: 'bot' }); addMember(db, 'main', 'bot');
    const permissions = createPermissions(db, ledger, dataDir, approvals);
    const workspace = join(dataDir, 'bots', 'bot', 'work'); mkdirSync(workspace, { recursive: true });
    let timeoutMs = 10_000, writeRoots = [];
    const def = { name: 'run_shell', class: 'act-external', description: 'Daemon-owned confined command execution', input: z.object({ command: z.string() }).strict(), permission: () => ({ approval: 'allow' }), execute: (ctx, args) => { assert.ok(ctx.permission); return executeCommand(ctx.permission, args.command, ctx.signal, timeoutMs, ctx.assertPermission); }, confirm: result => ({ outcome: result.interrupted ? 'unknown' : result.exitCode === 0 ? 'completed' : 'failed', detail: 'Observed disposable command exit.' }) };
    const ollama = createOllamaRuntime({ tools: [def], env: { OPENAG_OLLAMA_URL: 'http://127.0.0.1:1' } });
    const api = createApiRuntime({ tools: [def], ollama });
    const runner = createRunner({ db, ledger, approvals, dataDir, permissions, runtimes: { api }, tools: toExecutors([def]) });
    const runs = [];
    const app = createGateway({ db, ledger, approvals, auth, dataDir, permissions, work: runner.work, dispatch: args => { const run = runner.dispatch(args); runs.push(run); return run; } });
    const server = serve({ hostname: '127.0.0.1', port: 0, fetch: req => app.fetch(req) });
    if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    try {
      const scenarios = [['workspace-write', join(workspace, 'inside.txt'), true], ['workspace-write', join(dataDir, 'outside-confined.txt'), false], ['read-only', join(workspace, 'read-only.txt'), false], ['danger-full-access', join(dataDir, 'outside-full.txt'), true]];
      if (model === 'ollama/fixture') {
        symlinkSync(dataDir, join(workspace, 'outside-link'));
        scenarios.push(['workspace-write', join(dataDir, 'symlink-escape.txt'), false, 'printf oa398 > ' + quote(join(workspace, 'outside-link', 'symlink-escape.txt'))]);
        scenarios.push(['workspace-write', join(dataDir, 'descendant-escape.txt'), false, quote(process.execPath) + ' -e ' + quote(`require('node:fs').writeFileSync(${JSON.stringify(join(dataDir, 'descendant-escape.txt'))},'oa398')`)]);
        scenarios.push(['workspace-write', join(dataDir, 'timeout-sentinel.txt'), false, 'sleep 30', 50]);
        mkdirSync(join(workspace, '.codex'));
        scenarios.push(['workspace-write', join(workspace, '.codex', 'config.toml'), false, 'printf oa398 > .codex/config.toml']);
        mkdirSync(join(workspace, 'repo', '.git'), { recursive: true });
        scenarios.push(['workspace-write', join(workspace, 'repo', '.git', 'config'), false]);
        const extraRoot = join(dataDir, 'extra'); mkdirSync(join(extraRoot, '.claude'), { recursive: true }); writeRoots = [extraRoot];
        scenarios.push(['workspace-write', join(extraRoot, 'allowed.txt'), true]);
        scenarios.push(['workspace-write', join(extraRoot, '.claude', 'settings.json'), false]);
        const linkedRepo = join(workspace, 'linked-repo'), gitStore = join(extraRoot, 'git-storage'), gitCommon = join(extraRoot, 'git-common ');
        mkdirSync(linkedRepo); mkdirSync(gitStore); mkdirSync(gitCommon);
        writeFileSync(join(linkedRepo, '.git'), 'gitdir: ' + gitStore + '\n');
        writeFileSync(join(gitStore, 'commondir'), '../git-common \n');
        scenarios.push(['workspace-write', join(gitStore, 'config'), false]);
        scenarios.push(['workspace-write', join(gitCommon, 'config'), false]);
        const detachedTarget = join(dataDir, 'detached-outside.txt'), detachedPid = join(workspace, 'detached.pid');
        const detachedChild = `const f=require('node:fs');f.writeFileSync(${JSON.stringify(detachedPid)},String(process.pid));try{f.writeFileSync(${JSON.stringify(detachedTarget)},'oa398')}catch{}setTimeout(()=>{},30000)`;
        const detachedParent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(detachedChild)}],{detached:true,stdio:'inherit'});setTimeout(()=>{},30000)`;
        scenarios.push(['workspace-write', detachedTarget, false, quote(process.execPath) + ' -e ' + quote(detachedParent), 500]);
        const redactionTarget = join(workspace, 'redaction.txt');
        const redactionProgram = `const f=require('node:fs'),b=Buffer.from(${JSON.stringify(secret)}),i=b.findIndex(c=>c>127)+1;process.stdout.write(b.subarray(0,i));setTimeout(()=>{process.stdout.write(b.subarray(i));f.writeFileSync(${JSON.stringify(redactionTarget)},'oa398')},10)`;
        scenarios.push(['workspace-write', redactionTarget, true, quote(process.execPath) + ' -e ' + quote(redactionProgram)]);
        const overflowTarget = join(workspace, 'overflow.txt');
        scenarios.push(['workspace-write', overflowTarget, true, quote(process.execPath) + ' -e ' + quote(`process.stdout.write('x'.repeat(63990)+${JSON.stringify(secret)});require('node:fs').writeFileSync(${JSON.stringify(overflowTarget)},'oa398')`)]);
      }
      for (const [selected, target, expectWrite, overrideCommand, overrideTimeout] of scenarios) {
        timeoutMs = overrideTimeout ?? 10_000; modelName = model.slice(model.indexOf('/') + 1); command = overrideCommand ?? 'printf oa398 > ' + quote(target); step = 0; wire = [];
        const sessionResponse = await fetch(base + '/bots/bot/permissions?roomId=main', { headers: { authorization: 'Bearer ' + token } });
        const session = await sessionResponse.json();
        const selection = await fetch(base + '/bots/bot/permissions?roomId=main', { method: 'PUT', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ preset: selected === 'danger-full-access' ? 'full-access' : selected, revision: session.revision, writeRoots, acknowledgeFullAccess: selected === 'danger-full-access' }) });
        assert.equal(selection.status, 200);
        const began = Date.now();
        const response = await fetch(base + '/rooms/main/messages', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Use run_shell once for the supplied disposable command, then report its actual result.' }) });
        assert.equal(response.status, 202); await Promise.all(runs); await runner.idle();
        if (target.endsWith('/detached-outside.txt')) {
          const pid = Number(readFileSync(join(workspace, 'detached.pid'), 'utf8'));
          assert.ok(Number.isSafeInteger(pid) && pid > 1);
          try { process.kill(pid, 'SIGKILL'); } catch {}
          assert.ok(Date.now() - began < 2500, 'Detached output holders must not defeat the deadline');
        }
        const turn = db.prepare('SELECT * FROM turns ORDER BY created_at DESC LIMIT 1').get();
        const overflow = target.endsWith('/overflow.txt');
        assert.equal(turn.status, overflow ? 'incomplete' : 'finished', model + ': unexpected provider turn ' + turn.id);
        if (overflow) assert.equal(JSON.parse(turn.state_json).hostedStop, 'output_truncated');
        const results = ledger.list('main', { limit: 1000 }).filter(e => e.type === 'tool_result' && e.payload.turnId === turn.id && e.payload.tool === 'run_shell' && e.payload.invocationOutcome === 'returned');
        assert.equal(results.length, 1, model + ': missing actual daemon result');
        assert.equal(results[0].payload.ok, expectWrite, model + ': nested command result must match target');
        assert.ok(results[0].payload.receiptId);
        assert.equal(approvals.receipts.get(results[0].payload.receiptId).approvalId, null);
        assert.equal(results[0].payload.result.untrusted, true, 'Process output stays untrusted');
        if (overrideTimeout) {
          assert.equal(results[0].payload.result.timedOut, true, 'Timeout must be reported rather than counted as successful completion');
          assert.equal(results[0].payload.executionOutcome, 'unknown', 'Interruption cannot prove a failed effect');
        }
        if (target.endsWith('/redaction.txt')) assert.ok(!results[0].payload.result.stdout.includes(secret) && results[0].payload.result.stdout.includes('[REDACTED:'), 'UTF-8 split secret is redacted before output');
        if (target.endsWith('/overflow.txt')) assert.ok(results[0].payload.result.truncated && !results[0].payload.result.stdout.includes('fixture-') && results[0].payload.result.stdout.length < 64000, 'Overflow must not expose a clipped secret prefix');
        assert.equal(existsSync(target), expectWrite, model + ': target evidence');
        if (expectWrite) assert.equal(readFileSync(target, 'utf8'), 'oa398');
        if (!overflow) {
          assert.ok(wire.length >= 2, 'Actual provider loop must consume the tool result');
          assert.ok(outcomes(wire.at(-1).body).some(o => o.ok === expectWrite && o.result.untrusted === true), 'Actual provider request must carry the real nested untrusted tool outcome');
        } else assert.equal(wire.length, 1, 'Truncated output stops the provider loop without replay');
        assert.ok(JSON.stringify(wire[0].body).includes('filesystem=' + selected), 'Every SDK route receives the effective daemon policy in operating instructions');
        assert.ok(JSON.stringify(wire[0].tools).includes('run_shell'), 'Provider must receive the offered tool schema');
        assert.equal(approvals.listPending().length, 0);

      }
      console.log('PASS controlled ' + model + ': shared gate/executor, all three boundaries, nested result and actual target evidence');
    } finally { await api.close?.(); await new Promise(resolve => server.close(resolve)); db.close(); }
  }
} finally { globalThis.fetch = originalFetch; }
console.log('Controlled transport evidence: ' + directory + '; no live provider acceptance claimed.');
