// OA-339 standalone acceptance: default bot creation, idempotency, heartbeat/reflection resolution, API boundaries.
// Temporary data dirs only; real daemon modules from apps/daemon/dist (run `pnpm -r build` first); no model, no adapter, no network.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const load = (p) => import(root + 'apps/daemon/dist/' + p + '.js');
const { openDb } = await load('db/index'), { createLedger } = await load('ledger'), { createAuth } = await load('auth');
const { createApprovals } = await load('approvals'), { createGateway } = await load('gateway');
const rooms = await load('rooms'), { ensureDefaultBot, defaultBotStatus, getDefaultBotId } = await load('defaultbot');
const { getSetting, setSetting } = await load('settings'), { createReadiness } = await load('readiness');
const { registerHeartbeat, HEARTBEAT_ROOM_ID } = await load('heartbeat'), { registerReflection } = await load('reflection');
const { createScheduler } = await load('scheduler'), { createRunner } = await load('runtimes/runner');
const { defaultTools } = await load('runtimes/tools'), { createWakeFilter } = await load('wake');
const { ensureMemoryFile } = await load('memory');

const dirs = [];
const fresh = () => { const dir = mkdtempSync(join(tmpdir(), 'openag-default-bot-')); dirs.push(dir); const db = openDb(dir); return { dir, db, ledger: createLedger(db) }; };
const claudeOnly = (pkg) => pkg.includes('claude');
const codexOnly = (pkg) => pkg.includes('codex');
const none = () => false;
const count = (db, sql) => db.prepare(sql).get().n;
const snapshot = (db) => JSON.stringify({
  bots: db.prepare("SELECT id,name,runtime,model,config_json FROM bots WHERE id <> 'bot' ORDER BY id").all(),
  rooms: db.prepare('SELECT id,name,lead_bot_id FROM rooms ORDER BY id').all(),
  members: db.prepare('SELECT room_id,bot_id FROM room_members ORDER BY room_id,bot_id').all(),
  settings: db.prepare("SELECT key,value_json FROM settings WHERE key <> 'defaultBot' ORDER BY key").all(),
});
const ok = (name) => console.log('ok  ' + name);

try {
  // A. Fresh install: zero bots, zero rooms.
  {
    const { dir, db, ledger } = fresh();
    assert.equal(getDefaultBotId(db), null);
    const bot = ensureDefaultBot(db, ledger, claudeOnly);
    assert.deepEqual([bot.id, bot.name, bot.runtime, bot.model], ['bot', 'Bot', 'acp', 'claude-code']);
    assert.equal(rooms.listBots(db).length, 1);
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM rooms'), 0, 'no room is created');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM room_members'), 0, 'no membership is created');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM turns'), 0, 'no turn is started');
    assert.equal(getDefaultBotId(db), 'bot');
    const audit = db.prepare("SELECT payload_json FROM events WHERE room_id='_system' AND type='config'").all().map((r) => JSON.parse(r.payload_json));
    assert.deepEqual(audit, [{ action: 'default_bot_created', botId: 'bot', adapter: 'claude-code' }]);
    assert.equal(ensureDefaultBot(db, ledger, claudeOnly), undefined, 'idempotent in one process');
    db.close();
    const again = openDb(dir);
    assert.equal(ensureDefaultBot(again, createLedger(again), claudeOnly), undefined, 'idempotent across a restart');
    assert.equal(rooms.listBots(again).length, 1);
    assert.equal(getDefaultBotId(again), 'bot');
    assert.deepEqual(defaultBotStatus(again, {}, claudeOnly), { state: 'ok', botId: 'bot' });
    again.close();
    ok('fresh install: one bot, no room, no turn, idempotent across restart');
  }

  // B. Existing install (boss + main + settings): only the new bot and the setting are added.
  {
    const { db, ledger } = fresh();
    rooms.createBot(db, { id: 'boss', runtime: 'api', model: 'openai/gpt-5' });
    rooms.createBot(db, { id: 'coder', runtime: 'acp', model: 'claude-code' });
    rooms.createRoom(db, { id: 'main', leadBotId: 'boss' });
    for (const id of ['boss', 'coder']) rooms.addMember(db, 'main', id);
    setSetting(db, 'heartbeat', { enabled: true, everyMinutes: 30, botId: null, prompt: null });
    const before = snapshot(db);
    const bot = ensureDefaultBot(db, ledger, claudeOnly);
    assert.equal(bot.id, 'bot');
    assert.equal(snapshot(db), before, 'boss, coder, main, membership and every other setting are unchanged');
    assert.deepEqual(rooms.getRoom(db, 'main').members.sort(), ['boss', 'coder']);
    assert.equal(getSetting(db, 'heartbeat').botId, null, 'a stored "use the default" choice is not rewritten');
    db.close();
    ok('existing install: new Bot added, nothing else changed');
  }

  // C. Handle collision and adapter detection.
  {
    const { db, ledger } = fresh();
    rooms.createBot(db, { id: 'bot', name: 'Mine', runtime: 'api', model: 'openai/gpt-5' });
    assert.equal(ensureDefaultBot(db, ledger, claudeOnly).id, 'bot-2');
    assert.equal(rooms.getBot(db, 'bot').name, 'Mine', 'the user bot is untouched');
    db.close();
    const c2 = fresh();
    const codex = ensureDefaultBot(c2.db, c2.ledger, codexOnly);
    assert.deepEqual([codex.model, codex.config.adapter], ['codex', 'codex']);
    assert.equal(defaultBotStatus(c2.db, {}, codexOnly).state, 'ok');
    c2.db.close();
    const c3 = fresh();
    const bare = ensureDefaultBot(c3.db, c3.ledger, none);
    assert.equal(bare.model, 'claude-code');
    const status = defaultBotStatus(c3.db, {}, none);
    assert.equal(status.state, 'not_configured');
    assert.match(status.reason, /not installed.*administrator/);
    assert.equal(count(c3.db, 'SELECT COUNT(*) AS n FROM turns'), 0);
    c3.db.close();
    ok('handle collision -> bot-2; codex detected; none installed -> not_configured, nothing launched');
  }

  // D. A deleted default is reported, never silently recreated.
  {
    const { db, ledger } = fresh();
    ensureDefaultBot(db, ledger, claudeOnly);
    db.prepare("DELETE FROM bots WHERE id='bot'").run();
    assert.equal(ensureDefaultBot(db, ledger, claudeOnly), undefined);
    assert.equal(rooms.listBots(db).length, 0);
    assert.equal(defaultBotStatus(db, {}, claudeOnly).state, 'missing');
    db.close();
    ok('missing default: reported, not recreated');
  }

  // E. Heartbeat resolution (real scheduler, runner and heartbeat; fake runtime).
  {
    const T0 = new Date('2026-10-27T09:00:00Z');
    const HOUR = 3_600_000;
    const run = async (prepare) => {
      const { dir, db, ledger } = fresh();
      prepare(db, ledger);
      const seen = [];
      const fake = { async runTurn(ctx) { seen.push(ctx.bot.id); } };
      const runner = createRunner({ db, ledger, approvals: createApprovals(db, ledger), dataDir: dir, runtimes: { api: fake, acp: fake }, tools: defaultTools });
      const scheduler = createScheduler({ now: () => T0 });
      const wake = createWakeFilter({ db, ledger, tz: 'UTC', now: () => T0 });
      const errors = [];
      const original = console.error; console.error = (...a) => errors.push(a.join(' '));
      try {
        registerHeartbeat({ db, ledger, runner, scheduler, tz: 'UTC', wake });
        await scheduler.tick(new Date(T0.getTime() + HOUR));
      } finally { console.error = original; }
      db.close();
      return { seen, errors };
    };
    const enable = (db, patch = {}) => setSetting(db, 'heartbeat', { enabled: true, everyMinutes: 60, botId: null, prompt: null, ...patch });
    // default bot, no room "main" at all
    let r = await run((db, ledger) => { ensureDefaultBot(db, ledger, claudeOnly); enable(db); });
    assert.deepEqual(r.seen, ['bot'], 'the default bot runs the heartbeat with no main room');
    // an explicit bot wins
    r = await run((db, ledger) => { ensureDefaultBot(db, ledger, claudeOnly); rooms.createBot(db, { id: 'coder', runtime: 'api' }); enable(db, { botId: 'coder' }); });
    assert.deepEqual(r.seen, ['coder']);
    // a missing default must NOT fall back to the lead of main
    r = await run((db, ledger) => {
      rooms.createBot(db, { id: 'boss', runtime: 'api' }); rooms.createRoom(db, { id: 'main', leadBotId: 'boss' }); rooms.addMember(db, 'main', 'boss');
      ensureDefaultBot(db, ledger, claudeOnly); db.prepare("DELETE FROM bots WHERE id='bot'").run(); enable(db);
    });
    assert.deepEqual(r.seen, [], 'no fallback to the main lead');
    assert.ok(r.errors.some((m) => /heartbeat skipped: bot bot not found/.test(m)), r.errors.join('|'));
    // never created + main lead present: still no fallback
    r = await run((db) => { rooms.createBot(db, { id: 'boss', runtime: 'api' }); rooms.createRoom(db, { id: 'main', leadBotId: 'boss' }); rooms.addMember(db, 'main', 'boss'); enable(db); });
    assert.deepEqual(r.seen, []);
    assert.ok(r.errors.some((m) => /no bot chosen and no default bot/.test(m)));
    ok('heartbeat: default bot, explicit bot, missing default, no main fallback');
  }

  // F. Reflection resolution.
  {
    const NOW = new Date('2026-10-28T04:00:00Z');
    const start = async (prepare) => {
      const { dir, db, ledger } = fresh();
      prepare(db, ledger, dir);
      const seen = [];
      const fake = { async runTurn(ctx) { seen.push(ctx.bot.id); ctx.ledger.append(ctx.room.id, ctx.bot.id, 'bot_output', { text: JSON.stringify({ proposals: [] }) }); } };
      const approvals = createApprovals(db, ledger);
      const runner = createRunner({ db, ledger, approvals, dataDir: dir, runtimes: { api: fake, acp: fake }, tools: defaultTools });
      const scheduler = createScheduler({ now: () => NOW });
      const reflection = registerReflection({ db, ledger, approvals, runner, scheduler, tz: 'UTC', dataDir: dir, now: () => NOW });
      const result = await reflection.runNow(true);
      await reflection.idle();
      db.close();
      return { result, seen };
    };
    const lead = (db) => { rooms.createBot(db, { id: 'boss', runtime: 'api' }); rooms.createRoom(db, { id: 'main', leadBotId: 'boss' }); rooms.addMember(db, 'main', 'boss'); };
    let r = await start((db, ledger, dir) => { ensureDefaultBot(db, ledger, claudeOnly); ensureMemoryFile(dir, { id: 'bot', name: 'Bot' }); });
    assert.equal(r.result.started, true); assert.deepEqual(r.seen, ['bot']);
    r = await start((db, ledger) => { lead(db); ensureDefaultBot(db, ledger, claudeOnly); db.prepare("DELETE FROM bots WHERE id='bot'").run(); });
    assert.equal(r.result.started, false); assert.match(r.result.reason, /bot bot not found/); assert.deepEqual(r.seen, []);
    r = await start((db) => lead(db));
    assert.equal(r.result.started, false); assert.equal(r.result.reason, 'no bot chosen and no default bot'); assert.deepEqual(r.seen, []);
    ok('reflection: default bot, missing default, no main fallback');
  }

  // G. HTTP boundaries, isDefault and readiness (real gateway, in-process).
  {
    const { dir, db, ledger } = fresh();
    rooms.createBot(db, { id: 'boss', runtime: 'api', model: 'openai/gpt-5' });
    ensureDefaultBot(db, ledger, claudeOnly);
    const TOKEN = 'verify-default-bot-owner-token';
    const auth = createAuth({ db, ownerToken: TOKEN });
    const app = createGateway({
      db, ledger, approvals: createApprovals(db, ledger), auth, dispatch: () => undefined, deskDir: join(dir, 'no-desk'),
      readiness: createReadiness({ db, ledger, auth, env: {} }),
    });
    const call = (path, method = 'GET', body, token = TOKEN) => app.request(path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const device = async (access) => (await (await call('/devices', 'POST', { name: 'verify ' + access, access })).json()).token;
    const full = await device('full'), limited = await device('limited');
    const put = (token, body) => call('/settings/defaultBot', 'PUT', body, token);
    assert.equal((await put(limited, { botId: 'boss' })).status, 403, 'limited device refused');
    assert.equal((await put(TOKEN, { botId: null })).status, 400, 'null refused');
    assert.equal((await put(TOKEN, { botId: 'ghost' })).status, 400, 'unknown bot refused');
    assert.equal(getDefaultBotId(db), 'bot', 'refused requests change nothing');
    assert.equal((await put(full, { botId: 'boss' })).status, 200, 'full-access device allowed');
    assert.equal(getDefaultBotId(db), 'boss');
    assert.equal((await put(TOKEN, { botId: 'bot' })).status, 200, 'owner allowed');
    assert.equal((await put(TOKEN, { botId: 'bot', extra: 'x' })).status, 200, 'unknown fields are stripped like every setting');
    assert.deepEqual(db.prepare("SELECT value_json FROM settings WHERE key='defaultBot'").get(), { value_json: '{"botId":"bot"}' }, 'only botId is stored');
    const bots = (await (await call('/bots')).json()).bots;
    assert.deepEqual(bots.filter((b) => b.isDefault).map((b) => b.id), ['bot']);
    assert.equal(bots.find((b) => b.id === 'boss').isDefault, undefined);
    const audit = db.prepare("SELECT payload_json FROM events WHERE room_id='_system' AND type='config' ORDER BY id").all().map((r) => JSON.parse(r.payload_json));
    assert.equal(audit.filter((e) => e.action === 'setting_changed' && e.key === 'defaultBot').length, 3);
    const item = (await (await call('/readiness')).json()).items.find((i) => i.id === 'defaultBot');
    assert.ok(item, 'readiness has a defaultBot item');
    assert.equal(item.done, defaultBotStatus(db, {}).state === 'ok');
    db.close();
    ok('API: owner/full allowed, limited 403, null/unknown 400, extra fields stripped, isDefault marker, audit, readiness item');
  }
  console.log('verify-default-bot: all checks passed');
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
