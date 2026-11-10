// Standalone acceptance for scripts/onboard.mjs. Runs only `--dry-run`: temporary OPENAG_DATA/HOME, a fake Ollama on loopback,
// a PATH holding only node + pnpm. Asserts the printed plan and that nothing was created, started or installed.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const setup = join(root, 'scripts/onboard.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'openag-setup-'));
const data = join(tmp, 'data'), home = join(tmp, 'home'), bin = join(tmp, 'bin');
mkdirSync(home); mkdirSync(bin);
let ollama;
const ok = (label) => console.log('ok ' + label);

const which = (name) => {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    try { execFileSync('test', ['-x', join(dir, name)]); return join(dir, name); } catch { /* next */ }
  }
  throw new Error(name + ' not on PATH');
};
symlinkSync(process.execPath, join(bin, 'node'));
// A wrapper, not a symlink: CI's pnpm is a shim that resolves its files relative to its own directory.
writeFileSync(join(bin, 'pnpm'), `#!/bin/sh\nexec ${JSON.stringify(which('pnpm'))} "$@"\n`); chmodSync(join(bin, 'pnpm'), 0o755);

// Async: the fake Ollama lives in this process, so the event loop must stay free while setup runs.
const run = (args, extra = {}) => new Promise((resolve) => execFile(process.execPath, [setup, ...args], {
  encoding: 'utf8', timeout: 60000,
  // Clean env: no provider keys, no claude/codex on PATH.
  env: { PATH: bin + delimiter + '/usr/bin:/bin', HOME: home, LANG: 'C', OPENAG_DATA: data, OPENAG_PORT: '4799', ...extra },
}, (err, stdout, stderr) => resolve({ status: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })));
// pnpm itself writes ~/.cache when asked for its version; that is not setup state.
const snapshot = () => JSON.stringify([existsSync(data), readdirSync(home).filter((n) => n !== '.cache'), existsSync(join(home, 'Library'))]);

try {
  const before = snapshot();
  ollama = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(req.url === '/api/tags' ? JSON.stringify({ models: [{ name: 'tiny-model:1b' }] }) : '{}');
  });
  await new Promise((r) => ollama.listen(0, '127.0.0.1', r));
  const ollamaUrl = `http://127.0.0.1:${ollama.address().port}`;

  // 1. Defaults: plan only, foreground run mode, nothing written.
  let r = await run(['--dry-run', '--yes']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  for (const re of [/Node v\d+/, /pnpm \d+/, /pnpm install --frozen-lockfile && pnpm -r build/, /Claude Code/, /Codex/, /API keys\s+none set/, /Ollama\s+not reachable/,
    /No model source is ready/, /foreground/, /Plan: .*pnpm install --frozen-lockfile.*pnpm -r build.*foreground.*pnpm desk:open/, /Dry run complete: nothing was installed, built, seeded, started or written/]) assert.match(r.stdout, re, String(re));
  assert.doesNotMatch(r.stdout + r.stderr, /OPENAG_TOKEN|oag_|sk-/);
  assert.equal(snapshot(), before); assert.equal(existsSync(data), false);
  ok('dry run prints the plan and writes nothing');

  // 2. Ollama is offered and, with --yes, planned (no existing data); service + LAN are planned, not run.
  r = await run(['--dry-run', '--yes', '--skip-build', '--service', '--lan'], { OPENAG_OLLAMA_URL: ollamaUrl });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Ollama\s+reachable at .*models: tiny-model:1b/);
  assert.match(r.stdout, /would seed an Ollama agent "local" on tiny-model:1b/);
  assert.match(r.stdout, /would install the launchd service via scripts\/install-service\.sh \(OPENAG_HOST=0\.0\.0\.0\)/);
  assert.match(r.stdout, /warning: --lan/);
  assert.doesNotMatch(r.stdout, /pnpm -r build/);
  assert.equal(snapshot(), before); assert.equal(existsSync(join(home, 'Library')), false);
  ok('seed, service and --lan are planned only; no data dir, no plist');

  // 3. Explicit flags and provider keys (names only).
  r = await run(['--dry-run', '--yes', '--no-service', '--ollama-model', 'qwen3:8b'], { OPENAI_API_KEY: 'sk-test-secret-value-1234567890' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /OPENAI_API_KEY set \(values not shown\)/);
  assert.doesNotMatch(r.stdout, /sk-test-secret/);
  assert.match(r.stdout, /would seed an Ollama agent "local" on qwen3:8b/);
  ok('--ollama-model honoured; key names shown, values never');

  // 4. Argument errors exit non-zero without side effects.
  for (const args of [['--service', '--no-service'], ['--bogus'], ['--ollama-model', 'bad name; rm'], ['--ollama-model']]) {
    r = await run(['--dry-run', ...args]);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /onboard:/);
  }
  r = await run(['--dry-run', '--yes'], { OPENAG_PORT: 'abc' });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /OPENAG_PORT/);
  assert.equal(snapshot(), before);
  ok('bad flags and bad port are refused');

  r = await run(['--help']);
  assert.equal(r.status, 0); assert.match(r.stdout, /--dry-run/);
  ok('--help');
  console.log('PASS onboard dry-run plan, flags, and no side effects');
} finally {
  ollama?.close();
  rmSync(tmp, { recursive: true, force: true });
}
