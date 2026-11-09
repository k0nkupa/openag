import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { managedPath } from "./package-files.js";
import { connectorCredentialStore } from "./connector-credentials.js";
import { getDefaultRedactor } from "./redact.js";

const STAGE = /^\.key-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;
const FAILURE = "Connector key needs recovery on the OpenAg computer. Restore its original private key or existing connector-key configuration.";
const present = (path: string) => { try { lstatSync(path); return true; } catch (err) { if ((err as NodeJS.ErrnoException).code === "ENOENT") return false; throw err; } };

/** Stable daemon-only key. Never replace a missing original behind encrypted accounts. */
export function resolveConnectorKey(dataDir: string, connector: "google" | "composio" | "mcp" | "mcp-oauth", supplied?: string): string {
  if (supplied) getDefaultRedactor().addSecret(supplied);
  if (supplied && !/^[a-fA-F0-9]{64}$/.test(supplied)) throw Error(FAILURE);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const dir = managedPath(dataDir, ".connectors");
  try { mkdirSync(dir, { mode: 0o700 }); } catch (err) { if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw Error(FAILURE); }
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid?.() || (st.mode & 0o077)) throw Error(FAILURE);
  const file = join(dir, "key"), initialized = join(dir, "initialized");
  function read(path = file): string {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      let info = fstatSync(fd);
      if (!info.isFile() || info.size !== 64 || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw Error(FAILURE);
      // Recover only our interrupted publication links, never unrelated hard links.
      if (path !== file && info.nlink !== 1) throw Error(FAILURE);
      if (info.nlink > 1) {
        for (const name of readdirSync(dir)) {
          if (!STAGE.test(name)) continue;
          try { const stage = join(dir, name), entry = lstatSync(stage); if (entry.isFile() && entry.ino === info.ino && entry.dev === info.dev) unlinkSync(stage); }
          catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
        }
        info = fstatSync(fd);
      }
      const bytes = Buffer.alloc(65), length = readSync(fd, bytes, 0, bytes.length, 0), after = fstatSync(fd);
      const key = bytes.subarray(0, length).toString("utf8");
      if (length !== 64 || info.nlink !== 1 || after.size !== 64 || info.mtimeMs !== after.mtimeMs || info.ctimeMs !== after.ctimeMs || !/^[a-fA-F0-9]{64}$/.test(key)) throw Error(FAILURE);
      return key;
    } finally { closeSync(fd); }
  }
  try {
    if (!present(file)) {
      if (!supplied && present(initialized)) throw Error(FAILURE);
      const pending = readdirSync(dir).filter(name => STAGE.test(name));
      if (pending.length > 1) throw Error(FAILURE);
      let stage: string, candidate: string;
      if (pending.length === 1) {
        stage = join(dir, pending[0]!);
        candidate = read(stage);
        if (supplied && candidate.toLowerCase() !== supplied.toLowerCase()) throw Error(FAILURE);
      } else {
        if (!supplied && ["google", "composio", "mcp", "mcp-oauth"].some(name => present(managedPath(dataDir, `connector-${name}.enc`)))) throw Error(FAILURE);
        candidate = supplied ?? randomBytes(32).toString("hex");
        stage = join(dir, `.key-${randomUUID()}.tmp`);
      }
      // A healthy saved connection proves the key without depending on another connector.
      const hasOwnRecord = present(managedPath(dataDir, `connector-${connector}.enc`));
      connectorCredentialStore(dataDir, candidate, connector).read();
      if (!hasOwnRecord) {
        // Before a new connector has a record, preserve legacy key validation for its peer.
        for (const peer of (["google", "composio", "mcp", "mcp-oauth"] as const).filter(name => name !== connector)) connectorCredentialStore(dataDir, candidate, peer).read();
      }
      if (pending.length === 0) writeFileSync(stage, candidate, { mode: 0o600, flag: "wx" });
      const fd = openSync(stage, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { fsyncSync(fd); } finally { closeSync(fd); }
      try { linkSync(stage, file); }
      catch (err) { if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err; }
      finally { try { unlinkSync(stage); } catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; } }
    }
    const key = read();
    if (supplied && supplied.toLowerCase() !== key.toLowerCase()) throw Error(FAILURE);
    // Publish this marker before any caller can use the key to encrypt account state.
    try { writeFileSync(initialized, "", { mode: 0o600, flag: "wx" }); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err; }
    getDefaultRedactor().addSecret(key);
    return key;
  } catch { throw Error(FAILURE); }
}
