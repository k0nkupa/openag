// Actual React Skills panel and desk API against a temporary real gateway. DOM behavior, not browser layout.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(root + 'apps/desk/package.json');
const { JSDOM } = require('jsdom'), React = require('react');
const { act } = React;
const load = name => import(root + 'apps/daemon/dist/' + name + '.js');
const { openDb } = await load('db/index'), { createLedger } = await load('ledger'), { createApprovals } = await load('approvals'), { createAuth } = await load('auth'), { createGateway } = await load('gateway');
const { createSkillCatalogue } = await load('skills'), { createBot } = await load('rooms');
const dir = mkdtempSync(join(tmpdir(), 'oag-skills-desk-')), dataDir = join(dir, 'data'), library = join(dir, 'library');
const pkg = join(library, 'weekly-review'); mkdirSync(pkg, { recursive: true });
writeFileSync(join(pkg, 'SKILL.md'), '---\nname: weekly-review\ndescription: Review weekly work\n---\nDESK_REFERENCE_MARKER');
const db = openDb(dataDir), ledger = createLedger(db), approvals = createApprovals(db, ledger), auth = createAuth({ db, ownerToken: 'controlled-skills-desk-owner' });
createBot(db, { id: 'a', name: 'Agent A', runtime: 'api' }); createBot(db, { id: 'b', name: 'Agent B', runtime: 'api' });
const skills = createSkillCatalogue(db, dataDir, library), app = createGateway({ db, ledger, approvals, auth, skills, dataDir, dispatch() {} });
const dom = new JSDOM('<div id="root"></div>', { url: 'http://skills.fixture/', pretendToBeVisual: true });
const saved = new Map();
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
 saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
 Object.defineProperty(globalThis, key, { configurable: true, value: ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require('react-dom/client');
let vite, reactRoot, failNext = false, failReadback = false;
const mutations = [];
try {
 const { createServer } = await import(require.resolve('vite'));
 vite = await createServer({ configFile: false, root: root + 'apps/desk', resolve: { alias: { '@': root + 'apps/desk/src' } }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
 const { SkillsPanel } = await vite.ssrLoadModule('/src/components/SkillsPanel.tsx');
 const { createApi } = await vite.ssrLoadModule('/src/api.ts');
 const fetchFixture = async (path, init) => {
  if (init.method === 'PUT') { mutations.push(String(path)); if (failNext) { failNext = false; throw new TypeError('Synthetic uncertain response'); } }
  if (init.method === 'GET' && String(path).startsWith('/skills?') && failReadback) { failReadback = false; throw new TypeError('Synthetic failed readback'); }
  return app.request(path, init);
 };
 const api = createApi('controlled-skills-desk-owner', () => assert.fail('Owner unexpectedly refused'), fetchFixture);
 reactRoot = createRoot(document.getElementById('root'));
 const settle = operation => act(async () => { operation?.(); await new Promise(resolve => setImmediate(resolve)); });
 const render = (botId, selectedApi = api) => settle(() => reactRoot.render(React.createElement(SkillsPanel, { api: selectedApi, botId })));
 const librarySwitch = () => document.querySelector('[role="switch"][aria-label="Shared library"]');
 const assignment = () => document.querySelector('[role="switch"][aria-label^="Assign weekly-review"]');
 const button = text => [...document.querySelectorAll('button')].find(button => button.textContent === text || button.getAttribute('aria-label') === text);
 await render('a'); assert.equal(librarySwitch().getAttribute('aria-checked'), 'false');
 await settle(() => librarySwitch().click());
 assert.equal(librarySwitch().getAttribute('aria-checked'), 'true'); assert.ok(document.body.textContent.includes('shared:weekly-review'));
 assert.equal(skills.list('a', true)[0].assigned, false);
 await settle(() => button('weekly-review').click()); assert.ok(document.querySelector('[data-testid="skill-body"]').textContent.includes('DESK_REFERENCE_MARKER'));
 let checkbox = assignment(); assert.equal(checkbox.getAttribute('aria-checked'), 'false');
 await settle(() => checkbox.click()); assert.equal(skills.load('a', 'shared:weekly-review').name, 'weekly-review');
 assert.ok(document.querySelector('[data-testid="skill-body"]'), 'Assignment save keeps the preview open');
 await settle(() => button('All skills').click()); assert.equal(document.activeElement.getAttribute('placeholder'), 'Search skills…');
 const search = document.querySelector('input[placeholder="Search skills…"]');
 const inputValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
 await settle(() => { inputValue.call(search, 'not-a-skill'); search.dispatchEvent(new window.Event('input', {bubbles:true})); });
 assert.ok(document.body.textContent.includes('No matching skills'));
 await settle(() => { inputValue.call(search, ''); search.dispatchEvent(new window.Event('input', {bubbles:true})); });
 await render('b'); checkbox = assignment(); assert.equal(checkbox.getAttribute('aria-checked'), 'false'); assert.equal(skills.load('b', 'shared:weekly-review'), null);
 await render('a'); failNext = true; const before = mutations.length;
 await settle(() => librarySwitch().click());
 assert.ok(document.querySelector('[role="alert"]').textContent.includes('Refresh to check'));
 assert.equal(librarySwitch().getAttribute('aria-disabled'), 'true');
 await settle(() => librarySwitch().click()); assert.equal(mutations.length, before + 1, 'Uncertain writes are never automatically retried');
 await settle(() => button('Refresh skills').click()); assert.equal(librarySwitch().getAttribute('aria-disabled'), null);
 failReadback = true;
 await settle(() => assignment().click());
 assert.equal(skills.load('a', 'shared:weekly-review'), null, 'Assignment removal succeeded before readback failed');
 assert.equal(assignment().getAttribute('aria-disabled'), 'true');
 const readbackMutations = mutations.length;
 await settle(() => assignment().click()); assert.equal(mutations.length, readbackMutations, 'Stale selections cannot overwrite successful saves');
 await settle(() => button('Refresh skills').click()); assert.equal(assignment().getAttribute('aria-checked'), 'false');
 await settle(() => assignment().click()); assert.ok(skills.load('a', 'shared:weekly-review'));
 const limited = auth.createDevice('Limited', 'owner', 'limited');
 const limitedApi = createApi(limited.token, () => {}, fetchFixture);
 await render('a', limitedApi); assert.equal(librarySwitch().getAttribute('aria-disabled'), 'true'); await settle(() => button('About skills').click()); assert.ok(document.body.textContent.includes('Full access device'));
 assert.equal(assignment().getAttribute('aria-disabled'), 'true');
 await render('a'); await settle(() => librarySwitch().click()); assert.equal(skills.load('a', 'shared:weekly-review'), null);
 console.log('PASS actual SkillsPanel and desk API: enable, preview, assignment/readback, agent switching, Limited view, disable and uncertain-write lock/readback');
} finally {
 if (reactRoot) await act(async () => reactRoot.unmount()); await vite?.close(); dom.window.close();
 for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
 delete globalThis.IS_REACT_ACT_ENVIRONMENT;
 db.close(); rmSync(dir, { recursive: true, force: true });
}
