// Standalone DOM integration acceptance of the real sidebar and popovers; no unit runner or live service.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const desk = fileURLToPath(new URL('../apps/desk/', import.meta.url));
const require = createRequire(desk + 'package.json');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<div id="root"></div>', { url: 'http://sidebar.fixture/' , pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'localStorage', 'getComputedStyle']) globalThis[key] = key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createServer } = await import(require.resolve('vite'));
const server = await createServer({ configFile: false, root: desk, resolve: { alias: { '@': desk + 'src' } }, server: { middlewareMode: true }, appType: 'custom' });
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
let root;
try {
  const { Shell } = await server.ssrLoadModule('/src/components/Shell.tsx');
  const props = { rooms: [{ id: 'one', name: 'One', members: [], kind: 'room' }, { id: 'two', name: 'Two', members: [], kind: 'room' }], bots: ['Alpha', 'Beta', 'Gamma'].map((name) => ({ id: name.toLowerCase(), name, runtime: 'api', model: null })), route: { kind: 'work' }, status: 'live', pendingCount: 0, children: 'Content' };
  async function mount() { root = createRoot(document.getElementById('root')); await act(async () => root.render(React.createElement(Shell, props))); }
  const rows = (kind) => [...document.querySelectorAll(`[data-nav-kind="${kind}"]`)].map((r) => r.dataset.navId);
  const button = (label) => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent.trim() === label);
  async function click(label) { const b = button(label); assert.ok(b, label); assert.equal(b.disabled, false, label); await act(async () => b.click()); }
  async function close() { await act(async () => { document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }); }
  await mount();
  assert.ok([...document.querySelectorAll('[data-slot="sidebar-group-label"]')].some((e) => e.textContent === 'Agents'));
  await click('Options for Gamma'); await click('Pin to top'); await close();
  assert.deepEqual(rows('agents'), ['gamma', 'alpha', 'beta']);
  await click('Options for Beta'); await click('Move up'); await close();
  assert.deepEqual(rows('agents'), ['gamma', 'beta', 'alpha']);
  await click('Options for Two'); await click('Pin to top'); await close();
  assert.deepEqual(rows('rooms'), ['two', 'one']);
  await act(async () => root.unmount()); await mount();
  assert.deepEqual(rows('agents'), ['gamma', 'beta', 'alpha']);
  assert.deepEqual(rows('rooms'), ['two', 'one']);
  await click('Options for Gamma'); assert.equal(button('Move down').disabled, true); await click('Unpin'); await close();
  // Dispatch pointer input through the actual handle and row hit-testing path.
  async function pointer(type, target) {
    const handle = button('Drag Alpha to reorder');
    handle.setPointerCapture = () => {};
    document.elementFromPoint = () => document.querySelector(`[data-nav-id="${target}"]`);
    await act(async () => handle.dispatchEvent(new window.MouseEvent(type, { bubbles: true, button: 0, clientX: 20, clientY: 30 })));
  }
  await pointer('pointerdown', 'alpha'); await pointer('pointermove', 'two'); await pointer('pointerup', 'two');
  assert.deepEqual(rows('agents'), ['gamma', 'beta', 'alpha']);
  await pointer('pointerdown', 'alpha'); await pointer('pointermove', 'gamma'); await pointer('pointerup', 'gamma');
  assert.deepEqual(rows('agents'), ['alpha', 'gamma', 'beta']);
  await pointer('pointerdown', 'alpha'); await pointer('pointermove', 'beta'); await pointer('pointercancel', 'beta');
  assert.deepEqual(rows('agents'), ['alpha', 'gamma', 'beta']);
  // Real links remain independently usable; sidebar operations never create chats or change membership.
  assert.ok(document.querySelector('[data-nav-id="one"] a').getAttribute('href').includes('one'));
  assert.ok(document.querySelector('[data-nav-id="alpha"] a').getAttribute('href').includes('alpha'));
  await act(async () => root.unmount());
  localStorage.setItem('openag.sidebar.agents', '{broken'); await mount();
  assert.deepEqual(rows('agents'), ['alpha', 'beta', 'gamma']);
  await act(async () => root.unmount());
  Object.defineProperty(window.Storage.prototype, 'setItem', { value() { throw new Error('blocked'); }, configurable: true });
  await mount(); await click('Options for Beta'); await click('Pin to top');
  assert.deepEqual(rows('agents'), ['beta', 'alpha', 'gamma']);
  assert.ok([...document.querySelectorAll('[role="status"]')].some((e) => /storage is unavailable/.test(e.textContent)));
  console.log('PASS: real Shell + sidebar/popover DOM integration: label, agent/room pins, reorder, reload, boundary, pointer drop/cancel, links, malformed/blocked storage. No browser layout or physical touch claim.');
} finally {
  if (root) await act(async () => root.unmount());
  await server.close(); dom.window.close();
}
