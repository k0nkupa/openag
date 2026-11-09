// Controlled gateway acceptance against disposable data. No unit runner or provider calls.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const load = name => import(`../apps/daemon/dist/${name}.js`);
const { openDb } = await load('db/index');
const { createLedger } = await load('ledger');
const { createApprovals } = await load('approvals');
const { createAuth } = await load('auth');
const { createGateway } = await load('gateway');
const { getDefaultRedactor } = await load('redact');
const { createBot, createRoom, addMember } = await load('rooms');
const dir = mkdtempSync(join(tmpdir(), 'openag-profile-'));
let db;
try {
  db = openDb(dir);
  const ledger = createLedger(db), approvals = createApprovals(db, ledger);
  const auth = createAuth({ db, ownerToken: 'controlled-profile-owner' });
  const full = auth.createDevice('Full device', 'owner', 'full');
  const limited = auth.createDevice('Limited device', 'owner', 'limited');
  createBot(db, { id: 'bot', name: 'Bot', runtime: 'api' });
  createRoom(db, { id: 'main', leadBotId: 'bot' });
  addMember(db, 'main', 'bot');
  ledger.append('main', 'user', 'message', { text: 'Existing message' });
  const app = createGateway({ db, ledger, approvals, auth, dataDir: dir, dispatch() {} });
  const api = (path, method = 'GET', body, token = full.token) => app.request(path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const profile = async token => (await (await api('/settings', 'GET', undefined, token)).json()).settings.profile;
  assert.deepEqual(await profile(), { name: 'You', avatar: null });
  assert.equal((await app.request('/settings')).status, 401);
  const jpeg = readFileSync(new URL('./fixtures/profile-image.jpg', import.meta.url));
  const image = 'data:image/jpeg;base64,' + jpeg.toString('base64');
  const next = { name: '  Alex  ', avatar: image };
  assert.equal((await api('/settings/profile', 'PUT', next, limited.token)).status, 403);
  assert.deepEqual(await profile(), { name: 'You', avatar: null });
  const saved = await api('/settings/profile', 'PUT', next);
  assert.equal(saved.status, 200);
  const expected = { ...next, name: 'Alex' };
  assert.deepEqual((await saved.json()).value, expected);
  assert.deepEqual(await profile(limited.token), expected);
  for (const bad of [null, [], { name: '' }, { name: '  ' }, { name: 'x'.repeat(41) },
    { name: 'A\nB' }, { name: 'A\u202eB' }, { name: 42 }, { name: 'Alex', extra: true },
    { name: 'Alex', avatar: {} }, { name: 'Alex', avatar: [] },
    { name: 'Alex', avatar: { shape: 'constructor', color: null } },
    { name: 'Alex', avatar: { shape: 'robot', color: 'invalid' } },
    { name: 'Alex', avatar: { shape: 'robot', color: null, animated: 'true' } },
    { name: 'Alex', avatar: { shape: 'custom:00000000-0000-0000-0000-000000000000', color: null } },
  ]) {
    assert.equal((await api('/settings/profile', 'PUT', bad)).status, 400, JSON.stringify(bad));
    assert.deepEqual(await profile(), expected, 'Invalid writes must preserve the saved profile');
  }
  const malformed = ['https://example.com/avatar.jpg', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/jpeg;base64,AAAA', image.slice(0, -4), 'data:image/jpeg;base64,' + Buffer.alloc(65537).toString('base64')];
  const wrongSize = Buffer.from(jpeg), marker = wrongSize.indexOf(Buffer.from([255, 192]));
  assert.ok(marker > 0); wrongSize.writeUInt16BE(4096, marker + 5);
  malformed.push('data:image/jpeg;base64,' + wrongSize.toString('base64'));
  for (const avatar of malformed) {
    assert.equal((await api('/settings/profile', 'PUT', { name: 'Alex', avatar })).status, 400);
    assert.deepEqual(await profile(), expected);
  }
  const secret = 'controlled-profile-secret-12345';
  getDefaultRedactor().addSecret(secret);
  assert.equal((await api('/settings/profile', 'PUT', { name: secret, avatar: null })).status, 400);
  assert.deepEqual(await profile(), expected);
  const audit = db.prepare("SELECT payload_json FROM events WHERE type = 'config'").all();
  assert.ok(audit.length);
  for (const row of audit) { assert.ok(!row.payload_json.includes('Alex')); assert.ok(!row.payload_json.includes(secret)); assert.ok(!row.payload_json.includes(image)); }
  assert.equal(db.prepare("SELECT actor FROM events WHERE room_id = 'main' AND type = 'message'").get().actor, 'user');
  assert.equal(auth.listDevices().find(device => device.id === full.device.id).name, 'Full device');
  db.close(); db = openDb(dir);
  const { getSetting } = await load('settings');
  assert.deepEqual(getSetting(db, 'profile'), expected, 'Saved profile must survive reopening the database');
  const { setSetting } = await load('settings');
  assert.deepEqual(setSetting(db, 'profile', { name: 'You', avatar: null }), { name: 'You', avatar: null });
  db.prepare("UPDATE settings SET value_json=? WHERE key='profile'").run(JSON.stringify({ name: 'Legacy name', avatar: { shape: 'robot', color: 'teal' } }));
  assert.deepEqual(getSetting(db, 'profile'), { name: 'Legacy name', avatar: null }, 'Legacy bot avatar must fall back to initials without losing the name');
  const { cropImage, openProfileImage, PROFILE_UPLOAD_MAX } = await import('../apps/desk/src/profile-image.ts');
  assert.deepEqual(cropImage(600, 400, 1, 0.5, 0.5), { left: 100, top: 0, size: 400 });
  assert.deepEqual(cropImage(400, 600, 2, 1, 1), { left: 200, top: 400, size: 200 });
  assert.deepEqual(cropImage(256, 256, 1, 0, 0), { left: 0, top: 0, size: 256 });
  await assert.rejects(openProfileImage(new File([new Uint8Array(PROFILE_UPLOAD_MAX + 1)], 'large.jpg', { type: 'image/jpeg' })), /5 MiB/);
  await assert.rejects(openProfileImage(new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' })), /JPG, PNG or WebP/);
  await assert.rejects(openProfileImage(new File(['<svg/>'], 'fake.png', { type: 'image/png' })), /not a valid/);
  console.log('ok profile gateway: defaults, Full/Limited access, save/readback, invalid input, secret refusal, private audit, preserved actors/devices, restart/reset, cropped JPEG bounds, original-file rejection, crop geometry and legacy name preservation');
} finally {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
}
