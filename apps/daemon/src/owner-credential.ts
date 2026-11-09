import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { managedPath } from "./package-files.js";
import { getDefaultRedactor } from "./redact.js";

/** Owner-only host state. Never part of memory, product knowledge or SQLite backups. */
export function ownerDirectory(dataDir: string): string {
  const path = managedPath(dataDir, ".owner");
  const st = lstatSync(path);
  if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077) || st.uid !== process.getuid?.()) throw Error("Owner state directory must be private and owned by this user");
  return path;
}

export function resolveOwnerCredential(dataDir: string, supplied?: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = managedPath(dataDir, ".owner");
  const existing = existsSync(path) || existsSync(join(dataDir, "openag.db"));
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  const dir = ownerDirectory(dataDir), file = join(dir, "credential.json");
  function read(): string {
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      let st = fstatSync(fd);
      if (!st.isFile() || (st.mode & 0o077) || st.uid !== process.getuid?.() || st.size > 65536) throw Error();
      // A crash after publication can leave our staging name linked to the original credential.
      if (st.nlink > 1) {
        for (const name of readdirSync(dir)) {
          if (!/^\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/.test(name)) continue;
          try {
            const stage = join(dir, name), staged = lstatSync(stage);
            if (staged.isFile() && staged.dev === st.dev && staged.ino === st.ino) unlinkSync(stage);
          } catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
        }
        st = fstatSync(fd);
      }
      if (st.nlink !== 1) throw Error();
      const value: unknown = JSON.parse(readFileSync(fd, "utf8"));
      if (!value || typeof value !== "object" || typeof (value as { token?: unknown }).token !== "string") throw Error();
      const token = (value as { token: string }).token;
      if (!token) throw Error();
      return token;
    } catch { throw Error("Owner credential is unreadable or unsafe; restore the original credential, never replace it automatically"); }
    finally { closeSync(fd); }
  }
  let token: string;
  if (existsSync(file) || lstatExists(file)) {
    token = read();
    if (supplied && supplied !== token) throw Error("OPENAG_TOKEN conflicts with the stored owner credential; keep the original credential");
  } else {
    if (existing && !supplied) throw Error("Existing owner state needs the original OPENAG_TOKEN once for migration, or restoration of its credential file");
    token = supplied || randomBytes(32).toString("hex");
    const body = JSON.stringify({ token });
    if (Buffer.byteLength(body) > 65536) throw Error("Owner credential is too large to store safely");
    const stage = join(dir, `.${randomUUID()}.tmp`);
    writeFileSync(stage, body, { mode: 0o600, flag: "wx" });
    const fd = openSync(stage, constants.O_RDONLY);
    try { fsyncSync(fd); } finally { closeSync(fd); }
    try { linkSync(stage, file); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err; }
    finally {
      try { unlinkSync(stage); }
      catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
    }
    const stored = read();
    if (supplied && stored !== supplied) throw Error("OPENAG_TOKEN conflicts with the stored owner credential");
    token = stored;
  }
  getDefaultRedactor().addSecret(token);
  return token;
}

function lstatExists(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") return false; throw err; }
}
