// Real connector constructors and encrypted stores, synthetic credentials and temporary data only.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { connectorCredentialStore } from '../apps/daemon/dist/connector-credentials.js';
import { createGoogleConnectors } from '../apps/daemon/dist/google-connectors.js';
import { createComposioConnect } from '../apps/daemon/dist/composio-connect.js';

const records = {
 google: { subject: 'fixture', email: 'fixture@example.test', credentials: { access_token: 'controlled-access', refresh_token: 'controlled-refresh', expiry_date: Date.now() + 3600000, scope: 'openid email https://www.googleapis.com/auth/gmail.readonly' }, enabled: ['gmail'] },
 composio: { client: { client_id: 'controlled-client' }, tokens: { access_token: 'controlled-access', refresh_token: 'controlled-refresh', token_type: 'Bearer' }, expiresAt: Date.now() + 3600000, needsAccess: false, redirectUri: 'https://desk.example/composio-connect' },
};
for (const healthy of ['google', 'composio']) for (const fault of ['damaged', 'unsafe', 'symlink']) {
 const dir = mkdtempSync(join(tmpdir(), 'oag-isolation-')), key = randomBytes(32).toString('hex');
 const broken = healthy === 'google' ? 'composio' : 'google';
 const env = { OPENAG_CONNECTOR_KEY: key, OPENAG_COMPOSIO_REDIRECT_URI: 'https://desk.example/composio-connect', OPENAG_GOOGLE_CLIENT_ID: 'controlled-client', OPENAG_GOOGLE_CLIENT_SECRET: 'controlled-secret', OPENAG_GOOGLE_REDIRECT_URI: 'https://desk.example/google-connect' };
 let google, composio;
 try {
  connectorCredentialStore(dir, key, healthy).write(records[healthy]);
  const healthyFile = join(dir, `connector-${healthy}.enc`), brokenFile = join(dir, `connector-${broken}.enc`);
  const before = readFileSync(healthyFile), outside = join(dir, 'outside');
  if (fault === 'symlink') { writeFileSync(outside, 'preserve outside', { mode: 0o600 }); symlinkSync(outside, brokenFile); }
  else { writeFileSync(brokenFile, 'preserve damaged record', { mode: 0o600 }); if (fault === 'unsafe') chmodSync(brokenFile, 0o644); }
  const brokenBefore = readFileSync(brokenFile);
  // Match daemon initialization order: optional Composio first, then Google.
  const noNetwork = () => { throw Error('Migration must not contact a provider'); };
  composio = createComposioConnect({ dataDir: dir, env, fetch: noNetwork });
  google = createGoogleConnectors({ dataDir: dir, env, fetch: noNetwork });
  const connectors = { google, composio };
  assert.equal(connectors[healthy].status().configured, true, `${healthy} survives unrelated ${broken} ${fault} file during first key import`);
  assert.equal(connectors[broken].status().configured, false, 'The broken connector remains unavailable');
  assert.equal(readFileSync(join(dir, '.connectors/key'), 'utf8'), key);
  assert.deepEqual(readFileSync(healthyFile), before, 'Healthy ciphertext is never rewritten');
  assert.deepEqual(readFileSync(brokenFile), brokenBefore, 'Broken/unsafe records and symlink targets are preserved');
  assert.deepEqual(connectorCredentialStore(dir, key, healthy).read(), records[healthy]);
  console.log(`PASS ${healthy} migration isolated from ${broken} ${fault}`);
 } finally { google?.close(); await composio?.close(); rmSync(dir, { recursive: true, force: true }); }
}

// Composio is constructed first on upgrade. With only legacy Google state present,
// it must not persist an unverified wrong key before Google can reject it.
const wrongDir = mkdtempSync(join(tmpdir(), 'oag-wrong-key-')), originalKey = randomBytes(32).toString('hex');
let wrong, recovered;
try {
 connectorCredentialStore(wrongDir, originalKey, 'google').write(records.google);
 wrong = createComposioConnect({ dataDir: wrongDir, env: { OPENAG_CONNECTOR_KEY: 'b'.repeat(64), OPENAG_PUBLIC_URL: 'https://desk.example' } });
 assert.equal(wrong.status().configured, false);
 assert.equal(existsSync(join(wrongDir, '.connectors/key')), false, 'An unverified wrong key must not poison the shared key file');
 recovered = createComposioConnect({ dataDir: wrongDir, env: { OPENAG_CONNECTOR_KEY: originalKey, OPENAG_PUBLIC_URL: 'https://desk.example' } });
 assert.equal(recovered.status().configured, true);
 assert.equal(readFileSync(join(wrongDir, '.connectors/key'), 'utf8'), originalKey);
 assert.deepEqual(connectorCredentialStore(wrongDir, originalKey, 'google').read(), records.google);
 console.log('PASS absent caller record preserves legacy peer key validation and corrected-key retry');
} finally { await wrong?.close(); await recovered?.close(); rmSync(wrongDir, { recursive: true, force: true }); }
