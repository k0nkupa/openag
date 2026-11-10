#!/usr/bin/env node
// One-command setup: fresh clone -> built, running daemon -> signed-in browser. `pnpm onboard` (see README "Quick start").
// No dependencies. Every child process is argv-only (spawn/execFile, never a shell string). Safe to re-run: it never
// overwrites data or credentials, and it never prints an owner credential, token or provider key value (names only).
import { spawn, execFile } from 'node:child_process';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST = join(ROOT, 'apps/daemon/dist');
const OLLAMA_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,100}$/; // same rule as apps/daemon/src/seed.ts

const USAGE = `Usage: pnpm onboard [options]

  --yes, -y              accept defaults, no prompts (also the default when stdin is not a terminal)
  --dry-run              detect and print the plan; install, build, seed, service and start nothing
  --skip-build           skip "pnpm -r build" (use an existing build)
  --ollama-model <name>  seed an Ollama agent on this model (must already be pulled)
  --service | --no-service   install (or not) the always-on launchd service; default asks, --yes means no
  --lan                  with the service or foreground daemon, listen on 0.0.0.0 (OPENAG_HOST) for LAN access
  --no-open              do not open the browser
  --help, -h             show this help

Environment: OPENAG_DATA (default ~/openag-data), OPENAG_PORT (4747), OPENAG_HOST, OPENAG_OLLAMA_URL.`;

function parseArgs(argv) {
  const o = { yes: false, dryRun: false, skipBuild: false, ollamaModel: undefined, service: undefined, lan: false, open: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') o.yes = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--skip-build') o.skipBuild = true;
    else if (a === '--service') { if (o.service === false) throw new Error('--service and --no-service conflict'); o.service = true; }
    else if (a === '--no-service') { if (o.service === true) throw new Error('--service and --no-service conflict'); o.service = false; }
    else if (a === '--lan') o.lan = true;
    else if (a === '--no-open') o.open = false;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--ollama-model' || a.startsWith('--ollama-model=')) {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
      if (!v || !OLLAMA_MODEL_RE.test(v)) throw new Error('--ollama-model needs a model name such as llama3.2 or qwen3:8b');
      o.ollamaModel = v;
    } else throw new Error(`unknown option: ${a}`);
  }
  return o;
}

const say = (m = '') => console.log(m);
const step = (m) => console.log(`\n==> ${m}`);
const warn = (m) => console.log(`warning: ${m}`);
const fail = (m) => { console.error(`onboard: ${m}`); process.exit(1); };

function run(cmd, args, { env = process.env, cwd = ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`))));
  });
}

function capture(cmd, args) {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { cwd: ROOT, timeout: 15000 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout).trim()))));
}

/** Whether an executable named `name` exists in a PATH directory. No process is run. */
function onPath(name, pathVar = process.env.PATH ?? '') {
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, name);
    try { if (statSync(p).isFile()) { accessSync(p, constants.X_OK); return true; } } catch { /* next */ }
  }
  return false;
}

async function healthy(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500), redirect: 'error' });
    return res.ok;
  } catch { return false; }
}

async function waitHealthy(port, isAlive, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await healthy(port)) return true;
    if (!isAlive()) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/** Read-only detection through the daemon's own helpers: module resolution, env var presence, one GET to Ollama. */
async function detect() {
  const file = join(DIST, 'models.js');
  if (!existsSync(file)) return null;
  const { modelsStatus } = await import(pathToFileURL(file).href);
  const status = await modelsStatus({ bots: [], env: process.env });
  const cliBin = { 'claude-code': 'claude', codex: 'codex' };
  return {
    clis: status.clis.map((c) => ({ id: c.id, name: c.name, adapter: c.adapterInstalled, cli: onPath(cliBin[c.id]), bin: cliBin[c.id] })),
    keys: status.providers.filter((p) => p.chat && p.set).map((p) => ({ name: p.name, envVar: p.envVar })),
    ollama: status.ollama,
  };
}

function printDetection(d, ollamaUrl) {
  if (!d) return say('  (not built yet: model detection runs after the build)');
  for (const c of d.clis) {
    const state = c.adapter && c.cli ? 'ready' : c.adapter ? `adapter installed, \`${c.bin}\` not on PATH` : 'adapter missing (re-run pnpm install)';
    say(`  ${c.name.padEnd(12)} ${state}`);
  }
  say(`  API keys     ${d.keys.length ? d.keys.map((k) => k.envVar).join(', ') + ' set (values not shown)' : 'none set in this shell'}`);
  say(`  Ollama       ${d.ollama.reachable ? `reachable at ${d.ollama.url}, ${d.ollama.models.length ? 'models: ' + d.ollama.models.slice(0, 8).join(', ') : 'no models pulled'}` : `not reachable at ${d.ollama.url}`}`);
  say('  (sign-in state is not checked: that would launch the agent CLI)');
}

const hasSource = (d) => !!d && (d.clis.some((c) => c.adapter && c.cli) || d.keys.length > 0);

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`onboard: ${e.message}\n\n${USAGE}`); process.exit(2); }
  if (opts.help) return say(USAGE);

  const interactive = !opts.yes && process.stdin.isTTY && process.stdout.isTTY;
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = async (q, def) => {
    if (!rl) return def;
    const a = (await rl.question(`${q} [${def ? 'Y/n' : 'y/N'}] `)).trim().toLowerCase();
    return a === '' ? def : a === 'y' || a === 'yes';
  };

  const port = process.env.OPENAG_PORT || '4747';
  if (!/^\d+$/.test(port) || +port < 1 || +port > 65535) fail(`OPENAG_PORT must be a port number, got "${port}"`);
  const dataDir = (process.env.OPENAG_DATA || join(homedir(), 'openag-data')).replace(/^~(?=$|\/)/, homedir());
  const isMac = process.platform === 'darwin';
  const dry = opts.dryRun;
  const plan = [];

  try {
    step('Preflight');
    if (!isMac) warn(`macOS is the supported platform; ${process.platform} is untested (the launchd service is unavailable).`);
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 22) fail(`Node 22+ is required (found ${process.version}). Install it from https://nodejs.org and re-run.`);
    say(`  Node ${process.version} ok`);
    let pnpmVersion;
    try { pnpmVersion = await capture('pnpm', ['--version']); } catch { fail('pnpm was not found on PATH. Install pnpm 10: https://pnpm.io/installation, then re-run.'); }
    say(`  pnpm ${pnpmVersion} ok`);
    say(`  data: ${dataDir}   port: ${port}${dry ? '   (dry run: nothing will be changed)' : ''}`);

    step('Install and build');
    plan.push('pnpm install --frozen-lockfile');
    if (!opts.skipBuild) plan.push('pnpm -r build');
    if (dry) say(`  would run: ${plan.join(' && ')}`);
    else {
      await run('pnpm', ['install', '--frozen-lockfile']);
      if (opts.skipBuild) say('  build skipped (--skip-build)');
      else await run('pnpm', ['-r', 'build']);
    }
    if (!dry && !existsSync(join(DIST, 'main.js'))) fail('apps/daemon/dist is missing; run without --skip-build.');

    step('Model sources');
    const d = await detect();
    printDetection(d);

    let seedModel = opts.ollamaModel;
    const dbExists = existsSync(join(dataDir, 'openag.db'));
    if (!seedModel && d && !hasSource(d) && d.ollama.models.length) {
      if (dbExists) say('  Existing data found: not offering to seed an Ollama agent. Use "New bot" in the desk to add one.');
      else {
        const model = d.ollama.models[0];
        if (await ask(`  No Claude Code, Codex or API key found. Create an agent on Ollama model "${model}"?`, true)) seedModel = model;
      }
    }
    if (!hasSource(d) && !seedModel && d) {
      say('  No model source is ready. Setup continues; the desk will open but Bot cannot answer until you do one of:');
      say('    - install Claude Code (https://docs.anthropic.com/en/docs/claude-code) and run `claude` once to sign in, or the same for Codex (https://github.com/openai/codex);');
      say('    - export OPENAI_API_KEY, ANTHROPIC_API_KEY or OPENROUTER_API_KEY in the shell that starts the daemon;');
      say('    - install Ollama (https://ollama.com), `ollama pull <model>`, then re-run `pnpm onboard`.');
    }
    if (seedModel) {
      plan.push(`seed Ollama agent "local" on ${seedModel}`);
      if (dry) say(`  would seed an Ollama agent "local" on ${seedModel} (OPENAG_SEED_OLLAMA_MODEL; existing data is never overwritten)`);
      else {
        await run(process.execPath, [join(DIST, 'seed.js')], { env: { ...process.env, OPENAG_SEED_OLLAMA_MODEL: seedModel } });
      }
    }

    step('Run mode');
    let service = opts.service;
    if (service && !isMac) fail('--service needs macOS (launchd).');
    if (service === undefined) service = isMac && (await ask('  Install the always-on launchd service (starts at login, restarts on crash)?', false));
    const serviceEnv = { ...process.env };
    if (opts.lan) {
      serviceEnv.OPENAG_HOST = '0.0.0.0';
      warn('--lan: the daemon will listen on every network interface. Only use this on a network you trust; pair devices from Settings, Devices.');
    }
    if (service) {
      plan.push('scripts/install-service.sh');
      say(`  ${dry ? 'would install' : 'installing'} the launchd service via scripts/install-service.sh${serviceEnv.OPENAG_HOST ? ` (OPENAG_HOST=${serviceEnv.OPENAG_HOST})` : ''}`);
    } else {
      plan.push('start the daemon in the foreground');
      say(`  the daemon will run in the foreground; stop it with Ctrl+C. Re-run with --service for always-on.`);
    }
    plan.push('wait for /health, then open the desk (pnpm desk:open)');
    say(`\nPlan: ${plan.join(' -> ')}`);
    if (dry) return say('\nDry run complete: nothing was installed, built, seeded, started or written.');

    let daemon;
    let opening = true;
    let isAlive = () => true;
    const alreadyUp = await healthy(port);
    if (service) {
      await run('bash', [join(ROOT, 'scripts/install-service.sh')], { env: { ...serviceEnv, OPENAG_SKIP_BUILD: '1' } }); // already built above
    } else if (alreadyUp) {
      say(`\nA daemon is already answering on port ${port}; leaving it running.`);
    } else {
      step('Starting the daemon');
      daemon = spawn(process.execPath, [join(DIST, 'main.js')], { cwd: ROOT, env: serviceEnv, stdio: 'inherit' });
      let exited = false;
      daemon.on('exit', (code, sig) => { exited = true; if (!opening) process.exit(code ?? (sig ? 1 : 0)); });
      for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { if (!exited) daemon.kill(s); else process.exit(0); });
      isAlive = () => !exited;
    }

    if (!(await waitHealthy(port, isAlive))) fail(`the daemon did not become healthy on port ${port}${service ? `; see ${join(dataDir, 'logs/openagd.err.log')}` : ''}.`);
    say(`  daemon healthy on http://127.0.0.1:${port}`);

    if (opts.open) {
      step('Signing in this browser');
      let opened = false;
      for (let i = 0; i < 5 && !opened; i++) {
        try { await run(process.execPath, [join(DIST, 'open-desk.js')]); opened = true; } catch { await new Promise((r) => setTimeout(r, 1000)); }
      }
      if (!opened) warn('could not open the browser. Run `pnpm desk:open` on this Mac when ready.');
    }
    opening = false;

    step('Next steps');
    say(`  1. In the browser, confirm Full access for this device (within five minutes), then say hi to Bot.`);
    say(`  2. Phone: Settings -> Devices -> Pair device. Remote access: docs/tailscale.md (Tailscale recommended).`);
    say(`  3. Sign a browser back in later with \`pnpm desk:open\` on this Mac.`);
    if (!service) say(`  4. Always-on: re-run \`pnpm onboard --service\` (or scripts/install-service.sh).`);
    if (daemon) say(`\nThe daemon is running in this terminal. Press Ctrl+C to stop it.`);
  } finally {
    rl?.close();
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
