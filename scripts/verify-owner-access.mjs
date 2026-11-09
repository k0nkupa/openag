// Standalone filesystem/socket/HTTP and React integration acceptance. Synthetic credentials, temporary workspaces; no unit runner.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync, chmodSync, unlinkSync, symlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
const root = fileURLToPath(new URL('../', import.meta.url));
const load = name => import(root + 'apps/daemon/dist/' + name + '.js');
const require = createRequire(root + 'apps/daemon/package.json');
const { serve } = require('@hono/node-server');
const { resolveOwnerCredential, ownerDirectory } = await load('owner-credential');
const { startOwnerAccess, requestDeskAccess, ownerSocketPath } = await load('owner-access');
const { openDb } = await load('db/index'), { createAuth } = await load('auth');
const { createLedger } = await load('ledger'), { createApprovals } = await load('approvals');
const { createGateway } = await load('gateway');
const { getDefaultRedactor } = await load('redact');
const { ensureDataRepo } = await load('datagit');
const dir = mkdtempSync('/tmp/oag-owner-');
let db, server, stop, child;
const req = (app, path, token, body, method = 'POST') => app.request(path, { method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function start(app) {
 server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
 await once(server, 'listening');
 stop = await startOwnerAccess(dir, server.address().port, auth, ledger);
}
let clock = Date.now();
const owner = resolveOwnerCredential(dir);
db = openDb(dir);
const auth = createAuth({ db, ownerToken: owner, now: () => clock });
const ledger = createLedger(db), approvals = createApprovals(db, ledger);
const app = createGateway({ db, auth, ledger, approvals, dispatch() {}, dataDir: dir });
try {
 assert.match(owner, /^[a-f0-9]{64}$/);
 assert.equal(resolveOwnerCredential(dir), owner);
 assert.equal(resolveOwnerCredential(dir, owner), owner);
 assert.equal(statSync(ownerDirectory(dir)).mode & 0o777, 0o700);
 const credential = join(ownerDirectory(dir), 'credential.json');
 assert.equal(statSync(credential).mode & 0o777, 0o600);
 assert.throws(() => resolveOwnerCredential(dir, 'different-existing-credential'), /conflicts/);
 assert.equal(getDefaultRedactor().redact(owner), '[REDACTED:secret]');
 const stored = readFileSync(credential);
 chmodSync(credential, 0o644); assert.throws(() => resolveOwnerCredential(dir), /unsafe/); chmodSync(credential, 0o600);
 writeFileSync(credential, 'broken'); assert.throws(() => resolveOwnerCredential(dir), /unreadable/); assert.equal(readFileSync(credential, 'utf8'), 'broken');
 writeFileSync(credential, stored);
 unlinkSync(credential); symlinkSync('/does-not-exist', credential); assert.throws(() => resolveOwnerCredential(dir)); unlinkSync(credential); writeFileSync(credential, stored, { mode: 0o600 });
 const legacyDir = join(dir, 'legacy'); mkdirSync(legacyDir); writeFileSync(join(legacyDir, 'openag.db'), 'legacy-marker');
 assert.throws(() => resolveOwnerCredential(legacyDir), /original OPENAG_TOKEN/);
 const original = 'synthetic-original-owner-834721';
 assert.equal(resolveOwnerCredential(legacyDir, original), original); assert.equal(resolveOwnerCredential(legacyDir), original);
 await ensureDataRepo(dir); const ignore = readFileSync(join(dir, '.gitignore'), 'utf8');
 assert.ok(ignore.includes('.owner/')); writeFileSync(join(dir, '.gitignore'), ignore.replace('.owner/\n', '')); await ensureDataRepo(dir);
 assert.ok(readFileSync(join(dir, '.gitignore'), 'utf8').includes('.owner/'), 'Existing installs gain private-state ignore');
 const longDir = join(dir, 'long-workspace-'.repeat(9));
 resolveOwnerCredential(longDir);
 const longSocket = ownerSocketPath(longDir); assert.ok(Buffer.byteLength(longSocket) <= 100);
 const longStop = await startOwnerAccess(longDir, 80, auth, ledger);
 try { assert.match(await requestDeskAccess(longDir), /127\.0\.0\.1:80/); } finally { longStop(); }
 clock += 300001;
 await start(app);
 assert.equal(statSync(join(ownerDirectory(dir), 'access.sock')).mode & 0o777, 0o600);
 await assert.rejects(startOwnerAccess(dir, server.address().port, auth, ledger), /already uses/);
 const link = await requestDeskAccess(dir);
 assert.equal(link.includes(owner), false);
 const code = new URL(link).hash.split('/')[2];
 assert.equal((await req(app, '/devices/pairing-codes', null, { access: 'full' })).status, 401);
 const anonymousLocal = await fetch(new URL('/devices/pairing-codes', link), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"access":"full"}' });
 assert.equal(anonymousLocal.status, 401);
 const paired = await req(app, '/pair', null, { code, name: 'Host browser' }); assert.equal(paired.status, 200);
 const identity = await paired.json(); assert.match(identity.token, /^oag_/);
 assert.deepEqual((await (await req(app, '/whoami', identity.token, undefined, 'GET')).json()).access, 'full');
 assert.equal((await req(app, '/pair', null, { code, name: 'Replay' })).status, 400);
 const limited = auth.createDevice('Phone', 'owner', 'limited');
 assert.equal((await req(app, '/devices/pairing-codes', limited.token, { access: 'full' })).status, 403);
 const limitedGrant = await (await req(app, '/devices/pairing-codes', identity.token, {})).json();
 const phone = await (await req(app, '/pair', null, { code: limitedGrant.code, name: 'Paired phone' })).json();
 assert.equal(auth.authenticate(phone.token).access, 'limited');
 const expiredLink = await requestDeskAccess(dir); clock += 300001;
 assert.equal((await req(app, '/pair', null, { code: new URL(expiredLink).hash.split('/')[2], name: 'Expired' })).status, 400);
 const recovered = await (await req(app, '/pair', null, { code: new URL(await requestDeskAccess(dir)).hash.split('/')[2], name: 'Recovery' })).json();
 assert.equal(auth.authenticate(recovered.token).access, 'full');
 const restartedAuth = createAuth({ db, ownerToken: resolveOwnerCredential(dir) });
 assert.equal(restartedAuth.authenticate(identity.token).access, 'full'); assert.equal(restartedAuth.authenticate(phone.token).access, 'limited');
 assert.equal((await req(app, '/devices/' + identity.deviceId, recovered.token, undefined, 'DELETE')).status, 204);
 assert.equal(auth.authenticate(identity.token), null); assert.ok(auth.authenticate(recovered.token));
 const events = JSON.stringify(db.prepare('SELECT payload_json FROM events').all());
 assert.ok(!events.includes(owner)); assert.ok(!events.includes(code)); assert.ok(!events.includes(recovered.token));
 // A malformed local request cannot mint a grant.
 const before = db.prepare('SELECT COUNT(*) AS n FROM pairing_codes').get().n;
 await new Promise((resolve, reject) => { const client = createConnection(join(ownerDirectory(dir), 'access.sock')); client.on('error', reject); client.on('connect', () => client.end('anything-else\n')); client.on('close', resolve); });
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pairing_codes').get().n, before);
 // Saturation stays bounded and exposes no root secret.
 for (let i = 0; i < 5; i++) await requestDeskAccess(dir);
 await assert.rejects(requestDeskAccess(dir), /pairing grant/);
 stop(); stop = null; await new Promise(resolve => server.close(resolve)); server = null;
 await assert.rejects(requestDeskAccess(dir));
 console.log('PASS private credential creation/migration/restart, unsafe-file refusal, redaction, real socket/HTTP pairing, full/limited authority, expiry/replay/revocation and bounded grants');
 clock += 300001;
 await verifyDesk(app);
 if (process.argv.includes('--browser')) {
  clock += 300001;
  await start(app);
  const link = await requestDeskAccess(dir);
  writeFileSync(join(dir, 'browser.json'), JSON.stringify({ link, dir }), { mode: 0o600 });
  console.log('BROWSER_FIXTURE ' + join(dir, 'browser.json'));
  await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
 } else {
  // Start the actual daemon twice in an isolated HOME, without any provider keys or owner token.
  const actual = join(dir, 'actual'), home = join(dir, 'home'); mkdirSync(home);
  for (let run = 0; run < 2; run++) {
   child = spawn(process.execPath, [root + 'apps/daemon/dist/main.js'], { cwd: root, env: { PATH: process.env.PATH, HOME: home, TMPDIR: '/tmp', OPENAG_DATA: actual, OPENAG_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
   let output = '';
   await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Actual daemon startup timed out')), 15000);
    child.on('error', reject); child.once('exit', () => { clearTimeout(timer); reject(Error('Actual daemon exited before ready: ' + output)); });
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('Open this desk with pnpm desk:open')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', chunk => { output += chunk; });
   });
   const saved = JSON.parse(readFileSync(join(actual, '.owner/credential.json'), 'utf8')).token;
   assert.equal(output.includes(saved), false); assert.match(await requestDeskAccess(actual), /127\.0\.0\.1/);
   const boundPort = /listening on http:\/\/0\.0\.0\.0:([0-9]+)/.exec(output)[1];
   const loopback = `http://127.0.0.1:${boundPort}`;
   const managedStatus = await fetch(loopback + '/connectors/composio?origin=' + encodeURIComponent(loopback), { headers: { authorization: 'Bearer ' + saved, 'x-forwarded-host': 'evil.invalid', 'x-forwarded-proto': 'https' } }).then(r => r.json());
   assert.equal(managedStatus.configured, true, 'Actual bound port enables local sign-in without keys or redirect configuration');
   const connectorKey = readFileSync(join(actual, '.connectors/key'), 'utf8');
   assert.equal(output.includes(connectorKey), false);
   if (run === 0) writeFileSync(join(dir, 'first-connector-key'), connectorKey, { mode: 0o600 });
   else assert.equal(connectorKey, readFileSync(join(dir, 'first-connector-key'), 'utf8'));

   const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; child = null;
   assert.equal(existsSync(join(actual, '.owner/access.sock')), false);
   if (run === 0) writeFileSync(join(dir, 'first-root'), saved, { mode: 0o600 });
   else assert.equal(saved, readFileSync(join(dir, 'first-root'), 'utf8'));
  }
  const seeded = join(dir, 'seeded');
  execFileSync(process.execPath, [root + 'apps/daemon/dist/seed.js'], { cwd: root, env: { PATH: process.env.PATH, HOME: home, OPENAG_DATA: seeded }, stdio: 'pipe' });
  assert.ok(resolveOwnerCredential(seeded));
  if (process.platform === 'darwin') {
   const dryData = join(dir, "dry data ' $(printf substituted) `printf substituted` ; &"), plist = join(dir, 'dry.plist');
   const installEnv = { PATH: process.env.PATH, HOME: home, OPENAG_DATA: dryData, OPENAG_PLIST_OUT: plist, OPENAG_SERVICE_DRY_RUN: '1', OPENAG_SEED_SAMPLE: '1' };
   const output = execFileSync('bash', [root + 'scripts/install-service.sh'], { cwd: root, env: installEnv, timeout: 60000, encoding: 'utf8' });
   const command = output.split('\n').find(line => line.startsWith('  open:   '))?.slice('  open:   '.length);
   assert.ok(command, 'Installer prints the host sign-in command');
   assert.equal(execFileSync('bash', ['-c', 'pnpm() { printf \'%s\' "$OPENAG_DATA"; }; ' + command], { cwd: dir, env: { PATH: process.env.PATH, HOME: home, OPENAG_DATA: join(dir, 'wrong-data') }, encoding: 'utf8' }), dryData, 'Sign-in command preserves the exact custom data path');
   assert.equal(existsSync(join(dryData, 'openag.db')), false, 'Dry run never seeds');
   assert.equal(existsSync(join(dryData, '.owner')), false, 'Dry run never creates credentials');
   const fresh = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }));
   assert.equal(fresh.EnvironmentVariables.OPENAG_TOKEN, undefined);
   execFileSync('plutil', ['-insert', 'EnvironmentVariables.OPENAG_TOKEN', '-string', original, plist]);
   const connectorConfig = { OPENAG_PUBLIC_URL: 'https://desk.example', OPENAG_CONNECTOR_KEY: 'c'.repeat(64), OPENAG_COMPOSIO_REDIRECT_URI: 'https://desk.example/composio-connect', OPENAG_GOOGLE_CLIENT_ID: 'controlled-client', OPENAG_GOOGLE_CLIENT_SECRET: 'controlled-secret', OPENAG_GOOGLE_REDIRECT_URI: 'https://desk.example/google-connect' };
   for (const [name, value] of Object.entries(connectorConfig)) execFileSync('plutil', ['-insert', 'EnvironmentVariables.' + name, '-string', value, plist]);
   execFileSync('bash', [root + 'scripts/install-service.sh'], { cwd: root, env: installEnv, timeout: 60000, stdio: 'pipe' });
   const migrated = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }));
   assert.equal(migrated.EnvironmentVariables.OPENAG_TOKEN, original, 'Installer keeps legacy service credentials');
   for (const [name, value] of Object.entries(connectorConfig)) assert.equal(migrated.EnvironmentVariables[name], value, 'Installer preserves connector configuration');
   assert.equal(statSync(plist).mode & 0o777, 0o600);
  }
  console.log('PASS actual daemon token-free startup/restart, fresh seed and installer dry-run/legacy preservation');
 }
} finally {
 child?.kill('SIGTERM'); stop?.(); if (server) await new Promise(resolve => server.close(resolve)); db?.close(); rmSync(dir, { recursive: true, force: true });
}

async function verifyDesk(app) {
 const desk = root + 'apps/desk/', deskRequire = createRequire(desk + 'package.json');
 const { JSDOM } = deskRequire('jsdom');
 const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:4444/#/join/ABCD-EFGH/full', pretendToBeVisual: true });
 for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'localStorage', 'getComputedStyle']) globalThis[name] = name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name];
 Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
 globalThis.IS_REACT_ACT_ENVIRONMENT = true;
 globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
 globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
 window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
 globalThis.WebSocket = class { close() {} };
 const { createServer } = await import(deskRequire.resolve('vite'));
 const vite = await createServer({ configFile: false, root: desk, resolve: { alias: { '@': desk + 'src' } }, server: { middlewareMode: true }, appType: 'custom' });
 const React = deskRequire('react'), { act } = React, { createRoot } = deskRequire('react-dom/client');
 const renderRoot = createRoot(document.getElementById('root'));
 const fetchBefore = globalThis.fetch;
 let pairedToken;
 globalThis.fetch = async (path, init = {}) => app.request(String(path), init);
 try {
  const { Login } = await vite.ssrLoadModule('/src/components/Login.tsx');
  const { App } = await vite.ssrLoadModule('/src/app.tsx');
  const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text);
  const submit = async () => { await act(async () => { document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); }); };
  await act(async () => renderRoot.render(React.createElement(Login, { notice: null, onSignedIn: token => { pairedToken = token; } })));
  assert.equal(window.location.hash, ''); assert.ok(document.body.textContent.includes('Full access')); assert.ok(document.querySelector('#pair-code'));
  assert.equal(document.querySelector('#token'), null, 'Pairing is the normal sign-in route');
  await submit(); assert.ok(document.body.textContent.includes('Invalid or expired code')); assert.equal(pairedToken, undefined);
  const current = auth.createDevice('Existing limited browser'); localStorage.setItem('openag-token', current.token);
  const { code } = auth.createPairingCode('owner', 'full');
  window.history.replaceState(null, '', '#/join/' + code + '/full');
  await act(async () => renderRoot.render(React.createElement(React.StrictMode, null, React.createElement(App))));
  assert.ok(button('Cancel and keep current access')); assert.equal(localStorage.getItem('openag-token'), current.token);
  // Failed recovery does not discard the existing token or repeat the one-use request.
  clock += 300001; await submit(); assert.ok(document.body.textContent.includes('Invalid or expired code')); assert.equal(localStorage.getItem('openag-token'), current.token);
  const next = auth.createPairingCode('owner', 'full');
  await act(async () => { window.history.replaceState(null, '', '#/join/' + next.code + '/full'); window.dispatchEvent(new window.HashChangeEvent('hashchange')); });
  await submit(); const full = localStorage.getItem('openag-token'); assert.notEqual(full, current.token); assert.equal(auth.authenticate(full).access, 'full');
  assert.ok(auth.authenticate(current.token), 'Recovery preserves the previous device'); assert.equal(window.location.hash, '');
  const kept = localStorage.getItem('openag-token');
  const repeat = auth.createPairingCode('owner', 'full');
  await act(async () => { window.history.replaceState(null, '', '#/join/' + repeat.code + '/full'); window.dispatchEvent(new window.HashChangeEvent('hashchange')); });
  assert.equal(localStorage.getItem('openag-token'), kept, 'An already-full browser keeps its existing credential');
  assert.equal(document.querySelector('#pair-code'), null);
  await act(async () => renderRoot.render(null));
  const oldSession = auth.createDevice('Old session');
  localStorage.setItem('openag-token', oldSession.token);
  let releaseOld, heldOld = false;
  globalThis.fetch = async (path, init = {}) => {
   if (path === '/rooms' && init.headers?.authorization === 'Bearer ' + oldSession.token) {
    heldOld = true;
    return await new Promise(resolve => { releaseOld = () => resolve(Response.json({ error: 'unauthorized' }, { status: 401 })); });
   }
   return app.request(String(path), init);
  };
  await act(async () => renderRoot.render(React.createElement(App)));
  assert.ok(heldOld, 'Old session request is held at the HTTP interface');
  const recovery = auth.createPairingCode('owner', 'full');
  await act(async () => { window.history.replaceState(null, '', '#/join/' + recovery.code + '/full'); window.dispatchEvent(new window.HashChangeEvent('hashchange')); });
  await submit(); const replacement = localStorage.getItem('openag-token');
  assert.equal(auth.authenticate(replacement).access, 'full');
  auth.revokeDevice(oldSession.device.id);
  await act(async () => releaseOld());
  assert.equal(localStorage.getItem('openag-token'), replacement, 'A delayed old-session 401 cannot clear recovered access');
  await act(async () => renderRoot.unmount());
  console.log('PASS real Login/App with gateway: pairing default, fragment removal, expired handoff, limited-browser recovery and saved full device and stale-session 401 isolation');
 } finally { globalThis.fetch = fetchBefore; await vite.close(); dom.window.close(); }
}
