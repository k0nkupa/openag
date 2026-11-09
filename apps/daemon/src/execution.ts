import { spawn } from 'node:child_process';
import { realpathSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { getDefaultRedactor } from './redact.js';
import { ActionFailure } from './action-receipts.js';
import { rgPath } from '@vscode/ripgrep';

export type FilesystemMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export interface ExecutionPolicy { mode: FilesystemMode; workspace: string; writeRoots?: readonly string[] }
export interface CommandResult { untrusted: true; exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; interrupted: boolean; truncated: boolean }

// Git pointer files can place execution configuration outside a directory named .git.
async function gitMetadata(roots: readonly string[]): Promise<string[]> {
  const protectedPaths = new Set<string>(), visited = new Set<string>();
  const inspect = async (directory: string) => {
    const marker = join(directory, '.git');
    let info;
    try { info = await stat(marker); } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
      throw new ActionFailure('Git metadata could not be inspected', 'not-run');
    }
    let target = marker;
    if (info.isFile()) {
      if (info.size > 4096) throw new ActionFailure('Git pointer is too large to inspect', 'not-run');
      const match = /^gitdir: ([^\r\n]+)\r?\n?$/.exec(await readFile(marker, 'utf8'));
      if (!match) throw new ActionFailure('Git pointer could not be inspected', 'not-run');
      target = resolve(directory, match[1]!);
    }
    target = realpathSync(target); protectedPaths.add(target);
    try {
      const common = join(target, 'commondir'), commonInfo = await stat(common);
      if (!commonInfo.isFile() || commonInfo.size > 4096) throw Error('Invalid common Git directory');
      const commonTarget = (await readFile(common, 'utf8')).replace(/\r?\n$/, '');
      if (!commonTarget || /[\r\n]/.test(commonTarget)) throw Error('Invalid common Git directory');
      protectedPaths.add(realpathSync(resolve(target, commonTarget)));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ActionFailure('Shared Git metadata could not be inspected', 'not-run'); }
  };
  const walk = async (directory: string): Promise<void> => {
    if (visited.has(directory)) return;
    visited.add(directory);
    if (visited.size > 20_000) throw new ActionFailure('Write roots are too large to inspect safely', 'not-run');
    await inspect(directory);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !['.git', '.codex', '.claude'].includes(entry.name)) await walk(join(directory, entry.name));
    }
  };
  for (const root of roots) {
    await walk(root);
    for (let parent = dirname(root);;) {
      await inspect(parent);
      const next = dirname(parent); if (next === parent) break; parent = next;
    }
  }
  return [...protectedPaths];
}

export const hostConfinementAvailable=()=>process.platform==='darwin'&&existsSync('/usr/bin/sandbox-exec');
export const permitsOpaqueExecution=(mode:FilesystemMode|undefined)=>mode==='danger-full-access';

/** Filesystem confinement belongs to the command process, not the model or its transport. */
export async function executeCommand(policy: ExecutionPolicy, command: string, signal?: AbortSignal, timeoutMs = 30_000, beforeSpawn?: () => void, input?:string): Promise<CommandResult> {
  if(signal?.aborted)throw new ActionFailure('Command cancelled before dispatch','not-run');
  if (!['read-only', 'workspace-write', 'danger-full-access'].includes(policy.mode)) throw Error('Unknown filesystem mode');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw Error('Invalid command timeout');
  const workspace = realpathSync(policy.workspace);
  if (policy.mode !== 'danger-full-access' && !hostConfinementAvailable()) throw new ActionFailure('Filesystem confinement is unavailable on this host', 'not-run');
  const temporary = mkdtempSync(join(tmpdir(), 'openag-command-'));
  try {
    const roots = policy.mode === 'workspace-write' ? [workspace, realpathSync(temporary), ...(policy.writeRoots ?? []).map(p => realpathSync(p))] : [];
    const literal = (p: string) => '"' + p.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
    // Native config and Git hooks are execution authority; confined commands must not plant a native bypass.
    const protectedRoots = ['.codex', '.claude', '.mcp.json', '.git'].map(p => join(workspace, p));
    if (process.env.HOME) protectedRoots.push(process.env.CODEX_HOME ?? join(process.env.HOME, '.codex'), process.env.CLAUDE_CONFIG_DIR ?? join(process.env.HOME, '.claude'));
    if (policy.mode === 'workspace-write') protectedRoots.push(...await gitMetadata(roots));
    const protectedPaths = [...new Set(protectedRoots.flatMap(p => { try { return [p, realpathSync(p)]; } catch { return [p]; } }))];
    const metadata = '/(\\.git|\\.codex|\\.claude)(/|$)|/\\.mcp\\.json$';
    const profile = `(version 1) (allow default) (deny file-write*) (allow file-write* (literal "/dev/null")) ${roots.map(p => `(allow file-write* (subpath ${literal(p)}))`).join(' ')} ${protectedPaths.map(p => `(deny file-write* (subpath ${literal(p)}))`).join(' ')} (deny file-write* (regex #"${metadata}"))`;
    const argv = policy.mode === 'danger-full-access' ? ['/bin/sh', '-c', command] : ['/usr/bin/sandbox-exec', '-p', profile, '/bin/sh', '-c', command];
    if(signal?.aborted)throw new ActionFailure('Command cancelled before dispatch','not-run');
    beforeSpawn?.();
    return await new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(argv[0]!, argv.slice(1), {
        cwd: workspace, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: dirname(rgPath) + ':' + (process.env.PATH ?? '/usr/bin:/bin'), HOME: workspace, LANG: process.env.LANG ?? 'en_US.UTF-8', TMPDIR: temporary },
      });
      child.stdin?.on('error',()=>{});
      child.stdin.end(input);
      const stdout = { text: '', omitted: false }, stderr = { text: '', omitted: false };
      let truncated = false, timedOut = false, interrupted = false, settled = false;
      const limit = 64_000;
      const append = (output: typeof stdout, text: string) => {
        if (output.omitted) return;
        // Omit an overflowing stream so truncation cannot cut a secret before redaction.
        if (output.text.length + text.length > limit) { output.text = ''; output.omitted = true; truncated = true; }
        else output.text += text;
      };
      child.stdout.setEncoding('utf8').on('data', (text: string) => append(stdout, text));
      child.stderr.setEncoding('utf8').on('data', (text: string) => append(stderr, text));
      let killer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        interrupted = true;
        try { process.kill(-child.pid!, 'SIGTERM'); } catch {}
        killer ??= setTimeout(() => {
          try { process.kill(-child.pid!, 'SIGKILL'); } catch {}
          child.stdout.destroy(); child.stderr.destroy();
          finish(null);
        }, 1000);
      };
      const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
      const clean = () => { clearTimeout(timer); clearTimeout(killer); signal?.removeEventListener('abort', stop); };
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) stop();
      child.once('error', () => { clean(); reject(new ActionFailure('Command process could not start', 'not-run')); });
      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        try { process.kill(-child.pid!, 'SIGKILL'); } catch {}
        clean();
        const redactor = getDefaultRedactor();
        const safe = (output: typeof stdout) => {
          if (output.omitted) return '[output omitted: limit exceeded]';
          const text = redactor.redactString(output.text);
          if (text.length > limit) truncated = true;
          return text.slice(0, limit);
        };
        const out = safe(stdout), err = safe(stderr);
        resolve({ untrusted: true, exitCode, stdout: out, stderr: err, timedOut, interrupted, truncated });
      };
      child.once('close', finish);
    });
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
