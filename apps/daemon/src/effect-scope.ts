import { dirname, isAbsolute, relative, resolve, join } from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';

/** Only daemon executors supply scopes; tool arguments and provider hints cannot. */
export type EffectScope = { kind: 'read' } | { kind: 'opaque' } | { kind: 'paths'; paths: string[] };
export const opaqueScope: EffectScope = { kind: 'opaque' };
export function effectScope(value: unknown): EffectScope {
  const v = value as EffectScope | undefined;
  if (v?.kind === 'read') return { kind: 'read' };
  if (v?.kind === 'paths' && Array.isArray(v.paths) && v.paths.length > 0 && v.paths.every(p => typeof p === 'string' && /^[\x20-\x7e]+$/.test(p) && isAbsolute(p) && resolve(p) === p)) return { kind: 'paths', paths: [...new Set(v.paths)].sort() };
  return opaqueScope;
}
export function scopesConflict(a: EffectScope, b: EffectScope): boolean {
  if (a.kind === 'read' || b.kind === 'read') return false;
  if (a.kind === 'opaque' || b.kind === 'opaque') return true;
  // Conservatively fold ASCII case on every host; non-ASCII identities stay opaque.
  const inside = (root: string, path: string) => { const r = relative(root.toLowerCase(), path.toLowerCase()); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
  return a.paths.some(x => b.paths.some(y => inside(x, y) || inside(y, x)));
}
/** Resolve missing suffixes without creating files; refuse symlink/hard-link write aliases. */
export function writeTarget(path: string): string {
  const target = resolve(path);
  let current = target;
  for (;;) {
    try {
      const stat = lstatSync(current);
      if ((current === target && stat.isSymbolicLink()) || (stat.isFile() && stat.nlink > 1)) throw Error('Scoped writes refuse symbolic links and hard-linked files.');
      if (current !== target && !stat.isDirectory() && !stat.isSymbolicLink()) throw Error('Write parent is not a directory.');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (dirname(current) === current) break;
    current = dirname(current);
  }
  // Canonicalize existing ancestors (including platform aliases supplied by the caller).
  current = target;
  const suffix: string[] = [];
  for (;;) {
    try { return join(realpathSync(current), ...suffix); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; suffix.unshift(relative(dirname(current), current)); current = dirname(current); }
  }
}

/** Redacted paths are display text, never target identities. Fail closed if any scope changes. */
export function protectScope(value:unknown,redact:(value:unknown)=>unknown):EffectScope {
  const scope=effectScope(value);
  return JSON.stringify(redact(scope))===JSON.stringify(scope)?scope:opaqueScope;
}
