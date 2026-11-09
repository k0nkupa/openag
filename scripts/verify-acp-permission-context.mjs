// Standalone installed-adapter request capture; all model traffic is loopback and all data is disposable.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(root + 'apps/daemon/package.json');
const load = name => import(root + 'apps/daemon/dist/' + name + '.js');
const { openDb } = await load('db/index');
const { createLedger } = await load('ledger');
const { createApprovals } = await load('approvals');
const { createRunner } = await load('runtimes/runner');
const { createAcpRuntime, ACP_SESSION_INSTRUCTIONS, ACP_INSTRUCTION_VERSION } = await load('runtimes/acp');
const { createBot, createRoom, addMember, getRoom } = await load('rooms');
const directory = mkdtempSync(join(tmpdir(), 'openag-acp-instructions-'));
const savedEnv = { ...process.env };
console.log('Disposable evidence: ' + directory);

function deadline(promise, label, ms = 45_000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ' deadline')), ms); })]).finally(() => clearTimeout(timer));
}

try {
  for (const adapter of ['codex', 'claude']) {
    const home = join(directory, adapter);
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex/auth.json'), JSON.stringify({ OPENAI_API_KEY: 'controlled-fixture-token' }), { mode: 0o600 });
    let capture;
    const captured = new Promise(resolve => { capture = resolve; });
    const server = createServer(async (req, res) => {
      if (req.method === 'GET') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-5.4', object: 'model' }] })); return; }
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2_000_000) { req.destroy(); return; } }
      const parsed = JSON.parse(body || '{}');
      // Claude also sends a separate title-generation request containing the user text.
      if ((parsed.input || parsed.messages) && JSON.stringify(parsed).includes('UNTRUSTED_USER_TURN') && !JSON.stringify(parsed.system ?? '').includes('You are naming a coding session')) capture(parsed);
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('{"error":{"type":"overloaded_error","message":"Controlled request capture complete"}}');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const key of Object.keys(process.env)) delete process.env[key];
    for (const key of ['PATH', 'LANG', 'TMPDIR']) if (savedEnv[key]) process.env[key] = savedEnv[key];
    process.env.HOME = home; process.env.CODEX_HOME = join(home, '.codex');
    process.env.CODEX_CONFIG = JSON.stringify({ model_provider: 'fixture', model: 'gpt-5.4', model_providers: { fixture: { name: 'fixture', base_url: base + '/v1', wire_api: 'responses', requires_openai_auth: false } } });
    process.env.ANTHROPIC_BASE_URL = base; process.env.ANTHROPIC_AUTH_TOKEN = 'controlled-fixture-token';
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6'; process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
    const dataDir = join(home, 'data'), db = openDb(dataDir), ledger = createLedger(db), approvals = createApprovals(db, ledger);
    const bot = createBot(db, { id: 'bot', runtime: 'acp', config: { adapter } });
    createRoom(db, { id: 'main', leadBotId: bot.id }); addMember(db, 'main', bot.id);
    const acp = createAcpRuntime({ dataDir });
    const runner = createRunner({ db, ledger, approvals, dataDir, tools: {}, runtimes: { acp } });
    let running;
    let body;
    try {
      running = runner.run(getRoom(db, 'main'), bot, ledger.append('main', 'user', 'message', { text: 'UNTRUSTED_USER_TURN: Reply OK. No tools.' }));
      body = await deadline(captured, adapter + ' outgoing request');
    } finally {
      runner.shutdown(); await acp.close(); await running; await runner.drain(); db.close();
      await new Promise(resolve => server.close(resolve));
    }
    const privileged = adapter === 'codex'
      ? (body.input ?? []).filter(part => ['developer', 'system'].includes(part.role))
      : body.system;
    writeFileSync(join(home, 'model-request.json'), JSON.stringify(body), { mode: 0o600 });
    const strings = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
    assert.ok(strings(privileged).some(text => text.includes(ACP_SESSION_INSTRUCTIONS)), adapter + ' must receive the complete OpenAg contract outside user content');
    assert.ok(!JSON.stringify(privileged).includes('UNTRUSTED_USER_TURN'), 'User data must not become privileged instructions');
    const tools = JSON.stringify(body.tools ?? []);
    assert.ok(!/"(?:name|type)":"(?:Bash|Write|Edit|shell|shell_command|exec_command|apply_patch)"/.test(tools), 'Native execution tools must remain absent');
    writeFileSync(join(home, 'capture-evidence.json'), JSON.stringify({ adapter, instructionVersion: ACP_INSTRUCTION_VERSION, privilegedBridge: true, userNotPromoted: true, nativeExecutionAbsent: true }, null, 2));
    console.log('PASS ' + adapter + ': bridge in actual privileged model request; user data separate; native execution absent');
  }
} finally {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, savedEnv);
}
