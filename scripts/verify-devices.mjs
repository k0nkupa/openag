// Standalone real-gateway/React acceptance. Temporary data and synthetic devices only; no unit runner or live service.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url)), dir = mkdtempSync('/tmp/oag-devices-');
const load = name => import(root + 'apps/daemon/dist/' + name + '.js');
const { openDb } = await load('db/index'), { createAuth } = await load('auth');
const { createLedger } = await load('ledger'), { createApprovals } = await load('approvals'), { createGateway } = await load('gateway');
const db = openDb(dir), auth = createAuth({ db, ownerToken: 'synthetic-devices-owner-483771' });
const ledger = createLedger(db), approvals = createApprovals(db, ledger);
const app = createGateway({ db, auth, ledger, approvals, dataDir: dir, dispatch() {} });
const desktop = auth.createDevice('Desktop browser', 'owner', 'full');
const phone = auth.createDevice('Phone', 'owner', 'limited');
const tablet = auth.createDevice('Tablet', phone.device.id, 'limited');
const old = auth.createDevice('Old browser'); auth.revokeDevice(old.device.id);
const desk = root + 'apps/desk/', require = createRequire(desk + 'package.json');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'https://desk.fixture/#/settings/devices', pretendToBeVisual: true });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'DocumentFragment', 'MutationObserver', 'localStorage', 'getComputedStyle']) globalThis[name] = name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.WebSocket = class { close() {} };
const { createServer } = await import(require.resolve('vite'));
const vite = await createServer({ configFile: false, root: desk, resolve: { alias: { '@': desk + 'src' } }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client');
const renderRoot = createRoot(document.getElementById('root'));
const fetchBefore = globalThis.fetch;
let signedOut = 0, identity = { kind: 'device', deviceId: desktop.device.id, name: desktop.device.name, access: 'full' };
let pairCalls = 0, writes = 0, failList = false, holdIdentity = false, releaseIdentity;
const fetchGateway = async (path, init = {}) => {
 if (path === '/devices/pairing-codes') pairCalls++;
 if (init.method && init.method !== 'GET') writes++;
 if (path === '/devices' && failList) return Response.json({ error: 'Controlled offline response' }, { status: 503 });
 const response = await app.request(String(path), init);
 if (path === '/whoami' && holdIdentity) {
  holdIdentity = false;
  return await new Promise(resolve => { releaseIdentity = () => resolve(response); });
 }
 // Exercise client expiry with a short response lifetime; server TTL/replay is covered by verify-owner-access.
 if (path === '/devices/pairing-codes' && pairCalls === 1 && response.ok) {
  const grant = await response.json(); return Response.json({ ...grant, expiresAt: Date.now() + 1500 });
 }
 return response;
};
globalThis.fetch = fetchGateway;
let http, deskClosed = false;
async function closeDesk() {
 if (deskClosed) return;
 deskClosed = true; globalThis.fetch = fetchBefore;
 await act(async () => renderRoot.unmount()); await vite.close(); dom.window.close();
}
try {
 const { createApi } = await vite.ssrLoadModule('/src/api.ts');
 const { DevicesPage } = await vite.ssrLoadModule('/src/components/DevicesPage.tsx');
 const { SettingsLayout } = await vite.ssrLoadModule('/src/components/SettingsLayout.tsx');
 const { SettingsView } = await vite.ssrLoadModule('/src/components/SettingsView.tsx');
 const { parseHash, hrefFor } = await vite.ssrLoadModule('/src/route.ts');
 assert.deepEqual(parseHash('#/settings/devices'), { kind: 'settings', section: 'devices' });
 assert.equal(hrefFor({ kind: 'settings', section: 'devices' }), '#/settings/devices');
 const api = createApi(desktop.token, () => { signedOut++; }, fetchGateway);
 const devices = await api.listDevices();
 assert.equal(devices.devices.find(d => d.id === desktop.device.id).current, true, 'Full-access raw identity is retained by GET /devices');
 const props = () => ({ api, identity, onSignOut() { signedOut++; }, onIdentityChange(who) { identity = who; render(); } });
 function render() { renderRoot.render(React.createElement(SettingsLayout, { route: { kind: 'settings', section: 'devices' } }, React.createElement(DevicesPage, props()))); }
 const button = label => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent.trim() === label);
 const click = async label => { const b = button(label); assert.ok(b, label); assert.equal(b.disabled, false, label); await act(async () => { b.click(); await new Promise(resolve => setImmediate(resolve)); }); };
 const select = async (id, value) => {
  await act(async () => { const trigger = document.getElementById(id); assert.ok(trigger, id); trigger.click(); });
  const label = value === 'full' ? 'Full access' : 'Limited access';
  const option = [...document.querySelectorAll('[role="option"]')].find(element => element.textContent.trim() === label);
  assert.ok(option, label); await act(async () => option.click());
 };
 await act(async () => render());
 assert.equal(writes, 0, 'Opening Devices is passive');
 assert.equal(document.querySelector('nav[aria-label="Settings"] a[aria-current="page"]').textContent.trim(), 'Devices');
 assert.ok(document.querySelector('[aria-label="Devices"] li').textContent.includes('Desktop browser'));
 assert.ok(document.querySelector('[aria-label="Devices"] li').textContent.includes('This device'));
 assert.equal(document.querySelector('[aria-label="Revoked devices"]'), null, 'Revoked history starts collapsed');
 await click('Manage Phone'); await select('device-access', 'full'); await click('Save access');
 assert.equal(auth.authenticate(phone.token).access, 'full'); assert.equal(document.querySelector('[role="dialog"]'), null);
 await click('Pair device'); assert.equal(pairCalls, 0, 'Opening Pair does not mint a credential');
 assert.equal(document.querySelector('#new-access [data-slot="select-value"]').textContent.trim(), 'Limited access');
 await click('Create pairing code'); assert.equal(pairCalls, 1);
 const code = document.querySelector('[aria-label="Pairing code"]').textContent;
 assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/); assert.ok(document.querySelector('[role="timer"]').textContent.match(/Expires in 0:0[12]/));
 let copied;
 Object.defineProperty(navigator, 'clipboard', { value: { async writeText(value) { copied = value; } }, configurable: true });
 await click('Copy code'); assert.equal(copied, code);
 await click('Close'); await click('View pairing code'); assert.equal(pairCalls, 1, 'Reopening reuses the unexpired code');
 await act(async () => { await new Promise(resolve => setTimeout(resolve, 2200)); });
 assert.ok(document.body.textContent.includes('This code has expired'));
 await click('Create a new code'); assert.equal(pairCalls, 2);
 await click('Close');
 await click('Manage Phone'); await click('Remove access');
 assert.equal(auth.authenticate(phone.token).access, 'full', 'Remove requires a second confirmation');
 assert.equal(document.querySelector('[role="switch"]').getAttribute('aria-checked'), 'true');
 await click('Back'); assert.ok(auth.authenticate(phone.token));
 await click('Remove access'); await click('Remove device');
 assert.equal(auth.authenticate(phone.token), null); assert.equal(auth.authenticate(tablet.token), null);
 const revokedTrigger = [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Revoked devices'));
 await act(async () => revokedTrigger.click());
 assert.equal(document.querySelectorAll('[aria-label="Revoked devices"] li').length, 3);
 assert.equal(document.querySelectorAll('[aria-label="Revoked devices"] button').length, 0);
 await click('Manage Desktop browser'); await select('device-access', 'limited'); await click('Save access');
 assert.equal(identity.access, 'limited', 'Current-device permission changes update shared identity');
 await click('Manage Desktop browser'); assert.equal(document.getElementById('device-access').disabled, true);
 await click('Remove access'); assert.ok(document.body.textContent.includes('Removing it signs you out'));
 await click('Remove device'); assert.equal(signedOut, 1);
 await act(async () => renderRoot.render(null));
 const ownerApi = createApi('synthetic-devices-owner-483771', () => {}, fetchGateway);
 const { renderToStaticMarkup } = require('react-dom/server');
 const serverMarkup = renderToStaticMarkup(React.createElement(SettingsView, { api: ownerApi }));
 assert.ok(serverMarkup.includes('href="#/settings/devices"'));
 const serverHtml = document.createElement('div'); serverHtml.innerHTML = serverMarkup;
 assert.equal(serverHtml.querySelector('ul[aria-label="Devices"]'), null, 'Server page no longer duplicates device management');
 failList = true;
 await act(async () => renderRoot.render(React.createElement(DevicesPage, { api: ownerApi, identity: { kind: 'owner' }, onSignOut() {} })));
 assert.ok(document.querySelector('[role="alert"]').textContent.includes('Controlled offline response'));
 failList = false; await click('Retry');
 assert.ok(document.body.textContent.includes('No active devices'));
 await act(async () => renderRoot.render(null));
 dom.reconfigure({ url: 'https://127.example.com/#/settings/devices' });
 await act(async () => renderRoot.render(React.createElement(DevicesPage, { api: ownerApi, identity: { kind: 'owner' }, onSignOut() {} })));
 await click('Pair device'); await click('Create pairing code');
 assert.equal(document.body.textContent.includes('This address only works on this computer'), false, 'A hostname beginning 127 is not a loopback IP');
 await act(async () => renderRoot.render(null));
 const race = auth.createDevice('Race browser', 'owner', 'full'); localStorage.setItem('openag-token', race.token);
 window.history.replaceState(null, '', '#/');
 const { App } = await vite.ssrLoadModule('/src/app.tsx');
 await act(async () => renderRoot.render(React.createElement(App)));
 holdIdentity = true;
 await act(async () => { window.history.replaceState(null, '', '#/settings/devices'); window.dispatchEvent(new window.HashChangeEvent('hashchange')); });
 assert.ok(releaseIdentity, 'Pre-mutation identity read is held at the HTTP interface');
 await click('Manage Race browser'); await select('device-access', 'limited'); await click('Save access');
 assert.equal(auth.authenticate(race.token).access, 'limited');
 await act(async () => releaseIdentity());
 assert.ok(document.querySelector('[data-slot="sidebar-footer"]').textContent.includes('Limited access'), 'A late Full response cannot undo the shared Limited identity');
 await click('Manage Race browser'); assert.equal(document.getElementById('device-access').disabled, true);
 await click('Close');
 console.log('PASS stale pre-mutation identity response cannot restore Full labels or controls');
 console.log('PASS real route, settings navigation, Full-current identity, passive reads, save/readback, one-use pairing/copy/reopen/expiry, cascade and current-device revocation, permission changes, server extraction, error/retry/empty states');
 if (process.argv.includes('--browser')) {
  await closeDesk();
  auth.revokeDevice(race.device.id);
  auth.createDevice('X'.repeat(64), 'owner', 'limited');
  auth.createDevice('Personal laptop', 'owner', 'limited'); auth.createDevice('iPhone Safari', 'owner', 'limited'); auth.createDevice('Office browser', 'owner', 'full');
  const daemonRequire = createRequire(root + 'apps/daemon/package.json'), { serve } = daemonRequire('@hono/node-server');
  http = serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch }); await once(http, 'listening');
  const { code } = auth.createPairingCode('owner', 'full');
  writeFileSync(join(dir, 'browser.json'), JSON.stringify({ url: `http://127.0.0.1:${http.address().port}/#/join/${code}/full`, dir }), { mode: 0o600 });
  console.log('BROWSER_FIXTURE ' + join(dir, 'browser.json'));
  await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
 }
} catch (err) { console.error(err); throw err; } finally {
 await closeDesk();
 if (http) await new Promise(resolve => http.close(resolve)); db.close(); rmSync(dir, { recursive: true, force: true });
}
