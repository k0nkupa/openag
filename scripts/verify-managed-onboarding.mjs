// Controlled integration acceptance. Temporary host state; no provider or unit runner.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync, statSync, unlinkSync, linkSync, symlinkSync, mkdirSync } from 'node:fs';
import { randomBytes, randomUUID, createCipheriv } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createComposioConnect } from '../apps/daemon/dist/composio-connect.js';
import { createGoogleConnectors } from '../apps/daemon/dist/google-connectors.js';
import { googleCredentialStore } from '../apps/daemon/dist/google-credentials.js';
import { resolveConnectorKey } from '../apps/daemon/dist/connector-key.js';
import { getDefaultRedactor } from '../apps/daemon/dist/redact.js';
import { ensureDataRepo } from '../apps/daemon/dist/datagit.js';
const dir = mkdtempSync(join(tmpdir(), 'openag-managed-'));
let connector;
const fixtures = [];
const fixture = () => { const path = mkdtempSync(join(tmpdir(), 'openag-key-')); fixtures.push(path); return path; };
try {
 connector = createComposioConnect({ dataDir: dir, env: { OPENAG_COMPOSIO_REDIRECT_URI: 'https://desk.example/composio-connect' }, fetch: () => { throw Error('Construction must not contact provider'); } });
 assert.equal(connector.status().configured, true, 'A trusted callback needs no manually generated encryption key');
 const keyFile = join(dir, '.connectors/key'), key = readFileSync(keyFile, 'utf8');
 assert.match(key, /^[0-9a-f]{64}$/); assert.equal(statSync(keyFile).mode & 0o777, 0o600);
 assert.equal(statSync(join(dir, '.connectors')).mode & 0o777, 0o700);
 assert.equal(getDefaultRedactor().redact(key), '[REDACTED:secret]');
 await connector.close();
 connector = createComposioConnect({ dataDir: dir, env: { OPENAG_PUBLIC_URL: 'https://desk.example' } });
 assert.equal(connector.status('https://desk.example').configured, true);
 assert.equal(readFileSync(keyFile, 'utf8'), key, 'Restart reuses the same key');
 await ensureDataRepo(dir);
 assert.equal(execFileSync('git', ['check-ignore', '.connectors/key'], { cwd: dir, encoding: 'utf8' }).trim(), '.connectors/key');
 assert.throws(() => resolveConnectorKey(dir, 'composio', 'a'.repeat(64)), /recovery/);
 assert.equal(readFileSync(keyFile, 'utf8'), key);
 const stage = join(dir, `.connectors/.key-${randomUUID()}.tmp`);
 linkSync(keyFile, stage); assert.equal(resolveConnectorKey(dir, 'composio'), key); assert.equal(statSync(keyFile).nlink, 1);
 const unrelated = join(dir, 'unrelated-key-link'); linkSync(keyFile, unrelated);
 assert.throws(() => resolveConnectorKey(dir, 'composio'), /recovery/); unlinkSync(unrelated);
 chmodSync(keyFile, 0o644); assert.throws(() => resolveConnectorKey(dir, 'composio'), /recovery/); chmodSync(keyFile, 0o600);
 writeFileSync(keyFile, 'broken'); assert.throws(() => resolveConnectorKey(dir, 'composio'), /recovery/); assert.equal(readFileSync(keyFile, 'utf8'), 'broken');
 writeFileSync(keyFile, key); unlinkSync(keyFile); assert.throws(() => resolveConnectorKey(dir, 'composio'), /recovery/);
 symlinkSync(join(dir, 'missing'), keyFile); assert.throws(() => resolveConnectorKey(dir, 'composio')); unlinkSync(keyFile);
 assert.equal(resolveConnectorKey(dir, 'composio', key), key, 'Explicit original key can restore missing host state');
 const emptyDir = fixture(); mkdirSync(join(emptyDir, '.connectors'), { mode: 0o700 });
 assert.match(resolveConnectorKey(emptyDir, 'composio'), /^[a-f0-9]{64}$/, 'An empty unpublished directory is a fresh initialization');
 const markedDir = fixture(); mkdirSync(join(markedDir, '.connectors'), { mode: 0o700 });
 writeFileSync(join(markedDir, '.connectors/initialized'), '', { mode: 0o600 });
 assert.throws(() => resolveConnectorKey(markedDir, 'composio'), /recovery/, 'Initialized state never replaces a lost original key');
 writeFileSync(join(markedDir, `.connectors/.key-${randomUUID()}.tmp`), 'd'.repeat(64), { mode: 0o600 });
 assert.throws(() => resolveConnectorKey(markedDir, 'composio'), /recovery/, 'A leftover losing stage cannot replace a lost initialized key');
 const interruptedDir = fixture(), interruptedKey = randomBytes(32).toString('hex');
 mkdirSync(join(interruptedDir, '.connectors'), { mode: 0o700 });
 const unpublished = join(interruptedDir, `.connectors/.key-${randomUUID()}.tmp`);
 writeFileSync(unpublished, interruptedKey, { mode: 0o600 });
 assert.equal(resolveConnectorKey(interruptedDir, 'composio'), interruptedKey, 'A sole fsynced staging key survives interruption before publication');
 assert.equal(readFileSync(join(interruptedDir, '.connectors/key'), 'utf8'), interruptedKey);
 const unsafeDir = fixture(); mkdirSync(join(unsafeDir, '.connectors'), { mode: 0o755 });
 assert.throws(() => resolveConnectorKey(unsafeDir, 'composio'));

 // Independent legacy ciphertext proves migration preserves the original key and Google format.
 const legacyDir = fixture(), legacyKey = randomBytes(32).toString('hex');
 const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(legacyKey, 'hex'), iv);
 cipher.setAAD(Buffer.from('OpenAg Google credentials v1'));
 const record = { subject: 'controlled-google-subject', credentials: { access_token: 'controlled-google-access', refresh_token: 'controlled-google-refresh', expiry_date: Date.now() + 3600000, scope: 'openid email https://www.googleapis.com/auth/gmail.readonly' }, email: 'person@example.test', enabled: ['gmail'] };
 const encrypted = Buffer.concat([cipher.update(JSON.stringify(record)), cipher.final()]);
 const original = Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]);
 writeFileSync(join(legacyDir, 'connector-google.enc'), original, { mode: 0o600 });
 assert.throws(() => resolveConnectorKey(legacyDir, 'google'), /recovery/);
 assert.throws(() => resolveConnectorKey(legacyDir, 'google', 'b'.repeat(64)), /recovery/);
 assert.equal(resolveConnectorKey(legacyDir, 'google', legacyKey.toUpperCase()).toLowerCase(), legacyKey);
 assert.deepEqual(googleCredentialStore(legacyDir, legacyKey).read(), record);
 assert.deepEqual(readFileSync(join(legacyDir, 'connector-google.enc')), original);
 const google = createGoogleConnectors({ dataDir: legacyDir, env: { OPENAG_GOOGLE_CLIENT_ID: 'client', OPENAG_GOOGLE_CLIENT_SECRET: 'controlled-client-secret', OPENAG_GOOGLE_REDIRECT_URI: 'https://desk.example/google-connect' } });
 assert.equal(google.status().configured, true, 'Google reuses the managed key without an environment key'); google.close();

 // Two startup processes never replace the published winner. A concurrent initialization
 // may ask for recovery while its peer is still publishing; a subsequent start reuses it.
 const raceDir = fixture(), moduleUrl = new URL('../apps/daemon/dist/connector-key.js', import.meta.url).href;
 const attempts = await Promise.all([1, 2].map(() => new Promise(resolve => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {resolveConnectorKey} from ${JSON.stringify(moduleUrl)};try {resolveConnectorKey(process.argv[1], 'composio');}catch {process.exitCode=1;}`, raceDir], { stdio: 'ignore' });
  child.once('exit', resolve);
 })));
 assert.ok(attempts.includes(0)); const winner = readFileSync(join(raceDir, '.connectors/key'), 'utf8');
 assert.equal(resolveConnectorKey(raceDir, 'composio'), winner);

 const localDir = fixture(); let localOrigin;
 const local = createComposioConnect({ dataDir: localDir, env: {}, localOrigin: () => localOrigin });
 assert.equal(local.status().configured, false); localOrigin = 'http://127.0.0.1:5747';
 assert.equal(local.status(localOrigin).configured, true);
 assert.equal(local.status('https://phone.example').configured, false);
 assert.match(local.status('https://phone.example').reason, /Sign-in addresses/);
 await assert.rejects(() => local.start('phone', 'https://phone.example'), /Sign-in addresses/); await local.close();
 for (const config of [
  { OPENAG_PUBLIC_URL: 'http://192.168.1.1' }, { OPENAG_PUBLIC_URL: 'https://desk.example/path' },
  { OPENAG_PUBLIC_URL: 'https://name:secret@desk.example' }, { OPENAG_PUBLIC_URL: 'https://desk.example?query=1' },
  { OPENAG_PUBLIC_URL: 'https://desk.example', OPENAG_COMPOSIO_REDIRECT_URI: 'https://other.example/composio-connect' },
 ]) {
  const invalid = createComposioConnect({ dataDir: dir, env: config });
  assert.equal(invalid.status().configured, false); await invalid.close();
 }
 console.log('PASS managed key generation/restart/import/recovery, permissions, publication, Google compatibility and trusted local/remote setup');
 execFileSync(process.execPath, [new URL('./verify-composio-connect.mjs', import.meta.url).pathname, '--managed'], { stdio: 'inherit', timeout: 60000 });
} finally { await connector?.close(); for (const path of [dir, ...fixtures]) rmSync(path, { recursive: true, force: true }); }
