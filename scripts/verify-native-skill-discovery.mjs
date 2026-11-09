// Real installed ACP adapters, synthetic home and loopback model transports only. Captures requests, not model quality.
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(root + 'apps/daemon/package.json');
const { client, methods } = await import(require.resolve('@agentclientprotocol/sdk'));
const { spawnCodexAdapter, spawnClaudeAdapter, codexEnv, sessionMetaFor, profiles } = await import(root + 'apps/daemon/dist/runtimes/acp.js');
const dir = mkdtempSync(join(tmpdir(), 'oag-native-skills-')), savedEnv = { ...process.env };
const marker = 'OPENAG_UNASSIGNED_NATIVE_SKILL_MARKER';
let server, handle, connection;
function packageAt(base) {
 const path = join(base, 'native-probe'); mkdirSync(path, { recursive: true });
 writeFileSync(join(path, 'SKILL.md'), `---\nname: native-probe\ndescription: ${marker}\n---\nUnassigned native instructions.\n`);
}
try {
 for (const adapter of ['codex', 'claude']) {
  const home = join(dir, adapter); mkdirSync(join(home, '.codex'), { recursive: true });
  writeFileSync(join(home, '.codex/auth.json'), JSON.stringify({ OPENAI_API_KEY: 'controlled-fixture-token' }), { mode: 0o600 });
  const cwd = join(home, 'work'); mkdirSync(cwd);
  for (const base of [join(home, '.agents/skills'), join(home, '.claude/skills'), join(cwd, '.agents/skills'), join(cwd, '.claude/skills')]) packageAt(base);
  const bodies = [];
  let resolveRequest;
  const captured = new Promise(resolve => { resolveRequest = resolve; });
  server = createServer(async (req, res) => {
   let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 2_000_000) { req.destroy(); return; } }
   if (req.method === 'GET') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-5.4', object: 'model' }] })); return; }
   const parsed = JSON.parse(body || '{}');
   if (parsed.input || parsed.messages) { bodies.push(parsed); resolveRequest(); }
   res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":{"type":"overloaded_error","message":"Controlled inspection complete"}}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const key of ['PATH', 'LANG', 'TMPDIR']) if (savedEnv[key]) process.env[key] = savedEnv[key];
  process.env.HOME = home; process.env.CODEX_HOME = join(home, '.codex');
  process.env.CODEX_CONFIG = JSON.stringify({ model_provider: 'fixture', model: 'gpt-5.4', model_providers: { fixture: { name: 'fixture', base_url: baseUrl + '/v1', wire_api: 'responses', requires_openai_auth: false } } });
  process.env.ANTHROPIC_BASE_URL = baseUrl; process.env.ANTHROPIC_AUTH_TOKEN = 'controlled-fixture-token';
  process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6';
  process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  const profile = profiles[adapter];
  handle = await (adapter === 'codex' ? spawnCodexAdapter : spawnClaudeAdapter)({ cwd });
  connection = client({ name: 'native-skills-acceptance' })
   .onNotification(methods.client.session.update, () => {})
   .onRequest(methods.client.session.requestPermission, () => ({ outcome: { outcome: 'cancelled' } }))
   .connect(handle.target);
  const deadline = operation => {
   let timer; return Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(adapter + ' inspection deadline')), 35000); })]).finally(() => clearTimeout(timer));
  };
  try {
   await deadline(connection.agent.request(methods.agent.initialize, { protocolVersion: 1, clientCapabilities: {} }));
   const meta = sessionMetaFor(profile, 'room');
   const session = await deadline(connection.agent.request(methods.agent.session.new, { cwd, mcpServers: [], ...(meta ? { _meta: meta } : {}) }));
   const prompting = connection.agent.request(methods.agent.session.prompt, { sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Reply OK. No tools.' }] }).catch(() => undefined);
   await deadline(captured);
   const instructions = JSON.stringify(bodies);
   assert.ok(!instructions.includes(marker), adapter + ' must not receive global/project native skill metadata');
   const names = bodies.flatMap(b => b.tools ?? []).map(t => t.name ?? t.type);
   assert.ok(!names.some(name => /skill_search|skill_load|^Skill$/.test(name)), adapter + ' native skill tools must be absent');
   assert.equal(codexEnv(process.env).CODEX_CONFIG.includes('"include_instructions":false'), true);
   console.log(`PASS real ${adapter} ACP adapter: synthetic global/project skills absent from outgoing local model request and no native skill tools`);
   await handle.close(); connection.close(); await prompting;
  } finally { await handle?.close(); connection?.close(); handle = undefined; connection = undefined; await new Promise(resolve => server.close(resolve)); server = undefined; }
 }
} finally {
 await handle?.close(); connection?.close(); if (server) await new Promise(resolve => server.close(resolve));
 for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, savedEnv);
 await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
