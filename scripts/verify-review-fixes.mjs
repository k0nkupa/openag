// PR #1 regressions at the ledger/string-redaction and real routing-editor DOM seams.
// Temporary data and controlled APIs only; no unit runner, model or live account.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRedactor } from '../apps/daemon/dist/redact.js';
import { createLedger } from '../apps/daemon/dist/ledger.js';
import { openDb } from '../apps/daemon/dist/db/index.js';
const mode = process.argv[2];
if (mode !== 'routing') {
 const dir = mkdtempSync(join(tmpdir(), 'openag-review-redaction-'));
 let db;
 try {
  const r = createRedactor({ env: {}, extraSecrets: ['12345678901234567890', 'controlled-review-secret'] });
  db = openDb(dir); const ledger = createLedger(db, r);
  db.prepare("INSERT INTO rooms (id,name,created_at) VALUES ('review','Review',0)").run();
  const input = '{"value":12345678901234567890,"identifier":98765432109876543210}';
  const event = ledger.append('review', 'fixture', 'tool_result', { content: input });
  const stored = ledger.get(event.id).payload.content;
  assert.ok(!stored.includes('12345678901234567890'), 'Registered unsafe integer leaked into the ledger');
  assert.ok(stored.includes('98765432109876543210'), 'Unrelated unsafe integer must retain its literal');
  assert.doesNotThrow(() => JSON.parse(stored));
  const changed = r.redactString('{"value":"controlled-review-secret","identifier":98765432109876543210,"decimal":0.987654321098765432109,"exponent":1.2300e+42,"negativeZero":-0}');
  for (const literal of ['98765432109876543210', '0.987654321098765432109', '1.2300e+42', '-0']) assert.ok(changed.includes(literal), 'Preserve numeric spelling: ' + literal);
  assert.ok(!changed.includes('controlled-review-secret')); assert.equal(r.redactString(changed), changed);
  assert.ok(!r.redactString('{"password":12345678901234567890}').includes('12345678901234567890'));
  const benign = ' { "identifier": 98765432109876543210, "exponent":1.2300e+42 } ';
  assert.equal(r.redactString(benign), benign);
  const nested = JSON.stringify({ content: [{ text: input, quote: '"\\' }] });
  const safeNested = JSON.parse(r.redactString(nested)); assert.ok(!safeNested.content[0].text.includes('12345678901234567890')); assert.ok(safeNested.content[0].text.includes('98765432109876543210')); assert.equal(safeNested.content[0].quote, '"\\');
  assert.ok(!r.redactString('{"value":"controlled-review-secret","value":"ordinary"}').includes('controlled-review-secret'));
  console.log('PASS registered numeric secrets and exact unrelated numeric literals through ledger/MCP-shaped JSON, nested escaping and idempotence');
 } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
}
if (mode !== 'redaction') {
 const desk = fileURLToPath(new URL('../apps/desk/', import.meta.url));
 const require = createRequire(desk + 'package.json'), { JSDOM } = require('jsdom');
 const dom = new JSDOM('<div id="root"></div>', { url: 'http://routing.fixture/', pretendToBeVisual: true });
 for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle']) globalThis[name] = name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name];
 Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
 globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
 Element.prototype.scrollIntoView = () => {};
 window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
 globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window); globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window); globalThis.IS_REACT_ACT_ENVIRONMENT = true;
 const { createServer } = await import(require.resolve('vite'));
 const vite = await createServer({ configFile: false, root: desk, resolve: { alias: { '@': desk + 'src' } }, server: { middlewareMode: true }, appType: 'custom' });
 const React = require('react'), { act } = React, { createRoot } = require('react-dom/client');
 const root = createRoot(document.getElementById('root'));
 let discoveries = 0, saves = 0, rejectDiscovery = false, holdStoredCatalog = false, releaseCatalog;
 const discoveryInputs = [];
 const options = [{ strategy: 'lead', reason: null, providers: [] }, { strategy: 'cheap-same-model', reason: null, providers: [{ id: 'openai', name: 'OpenAI', configured: true }] }, { strategy: 'openai-decision', reason: null, providers: [{ id: 'openai', name: 'OpenAI', configured: true }] }];
 const room = { id: 'main', name: 'Main', leadBotId: 'boss', members: ['boss'], router: 'openai-decision', routerRevision: 'stored-revision', routerConfig: { provider: 'openai', model: 'openai/fixture', reasoning: { effort: 'high' } } };
 const api = {
  discoverRoomRouter: async (_id, input) => {
   discoveries++; discoveryInputs.push(input);
   if (holdStoredCatalog && input.strategy === 'openai-decision' && !input.model) await new Promise(resolve => { releaseCatalog = resolve; });
   if (rejectDiscovery) throw Error('Controlled discovery failure');
   return { target: input.provider, model: 'openai/fixture', models: [{ id: 'openai/fixture', name: 'Fixture' }], reasoning: {}, controls: input.model ? [{ id: 'effort', name: 'Reasoning effort', values: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] }] : [], revision: 'stored-revision', snapshotId: 'snapshot-' + discoveries, source: 'Controlled routing choices', reason: null };
  },
  setRoomRouting: async (_id, input) => { saves++; assert.equal(input.snapshotId, 'snapshot-' + discoveries); assert.deepEqual(input.reasoning, { effort: 'high' }); return { room }; },
  listRooms: async () => ({ rooms: [room] }),
 };
 const button = label => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label);
 async function click(label) { const b = button(label); assert.ok(b, label); assert.equal(b.disabled, false); await act(async () => b.click()); }
 try {
  const { RoomRouting } = await vite.ssrLoadModule('/src/components/RoomRoutingPanel.tsx');
  await act(async () => root.render(React.createElement(RoomRouting, { api, room, options, disabled: false, onSaved() {} })));
  assert.equal(discoveries, 2); assert.equal(document.getElementById('routing-main-effort').value, '"high"');
  for (let i = 0; i < 2; i++) {
   const before = discoveries; await click('Cancel');
   assert.equal(discoveries, before + 1, 'Cancel must reload the unchanged stored model controls and snapshot');
   assert.equal(document.getElementById('routing-main-effort').value, '"high"'); assert.equal(button('Save routing for Main').disabled, false);
  }
  const reasoning = document.getElementById('routing-main-effort');
  await act(async () => { reasoning.value = '"low"'; reasoning.dispatchEvent(new window.Event('change', { bubbles: true })); });
  await click('Cancel'); assert.equal(document.getElementById('routing-main-effort').value, '"high"');
  await click('Save routing for Main'); assert.equal(saves, 1); assert.ok(document.body.textContent.includes('Saved. Service acceptance'), 'Reset recovery must preserve the existing save confirmation');
  rejectDiscovery = true; const beforeFailure = discoveries; await click('Cancel');
  assert.equal(discoveries, beforeFailure + 1); assert.equal(button('Save routing for Main').disabled, true); assert.ok(document.body.textContent.includes('Controlled discovery failure'));
  await act(async () => { await new Promise(resolve => setImmediate(resolve)); }); assert.equal(discoveries, beforeFailure + 1, 'A failed discovery must not loop');
  rejectDiscovery = false; await click('Cancel'); assert.equal(button('Save routing for Main').disabled, false, 'Explicit reset can recover from discovery failure');
  const routing = document.querySelector('select[aria-label="Routing for Main"]');
  await act(async () => { routing.value = 'cheap-same-model'; routing.dispatchEvent(new window.Event('change', { bubbles: true })); });
  holdStoredCatalog = true; const beforeStrategyReset = discoveries;
  await click('Cancel');
  assert.equal(discoveries, beforeStrategyReset + 1, 'Changed-strategy Cancel must wait for the saved strategy catalogue before discovering controls');
  assert.equal(discoveryInputs.at(-1).model, undefined);
  assert.equal(document.getElementById('routing-main-effort'), null);
  await act(async () => { holdStoredCatalog = false; releaseCatalog(); });
  assert.equal(discoveries, beforeStrategyReset + 2); assert.equal(button('Save routing for Main').disabled, false);
  console.log('PASS unchanged-strategy Cancel, repeated reset, restored reasoning, fresh snapshot/save and bounded discovery failure');
 } finally { await act(async () => root.unmount()); await vite.close(); dom.window.close(); }
}
