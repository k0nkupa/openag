// Actual renderer/editor and desk API against a temporary gateway. DOM assertions, not browser acceptance.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(root + 'apps/desk/package.json');
const { JSDOM } = require('jsdom'), React = require('react'), { act } = React;
const dir = mkdtempSync(join(tmpdir(), 'openag-avatar-desk-'));
const load = name => import(root + 'apps/daemon/dist/' + name + '.js');
const { openDb } = await load('db/index'), { createLedger } = await load('ledger'), { createApprovals } = await load('approvals');
const { createAuth } = await load('auth'), { createGateway } = await load('gateway'), { createBot } = await load('rooms');
const db = openDb(dir), ledger = createLedger(db), approvals = createApprovals(db, ledger), auth = createAuth({ db, ownerToken: 'controlled-avatar-owner' });
createBot(db, { id: 'coder', name: 'Coder', runtime: 'api', config: { avatar: { shape: 'hexagon', color: 'pink' } } });
const app = createGateway({ db, ledger, approvals, auth, dataDir: dir, dispatch() {} });
const token = auth.createDevice('Appearance', 'owner', 'limited').token;
const dom = new JSDOM('<div id="root"></div>', { url: 'http://avatar.fixture/', pretendToBeVisual: true });
const saved = new Map(), frames = new Map(), listeners = new Set();
let nextFrame = 0, clock = performance.now(), reduced = false;
const media = { get matches() { return reduced; }, media: '(prefers-reduced-motion: reduce)', addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
  MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  matchMedia: () => media, requestAnimationFrame: fn => { const id = ++nextFrame; frames.set(id, fn); return id; },
  cancelAnimationFrame: id => frames.delete(id), IS_REACT_ACT_ENVIRONMENT: true };
for (const [key, value] of Object.entries(globals)) { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
dom.window.matchMedia = globals.matchMedia;
let runtimeRunner;
let vite, reactRoot, failSave = false, holdSave, writes = 0, closes = 0;
try {
  const { createServer } = await import(require.resolve('vite'));
  vite = await createServer({ configFile: false, root: root + 'apps/desk', resolve: { alias: { '@': root + 'apps/desk/src' } }, server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  const { BotAvatar } = await vite.ssrLoadModule('/src/components/BotAvatar.tsx');
  const { AvatarEditor } = await vite.ssrLoadModule('/src/components/AvatarEditor.tsx');
  const { Dialog } = await vite.ssrLoadModule('/src/components/ui/dialog.tsx');
  const { AVATAR_SHAPES } = await vite.ssrLoadModule('/src/types.ts');
  const { avatarFor, avatarCharacter, avatarDefinition } = await vite.ssrLoadModule('/src/components/avatar-catalogue.ts');
  const { generatedAvatars } = await vite.ssrLoadModule('/src/components/avatar-generated.ts');
  const engine = join(dirname(require.resolve('open-bot-avatar/package.json')), 'dist');
  const { validateAvatar, analyzeBody } = await import(pathToFileURL(join(engine, 'validate.js')));
  const { faceRoom } = await import(pathToFileURL(join(engine, 'volume.js')));
  const { silhouetteSeams } = await import(pathToFileURL(join(engine, 'seams.js')));
  for (const definition of generatedAvatars) {
    const valid = validateAvatar(definition);
    assert.ok(valid.ok, definition.id + ': schema and geometry');
    const body = analyzeBody(valid.value.body.path);
    assert.ok(faceRoom(valid.value, body).ok, definition.id + ': full-size eyes and full gaze');
    assert.deepEqual(silhouetteSeams(body.polys), [], definition.id + ': no accidental seams');
  }
  assert.deepEqual(avatarFor('coder'), { shape: 'watering-can', color: 'pink' });
  const { createApi } = await vite.ssrLoadModule('/src/api.ts');
  const api = createApi(token, () => assert.fail('Appearance access unexpectedly refused'), async (path, init) => {
    if (init.method === 'PUT') { writes++; if (holdSave) await holdSave; if (failSave) return Response.json({ error: 'Controlled save refusal' }, { status: 503 }); }
    return app.request(path, init);
  });
  const { createRoot } = require('react-dom/client'); reactRoot = createRoot(document.getElementById('root'));
  const settle = operation => act(async () => { operation?.(); await new Promise(resolve => setImmediate(resolve)); });
  const flush = () => { clock += 17; const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(clock)); };
  const render = element => settle(() => reactRoot.render(element));
  const avatar = props => React.createElement(BotAvatar, { name: 'coder', ...props });
  for (const savedAvatar of [undefined, { shape: 'mug', color: 'blue', animated: true }]) {
    await render(avatar({ avatar: savedAvatar, still: true })); flush();
    assert.ok(document.querySelector('.bot-avatar svg'), 'Sidebar override renders a static avatar');
    assert.equal(document.querySelector('[data-avatar-scene]'), null);
    assert.equal(frames.size, 0, 'Sidebar override schedules no animation frames');
  }
  for (const shape of AVATAR_SHAPES) {
    assert.equal(avatarDefinition(shape).id, shape);
    await render(avatar({ avatar: { shape, color: 'pink' } })); flush();
    assert.ok(document.querySelector('[data-avatar-scene]'), shape + ' animates while idle');
  }
  assert.equal(avatarCharacter('hexagon', 'coder'), avatarFor('coder').shape);
  assert.deepEqual(avatarFor('Coder'), avatarFor('coder'));
  await render(React.createElement(React.Fragment, null, Array.from({ length: 100 }, (_, i) => React.createElement(BotAvatar, { key: i, name: 'agent-' + i })))); flush();
  assert.equal(document.querySelectorAll('[data-avatar-scene]').length, 100);
  assert.equal(frames.size, 1, '100 animated idle avatars share one animation frame');
  const idleView = document.querySelector('[data-view]');
  const idleTransform = idleView.style.transform;
  clock += 1000; flush();
  assert.notEqual(idleView.style.transform, idleTransform, 'Idle avatar actually moves between frames');
  await settle(() => { reduced = true; for (const fn of listeners) fn(); }); flush();
  assert.equal(frames.size, 0, 'Reduced motion stops idle avatars');
  await settle(() => { reduced = false; for (const fn of listeners) fn(); }); flush();
  assert.equal(frames.size, 1, 'Idle animation resumes after reduced motion is disabled');
  await render(avatar({ mood: 'thinking' })); flush();
  assert.ok(document.querySelector('[data-avatar-scene]')); assert.equal(frames.size, 1, 'Live renderer uses one shared frame');
  await render(avatar({ mood: 'happy', avatar: { shape: 'mug', color: 'blue' } })); flush();
  assert.equal(document.querySelector('.bot-avatar').dataset.mood, 'happy');
  assert.ok(document.querySelector('[data-eye="0"] svg'));
  await render(avatar({ mood: 'waiting' })); flush();
  assert.ok(document.querySelector('[data-avatar-scene]')); assert.equal(frames.size, 1, 'Waiting keeps the neutral idle animation');
  await render(avatar({ mood: 'thinking', avatar: { shape: 'sprout', color: null, animated: false } })); flush();
  assert.ok(document.querySelector('.bot-avatar > svg')); assert.equal(frames.size, 0, 'Saved animation-off is static');
  await render(avatar({ avatar: { shape: 'compass', color: 'white', animated: false } })); flush();
  assert.ok(document.querySelector('.bot-avatar > svg')); assert.equal(frames.size, 0, 'Saved animation-off also stops idle avatars');
  const button = text => [...document.querySelectorAll('button')].find(b => b.textContent === text);
  const radio = label => document.querySelector(`input[aria-label="${label}"]`);
  const stage = () => document.querySelector('[aria-label^="Avatar view."]');
  const editor = (key = 'editor') => React.createElement(Dialog, { open: true }, React.createElement(AvatarEditor, { key, id: 'coder', name: 'Coder', avatar: { shape: 'hexagon', color: 'pink' }, onSave: value => api.putBotSettings('coder', { avatar: value }), close: () => { closes++; } }));
  await render(editor()); flush();
  assert.equal(document.querySelectorAll('input[name="avatar-shape-coder"]').length, 12);
  assert.equal(document.querySelector('input[name="avatar-shape-coder"]:checked').value, avatarFor('coder').shape);
  await settle(() => radio('Barbell').click()); flush();
  assert.equal(document.querySelector('[data-bot="coder"][data-depth="true"]').dataset.shape, 'barbell');
  await settle(() => radio('Blue').click()); flush();
  await settle(() => stage().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))); flush();
  const turned = stage().querySelector('[data-view]').style.transform;
  assert.ok(turned);
  await settle(() => { reduced = true; for (const fn of listeners) fn(); }); flush();
  const stopped = stage().querySelector('[data-view]').style.transform;
  assert.notEqual(turned, stopped, 'System reduced motion resets editor turn');
  await settle(() => stage().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))); flush();
  assert.equal(stage().querySelector('[data-view]').style.transform, stopped);
  await settle(() => { reduced = false; for (const fn of listeners) fn(); }); flush();
  failSave = true; await settle(() => button('Save avatar').click());
  assert.ok(document.querySelector('[role="alert"]').textContent.includes('Controlled save refusal'));
  assert.equal(radio('Barbell').checked, true, 'Failed save retains draft'); assert.equal(closes, 0);
  failSave = false; let release; holdSave = new Promise(resolve => { release = resolve; });
  const before = writes; await settle(() => { button('Save avatar').click(); button('Save avatar')?.click(); });
  assert.equal(writes, before + 1, 'Duplicate save starts one request');
  await settle(() => release()); holdSave = undefined;
  assert.equal(closes, 1);
  const read = await app.request('/bots/coder/settings', { headers: { authorization: 'Bearer controlled-avatar-owner' } });
  assert.deepEqual((await read.json()).avatar, { shape: 'barbell', color: 'blue' });
  await render(editor('cancel')); const beforeCancel = writes;
  await settle(() => radio('Mug').click()); await settle(() => button('Cancel').click()); assert.equal(writes, beforeCancel);
  await render(editor('reset')); await settle(() => button('Reset').click()); await settle(() => button('Save avatar').click());
  const reset = await app.request('/bots/coder/settings', { headers: { authorization: 'Bearer controlled-avatar-owner' } });
  assert.equal((await reset.json()).avatar, null);
  await render(null); assert.equal(frames.size, 0, 'Unmount cancels final shared frame');
  assert.equal(listeners.size, 1, 'Only package-wide reduced-motion subscription remains');
  await render(avatar({ depth: true })); flush(); await render(null);
  assert.equal(frames.size, 0, 'Remount/unmount also cleans up');
  // Real runner → approval in actual Feed → registration event → open picker refresh.
  const { createRoom, addMember } = await load('rooms');
  const { createRunner } = await load('runtimes/runner');
  const { createAvatarLibrary } = await load('avatars');
  const { createAvatarTools } = await load('tools/avatars');
  const { toExecutors } = await load('tools/registry');
  createRoom(db, { id: 'avatar-chat', leadBotId: 'coder' }); addMember(db, 'avatar-chat', 'coder');
  const shared = createAvatarLibrary(db, ledger);
  runtimeRunner = createRunner({ db, ledger, approvals, dataDir: dir, tools: toExecutors(createAvatarTools(shared)), runtimes: { api: { async runTurn(ctx) {
    const preview = await ctx.callTool('avatar_preview', generatedAvatars.find(a => a.id === 'robot'));
    if (preview.ok) await ctx.callTool('avatar_library_add', { previewId: preview.result.previewId });
  } } } });
  let dispatchFinished;
  const runtimeApp = createGateway({ db, ledger, approvals, auth, dataDir: dir, dispatch: args => { dispatchFinished=runtimeRunner.dispatch(args);return dispatchFinished; } });
  const libraryApi = createApi(token, () => assert.fail('Controlled device refused'), (path, init) => runtimeApp.request(path, init));
  const { StreamProvider } = await vite.ssrLoadModule('/src/stream.tsx');
  const { AvatarLibraryProvider } = await vite.ssrLoadModule('/src/avatar-library.tsx');
  const { Feed } = await vite.ssrLoadModule('/src/components/Feed.tsx');
  const { setHideTechnicalActivity } = await vite.ssrLoadModule('/src/chat-display.ts');
  for (const key of ['Event', 'CustomEvent', 'localStorage', 'sessionStorage']) {
    if (!saved.has(key)) saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  class Observer { observe() {} unobserve() {} disconnect() {} }
  for (const key of ['ResizeObserver', 'IntersectionObserver']) { saved.set(key, Object.getOwnPropertyDescriptor(globalThis,key)); Object.defineProperty(globalThis,key,{ configurable:true,value:Observer }); dom.window[key]=Observer; }
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const transport = { state: 'open', onClose: () => () => {}, subscribe: async (_headers, listener) => ledger.subscribe('*', listener) };
  const wrap = child => React.createElement(StreamProvider, { token, rtcTransport: transport, onAuthFailure: () => {} }, React.createElement(AvatarLibraryProvider, { api: libraryApi }, child));
  const waitFor = async test => { const end=Date.now()+5000; while(!test()){ assert.ok(Date.now()<end,'DOM integration deadline'); await settle(); } };
  await runtimeApp.request('/rooms/avatar-chat/messages', { method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({text:'Make me a robot avatar'}) });
  await waitFor(() => approvals.listPending().some(a => a.toolName === 'avatar_library_add'));
  const proposal = approvals.listPending().find(a => a.toolName === 'avatar_library_add');
  await settle(() => setHideTechnicalActivity(true));
  await render(wrap(React.createElement(Feed, { api:libraryApi,events:ledger.list('avatar-chat'),approvals:[proposal],onDecide:(id,decision)=>libraryApi.decide(id,decision) }))); flush();
  assert.equal(document.querySelectorAll('[aria-label="Avatar preview: Robot"]').length,2,'Chat and approval show the exact generated design even when technical activity is hidden');
  assert.equal(button('Edit').disabled,true);
  assert.equal(shared.list().length,0);
  await settle(() => button('Add to library').click()); flush();
  await waitFor(() => shared.list().length === 1);
  await settle(); flush();
  assert.ok(document.body.textContent.includes('In avatar library'),'Existing chat preview updates after registration');
  await act(async () => { await dispatchFinished; });
  const savedCharacter=shared.list()[0];
  await render(wrap(editor('library-picker'))); await settle(); flush();
  assert.equal(document.querySelectorAll('input[name="avatar-shape-coder"]').length,13);
  await settle(() => [...document.querySelectorAll('input[name="avatar-shape-coder"]')].find(input=>input.value===savedCharacter.id).click()); flush();
  assert.equal(document.querySelector('[data-depth="true"]').dataset.shape,savedCharacter.id);
  await settle(() => button('Save avatar').click());
  assert.equal((await runtimeApp.request('/bots/coder/settings',{headers:{authorization:'Bearer controlled-avatar-owner'}}).then(r=>r.json())).avatar.shape,savedCharacter.id);
  await render(null);
  console.log('PASS actual Feed approval preview, hidden-activity visibility, mandatory Add to library action, live catalogue refresh, dynamic picker and selected custom avatar via gateway.');
  console.log('PASS actual avatar renderer/editor + gateway: 12 characters (five strict-validated generated), stable defaults, legacy fallback, animated 100-agent list sharing one frame, live expressions, motion controls, keyboard turning, save/cancel/reset, failure retention, duplicate guard and lifecycle cleanup. DOM-only; visual/performance acceptance pending.');
} finally {
  runtimeRunner?.shutdown();
  if (reactRoot) await act(async () => reactRoot.unmount()); await vite?.close(); dom.window.close(); db.close(); rmSync(dir, { recursive: true, force: true });
  for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
}
