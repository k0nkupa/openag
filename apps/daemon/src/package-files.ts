import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export const PACKAGE_MAX_BYTES = 5 * 1024 * 1024;
export interface PackageFile { rel: string; abs: string; sig: string; size: number; mode: number; ino: number; dev: number }
export type PackageTree = { files: PackageFile[] } | { error: string };

/** Canonicalise system aliases (for example macOS /tmp), but refuse links within a managed root. */
export function managedPath(root: string, relative = ""): string {
  const st = lstatSync(root);
  if (!st.isDirectory() || st.isSymbolicLink() || (typeof process.getuid === "function" && st.uid !== process.getuid()) || (st.mode & 0o022)) throw Error("target directory must be owned by this user and not writable by others");
  const canonical = realpathSync(root), target = resolve(canonical, relative);
  if (target !== canonical && !target.startsWith(canonical + sep)) throw Error("path is outside the target directory");
  let current = target;
  while (current !== canonical) {
    try { const item = lstatSync(current); if (item.isSymbolicLink()) throw Error("symlinks are not allowed in the target path"); if (item.isDirectory() && ((item.mode & 0o022) || typeof process.getuid === "function" && item.uid !== process.getuid())) throw Error("target path contains an unsafe directory"); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
    current = dirname(current);
  }
  return target;
}

/** The same ordered file tree used for App approval and local package publication. data/ is never code. */
export function packageFiles(dir: string): PackageTree {
  const files: PackageFile[] = []; let total = 0, directories = 0;
  try {
    if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) return { error: "not a plain folder" };
    const visit = (abs: string, rel: string, depth: number): string | null => {
      if (++directories > 200 || depth > 32) return "app folder has too many directories";
      for (const name of readdirSync(abs).sort()) {
        if (!rel && name === "data") continue;
        const path = join(abs, name), r = rel ? `${rel}/${name}` : name, st = lstatSync(path);
        if (st.isSymbolicLink()) return `${r}: symlinks are not allowed inside an app`;
        if (st.isDirectory()) { const error = visit(path, r, depth + 1); if (error) return error; }
        else if (st.isFile()) {
          total += st.size;
          if (files.length >= 200 || total > PACKAGE_MAX_BYTES) return "app folder is too large";
          files.push({ rel: r, abs: path, sig: `${r}:${st.size}:${st.mtimeMs}:${st.ctimeMs}:${st.ino}`, size: st.size, mode: st.mode, ino: st.ino, dev: st.dev });
        } else return `${r}: not a plain file`;
      }
      return null;
    };
    const error = visit(dir, "", 0); return error ? { error } : { files };
  } catch { return { error: "could not be read" }; }
}

/** Capture bounded bytes once: the digest and copied files describe the exact same snapshot. */
export function packageContents(dir: string, tree = packageFiles(dir)) {
  if ("error" in tree) throw Error(tree.error);
  const hash = createHash("sha256"), files: { rel: string; body: Buffer; mode: number }[] = [];
  const root = realpathSync(dir);
  for (const file of tree.files) {
    const real = realpathSync(file.abs); if (!real.startsWith(root + sep)) throw Error("package path escaped its folder");
    const fd = openSync(file.abs, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || before.ino !== file.ino || before.dev !== file.dev || before.size !== file.size) throw Error("package changed while being read");
      const bytes = Buffer.alloc(file.size + 1); let count = 0;
      while (count < bytes.length) { const n = readSync(fd, bytes, count, bytes.length - count, null); if (!n) break; count += n; }
      const after = fstatSync(fd);
      if (count !== file.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw Error("package changed while being read");
      const body = bytes.subarray(0, count);
      hash.update(`${file.rel}\0${body.length}\0`).update(body);
      files.push({ rel: file.rel, body, mode: file.mode });
    } finally { closeSync(fd); }
  }
  return { hash: hash.digest("hex"), files };
}
