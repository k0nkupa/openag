import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CODEX_DAEMON_DISABLED_FEATURES = [
  'shell_tool', 'js_repl', 'code_mode', 'code_mode_only', 'multi_agent', 'multi_agent_v2',
  'apps', 'connectors', 'plugins', 'tool_suggest', 'browser_use', 'computer_use', 'image_generation',
  'hooks', 'codex_hooks', 'plugin_hooks', 'skill_search', 'memories', 'memory_tool', 'external_agent_memory_import', 'chronicle',
] as const;

const pinnedCli = () => {
  const require = createRequire(import.meta.url);
  return createRequire(require.resolve('@agentclientprotocol/codex-acp/package.json')).resolve('@openai/codex/bin/codex.js');
};

interface InheritedServer { name: string; transport: 'stdio' | 'http' }
export type DisabledServers = Record<string, { enabled: false; command?: string; args?: string[]; url?: string }>;

/** Read config only: return transport kinds, never URLs, arguments, credentials or installation mutations. */
export async function codexMcpServers(cwd: string, env: NodeJS.ProcessEnv): Promise<InheritedServer[]> {
  const cli = pinnedCli();
  return await new Promise((resolve, reject) => {
    // Match the ACP adapter's transient workspace trust so project-layer servers cannot appear only after probing.
    const child = spawn(process.execPath, [cli, 'app-server', ...CODEX_DAEMON_DISABLED_FEATURES.flatMap(name => ['--disable', name]), '-c', `projects={${JSON.stringify(cwd)}={trust_level="trusted"}}`], { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.resume();
    let buffer = '', size = 0, settled = false;
    const finish = (servers?: InheritedServer[]) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { process.kill(-child.pid!, 'SIGTERM'); } catch {}
      const killer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} }, 1000);
      child.once('exit', () => clearTimeout(killer));
      if (servers) resolve(servers); else reject(Error('Native Codex configuration could not be isolated'));
    };
    const timer = setTimeout(() => finish(), 20_000);
    child.once('error', () => finish());
    child.once('exit', () => { if (!settled) finish(); });
    const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n');
    child.stdin.on('error', () => finish());
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length; if (size > 2_000_000) return finish();
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        let message; try { message = JSON.parse(line); } catch { return finish(); }
        if (message.id === 1) {
          if (message.error) return finish();
          send({ jsonrpc: '2.0', method: 'initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'config/read', params: { cwd, includeLayers: false } });
        } else if (message.id === 2) {
          if (message.error || !message.result?.config) return finish();
          const servers = message.result.config.mcp_servers;
          if (servers != null && (typeof servers !== 'object' || Array.isArray(servers))) return finish();
          // Disabled declarations can belong to another environment; do not recreate them as local transports.
          const active: InheritedServer[] = [];
          for (const [name, entry] of Object.entries(servers ?? {})) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return finish();
            const value = entry as { enabled?: boolean; command?: unknown; url?: unknown };
            if (value.enabled === false) continue;
            if (!/^[A-Za-z0-9_-]+$/.test(name)) return finish();
            const stdio = typeof value.command === 'string', http = typeof value.url === 'string';
            if (stdio === http) return finish();
            active.push({ name, transport: stdio ? 'stdio' : 'http' });
          }
          finish(active);
        }
      }
    });
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'openagd-config', version: '1' }, capabilities: {} } });
  });
}

/** Disable inherited transports before startup and preserve those exclusions in the session map. */
export async function prepareCodexIsolation(cwd: string, env: NodeJS.ProcessEnv): Promise<{ executable: string; servers: DisabledServers; dispose(): void }> {
  const servers = await codexMcpServers(cwd, env);
  const directory = mkdtempSync(join(tmpdir(), 'openag-codex-launch-'));
  const executable = join(directory, 'codex');
  const quote = (s: string) => "'" + s.replaceAll("'", "'\"'\"'") + "'";
  const disabled: DisabledServers = Object.fromEntries(servers.map(server => [server.name, server.transport === 'stdio' ? { enabled: false, command: '/usr/bin/false', args: [] } : { enabled: false, url: 'http://127.0.0.1:1/disabled' }]));
  const table = '{' + Object.entries(disabled).map(([name, value]) => JSON.stringify(name) + '={' + Object.entries(value).map(([key, entry]) => key + '=' + JSON.stringify(entry)).join(',') + '}').join(',') + '}';
  const overrides = [...CODEX_DAEMON_DISABLED_FEATURES.flatMap(name => ['--disable', name]), '-c', 'mcp_servers=' + table];
  try {
    writeFileSync(executable, `#!/bin/sh
exec ${quote(process.execPath)} ${quote(pinnedCli())} "$@" ${overrides.map(quote).join(' ')}
`, { mode: 0o700, flag: 'wx' });
    return { executable, servers: disabled, dispose: () => rmSync(directory, { recursive: true, force: true }) };
  } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
}
