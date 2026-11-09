// Real gateway and built desk; controlled provider unless --live-audio is explicitly supplied. No unit runner.
import { capabilityFixture, capabilityUrl } from './model-capabilities-fixture.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(root + 'apps/daemon/package.json');
const { serve } = require('@hono/node-server');
const load = name => import(root + 'apps/daemon/dist/' + name + '.js');
const { openDb } = await load('db/index'), { createAuth } = await load('auth'), { createLedger } = await load('ledger');
const { createBotModels } = await load('botmodels'), { createApprovals } = await load('approvals'), { createGateway, attachStream } = await load('gateway');
const { createRoom, createBot, addMember } = await load('rooms'), { setSetting } = await load('settings');
const { registerProviderSecrets } = await load('providers');
const livePath = process.argv.includes('--live-audio') ? process.argv[process.argv.indexOf('--live-audio') + 1] : null;
const provider = process.argv.includes('--ollama') ? 'ollama' : 'openai';
if (process.argv.includes('--live-audio')) assert.ok(livePath && (provider === 'ollama' || process.env.OPENAI_API_KEY), 'Live acceptance requires an audio path and OPENAI_API_KEY');
if (!livePath) process.env.OPENAI_API_KEY = 'synthetic-dictation-key';
registerProviderSecrets(process.env);
const dir = mkdtempSync(join(tmpdir(), 'openag-dictation-')), token = 'dictation-fixture-owner';
const db = openDb(dir), auth = createAuth({ db, ownerToken: token }), ledger = createLedger(db), approvals = createApprovals(db, ledger);
createBot(db, { id: 'boss', name: 'Boss', runtime: 'api', model: 'openai/gpt-5' }); createRoom(db, { id: 'main', leadBotId: 'boss' }); addMember(db, 'main', 'boss');
createRoom(db, { id: 'second', leadBotId: 'boss' }); addMember(db, 'second', 'boss');
const limited = auth.createDevice('Limited').token;
let mode = 'ok', calls = 0, release, started;
const models = { openai: 'gpt-transcribe', ollama: 'lfm3-omni' };
const transport = async (url, init) => {
  if (String(url).endsWith('/api/show')) return Response.json({ capabilities: mode === 'no-audio' ? ['completion'] : ['completion', 'audio'] });
  const expectedProvider = init.body.get('model') === 'lfm3-omni' ? 'ollama' : 'openai';
  calls++; assert.equal(url, expectedProvider === 'openai' ? 'https://api.openai.com/v1/audio/transcriptions' : 'http://127.0.0.1:11434/v1/audio/transcriptions'); assert.equal(init.redirect, 'error');
  if (expectedProvider === 'ollama') { assert.equal(init.headers.authorization, undefined); assert.equal(init.body.get('file').type, 'audio/wav'); const wav = new DataView(await init.body.get('file').arrayBuffer()); assert.equal(wav.getUint16(22, true), 1); assert.equal(wav.getUint32(24, true), 16000); assert.equal(wav.getInt16(44, true), -32768); assert.equal(wav.getInt16(46, true), 0); assert.equal(wav.getInt16(48, true), 32767); }
  assert.equal(init.body.get('model'), models[expectedProvider]); assert.ok(init.body.get('file').size > 0);
  if (mode === 'hold') { started?.(); await new Promise(resolve => { release = resolve; }); }
  if (mode === 'transport') throw new Error('private transport details');
  if (mode === 'http') return new Response('private provider error', { status: 401 });
  if (mode === 'nested') return Response.json({ text: 'misleading success', error: { message: 'private error' } });
  if (mode === 'empty') return Response.json({ text: '' });
  if (mode === 'huge') return new Response('x'.repeat(70 * 1024));
  return Response.json({ text: 'Dictation acceptance sentence.' });
};
const modelEnv = { OPENAI_API_KEY: 'synthetic-model-key', OPENAG_OLLAMA_URL: 'http://127.0.0.1:1' };
const botModels = createBotModels({ db, ledger, env: modelEnv, acp: { async discover() { throw Error('Subscription discovery is outside this fixture'); }, async stopBot() {} }, withIdleBot: async (_id, fn) => fn(), fetch: async url => String(url) === capabilityUrl ? Response.json(capabilityFixture) : String(url).endsWith('/api/tags') ? Response.json({models:[{name:'lfm3-omni'}]}) : String(url).endsWith('/api/show') ? Response.json({capabilities:mode === 'no-audio' ? [] : ['audio']}) : Response.json({ data: [{ id: 'gpt-5' }, ...Object.keys(capabilityFixture.openai.models).filter(id=>id.includes('transcribe')).map(id=>({id}))] }) });
const app = createGateway({ botModels, modelEnv, db, auth, ledger, approvals, dispatch() {}, dataDir: dir, deskDir: root + 'apps/desk/dist', ...(livePath ? {} : { transcriptionFetch: transport }) });
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
const detach = attachStream(server, ledger, auth);
const url = 'http://127.0.0.1:' + server.address().port;
const req = (path, { method = 'GET', body, bearer = token, headers = {} } = {}) => fetch(url + path, { method, headers: { ...(bearer ? { authorization: 'Bearer ' + bearer } : {}), ...headers }, body });
const setting = { enabled: true, provider, model: models[provider] };
await botModels.catalogue.refresh();
const save = (value, bearer = token) => { let snapshotId; try { snapshotId=botModels.catalogue.read(value.provider, `${value.provider}/${value.model}`, 'transcription').snapshotId; } catch {} return req('/settings/dictation', { method: 'PUT', bearer, headers: { 'content-type': 'application/json' }, body: JSON.stringify({...value,...(snapshotId?{snapshotId}:{})}) }); };
const wav = Buffer.alloc(48); wav.write('RIFF'); wav.write('WAVE', 8);
const audio = (bytes = wav, bearer = token, target = `${setting.provider}/${setting.model}`, type = 'audio/wav') => req('/rooms/main/dictation', { method: 'POST', body: bytes, bearer, headers: { 'content-type': type, 'x-transcription-target': target } });
try {
  assert.equal((await req('/dictation', { bearer: '' })).status, 401);
  assert.equal((await audio()).status, 503);
  assert.equal((await save(setting, limited)).status, 403);
  assert.equal((await save({ ...setting, model: 'not-allowed' })).status, 409);
  assert.equal((await save(setting)).status, 200);
  assert.equal((await req('/dictation')).status, 200);
  if (livePath) {
    const result = await audio(readFileSync(livePath));
    const body = await result.json();
    assert.equal(result.status, 200, JSON.stringify(body));
    const normalize = text => text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    assert.equal(normalize(body.text), normalize('This is a dictation acceptance sentence. Please keep the existing draft.'));
    console.log(JSON.stringify({ liveTranscription: 'PASS', textMatched: true, provider, model: setting.model }));
  } else {
    assert.equal((await audio(wav, token, 'openai/stale')).status, 409);
    assert.equal((await audio(Buffer.from('invalid'))).status, 400);
    assert.equal((await audio(Buffer.alloc(8 * 1024 * 1024 + 1))).status, 413);
    assert.equal(calls, 0);
    for (let i = 0; i < 2; i++) { const r = await audio(wav, limited); assert.equal(r.status, 200); assert.equal((await r.json()).text, 'Dictation acceptance sentence.'); }
    for (mode of ['http', 'nested', 'empty', 'huge', 'transport']) { const before = calls; const r = await audio(); assert.equal(r.status, 502); assert.ok(!(await r.text()).includes('private')); assert.equal(calls, before + 1, 'No automatic retry'); }
    mode = 'hold'; const gate = new Promise(resolve => { started = resolve; }); const pending = audio(wav, limited); await gate;
    assert.equal((await audio(wav, limited)).status, 429);
    auth.revokeDevice(auth.listDevices().find(d => d.name === 'Limited').id); release(); assert.equal((await pending).status, 401);
    mode = 'ok';
    assert.equal((await save({ enabled: true, provider: 'ollama', model: 'gpt-transcribe' })).status, 409);
    const local = { enabled: true, provider: 'ollama', model: 'lfm3-omni' };
    assert.equal((await save(local)).status, 200); mode = 'no-audio'; await botModels.catalogue.refresh();
    assert.equal((await req('/dictation').then(r => r.json())).available, false);
    mode = 'ok'; await botModels.catalogue.refresh(); assert.equal((await req('/dictation').then(r => r.json())).available, true);
    assert.equal((await audio(Buffer.from([0x1a,0x45,0xdf,0xa3]), token, 'ollama/lfm3-omni', 'audio/webm')).status, 400);
    assert.equal((await save(setting)).status, 200);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE payload_json LIKE '%Dictation acceptance%'").get().n, 0);
    console.log(JSON.stringify({ controlledGateway: 'PASS', calls, checks: ['auth', 'owner-only settings', 'validation', 'stale target', 'size', 'second call', 'nested error', 'response cap', 'concurrency', 'revocation', 'no transcript ledger'] }));
  }
  if (!livePath && !process.argv.includes('--no-desk')) {
    const deskRequire = createRequire(root + 'apps/desk/package.json');
    const { JSDOM, VirtualConsole } = deskRequire('jsdom'), { WebSocket } = require('ws');
    const { readdirSync } = await import('node:fs');
    const assets = root + 'apps/desk/dist/assets/';
    const bundle = readFileSync(assets + readdirSync(assets).find(name => /^index-.*\.js$/.test(name)), 'utf8');
    const errors = [], vc = new VirtualConsole(); vc.on('jsdomError', e => { if (!e.message.includes('Not implemented')) errors.push(e.message); });
    const dom = new JSDOM('<div id="root"></div>', { url: url + '/#/room/main', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc }), w = dom.window;
    const sockets = new Set();
    w.WebSocket = class extends WebSocket { constructor(address) { super(address); sockets.add(this); this.on('error', () => {}); this.on('close', () => sockets.delete(this)); } };
    let loseResult = false, loseBody = false;
    w.fetch = async (path, options) => {
      const response = await fetch(new URL(path, url), options);
      if (loseBody && options?.method === 'POST' && path.endsWith('/dictation')) { await response.body?.cancel(); return new Response(new ReadableStream({ start(c) { c.error(new Error('Controlled interrupted body')); } }), { status: 200 }); }
      if (loseResult && options?.method === 'POST' && path.endsWith('/dictation')) { await response.body?.cancel(); throw new w.TypeError('Controlled lost transcription response'); }
      return response;
    };
    w.matchMedia = q => ({ matches: q.includes('min-width:1180'), media: q, addEventListener() {}, removeEventListener() {} });
    w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; w.IntersectionObserver = w.ResizeObserver;
    w.HTMLElement.prototype.scrollTo = function() {}; w.HTMLElement.prototype.scrollIntoView = function() {};
    Object.defineProperty(w, 'isSecureContext', { value: true }); w.Blob = Blob;
    let denied = false, permissionResolve, holdPermission = false, tracksStopped = 0;
    Object.defineProperty(w.navigator, 'mediaDevices', { value: { getUserMedia: async () => {
      if (denied) throw new w.Error('Microphone permission denied');
      const stream = { getTracks: () => [{ stop() { tracksStopped++; } }] };
      if (holdPermission) return new Promise(resolve => { permissionResolve = () => resolve(stream); });
      return stream;
    } } });
    w.MediaRecorder = class {
      static isTypeSupported() { return true; }
      state = 'inactive';
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2])]) }); this.onstop?.(); }); }
    };
    w.localStorage.setItem('openag-token', auth.createDevice('Desk acceptance').token); w.eval(bundle);
    const until = async (read, predicate, label) => { const end = Date.now() + 10000; do { const value = read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 20)); } while (Date.now() < end); throw Error('Desk acceptance deadline: ' + label); };
    const button = label => w.document.querySelector(`[aria-label="${label}"]`);
    const fill = text => { const area = w.document.querySelector('#composer-text'); Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(area, text); area.dispatchEvent(new w.Event('input', { bubbles: true })); };
    try {
      await until(() => button('Dictate message'), b => b && !b.disabled, 'composer ready');
      const area = () => w.document.querySelector('#composer-text');
      const dictationStatus = label => [...w.document.querySelectorAll('form [role="status"]')].filter(node => node.textContent === label);
      const assertEmptyPrompt = label => {
        assert.equal(area().placeholder, '');
        const prompt = w.document.querySelector('.dictation-prompt');
        assert.ok(prompt); assert.equal(prompt.textContent, label); assert.equal(prompt.getAttribute('aria-hidden'), 'true');
        assert.equal(dictationStatus(label).length, 1, 'one live dictation status');
        assert.ok(dictationStatus(label)[0].closest('[data-slot="input-group-addon"]')?.classList.contains('sr-only'), 'empty-draft status is screen-reader-only');
      };
      const attachmentInput = w.document.querySelector('[aria-label="Choose attachments"]');
      Object.defineProperty(attachmentInput, 'files', { configurable: true, value: [new File(['fixture'], 'dictation-note.txt', { type: 'text/plain' })] });
      attachmentInput.dispatchEvent(new w.Event('change', { bubbles: true }));
      await until(() => w.document.querySelector('[aria-label="Attachments"]'), Boolean, 'attachment ready');

      holdPermission = true; button('Dictate message').click();
      await until(() => dictationStatus('Starting microphone…').length, Boolean, 'starting prompt'); assertEmptyPrompt('Starting microphone…');
      await until(() => permissionResolve, resolve => typeof resolve === 'function', 'microphone permission request');
      permissionResolve(); holdPermission = false;
      await until(() => button('Stop dictation'), Boolean, 'recording'); assertEmptyPrompt('Recording…');
      mode = 'hold'; let gate = new Promise(resolve => { started = resolve; }); button('Stop dictation').click(); await gate;
      assertEmptyPrompt('Transcribing…');
      fill('Typed during transcription 0'); assert.equal(w.document.querySelector('.dictation-prompt'), null); assert.equal(dictationStatus('Transcribing…').length, 1); assert.ok(!dictationStatus('Transcribing…')[0].closest('[data-slot="input-group-addon"]')?.classList.contains('sr-only'), 'nonempty draft keeps compact status');
      fill(''); assertEmptyPrompt('Transcribing…');
      fill('Typed during transcription 0'); release(); mode = 'ok';
      await until(() => area().value, text => text === 'Typed during transcription 0 Dictation acceptance sentence.', 'draft insertion');
      await until(() => button('Dictate message'), b => b && !b.disabled, 'ready after empty prompt');
      assert.ok(w.document.querySelector('[aria-label="Attachments"]'), 'attachment is preserved through dictation');

      fill(''); button('Dictate message').click(); await until(() => button('Stop dictation'), Boolean, 'empty transcript recording'); button('Stop dictation').click();
      await until(() => area().value, text => text === 'Dictation acceptance sentence.', 'empty-to-filled transcript insertion');
      await until(() => button('Dictate message'), b => b && !b.disabled, 'ready after empty transcript');
      fill('Existing draft');
      for (let i = 0; i < 2; i++) {
        button('Dictate message').click(); await until(() => button('Stop dictation'), Boolean, 'recording');
        assert.equal(button('Send').disabled, true);
        mode = 'hold'; gate = new Promise(resolve => { started = resolve; }); button('Stop dictation').click(); await gate;
        fill('Typed during transcription ' + i); release(); mode = 'ok';
        await until(() => w.document.querySelector('#composer-text').value, text => text === `Typed during transcription ${i} Dictation acceptance sentence.`, 'draft insertion');
        await until(() => button('Dictate message'), b => b && !b.disabled, 'ready again');
      }
      fill(''); const beforeCancel = w.document.querySelector('#composer-text').value;
      button('Dictate message').click(); await until(() => button('Stop dictation'), Boolean, 'cancel recording'); button('Cancel dictation').click();
      await until(() => button('Dictate message'), Boolean, 'cancel returned'); assert.equal(w.document.querySelector('#composer-text').value, beforeCancel); assert.equal(area().placeholder, 'Message Boss…');
      denied = true; button('Dictate message').click(); await until(() => w.document.body.textContent, text => text.includes('Microphone permission denied'), 'denied permission'); denied = false; assert.equal(area().placeholder, 'Message Boss…');
      permissionResolve = undefined; holdPermission = true; button('Dictate message').click(); await until(() => permissionResolve, Boolean, 'pending permission'); button('Cancel dictation').click(); const stopped = tracksStopped; permissionResolve();
      await until(() => tracksStopped, n => n > stopped, 'late microphone release'); holdPermission = false;
      button('Dictate message').click(); await until(() => button('Stop dictation'), Boolean, 'cancel pending');
      mode = 'hold'; gate = new Promise(resolve => { started = resolve; }); button('Stop dictation').click(); await gate;
      button('Cancel dictation').click(); release(); mode = 'ok';
      await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(w.document.querySelector('#composer-text').value, beforeCancel);
      await until(() => button('Dictate message'), b => b && !b.disabled, 'local ready');
      fill('Existing draft'); const beforeLocal = area().value;
      await save({ enabled: true, provider: 'ollama', model: 'lfm3-omni' });
      w.OfflineAudioContext = class { async decodeAudioData() { return { length: 3, duration: 3 / 16000, numberOfChannels: 1, getChannelData: () => new Float32Array([-1, 0, 1]) }; } };
      button('Dictate message').click(); await until(() => button('Stop dictation'), Boolean, 'local recording'); button('Stop dictation').click();
      await until(() => w.document.querySelector('#composer-text').value, text => text === beforeLocal + ' Dictation acceptance sentence.', 'WAV transcript');
      await until(() => button('Dictate message'), Boolean, 'local settled');
      await save(setting);
      const beforeLost = calls, lostDraft = w.document.querySelector('#composer-text').value; loseResult = true;
      button('Dictate message').click(); await until(() => button('Stop dictation'), Boolean, 'lost response recording'); button('Stop dictation').click();
      await until(() => w.document.body.textContent, text => text.includes('Transcription is unconfirmed.'), 'uncertain transport reporting');
      assert.equal(w.document.querySelector('#composer-text').value, lostDraft); assert.equal(calls, beforeLost + 1); loseResult = false;
      await until(() => button('Dictate message'), b => b && !b.disabled, 'body-loss ready'); loseBody = true;
      const beforeBody = calls;
      button('Dictate message').click(); await until(() => button('Stop dictation'), Boolean, 'body-loss recording'); button('Stop dictation').click();
      await until(() => w.document.body.textContent, text => text.includes('Transcription is unconfirmed.'), 'body-loss uncertainty');
      assert.equal(w.document.querySelector('#composer-text').value, lostDraft); assert.equal(calls, beforeBody + 1); loseBody = false;
      assert.equal(errors.length, 0, errors.join('\n'));
      console.log(JSON.stringify({ controlledDesk: 'PASS', checks: ['empty starting/recording/transcribing prompts', 'one live dictation status', 'ordinary placeholder hidden for empty active capture', 'existing draft and attachment preservation', 'typing/clearing during transcription', 'empty-to-filled transcript insertion', 'second dictation', 'Send blocked', 'cancel/error prompt restoration', 'late permission release', 'cancel pending result', 'local audio capability', 'PCM16 WAV conversion', 'lost response uncertainty/no replay'], tracksStopped }));
    } finally { dom.window.close(); for (const socket of sockets) socket.terminate(); }
  }
  if (process.argv.includes('--serve')) {
    console.log(JSON.stringify({ url, token, previewToken: auth.createDevice("Preview").token, dataDir: dir }));
    await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
  }
} finally { detach(); server.closeAllConnections(); server.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
