// Controlled SDK/gateway acceptance. Temporary state, no provider registration or unit runner.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createServer as createHttpsServer } from 'node:https';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDefaultRedactor } from '../apps/daemon/dist/redact.js';
import { createComposioConnect } from '../apps/daemon/dist/composio-connect.js';
import { openDb } from '../apps/daemon/dist/db/index.js';
import { createAuth } from '../apps/daemon/dist/auth.js';
import { createLedger } from '../apps/daemon/dist/ledger.js';
import { createApprovals } from '../apps/daemon/dist/approvals.js';
import { createGateway } from '../apps/daemon/dist/gateway.js';
import { getSetting, setSetting } from '../apps/daemon/dist/settings.js';
import { createBot, createRoom, addMember } from '../apps/daemon/dist/rooms.js';
import { attachStream } from '../apps/daemon/dist/gateway.js';
const require = createRequire(new URL('../apps/daemon/package.json', import.meta.url));
const { serve } = require('@hono/node-server');
const dir = mkdtempSync(join(tmpdir(), 'oag-remote-'));
const db = openDb(dir), owner = 'controlled-owner-remote', apiOrigin = 'http://100.64.0.10:4747';
let clock = Date.now(), registrations = 0, exchanges = 0, rejectToken = false, holdToken, releaseToken;
let connector, http, https, detach, browser;
const codes = new Map(), secret = 'controlled-remote-provider-access';
const ledger = createLedger(db), approvals = createApprovals(db, ledger), auth = createAuth({ db, ownerToken: owner });
const full = auth.createDevice('Original desk', 'owner', 'full'), limited = auth.createDevice('Limited');
const fakeFetch = async (input, init = {}) => {
 const url = new URL(input); assert.equal(init.redirect, 'error');
 if (url.pathname.includes('oauth-protected-resource')) return Response.json({ resource: 'https://connect.composio.dev/mcp', authorization_servers: ['https://connect.composio.dev'] });
 if (url.pathname === '/.well-known/oauth-authorization-server') return Response.json({ issuer: 'https://connect.composio.dev', authorization_endpoint: 'https://connect.composio.dev/oauth/authorize', token_endpoint: 'https://login.composio.dev/oauth2/token', registration_endpoint: 'https://login.composio.dev/oauth2/register', response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
 if (url.pathname === '/oauth2/register') { registrations++; return Response.json({ ...JSON.parse(init.body), client_id: 'controlled-client-' + registrations }, { status: 201 }); }
 if (url.pathname === '/oauth2/token') {
  exchanges++; const params = new URLSearchParams(init.body);
  assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'), codes.get(params.get('code')));
  if (holdToken) await holdToken;
  if (rejectToken) return Response.json({ error: 'invalid_grant' }, { status: 400 });
  return Response.json({ access_token: secret, refresh_token: 'controlled-refresh', token_type: 'Bearer', expires_in: 3600 });
 }
 throw Error('Unexpected network access: ' + url.origin + url.pathname);
};
const req = (path, token = full.token, body, method) => app.request(apiOrigin + path, { method: method ?? (body ? 'POST' : 'GET'), headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
let sequence = 0;
function responseFor(started) {
 const url = new URL(started.url), state = url.searchParams.get('state'), code = 'controlled-code-' + (++sequence);
 codes.set(code, url.searchParams.get('code_challenge'));
 return '/composio-connect?' + new URLSearchParams({ state, code });
}
async function begin(origin = apiOrigin, token = full.token) {
 const response = await req('/connectors/composio/start', token, { origin }); assert.equal(response.status, 200);
 return responseFor(await response.json());
}
async function callback(path) {
 const response = await req(path, null); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
 return response;
}
connector = createComposioConnect({ dataDir: dir, env: {}, fetch: fakeFetch, now: () => clock, getSignIn: () => getSetting(db, 'connectorSignIn') });
const app = createGateway({ db, auth, ledger, approvals, composio: connector, dispatch() {}, dataDir: dir });
try {
 const addresses = { callbackOrigin: 'https://callback.example', deskOrigins: [apiOrigin, 'https://desk.example'] };
 assert.equal((await req('/settings/connectorSignIn', limited.token, addresses, 'PUT')).status, 403);
 assert.equal((await req('/settings/connectorSignIn', full.token, addresses, 'PUT')).status, 200);
 assert.equal(connector.status('http://100.64.0.10:4747').configured, true, 'Trusted HTTP desk can use a separate HTTPS callback');
 for (const invalid of ['https://user:pass@example.com', 'https://desk.example/path', 'https://desk.example?secret=1', 'javascript:alert(1)']) assert.equal((await req('/settings/connectorSignIn', full.token, { ...addresses, deskOrigins: [invalid] }, 'PUT')).status, 400);
 assert.equal((await req('/settings/connectorSignIn', full.token, { ...addresses, callbackOrigin: apiOrigin }, 'PUT')).status, 400);
 assert.equal((await req('/connectors/composio/start', limited.token, { origin: apiOrigin })).status, 403);
 assert.equal((await req('/connectors/composio/start', full.token, { origin: 'https://evil.invalid' })).status, 400);
 let path = await begin(), result = await callback(path);
 assert.equal(result.status, 303); assert.equal(result.headers.get('location'), apiOrigin + '/?composioResult=connected#/app-library');
 assert.equal(connector.status(apiOrigin).state, 'connected'); assert.equal(exchanges, 1);
 assert.equal((await callback(path)).status, 400, 'Callback replay is rejected');
 assert.equal((await callback(path + '&state=duplicate')).status, 400);
 const saved = readFileSync(join(dir, 'connector-composio.enc'));
 for (const error of ['access_denied', 'provider_failure']) {
  path = await begin(); const query = new URLSearchParams(path.split('?')[1]); query.delete('code'); query.set('error', error);
  result = await callback('/composio-connect?' + query); assert.equal(result.status, 303);
  assert.match(result.headers.get('location'), /composioResult=(cancelled|failed)/); assert.deepEqual(readFileSync(join(dir, 'connector-composio.enc')), saved);
 }
 path = await begin(); result = await callback(path + '&iss=https%3A%2F%2Fevil.invalid'); assert.match(result.headers.get('location'), /failed/);
 assert.equal(exchanges, 1, 'Denial and wrong issuer do not exchange a code');
 rejectToken = true; result = await callback(await begin()); rejectToken = false;
 assert.match(result.headers.get('location'), /failed/); assert.deepEqual(readFileSync(join(dir, 'connector-composio.enc')), saved);
 path = await begin(); clock += 5 * 60000 + 1; assert.equal((await callback(path)).status, 400);
 const revoked = auth.createDevice('Revoked during sign-in', 'owner', 'full'); path = await begin(apiOrigin, revoked.token); auth.revokeDevice(revoked.device.id);
 const beforeRevocation = exchanges; result = await callback(path); assert.match(result.headers.get('location'), /failed/); assert.equal(exchanges, beforeRevocation);
 const downgraded = auth.createDevice('Downgraded during exchange', 'owner', 'full'); path = await begin(apiOrigin, downgraded.token);
 holdToken = new Promise(resolve => { releaseToken = resolve; }); const pending = callback(path);
 await new Promise(resolve => setImmediate(resolve)); auth.setDeviceAccess(downgraded.device.id, 'limited'); releaseToken(); holdToken = undefined;
 result = await pending; assert.match(result.headers.get('location'), /failed/); assert.deepEqual(readFileSync(join(dir, 'connector-composio.enc')), saved);
 path = await begin(); await req('/settings/connectorSignIn', full.token, addresses, 'PUT'); assert.equal((await callback(path)).status, 400, 'Configuration changes invalidate pending attempts');
 // A new desk alias keeps the same account/client registration and no device credential is handed off.
 const beforeAlias = registrations; path = await begin('https://desk.example'); result = await callback(path);
 assert.match(result.headers.get('location'), /^https:\/\/desk.example\//); assert.equal(registrations, beforeAlias);
 assert.equal((await req('/rooms', null)).status, 401);
 const unsolicited = 'untrusted-callback-probe-not-a-secret';
 assert.equal((await callback('/composio-connect?' + new URLSearchParams({ state: 'x'.repeat(43), code: unsolicited }))).status, 400);
 assert.equal(getDefaultRedactor().redact(unsolicited), unsolicited, 'Unknown callbacks must not fill the permanent secret registry');
 for (let probe = 0; probe < 25; probe++) await req('/composio-connect?state=invalid', null);
 assert.equal((await req('/composio-connect?state=invalid', null)).status, 429);
 result = await callback(await begin()); assert.equal(result.status, 303, 'Unknown probes must not lock out a valid pending attempt');

 assert.ok(!readFileSync(join(dir, 'connector-composio.enc')).includes(Buffer.from(secret)));
 assert.ok(!JSON.stringify(ledger.list('_system')).includes(secret));
 console.log('PASS remote callback: permissions, PKCE, original return, replay/issuer/expiry, cancellation, revocation/downgrade, failed reconnect and configuration invalidation');

 if (process.argv.includes('--browser')) {
  const exec = promisify(execFile), session = 'remote-oauth-' + process.pid;
  browser = (...args) => exec('agent-browser', ['--session', session, '--ignore-https-errors', ...args], { timeout: 15000 }).then(r => r.stdout.trim());
  const evaluate = async code => JSON.parse(await browser('--json', 'eval', code)).data.result;
  const bot = createBot(db, { id: 'bot', name: 'Bot', runtime: 'api', config: {} }); const room = createRoom(db, { id: 'main', leadBotId: bot.id }); addMember(db, room.id, bot.id);
  http = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }); await once(http, 'listening'); detach = attachStream(http, ledger, auth);
  const desk = 'http://127.0.0.1:' + http.address().port;
  await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'tls-key'), '-out', join(dir, 'tls-cert'), '-days', '1', '-subj', '/CN=127.0.0.1']);
  https = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0, createServer: createHttpsServer, serverOptions: { key: readFileSync(join(dir, 'tls-key')), cert: readFileSync(join(dir, 'tls-cert')) } }); await once(https, 'listening');
  const target = 'https://127.0.0.1:' + https.address().port;
  setSetting(db, 'connectorSignIn', { callbackOrigin: target, deskOrigins: [desk] }); connector.invalidateFlows();
  await browser('open', desk + '/#/app-library');
  await evaluate(`localStorage.setItem('openag-token', ${JSON.stringify(full.token)}); location.reload()`);
  const started = await evaluate(`fetch('/connectors/composio/start', {method:'POST',headers:{authorization:'Bearer '+localStorage.getItem('openag-token'),'content-type':'application/json'},body:JSON.stringify({origin:location.origin})}).then(r=>r.json())`);
  path = responseFor(started);
  await browser('open', target + '/health'); assert.equal(await evaluate(`localStorage.getItem('openag-token')`), null, 'HTTPS callback origin has no desk credential');
  await browser('open', target + path);
  assert.equal(await evaluate('location.origin'), desk);
  assert.equal(await evaluate(`localStorage.getItem('openag-token')`), full.token);
  const deadline = Date.now() + 10000;
  while (!await evaluate(`document.body.textContent.includes('Composio account access is saved')`)) { if (Date.now() > deadline) throw Error('Original desk did not show completion'); await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.equal(await evaluate('location.search'), '', 'Display result is removed from history');
  const status = await evaluate(`fetch('/connectors/composio?origin='+encodeURIComponent(location.origin),{headers:{authorization:'Bearer '+localStorage.getItem('openag-token')}}).then(r=>r.json())`); assert.equal(status.state, 'connected');
  console.log('PASS actual browser: HTTP paired desk -> token-free HTTPS callback -> original HTTP desk, original device session retained and connection read back');
 }
} finally {
 if (browser) await browser('close').catch(() => {});
 detach?.(); for (const server of [http, https]) if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
 await connector?.close(); db.close(); rmSync(dir, { recursive: true, force: true });
}
