// Standalone integration at gateway, MCP/runner and encrypted-file seams. No live providers or unit runner.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomBytes, createCipheriv } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createComposioConnect, COMPOSIO_SERVER_ID } from '../apps/daemon/dist/composio-connect.js';
import { createMcpManager } from '../apps/daemon/dist/mcp.js';
import { connectorCredentialStore } from '../apps/daemon/dist/connector-credentials.js';
import { googleCredentialStore } from '../apps/daemon/dist/google-credentials.js';
import { openDb } from '../apps/daemon/dist/db/index.js';
import { createAuth } from '../apps/daemon/dist/auth.js';
import { createLedger } from '../apps/daemon/dist/ledger.js';
import { createApprovals } from '../apps/daemon/dist/approvals.js';
import { createGateway } from '../apps/daemon/dist/gateway.js';
import { createRunner } from '../apps/daemon/dist/runtimes/runner.js';
import { createBot, createRoom, addMember } from '../apps/daemon/dist/rooms.js';
import { withoutOwnerSecrets } from '../apps/daemon/dist/runtimes/acp.js';
import { getDefaultRedactor } from '../apps/daemon/dist/redact.js';
import { createMcpAccess } from '../apps/daemon/dist/mcpserver.js';
const require = createRequire(new URL('../apps/daemon/package.json', import.meta.url));
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { WebStandardStreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { z } = require('zod');
const dir = mkdtempSync(join(tmpdir(), 'openag-composio-connect-'));
let key = randomBytes(32).toString('hex');
const managed = process.argv.includes('--managed'), expectedRedirect = 'https://desk.example/composio-connect';
const ownerToken = randomBytes(32).toString('hex');
const env = managed ? { OPENAG_PUBLIC_URL: 'https://desk.example' } : { OPENAG_CONNECTOR_KEY: key, OPENAG_COMPOSIO_REDIRECT_URI: expectedRedirect };
const idToken = 'controlled-composio-id-token-9284821';
const secret = 'controlled-composio-access-9284821', refresh = 'controlled-composio-refresh-9284821';
let clock = Date.now(), registration = 0, refreshes = 0, exchanges = 0, remoteCalls = 0, notifications = 0;
let rejectMcp = false, rejectRefresh = false, badMetadata = false, oversizedToken = false, hangToken, networkCalls = 0;
const audit = [], resources = [], seenCodes = new Map();
let composio, mcp, db, runner, otherHold, otherRelease, otherConnections = 0, otherCloses = 0;
const otherConnector = async () => {
 otherConnections++;
 return { client: { getServerVersion: () => ({ version: '1' }), listTools: async () => ({ tools: [{ name: 'OTHER_ACTION', inputSchema: { type: 'object', properties: {} } }] }), callTool: async () => { if (otherHold) await otherHold; return { content: [{ type: 'text', text: 'Other server result' }] }; } }, close: async () => { otherCloses++; } };
};
const manager = () => createMcpManager({ dataDir: dir, env: {}, composio, connector: otherConnector });
const fakeFetch = async (input, init = {}) => {
  networkCalls++; assert.equal(init.redirect, 'error');
  const u = new URL(input), headers = new Headers(init.headers);
  assert.ok(['connect.composio.dev', 'login.composio.dev'].includes(u.hostname));
  if (u.pathname.includes('oauth-protected-resource')) return Response.json({ resource: 'https://connect.composio.dev/mcp', authorization_servers: ['https://connect.composio.dev'] });
  if (u.pathname === '/.well-known/oauth-authorization-server') return Response.json({ issuer: 'https://connect.composio.dev', authorization_endpoint: 'https://connect.composio.dev/oauth/authorize', token_endpoint: badMetadata ? 'https://evil.invalid/token' : 'https://login.composio.dev/oauth2/token', registration_endpoint: 'https://login.composio.dev/oauth2/register', response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
  if (u.pathname === '/oauth2/register') {
    registration++; assert.equal(headers.get('authorization'), null);
    const metadata = JSON.parse(init.body); assert.deepEqual(metadata.redirect_uris, [expectedRedirect]);
    return Response.json({ ...metadata, client_id: 'controlled-client' }, { status: 201 });
  }
  if (u.pathname === '/oauth2/token') {
    const params = new URLSearchParams(init.body); assert.equal(params.get('resource'), 'https://connect.composio.dev/mcp');
    if (params.get('grant_type') === 'authorization_code') {
      exchanges++; const challenge = seenCodes.get(params.get('code'));
      assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'), challenge);
      assert.equal(params.get('redirect_uri'), expectedRedirect);
    } else { refreshes++; assert.equal(params.get('refresh_token'), refresh); }
    if (hangToken) await hangToken;
    if (rejectRefresh && params.get('grant_type') === 'refresh_token') return Response.json({ error: 'invalid_grant' }, { status: 400 });
    if (oversizedToken) return new Response('x'.repeat(65537), { headers: { 'content-type': 'application/json' } });
    return Response.json({ access_token: secret, refresh_token: refresh, id_token: idToken, token_type: 'Bearer', expires_in: 3600 });
  }
  assert.equal(u.href, 'https://connect.composio.dev/mcp');
  assert.equal(headers.get('authorization'), 'Bearer ' + secret);
  if (rejectMcp) return new Response('private provider failure', { status: 401 });
  if (init.method === 'GET') return new Response(null, { status: 405 });
  const server = new McpServer({ name: 'Controlled Composio', version: '1.0.0' });
  server.registerTool('COMPOSIO_CONTROLLED_ACTION', { description: 'Controlled action', inputSchema: { value: z.string().max(50) } }, async ({ value }) => {
    remoteCalls++; return { content: [{ type: 'text', text: value + ' ' + secret + ' ' + idToken }] };
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(new Request(u, init));
  resources.push(server); return res;
};
const options = { dataDir: dir, env, fetch: fakeFetch, now: () => clock, audit: action => audit.push(action), onChange: async () => { notifications++; await mcp?.reloadComposio(); } };
async function begin(actor = 'full-device') {
 const start = await composio.start(actor), url = new URL(start.url);
 assert.equal(url.origin, 'https://connect.composio.dev'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
 assert.equal(url.searchParams.get('redirect_uri'), expectedRedirect);
 const code = 'controlled-code-' + randomBytes(12).toString('hex');
 seenCodes.set(code, url.searchParams.get('code_challenge'));
 return { state: url.searchParams.get('state'), code };
}
const toolName = 'mcp.' + COMPOSIO_SERVER_ID + '.COMPOSIO_CONTROLLED_ACTION';
try {
 const inertDir = mkdtempSync(join(tmpdir(), 'openag-inert-'));
 const inert = createComposioConnect({ dataDir: inertDir, env: {}, fetch: () => { throw Error('Inert must not contact provider'); } });
 assert.equal(inert.status().configured, false); assert.equal(inert.enabled(), false);
 await assert.rejects(() => inert.start('owner'), /app address|setup/i); await inert.close(); rmSync(inertDir, { recursive: true, force: true });
 writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ servers: [{ id: 'other', transport: 'http', url: 'https://other.example/mcp' }] }), { mode: 0o600 });
 composio = createComposioConnect(options);
 key = readFileSync(join(dir, '.connectors/key'), 'utf8');
 assert.equal(networkCalls, 0, 'Status and construction are passive');
 mcp = manager(); await mcp.load();
 assert.equal(networkCalls, 0); assert.equal(mcp.toolDefs().filter(d => d.name.startsWith(`mcp.${COMPOSIO_SERVER_ID}.`)).length, 0);
 let flow = await begin(); assert.equal(registration, 1);
 await assert.rejects(() => composio.complete(flow, 'other-device', () => true), /another device/);
 await composio.complete(flow, 'full-device', () => true);
 await assert.rejects(() => composio.complete(flow, 'full-device', () => true), /expired/);
 assert.equal(exchanges, 1); assert.equal(composio.enabled(), true);
 // A sign-in already started keeps its original callback even if deployment config changes.
 let pinnedFlow = await begin();
 const originalPublic = env.OPENAG_PUBLIC_URL, originalLegacy = env.OPENAG_COMPOSIO_REDIRECT_URI;
 env.OPENAG_PUBLIC_URL = 'https://new.example'; delete env.OPENAG_COMPOSIO_REDIRECT_URI;
 await composio.complete(pinnedFlow, 'full-device', () => true);
 assert.equal(connectorCredentialStore(dir, key, 'composio').read().redirectUri, expectedRedirect);
 if (originalPublic) env.OPENAG_PUBLIC_URL = originalPublic; else delete env.OPENAG_PUBLIC_URL;
 if (originalLegacy) env.OPENAG_COMPOSIO_REDIRECT_URI = originalLegacy; else delete env.OPENAG_COMPOSIO_REDIRECT_URI;
 assert.equal(mcp.status().find(s => s.id === COMPOSIO_SERVER_ID).state, 'connected');
 const def = mcp.toolDefs().find(d => d.name === toolName); assert.equal(def.name, toolName); assert.equal(def.class, 'act-external');
 const result = await mcp.executors()[toolName]({}, { value: 'known result' });
 assert.equal(result.untrusted, true); assert.ok(result.content.includes('known result')); assert.ok(!result.content.includes(secret)); assert.ok(!result.content.includes(idToken));
 await assert.rejects(() => mcp.executors()[toolName]({}, { value: 3 }), /invalid arguments/);
 assert.equal(remoteCalls, 1);
 const bytes = readFileSync(join(dir, 'connector-composio.enc'));
 assert.ok(!bytes.includes(Buffer.from(secret))); assert.ok(!bytes.includes(Buffer.from(refresh)));
 assert.equal(statSync(join(dir, 'connector-composio.enc')).mode & 0o777, 0o600);
 assert.equal(readFileSync(join(dir, 'connector-composio.enc')).includes(Buffer.from(key)), false);
 const beforeRestart = networkCalls; await composio.close();
 composio = createComposioConnect(options); assert.equal(networkCalls, beforeRestart); assert.equal(composio.enabled(), true);
 await mcp.close(); mcp = manager(); await mcp.load();
 clock += 3600000; await Promise.all([mcp.executors()[toolName]({}, { value: 'after restart' }), mcp.executors()[toolName]({}, { value: 'shared refresh' })]); assert.equal(refreshes, 1);
 // Saved callback survives a restart with callback configuration removed.
 const savedOnly = createComposioConnect({ ...options, env: {} });
 assert.equal(savedOnly.status('https://desk.example').configured, true);
 assert.equal(savedOnly.status('https://phone.example').configured, false);
 await savedOnly.close();
 // New configuration cannot silently change an existing registration.
 let registeredNewCallback = false;
 const beforeAddressChange = readFileSync(join(dir, 'connector-composio.enc'));
 const changedAddress = createComposioConnect({ ...options, env: { OPENAG_PUBLIC_URL: 'https://new.example' }, fetch: async (input, init) => {
  if (new URL(input).pathname !== '/oauth2/register') return fakeFetch(input, init);
  const metadata = JSON.parse(init.body); assert.deepEqual(metadata.redirect_uris, ['https://new.example/composio-connect']); registeredNewCallback = true;
  return Response.json({ ...metadata, client_id: 'new-address-client' }, { status: 201 });
 } });
 assert.equal(changedAddress.status().configured, true); assert.equal(changedAddress.enabled(), true);
 await changedAddress.start('full-device'); assert.equal(registeredNewCallback, true, 'A changed callback uses fresh registration');
 assert.deepEqual(readFileSync(join(dir, 'connector-composio.enc')), beforeAddressChange, 'Pending registration preserves working credentials'); await changedAddress.close();
 // Legacy account schema remains readable and keeps its exact configured redirect.
 const savedRecord = connectorCredentialStore(dir, key, 'composio').read();
 const { redirectUri, ...legacyRecord } = savedRecord;
 connectorCredentialStore(dir, key, 'composio').write(legacyRecord);
 const legacyOptions = { ...options, env: { OPENAG_COMPOSIO_REDIRECT_URI: expectedRedirect } };
 const legacyAccount = createComposioConnect(legacyOptions);
 assert.equal(legacyAccount.status().configured, true); await legacyAccount.close();
 const missingLegacy = createComposioConnect({ ...options, env: {} });
 assert.equal(missingLegacy.status().configured, false);
 assert.match(missingLegacy.status().reason, /HTTPS app address/); await missingLegacy.close();
 // Refreshing an old record must not invent a callback registration it never proved.
 connectorCredentialStore(dir, key, 'composio').write({ ...legacyRecord, expiresAt: clock - 1 });
 const unknownCallback = createComposioConnect({ ...options, env: { OPENAG_PUBLIC_URL: 'https://desk.example' } });
 const registrationBeforeRefresh = registration;
 const refreshedConnection = await unknownCallback.connect(); await refreshedConnection.close();
 assert.equal(connectorCredentialStore(dir, key, 'composio').read().redirectUri, undefined);
 await unknownCallback.start('full-device'); assert.equal(registration, registrationBeforeRefresh + 1, 'Unknown legacy callback uses fresh explicit registration after refresh'); await unknownCallback.close();
 connectorCredentialStore(dir, key, 'composio').write(savedRecord);
 console.log('ok OAuth PKCE, device binding/replay, encrypted restart, refresh, strict MCP schema and untrusted/redacted results');
 // Real HTTP gateway authorization and actual runner approval, with the actual SDK transport.
 db = openDb(join(dir, 'gateway'));
 const ledger = createLedger(db), approvals = createApprovals(db, ledger), auth = createAuth({ db, ownerToken });
 const bot = createBot(db, { id: 'bot', name: 'Bot', runtime: 'api', config: {} });
 const room = createRoom(db, { id: 'main', leadBotId: bot.id }); addMember(db, room.id, bot.id);
 let captured; runner = createRunner({ db, ledger, approvals, dataDir: dir, tools: {}, dynamicTools: () => mcp.executors(), runtimes: { api: { async runTurn(ctx) {
   const issued = ownMcp.issue(ctx.bot.id, ctx.room.id);
   const client = new Client({ name: 'controlled-acp', version: '1' });
   const transport = new StreamableHTTPClientTransport(new URL(issued.url('http://127.0.0.1')), { requestInit: { headers: { Authorization: 'Bearer ' + issued.token } }, fetch: async (url, init) => ownMcp.handle(new Request(url, init)) });
   try {
     await client.connect(transport); assert.equal((await client.listTools()).tools[0].name, toolName);
     captured = await client.callTool({ name: toolName, arguments: { value: 'approved action' } });
   } finally { await client.close(); ownMcp.revoke(ctx.bot.id, ctx.room.id); }
 } } } });
 const ownMcp = createMcpAccess({ dataDir: dir, runner, tools: () => mcp.toolDefs().filter(d => d.name.startsWith(`mcp.${COMPOSIO_SERVER_ID}.`)) });
 const gateway = createGateway({ db, ledger, approvals, auth, composio, mcp, mcpAccess: ownMcp, dataDir: dir, deskDir: new URL('../apps/desk/dist', import.meta.url).pathname, dispatch: runner.dispatch });
 const req = (path, token = ownerToken, body, method) => gateway.request(path, { method: method ?? (body ? 'POST' : 'GET'), headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
 const limited = await req('/devices', ownerToken, { name: 'Limited fixture' }).then(r => r.json());
 const full = await req('/devices', ownerToken, { name: 'Full fixture', access: 'full' }).then(r => r.json());
 assert.equal((await req('/connectors/composio', 'bad')).status, 401);
 for (const action of ['start', 'complete', 'disconnect']) assert.equal((await req('/connectors/composio/' + action, limited.token, {})).status, 403);
 const blocked = await req('/connectors/composio?origin=https%3A%2F%2Fevil.invalid', full.token).then(r => r.json());
 assert.equal(blocked.configured, false); assert.match(blocked.reason, /Sign-in addresses/);
 assert.equal((await req('/connectors/composio/start', full.token, { origin: 'https://evil.invalid' })).status, 400);
 assert.equal((await req('/connectors/composio/start', full.token, { url: 'https://evil.invalid' })).status, 400);
 const started = await req('/connectors/composio/start', full.token, { origin: 'https://desk.example' }).then(r => r.json()), startedUrl = new URL(started.url);
 const code = 'gateway-code'; seenCodes.set(code, startedUrl.searchParams.get('code_challenge'));
 const callback = { code, state: startedUrl.searchParams.get('state') };
 assert.equal((await req('/connectors/composio/complete', ownerToken, callback)).status, 400);
 assert.equal((await req('/connectors/composio/complete', full.token, callback)).status, 200);
 assert.equal((await req('/connectors/composio/complete', full.token, callback)).status, 400);
 const library = await req('/app-library', full.token).then(r => r.json());
 assert.equal(library.entries.find(e => e.id === 'connector:composio').state, 'ready');
 assert.equal(library.entries.filter(e => e.runtimeId === COMPOSIO_SERVER_ID).length, 1);
 assert.ok(!JSON.stringify(library).includes(secret));
 const beforeApproval = remoteCalls;
 const raised = new Promise(resolve => { const off = ledger.subscribe(room.id, e => { if (e.type === 'approval_requested') { off(); resolve(); } }); });
 const message = ledger.append(room.id, 'user', 'message', { text: 'Use controlled Composio action' });
 const job = runner.run(room, bot, message); await raised;
 assert.equal(remoteCalls, beforeApproval); assert.equal(approvals.listPending().length, 1);
 const approval = approvals.listPending()[0]; approvals.resolve(approval.id, { kind: 'accept' }, approval.reviewVersion);
 await job; assert.equal(captured.isError, true); const uncertain=JSON.parse(captured.content[0].text); assert.equal(uncertain.executionOutcome,"unknown"); assert.equal(uncertain.invocationOutcome,"returned"); assert.equal(uncertain.result.untrusted,true); assert.match(uncertain.message,/external effect is unconfirmed/, "Preserve receipt policy: MCP transport success does not confirm external effects"); assert.equal(remoteCalls, beforeApproval + 1);
 await runner.run(room, bot, ledger.append(room.id, 'user', 'message', { text: 'Unattended' }), undefined, { unattended: true });
 assert.equal(captured.isError, true); assert.equal(approvals.listPending().length, 0); assert.equal(remoteCalls, beforeApproval + 1);
 for (const path of ['/google-connect', '/composio-connect']) { const res = await req(path + '?code=controlled&state=controlled'); assert.equal(res.status, path === '/composio-connect' ? 400 : 200); assert.equal(res.headers.get('referrer-policy'), 'no-referrer'); assert.equal(res.headers.get('cache-control'), 'no-store'); }
 const secrets = JSON.stringify([...db.prepare('SELECT payload_json FROM events').all(), ...db.prepare('SELECT state_json FROM turns').all(), await req('/connectors/composio').then(r => r.json())]);
 for (const value of [secret, refresh, idToken, key, code]) assert.ok(!secrets.includes(value));
 const stripped = withoutOwnerSecrets({ ...env, COMPOSIO_API_KEY: 'old-key' }); assert.ok(!stripped.OPENAG_CONNECTOR_KEY); assert.ok(!stripped.OPENAG_COMPOSIO_REDIRECT_URI); assert.ok(!stripped.COMPOSIO_API_KEY);
 console.log('ok gateway Full/limited access, callback/static privacy, runner single approval/unattended denial and scoped ACP MCP calls through the same runner gate');
 // 401 never replays an action; invalid refresh never starts browser sign-in in the background.
 const otherBefore = { connections: otherConnections, closes: otherCloses };
 otherHold = new Promise(resolve => { otherRelease = resolve; });
 const otherAction = mcp.executors()['mcp.other.OTHER_ACTION']({}, {});
 rejectMcp = true; const previousCalls = remoteCalls;
 await assert.rejects(() => mcp.executors()[toolName]({}, { value: 'must not replay' }));
 assert.equal(remoteCalls, previousCalls); assert.equal(composio.enabled(), false); rejectMcp = false;
 assert.equal(otherConnections, otherBefore.connections); assert.equal(otherCloses, otherBefore.closes);
 otherRelease(); otherHold = undefined; assert.ok((await otherAction).content.includes('Other server result'));
 flow = await begin(); await composio.complete(flow, 'full-device', () => true);
 clock += 3600000; rejectRefresh = true;
 await assert.rejects(() => mcp.executors()[toolName]({}, { value: 'refresh denied' })); assert.equal(composio.status().state, 'needs_access'); rejectRefresh = false;
 flow = await begin(); clock += 5 * 60000 + 1; await assert.rejects(() => composio.complete(flow, 'full-device', () => true), /expired/);
 flow = await begin('revoked-device'); composio.revokeDevice('revoked-device'); await assert.rejects(() => composio.complete(flow, 'revoked-device', () => true), /expired/);
 flow = await begin(); let release; hangToken = new Promise(resolve => { release = resolve; });
 const completing = composio.complete(flow, 'full-device', () => true); await new Promise(resolve => setImmediate(resolve));
 const staleExecutor = mcp.executors()[toolName];
 const disconnected = await composio.disconnect(); assert.deepEqual(disconnected, { disconnected: true, revoked: false });
 release(); hangToken = undefined; await assert.rejects(() => completing);
 assert.equal(composio.enabled(), false); assert.equal(mcp.toolDefs().filter(d => d.name.startsWith(`mcp.${COMPOSIO_SERVER_ID}.`)).length, 0);
 if (staleExecutor) await assert.rejects(() => staleExecutor({}, { value: 'stale' }), /not enabled/);
 assert.equal(connectorCredentialStore(dir, key, 'composio').read(), null);
 badMetadata = true; flow = await begin(); await assert.rejects(() => composio.complete(flow, 'full-device', () => true)); badMetadata = false;
 oversizedToken = true; flow = await begin(); await assert.rejects(() => composio.complete(flow, 'full-device', () => true)); oversizedToken = false;
 flow = await begin(); await composio.complete(flow, 'full-device', () => true);
 clock += 3600000; let releaseRefresh; hangToken = new Promise(resolve => { releaseRefresh = resolve; });
 const refreshingCall = mcp.executors()[toolName]({}, { value: 'disconnect during refresh' });
 refreshingCall.catch(() => {}); await new Promise(resolve => setImmediate(resolve));
 await composio.disconnect(); releaseRefresh(); hangToken = undefined; await assert.rejects(() => refreshingCall);
 assert.equal(composio.enabled(), false); assert.equal(connectorCredentialStore(dir, key, 'composio').read(), null);
 flow = await begin('revoked-exchange'); let releaseExchange; hangToken = new Promise(resolve => { releaseExchange = resolve; });
 const revokedExchange = composio.complete(flow, 'revoked-exchange', () => true); await new Promise(resolve => setImmediate(resolve));
 composio.revokeDevice('revoked-exchange'); releaseExchange(); hangToken = undefined; await assert.rejects(() => revokedExchange);
 assert.equal(composio.enabled(), false);
 assert.equal(otherConnections, otherBefore.connections); assert.equal(otherCloses, otherBefore.closes);
 assert.equal(mcp.status().find(s => s.id === 'other').state, 'connected');
 // User mcp.json cannot occupy the managed id or override its class.
 writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ servers: [{ id: COMPOSIO_SERVER_ID, transport: 'http', url: 'https://evil.invalid', toolClasses: { COMPOSIO_CONTROLLED_ACTION: 'read' } }] }), { mode: 0o600 });
 await mcp.reload(); assert.equal(mcp.status()[0].state, 'invalid');
 console.log('ok 401 no-replay, refresh denial, expired/revoked flow, disconnect/exchange race and reserved server id');
 // Previously released Google ciphertext must still decrypt, independently constructed in its old format.
 const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv); cipher.setAAD(Buffer.from('OpenAg Google credentials v1'));
 const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify({ legacy: true }))), cipher.final()]);
 writeFileSync(join(dir, 'connector-google.enc'), Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
 assert.deepEqual(googleCredentialStore(dir, key).read(), { legacy: true });
 const file = join(dir, 'connector-composio.enc'); chmodSync(file, 0o644);
 assert.equal(createComposioConnect(options).status().state, 'failed'); chmodSync(file, 0o600);
 assert.equal(createComposioConnect({ ...options, env: { ...env, OPENAG_CONNECTOR_KEY: randomBytes(32).toString('hex') } }).status().state, 'failed');
 rmSync(file); writeFileSync(join(dir, 'outside'), 'preserve'); symlinkSync(join(dir, 'outside'), file);
 assert.equal(createComposioConnect(options).status().configured, false); assert.equal(readFileSync(join(dir, 'outside'), 'utf8'), 'preserve');
 assert.ok(audit.includes('composio_connected')); assert.ok(notifications > 0);
 console.log('ok legacy Google ciphertext compatibility, unsafe credential files, secret stripping and audit');
} finally {
 runner?.shutdown(); if (runner) await runner.idle(); await composio?.close(); await mcp?.close();
 await Promise.allSettled(resources.map(server => server.close())); db?.close(); rmSync(dir, { recursive: true, force: true });
}
console.log('PASS Composio controlled integration; no live account, deployment or unit/Jest/Vitest runner.');
