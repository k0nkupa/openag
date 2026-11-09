// OA-344 standalone acceptance: conversation kind, backfill, delivery destination, no implicit `main`.
// Temporary data dirs only; real daemon modules from apps/daemon/dist (run `pnpm -r build` first); no model, no adapter, no network.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from '../node_modules/.pnpm/node_modules/better-sqlite3/lib/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const load = (p) => import(root + 'apps/daemon/dist/' + p + '.js');
const { openDb, MIGRATIONS_DIR } = await load('db/index'), { migrate } = await load('db/migrate');
const { createLedger } = await load('ledger'), { createAuth } = await load('auth'), { createApprovals } = await load('approvals');
const { createGateway } = await load('gateway'), rooms = await load('rooms');
const { ensureDefaultBot } = await load('defaultbot'), { resolveDeliveryRoom, deliveryStatus } = await load('delivery');
const { ensureDirectChat } = await load('roomcreation'), { setSetting, getSetting } = await load('settings');
const { createWakeFilter } = await load('wake'), { deliverBrief } = await load('brief'), { createReadiness } = await load('readiness');
const { registerReflection } = await load('reflection'), { createScheduler } = await load('scheduler'), { createRunner } = await load('runtimes/runner');
const { defaultTools } = await load('runtimes/tools'), { ensureMemoryFile } = await load('memory');

const dirs = [];
const tmp = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; };
const fresh = () => { const dir = tmp('openag-conv-'); const db = openDb(dir); return { dir, db, ledger: createLedger(db) }; };
const claude = (pkg) => pkg.includes('claude');
const count = (db, sql, ...args) => db.prepare(sql).get(...args).n;
const ok = (name) => console.log('ok  ' + name);
const visible = (db) => rooms.listRooms(db).filter((r) => !r.id.startsWith('_'));
const PING = JSON.stringify({ verdict: 'ping', urgency: 'high', dedupe_key: 'k1', reason: 'build is red' });

try {
  // A. Migration 021 backfill on legacy-shaped data (schema 20 first, then the full migration set).
  {
    const old = tmp('openag-conv-migs-');
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f < '021')) cpSync(join(MIGRATIONS_DIR, f), join(old, f));
    const dir = tmp('openag-conv-legacy-'); mkdirSync(dir, { recursive: true });
    const raw = new Database(join(dir, 'openag.db')); raw.pragma('foreign_keys = ON');
    migrate(raw, old);
    const bot = (id) => raw.prepare("INSERT INTO bots (id,name,runtime,model,config_json,created_at) VALUES (?,?,'acp','claude-code','{}',1)").run(id, id);
    for (const id of ['boss', 'coder', 'solo']) bot(id);
    const room = (id, name, lead) => raw.prepare('INSERT INTO rooms (id,name,lead_bot_id,created_at) VALUES (?,?,?,1)').run(id, name, lead);
    const member = (r, b) => raw.prepare('INSERT INTO room_members (room_id,bot_id) VALUES (?,?)').run(r, b);
    const hex = (c) => 'chat-' + c.repeat(32);
    room('main', 'main', 'boss'); member('main', 'boss'); member('main', 'coder');
    room(hex('a'), 'boss', 'boss'); member(hex('a'), 'boss');                      // desk direct chat -> direct
    room('notes', 'Notes', 'solo'); member('notes', 'solo');                        // user-named one-bot room -> room
    room('chat-not-hex', 'x', 'solo'); member('chat-not-hex', 'solo');               // wrong id shape -> room
    room(hex('b'), 'two', 'boss'); member(hex('b'), 'boss'); member(hex('b'), 'coder'); // two members -> room
    room(hex('c'), 'lead-mismatch', 'coder'); member(hex('c'), 'boss');              // lead is not the member -> room
    room('_heartbeat', 'heartbeat', 'boss'); member('_heartbeat', 'boss');           // hidden -> room
    assert.equal(raw.prepare('SELECT MAX(version) v FROM schema_version').get().v, 20);
    const before = { rooms: raw.prepare('SELECT COUNT(*) n FROM rooms').get().n, members: raw.prepare('SELECT COUNT(*) n FROM room_members').get().n };
    raw.close();
    const db = openDb(dir);
    const kinds = Object.fromEntries(db.prepare('SELECT id,kind FROM rooms').all().map((r) => [r.id, r.kind]));
    assert.deepEqual(kinds, { main: 'room', [hex('a')]: 'direct', notes: 'room', 'chat-not-hex': 'room', [hex('b')]: 'room', [hex('c')]: 'room', _heartbeat: 'room' });
    assert.equal(db.prepare('SELECT MAX(version) v FROM schema_version').get().v, Math.max(...readdirSync(MIGRATIONS_DIR).filter(f => /^\d+_.*\.sql$/.test(f)).map(f => Number(f.split('_')[0]))));
    assert.deepEqual(getSetting(db, 'deliveryRoom'), { roomId: 'main' }, 'existing installs keep main as the destination');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM rooms'), before.rooms, 'no room added or removed');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM room_members'), before.members, 'no membership changed');
    db.close();
    // A fresh database (no main) gets NO delivery setting.
    const f = fresh();
    assert.deepEqual(getSetting(f.db, 'deliveryRoom'), { roomId: null });
    assert.equal(count(f.db, "SELECT COUNT(*) AS n FROM settings WHERE key='deliveryRoom'"), 0);
    f.db.close();
    ok('migration: conservative backfill, delivery kept on main only where main exists, nothing added/removed');
  }

  // B. Fresh install: default bot only; zero rooms; the chat is created on first delivery; no `main` ever.
  {
    const { dir, db, ledger } = fresh();
    ensureDefaultBot(db, ledger, claude);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM rooms'), 0, 'zero rooms after startup');
    assert.deepEqual(deliveryStatus(db), { state: 'ok', roomId: null, via: 'default_bot' });
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM rooms'), 0, 'reading status creates nothing');
    const id = resolveDeliveryRoom(db, ledger);
    assert.match(id, /^chat-[0-9a-f]{32}$/);
    const chat = rooms.getRoom(db, id);
    assert.deepEqual([chat.kind, chat.members, chat.leadBotId, chat.name], ['direct', ['bot'], 'bot', 'Bot']);
    assert.equal(resolveDeliveryRoom(db, ledger), id, 'reused, not recreated');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM turns'), 0, 'no turn');
    db.close();
    const again = openDb(dir);
    assert.equal(rooms.getRoom(again, 'main'), undefined, 'no main after a restart');
    assert.equal(visible(again).length, 1);
    again.close();
    ok('fresh install: zero rooms, chat created once on demand (kind direct), no implicit main after restart');
  }

  // C. Wake pings: default chat, override, set-but-missing room.
  {
    const { db, ledger } = fresh();
    ensureDefaultBot(db, ledger, claude);
    const pinged = [];
    const wake = createWakeFilter({ db, ledger, tz: 'UTC', now: () => new Date('2026-10-27T09:00:00Z'), onPing: (n) => pinged.push(n) });
    let d = wake.process({ source: 'heartbeat', botId: 'bot', turnId: null, text: PING });
    assert.equal(d.decision, 'ping');
    const chatId = visible(db)[0].id;
    assert.equal(d.delivered.roomId, chatId, 'the decision reports where the ping was written');
    assert.equal(d.delivered.eventId, ledger.list(chatId).find((e) => e.type === 'message').id);
    const msgs = ledger.list(chatId).filter((e) => e.type === 'message');
    assert.equal(msgs.length, 1); assert.equal(msgs[0].actor, 'primary'); assert.match(msgs[0].payload.text, /^Heads-up from bot: build is red$/); assert.equal(msgs[0].payload.wake, true);
    assert.equal(pinged.length, 1, 'push fires for a delivered ping');
    // override to a named room
    rooms.createRoom(db, { id: 'ops', name: 'Ops', leadBotId: 'bot' }); rooms.addMember(db, 'ops', 'bot');
    setSetting(db, 'deliveryRoom', { roomId: 'ops' });
    d = wake.process({ source: 'heartbeat', botId: 'bot', turnId: null, text: PING.replace('k1', 'k2') });
    assert.equal(d.decision, 'ping');
    assert.equal(d.delivered.roomId, 'ops');
    assert.equal(ledger.list('ops').filter((e) => e.type === 'message').length, 1, 'delivered to the chosen room');
    assert.equal(ledger.list(chatId).filter((e) => e.type === 'message').length, 1, 'not the default chat');
    // set but gone: nothing is written anywhere, the ping is kept as a digest item
    setSetting(db, 'deliveryRoom', { roomId: 'gone' });
    const rowsBefore = count(db, 'SELECT COUNT(*) AS n FROM rooms');
    d = wake.process({ source: 'heartbeat', botId: 'bot', turnId: null, text: PING.replace('k1', 'k3') });
    assert.deepEqual([d.decision, d.suppressedBy], ['digest', 'no_destination']);
    assert.equal(d.delivered, null);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM digest_items WHERE delivered_at IS NULL'), 1);
    assert.equal(pinged.length, 2, 'no push for an undeliverable ping');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM rooms'), rowsBefore, 'no room created for a missing destination');
    assert.equal(rooms.getRoom(db, 'gone'), undefined);
    db.close();
    ok('wake: default chat, override, missing room -> digest no_destination, no push, no room created');
  }

  // D. Brief: delivers to the destination; with none it consumes nothing and retries.
  {
    const { db, ledger } = fresh();
    ensureDefaultBot(db, ledger, claude);
    db.prepare("INSERT INTO digest_items (ts,bot_id,text,dedupe_key,decision_id) VALUES (1,'bot','overnight note','k',0)").run();
    const NOW = new Date('2026-10-27T07:35:00Z');
    setSetting(db, 'deliveryRoom', { roomId: 'gone' });
    const blocked = deliverBrief({ db, ledger, now: NOW, tz: 'UTC' });
    assert.deepEqual(blocked, { sent: false, reason: 'no_destination' });
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM digest_items WHERE delivered_at IS NULL'), 1, 'digest untouched');
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM settings WHERE key='briefState'"), 0, 'briefState untouched');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM rooms'), 0);
    setSetting(db, 'deliveryRoom', { roomId: null });
    assert.deepEqual(deliverBrief({ db, ledger, now: NOW, tz: 'UTC' }), { sent: true });
    const chat = visible(db)[0];
    assert.equal(chat.kind, 'direct');
    const brief = ledger.list(chat.id).filter((e) => e.type === 'message');
    assert.equal(brief.length, 1); assert.equal(brief[0].payload.brief, true); assert.match(brief[0].payload.text, /overnight note/);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM digest_items WHERE delivered_at IS NULL'), 0);
    assert.deepEqual(deliverBrief({ db, ledger, now: NOW, tz: 'UTC' }), { sent: false, reason: 'already_sent' });
    db.close();
    ok('brief: no_destination consumes nothing and retries; delivered once to the default chat');
  }

  // E. Reflection approvals go where the owner is notified; with nowhere to deliver they stay in _reflection.
  {
    const NOW = new Date('2026-10-28T04:00:00Z');
    const run = async (setup) => {
      const { dir, db, ledger } = fresh();
      ensureDefaultBot(db, ledger, claude); ensureMemoryFile(dir, { id: 'bot', name: 'Bot' });
      setup(db);
      const fake = { async runTurn(ctx) { ctx.ledger.append(ctx.room.id, ctx.bot.id, 'bot_output', { text: JSON.stringify({ proposals: [{ kind: 'memory_append', text: 'Prefers short answers.' }] }) }); } };
      const approvals = createApprovals(db, ledger);
      const runner = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { api: fake, acp: fake }, tools: defaultTools });
      const reflection = registerReflection({ db, ledger, approvals, runner, scheduler: createScheduler({ now: () => NOW }), tz: 'UTC', dataDir: dir, now: () => NOW });
      const result = await reflection.runNow(true); await reflection.idle();
      const rows = db.prepare('SELECT room_id FROM approvals').all().map((r) => r.room_id);
      const chat = visible(db)[0]?.id;
      db.close();
      return { result, rows, chat };
    };
    let r = await run(() => {});
    assert.equal(r.result.started, true); assert.deepEqual(r.rows, [r.chat], 'proposal approval is in the default bot chat');
    r = await run((db) => setSetting(db, 'deliveryRoom', { roomId: 'gone' }));
    assert.equal(r.result.started, true); assert.deepEqual(r.rows, ['_reflection'], 'no destination: stays in the hidden reflection room');
    ok('reflection: approvals follow the delivery room, fall back to _reflection');
  }

  // F. HTTP: kind rules, direct-chat reuse, named one-bot rooms, settings boundaries, readiness.
  {
    const { dir, db, ledger } = fresh();
    ensureDefaultBot(db, ledger, claude);
    rooms.createBot(db, { id: 'solo', runtime: 'api', model: 'openai/gpt-5' });
    const TOKEN = 'verify-conversation-owner-token';
    const auth = createAuth({ db, ownerToken: TOKEN });
    const app = createGateway({ db, ledger, approvals: createApprovals(db, ledger), auth, dispatch: () => undefined, deskDir: join(dir, 'no-desk'), readiness: createReadiness({ db, ledger, auth, env: {} }) });
    const call = (path, method = 'GET', body, token = TOKEN) => app.request(path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = async (r) => ({ status: r.status, body: await r.json() });
    const device = async (access) => (await (await call('/devices', 'POST', { name: 'verify ' + access, access })).json()).token;
    const full = await device('full'), limited = await device('limited');

    let r = await json(await call('/rooms', 'POST', { id: 'notes', name: 'Notes', members: ['solo'], kind: 'room' }));
    assert.deepEqual([r.status, r.body.created, r.body.room.kind], [201, true, 'room']);
    r = await json(await call('/rooms', 'POST', { id: 'notes-2', name: 'Notes 2', members: ['solo'], kind: 'room' }));
    assert.deepEqual([r.status, r.body.created], [201, true], 'a second one-bot named room is created, never reused');
    r = await json(await call('/rooms', 'POST', { id: 'plain', name: 'No kind', members: ['solo'] }));
    assert.deepEqual([r.status, r.body.room.kind], [201, 'room'], 'kind defaults to room');
    r = await json(await call('/rooms', 'POST', { id: 'chat-' + 'd'.repeat(32), name: 'solo', members: ['solo'], kind: 'direct' }));
    assert.deepEqual([r.status, r.body.created, r.body.room.kind], [201, true, 'direct']);
    const directId = r.body.room.id;
    r = await json(await call('/rooms', 'POST', { id: 'chat-' + 'e'.repeat(32), name: 'solo', members: ['solo'], kind: 'direct' }));
    assert.deepEqual([r.status, r.body.created, r.body.room.id], [200, false, directId], 'direct chat reused by kind');
    // Concurrent creation: five simultaneous direct-chat requests for one bot produce exactly one chat.
    rooms.createBot(db, { id: 'solo2', runtime: 'api', model: 'openai/gpt-5' });
    const racers = await Promise.all(Array.from({ length: 5 }, (_, i) => call('/rooms', 'POST', { id: 'chat-' + String(i).repeat(32), name: 'solo2', members: ['solo2'], kind: 'direct' }).then(json)));
    assert.equal(racers.filter((x) => x.body.created).length, 1, 'exactly one request created the chat');
    assert.equal(new Set(racers.map((x) => x.body.room.id)).size, 1, 'every request got the same chat');
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM rooms WHERE kind='direct' AND lead_bot_id='solo2'"), 1);
    assert.equal((await call('/rooms', 'POST', { id: 'two', name: 'Two', members: ['solo', 'bot'], kind: 'direct' })).status, 400, 'direct needs exactly one bot');
    assert.equal((await call('/rooms', 'POST', { id: 'odd', name: 'Odd', members: ['solo'], kind: 'channel' })).status, 400, 'unknown kind');
    assert.equal((await call('/rooms', 'POST', { id: 'lim', name: 'Lim', members: ['solo'] }, limited)).status, 403, 'limited device refused');
    const list = (await (await call('/rooms')).json()).rooms;
    assert.ok(list.every((x) => x.kind === 'room' || x.kind === 'direct'), 'every room reports a kind');
    assert.deepEqual(list.filter((x) => x.members.length === 1 && x.kind === 'room').map((x) => x.id).sort(), ['notes', 'notes-2', 'plain'], 'named one-bot rooms stay rooms');

    const put = (token, body) => call('/settings/deliveryRoom', 'PUT', body, token);
    assert.equal((await put(limited, { roomId: 'notes' })).status, 403);
    assert.equal((await put(TOKEN, { roomId: 'ghost' })).status, 400);
    assert.equal((await put(TOKEN, { roomId: '_reflection' })).status, 400, 'hidden rooms are never a destination');
    assert.equal((await put(TOKEN, {})).status, 400, 'roomId is required (null to clear)');
    assert.equal((await put(full, { roomId: 'notes' })).status, 200);
    assert.deepEqual(getSetting(db, 'deliveryRoom'), { roomId: 'notes' });
    assert.equal((await put(TOKEN, { roomId: null })).status, 200);
    const item = (await (await call('/readiness')).json()).items.find((i) => i.id === 'delivery');
    assert.equal(item.done, true);
    db.prepare("INSERT INTO settings (key,value_json,updated_at) VALUES ('deliveryRoom','{\"roomId\":\"vanished\"}',1) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json").run();
    const broken = (await (await call('/readiness')).json()).items.find((i) => i.id === 'delivery');
    assert.equal(broken.done, false); assert.match(broken.detail, /no longer exists/);
    const audit = db.prepare("SELECT payload_json FROM events WHERE room_id='_system' AND type='config'").all().map((e) => JSON.parse(e.payload_json));
    assert.ok(audit.some((e) => e.kind === 'room_created' && e.roomKind === 'direct'));
    assert.ok(audit.filter((e) => e.action === 'setting_changed' && e.key === 'deliveryRoom').length >= 2);
    db.close();
    ok('API: explicit kind, direct reuse by kind, concurrent creation, named one-bot rooms stay rooms, owner/full/limited, settings validation, readiness, audit');
  }

  // G. Guard: no non-test daemon source refers to room "main" except the explicit dev seed.
  {
    const files = readdirSync(join(root, 'apps/daemon/src'), { recursive: true }).filter((f) => f.endsWith('.ts') && !/\.(test|testkit)\.ts$/.test(f));
    const code = (f) => readFileSync(join(root, 'apps/daemon/src', f), 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    const hits = files.filter((f) => /["'`]main["'`]/.test(code(f)));
    assert.deepEqual(hits, ['seed.ts'], 'only the explicit dev sample may name room main: ' + hits.join(','));
    ok('guard: only seed.ts names room main');
  }
  console.log('verify-conversation-model: all checks passed');
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
