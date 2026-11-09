// OA-346 public gateway/storage acceptance with owned temporary data; no inference or unit runner.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb } from '../apps/daemon/dist/db/index.js';
import { createLedger } from '../apps/daemon/dist/ledger.js';
import { createAuth } from '../apps/daemon/dist/auth.js';
import { createApprovals } from '../apps/daemon/dist/approvals.js';
import { createGateway } from '../apps/daemon/dist/gateway.js';
import { createBot, getRoom } from '../apps/daemon/dist/rooms.js';
import { getDefaultRedactor } from '../apps/daemon/dist/redact.js';
const dir = mkdtempSync(join(tmpdir(), 'openag-new-room-')), token = 'controlled-room-owner';
let db = openDb(dir), ledger, app, observed;
function setup() {
  ledger = createLedger(db); observed = [];
  ledger.subscribe('*', event => observed.push(event));
  app = createGateway({ db, ledger, auth: createAuth({ db, ownerToken: token }), approvals: createApprovals(db, ledger), dispatch: () => { throw Error('Creation must not dispatch'); }, deskDir: join(dir, 'absent') });
}
setup();
const call = (path, method = 'GET', body, credential = token) => app.request(path, { method, headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const draft = overrides => { const requestId = randomUUID(); return { requestId, id: `room-${requestId}`, name: 'Planning 计划 / café', members: ['coder', 'researcher'], lead: 'researcher', kind: 'room', ...overrides }; };
try {
  for (const id of ['coder', 'researcher']) createBot(db, { id, name: 'Same name', runtime: 'api' });
  const input = draft();
  const response = await call('/rooms', 'POST', input); assert.equal(response.status, 201, await response.clone().text());
  const created = (await response.json()).room;
  assert.equal(created.name, input.name); assert.equal(created.leadBotId, 'researcher'); assert.deepEqual(created.members, ['coder', 'researcher']); assert.equal(created.kind, 'room');
  const receiptPath = `/rooms/creation/requests/${input.requestId}`;
  assert.equal((await call(receiptPath)).headers.get('cache-control'), 'no-store');
  assert.equal((await (await call(receiptPath)).json()).room.id, created.id);
  assert.equal((await call('/rooms', 'POST', input)).status, 200);
  assert.equal((await call('/rooms', 'POST', { ...input, members: [...input.members].reverse() })).status, 200, 'membership is a set');
  for (const change of [{ name: 'Different' }, { lead: 'coder' }, { id: 'different-id' }]) assert.equal((await call('/rooms', 'POST', { ...input, ...change })).status, 409);
  assert.equal((await call('/rooms', 'POST', draft({ id: input.id }))).status, 409, 'unrelated duplicate id refused');
  const separate = await call('/rooms', 'POST', draft()); assert.equal(separate.status, 201); assert.notEqual((await separate.json()).room.id, created.id, 'same name and members do not mean same room');
  const concurrentInput = draft();
  const races = await Promise.all(Array.from({ length: 8 }, () => call('/rooms', 'POST', concurrentInput)));
  assert.equal(races.filter(r => r.status === 201).length, 1);
  assert.ok(races.every(r => [200, 201].includes(r.status)));
  for (const r of races) assert.equal((await r.json()).room.id, concurrentInput.id);
  assert.equal(observed.filter(e => e.payload?.roomId === concurrentInput.id).length, 1);
  const unchanged = Object.fromEntries(['rooms', 'room_members', 'room_creations', 'events'].map(t => [t, db.prepare(`SELECT count(*) n FROM ${t}`).get().n]));
  for (const change of [{ id: '_hidden' }, { id: 'bad/id' }, { id: 'x'.repeat(65) }, { members: [] }, { members: ['missing'] }, { members: ['coder', 'coder'] }, { lead: 'missing' }, { lead: 'owner' }, { lead: null }, { name: ' ' }, { name: 'x'.repeat(81) }, { name: 'bad\nname' }, { requestId: 'not-uuid' }, { unknown: true }, { members: Array(51).fill('coder') }]) {
    const r = await call('/rooms', 'POST', draft(change)); assert.equal(r.status, 400, JSON.stringify(change));
  }
  for (const [table, count] of Object.entries(unchanged)) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, count, 'validation changes nothing');
  assert.equal((await call('/rooms/creation/requests/not-uuid')).status, 400);
  assert.equal((await (await call(`/rooms/creation/requests/${randomUUID()}`)).json()).room, null);
  const device = async access => { const r = await (await call('/devices', 'POST', { name: access, access })).json(); return r.token; };
  const limited = await device('limited'), full = await device('full');
  assert.equal((await call('/rooms', 'POST', draft(), limited)).status, 403);
  assert.equal((await call(receiptPath, 'GET', undefined, limited)).status, 403);
  assert.equal((await call(receiptPath, 'GET', undefined, full)).status, 200);
  assert.equal((await call('/rooms', 'POST', draft(), full)).status, 201);
  assert.equal((await call(receiptPath, 'GET', undefined, 'invalid')).status, 401);
  const legacy = { id: 'legacy', name: 'Legacy', members: ['researcher', 'coder'] };
  assert.equal((await call('/rooms', 'POST', legacy)).status, 201); assert.equal(getRoom(db, 'legacy').leadBotId, 'researcher');
  assert.equal((await call('/rooms', 'POST', legacy)).status, 409);
  const solo = draft({ members: ['coder'], lead: 'coder' }); assert.equal((await call('/rooms', 'POST', solo)).status, 201);
  const direct = { id: 'chat-' + 'a'.repeat(32), name: 'Same name', members: ['coder'], kind: 'direct' };
  const directRoom = (await (await call('/rooms', 'POST', direct)).json()).room;
  const reused = (await (await call('/rooms', 'POST', { ...direct, id: 'chat-' + 'b'.repeat(32) })).json()).room;
  assert.equal(directRoom.id, reused.id); assert.notEqual(directRoom.id, solo.id); assert.equal(getRoom(db, solo.id).kind, 'room');
  const secret = 'controlled-room-secret-123456789'; getDefaultRedactor().addSecret(secret);
  const redacted = (await (await call('/rooms', 'POST', draft({ name: secret }))).json()).room; assert.ok(!JSON.stringify(redacted).includes(secret));
  const failed = draft(), beforeEvents = observed.length;
  db.exec("CREATE TRIGGER reject_room_receipt BEFORE INSERT ON room_creations BEGIN SELECT RAISE(ABORT, 'controlled receipt failure'); END");
  const failedResponse = await call('/rooms', 'POST', failed); assert.equal(failedResponse.status, 500);
  assert.equal(getRoom(db, failed.id), undefined); assert.equal(observed.length, beforeEvents); assert.equal((await (await call(`/rooms/creation/requests/${failed.requestId}`)).json()).room, null);
  db.exec('DROP TRIGGER reject_room_receipt');
  for (const table of ['turns', 'work']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM settings WHERE key IN ('defaultBot','deliveryRoom')").get().n, 0);
  // Simulate a lost creation response by discarding the successful response, then recover only through the receipt.
  const lost = draft(); await call('/rooms', 'POST', lost);
  db.close(); db = openDb(dir); setup();
  assert.equal((await (await call(`/rooms/creation/requests/${lost.requestId}`)).json()).room.id, lost.id);
  assert.equal((await call('/rooms', 'POST', lost)).status, 200);
  assert.equal(getRoom(db, input.id).leadBotId, 'researcher');
  console.log('PASS: named room/lead/members, duplicate names, exact receipts/replay/conflicts/concurrency, strict validation, access, redaction, rollback/publication, direct reuse and restart; zero turns/Work/delivery changes.');
} finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
