#!/usr/bin/env node
// Publish a release of this (private, development) repository to the public repository as ONE snapshot commit.
//
//   node scripts/publish-release.mjs --dry-run          # build + scan the snapshot, show what would change, push nothing
//   node scripts/publish-release.mjs                    # publish: commit to the public main, tag vX.Y.Z, create the GitHub release
//
// Options: --repo owner/name (default k0nkupa/openag), --remote <git url> (push target; default the repo's SSH URL),
// --skip-release (no GitHub release; for a test remote), --allow-dirty (development only; never for a real publish).
//
// The version comes from package.json and must have a `## X.Y.Z` section in CHANGELOG.md. The snapshot is `git archive HEAD`,
// so only committed files are published. Before anything is pushed it is scanned: generic personal-path and token checks,
// gitleaks (when installed; findings are allowed only in test fixtures), and a PRIVATE deny list of strings that must never
// be published (one per line, `#` comments), read from $OPENAG_RELEASE_DENYLIST or ~/.config/openag/release-denylist.
// The deny list lives outside the repository on purpose: publishing it would publish what it protects.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const dry = flag('--dry-run');
const repo = option('--repo', 'k0nkupa/openag');
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) fail(`invalid --repo ${repo}`);
const remote = option('--remote', `git@github.com:${repo}.git`);

function fail(message) { console.error(`publish-release: ${message}`); process.exit(1); }
const say = (message) => console.log(message);
const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const git = (argv, cwd = ROOT, env) => run('git', argv, { cwd, env: env ? { ...process.env, ...env } : process.env });

// 1. Preconditions: a clean, pushed main with a version and its changelog section.
const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) fail('package.json has no X.Y.Z version');
const tag = `v${version}`;
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
const section = changelog.match(new RegExp(`^## ${version.replaceAll('.', '\\.')}\\b.*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
if (!section || !section[1].trim()) fail(`CHANGELOG.md has no "## ${version}" section`);
if (!flag('--allow-dirty')) {
  if (git(['status', '--porcelain', '--untracked-files=no'])) fail('the working tree has uncommitted changes');
  git(['fetch', '-q', 'origin', 'main']);
  if (git(['rev-parse', 'HEAD']) !== git(['rev-parse', 'origin/main'])) fail('HEAD is not origin/main; publish from the merged main');
}
const source = git(['rev-parse', '--short', 'HEAD']);
say(`OpenAg ${version} from ${source} -> ${repo}${dry ? ' (dry run)' : ''}`);

// 2. Snapshot of committed files only.
const work = mkdtempSync(join(tmpdir(), 'openag-release-'));
const snapshot = join(work, 'snapshot');
run('mkdir', [snapshot]);
execFileSync('sh', ['-c', 'git archive HEAD | tar -x -C "$1"', 'sh', snapshot], { cwd: ROOT });

// 3. Scan. Every problem is listed before failing so one run shows all of them.
const problems = [];
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name), st = statSync(path);
    if (st.isDirectory()) walk(path); else files.push(path);
  }
})(snapshot);
const total = files.reduce((sum, f) => sum + statSync(f).size, 0);
for (const f of files) if (statSync(f).size > 5 * 1024 * 1024) problems.push(`large file (>5 MB): ${relative(snapshot, f)}`);
const denyFile = process.env.OPENAG_RELEASE_DENYLIST ?? join(homedir(), '.config/openag/release-denylist');
const deny = existsSync(denyFile) ? readFileSync(denyFile, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : [];
if (!deny.length) say(`  warning: no private deny list at ${denyFile}; only generic checks run`);
const generic = [
  { what: 'home directory path', re: /\/Users\/(?!alice\b|runner\b|you\b|<)[A-Za-z][\w.-]*\//g },
  { what: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { what: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{40,}\b/g },
  { what: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];
const fixture = (path) => /\.(test|testkit)\.tsx?$|(^|\/)scripts\/(verify-[^/]+|[^/]+-fixture)\.mjs$|(^|\/)src\/test\//.test(path);
for (const f of files) {
  const rel = relative(snapshot, f);
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  if (text.includes('\u0000')) continue; // binary
  for (const word of deny) if (text.toLowerCase().includes(word.toLowerCase())) problems.push(`deny-listed text in ${rel}`);
  for (const { what, re } of generic) for (const m of text.matchAll(re)) if (!fixture(rel)) problems.push(`${what} in ${rel}: ${m[0].slice(0, 24)}…`);
}
try {
  const report = join(work, 'gitleaks.json');
  try { run('gitleaks', ['detect', '--no-git', '--source', snapshot, '--report-format', 'json', '--report-path', report, '--exit-code', '0', '--no-banner', ...(existsSync(join(snapshot, '.gitleaks.toml')) ? ['--config', join(snapshot, '.gitleaks.toml')] : [])]); }
  catch (e) { if (e.code === 'ENOENT') throw e; }
  const findings = JSON.parse(readFileSync(report, 'utf8') || '[]');
  const real = findings.filter((x) => !fixture(relative(snapshot, x.File.startsWith('/') ? x.File : join(snapshot, x.File))));
  for (const x of real) problems.push(`gitleaks ${x.RuleID} in ${relative(snapshot, x.File.startsWith('/') ? x.File : join(snapshot, x.File))}:${x.StartLine}`);
  say(`  gitleaks: ${findings.length} finding(s), ${findings.length - real.length} in test fixtures`);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
  say('  warning: gitleaks is not installed; secret scan skipped (brew install gitleaks)');
}
say(`  snapshot: ${files.length} files, ${(total / 1024 / 1024).toFixed(1)} MB; deny list: ${deny.length} entr${deny.length === 1 ? 'y' : 'ies'}`);
if (problems.length) {
  for (const p of [...new Set(problems)]) console.error(`  ✗ ${p}`);
  rmSync(work, { recursive: true, force: true });
  fail(`${new Set(problems).size} problem(s) found; nothing was published`);
}
say('  scan: clean');

// 4. Public repository: one new commit on top of the previous release, so its history is one commit per release.
const pub = join(work, 'public');
const identity = JSON.parse(run('gh', ['api', 'user']));
const email = `${identity.id}+${identity.login}@users.noreply.github.com`;
const author = { GIT_AUTHOR_NAME: identity.login, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: identity.login, GIT_COMMITTER_EMAIL: email };
git(['clone', '-q', '--depth', '1', remote, pub], work);
if (git(['ls-remote', '--tags', 'origin', tag], pub)) fail(`${tag} already exists on ${repo}`);
for (const name of readdirSync(pub)) if (name !== '.git') rmSync(join(pub, name), { recursive: true, force: true });
execFileSync('sh', ['-c', 'cp -R "$1"/. "$2"/', 'sh', snapshot, pub]);
git(['add', '-A'], pub);
const stat = git(['diff', '--cached', '--shortstat'], pub);
say(`  changes since the last release: ${stat || 'none'}`);
if (!stat) fail('nothing changed since the last published release');

const notes = section[1].trim().replace(/\]\((?!https?:|#)([^)]+)\)/g, `](https://github.com/${repo}/blob/${tag}/$1)`);
writeFileSync(join(work, 'notes.md'), notes + '\n');
if (dry) {
  say(`\nDry run: would commit "OpenAg ${version}" as ${identity.login} <${email}>, tag ${tag}, push to ${remote}${flag('--skip-release') ? '' : ' and create the GitHub release'}.`);
  say(`Release notes preview: ${join(work, 'notes.md')}`);
  process.exit(0);
}
git(['commit', '-q', '-m', `OpenAg ${version}`], pub, author);
git(['tag', '-a', tag, '-m', `OpenAg ${version}`], pub, author);
git(['push', '-q', 'origin', 'HEAD', tag], pub);
say(`  pushed ${tag} to ${remote}`);
if (!flag('--skip-release')) {
  say(`  ${run('gh', ['release', 'create', tag, '-R', repo, '--title', `OpenAg ${version}`, '--notes-file', join(work, 'notes.md')])}`);
  // Mark the source commit too, so a public release maps back to its development commit.
  git(['tag', '-a', tag, '-m', `OpenAg ${version} (published to ${repo})`]);
  git(['push', '-q', 'origin', tag]);
  say(`  tagged ${source} as ${tag} in the development repository`);
}
rmSync(work, { recursive: true, force: true });
say('Done.');
