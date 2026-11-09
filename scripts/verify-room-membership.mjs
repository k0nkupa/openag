// OA-452: temporary gateway/storage acceptance, no model or unit runner.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../apps/daemon/dist/db/index.js';
import { createLedger } from '../apps/daemon/dist/ledger.js';
import { createAuth } from '../apps/daemon/dist/auth.js';
import { createApprovals } from '../apps/daemon/dist/approvals.js';
import { createGateway } from '../apps/daemon/dist/gateway.js';
import { createBot, createRoom, addMember, getRoom } from '../apps/daemon/dist/rooms.js';
const dir = mkdtempSync(join(tmpdir(), 'openag-members-')), token = 'controlled-members-owner';
let db = openDb(dir);
function setup() {
  const ledger = createLedger(db);
  return createGateway({ db, ledger, auth: createAuth({ db, ownerToken: token }), approvals: createApprovals(db, ledger), dispatch() { throw Error('Membership must not dispatch'); }, deskDir: join(dir, 'absent') });
}
let app = setup();
const call = (path, method = 'GET', body, credential = token) => app.request(path, { method, headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const patch = (body, credential = token, id = 'team') => call(`/rooms/${id}`, 'PATCH', body, credential);
try {
  for (const id of ['lead', 'coder', 'reviewer', ...Array.from({ length: 50 }, (_, i) => `extra-${i}`)]) createBot(db, { id, runtime: 'api' });
  for (const id of ['team', '_system', '_hidden', 'direct', 'rollback', 'capacity']) { createRoom(db, { id, leadBotId: 'lead', kind: id === 'direct' ? 'direct' : 'room' }); addMember(db, id, 'lead'); }
  const device = async access => (await (await call('/devices', 'POST', { name: access, access })).json()).token;
  const full = await device('full'), limited = await device('limited');
  assert.equal((await patch({ addMembers: ['coder'] }, limited)).status, 403);
  assert.equal((await patch({ addMembers: ['coder'] }, '')).status, 401);
  assert.deepEqual(getRoom(db, 'team').members, ['lead']);
  const saved = await patch({ addMembers: ['coder'] }, full); assert.equal(saved.status, 200, await saved.clone().text());
  assert.deepEqual((await saved.json()).room.members, ['coder', 'lead']);
  assert.equal(getRoom(db, 'team').leadBotId, 'lead');
  assert.equal((await patch({ addMembers: ['coder'] })).status, 200, 'idempotent addition');
  assert.deepEqual(getRoom(db, 'team').members, ['coder', 'lead']);
  const races = await Promise.all([patch({ addMembers: ['reviewer'] }), patch({ addMembers: ['extra-0'] })]);
  assert.ok(races.every(r => r.status === 200));
  assert.deepEqual(getRoom(db, 'team').members, ['coder', 'extra-0', 'lead', 'reviewer']);
  const before = JSON.stringify(getRoom(db, 'team'));
  for (const body of [{ addMembers: [] }, { addMembers: ['missing'] }, { addMembers: ['coder', 'coder'] }, { addMembers: ['reviewer', 'missing'], name: 'Must not save' }, { addMembers: Array(51).fill('coder') }, { members: ['coder'] }, { addMembers: [null] }, { addMembers: ['constructor'] }]) assert.equal((await patch(body)).status, 400, JSON.stringify(body));
  assert.equal(JSON.stringify(getRoom(db, 'team')), before);
  for (const [id, status] of [['direct', 400], ['_hidden', 404], ['absent', 404]]) assert.equal((await patch({ addMembers: ['coder'] }, token, id)).status, status);
  assert.deepEqual(getRoom(db, 'direct').members, ['lead']);
  assert.equal((await patch({ name: 'New name', description: 'Details', leadBotId: 'coder' })).status, 200, 'legacy details still supported');
  assert.equal(getRoom(db, 'team').leadBotId, 'coder');
  db.exec("CREATE TRIGGER reject_member BEFORE INSERT ON room_members WHEN NEW.room_id = 'rollback' BEGIN SELECT RAISE(ABORT, 'controlled failure'); END");
  const eventsBefore = db.prepare('SELECT count(*) n FROM events').get().n;
  assert.equal((await patch({ addMembers: ['coder'], name: 'Must roll back' }, token, 'rollback')).status, 500);
  assert.deepEqual(getRoom(db, 'rollback').members, ['lead']); assert.equal(getRoom(db, 'rollback').name, 'rollback');
  assert.equal(db.prepare('SELECT count(*) n FROM events').get().n, eventsBefore);
  db.exec('DROP TRIGGER reject_member');
  const extras = Array.from({ length: 49 }, (_, i) => `extra-${i}`);
  assert.equal((await patch({ addMembers: extras }, token, 'capacity')).status, 200);
  assert.equal((await patch({ addMembers: ['extra-49'] }, token, 'capacity')).status, 400);
  assert.equal(getRoom(db, 'capacity').members.length, 50);
  const events = (await (await call('/rooms/_system/events')).json()).events;
  assert.ok(events.some(e => e.payload?.action === 'room_updated' && e.payload.changed.includes('members') && e.payload.addedMembers.includes('coder')));
  for (const table of ['turns', 'work']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  db.close(); db = openDb(dir); app = setup();
  const readback = (await (await call('/rooms/team')).json());
  assert.deepEqual(readback.room.members, ['coder', 'extra-0', 'lead', 'reviewer']); assert.equal(readback.room.leadBotId, 'coder');
  assert.deepEqual(readback.bots.map(bot => bot.id).sort(), readback.room.members);
  console.log('PASS: owner/Full/limited access, additive/repeated/concurrent writes, validation, direct/hidden exclusions, 50-agent cap, atomic rollback/audit, legacy details, restart/readback; zero turns/Work.');
} finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
