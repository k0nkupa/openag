import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { managedPath } from "./package-files.js";

/** Private encrypted store, separate from SQLite/backups. The key is supplied only to the daemon. */
export function connectorCredentialStore(dataDir: string, keyHex: string, name: "google" | "composio" | "mcp" | "mcp-oauth") {
  if (!/^[a-fA-F0-9]{64}$/.test(keyHex)) throw Error("A 32-byte OPENAG_CONNECTOR_KEY is required");
  const key = Buffer.from(keyHex, "hex");
  const path = () => managedPath(dataDir, `connector-${name}.enc`);
  const aad = () => Buffer.from(name === "google" ? "OpenAg Google credentials v1" : name === "mcp" ? "OpenAg MCP secrets v1" : name === "mcp-oauth" ? "OpenAg MCP OAuth v1" : "OpenAg Composio credentials v1");
  function read(): unknown | null {
    const file = path(); if (!existsSync(file)) return null;
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const st = fstatSync(fd);
      if (!st.isFile() || st.nlink !== 1 || st.size > 65536 || (st.mode & 0o077) || typeof process.getuid === "function" && st.uid !== process.getuid()) throw Error("Unsafe Connector credential file");
      const buffer = Buffer.alloc(65537); let length = 0;
      for (;;) { const n = readSync(fd, buffer, length, buffer.length - length, null); if (!n) break; length += n; if (length === buffer.length) break; }
      const after = fstatSync(fd);
      if (length !== st.size || st.size !== after.size || st.mtimeMs !== after.mtimeMs || st.ctimeMs !== after.ctimeMs) throw Error("Connector credentials changed while reading");
      const bytes = buffer.subarray(0, length);
      if (bytes.length < 29 || bytes.length > 65536 || bytes[0] !== 1) throw Error("Invalid Connector credential file");
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(1, 13));
      decipher.setAAD(aad());
      decipher.setAuthTag(bytes.subarray(13, 29));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(29)), decipher.final()]).toString("utf8"));
    } finally { closeSync(fd); }
  }
  function write(value: unknown) {
    // Validate any existing target before replacing it; never follow or overwrite an unsafe file.
    read();
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad());
    const body = Buffer.from(JSON.stringify(value)); if (body.length > 60000) throw Error("Connector credential record too large");
    const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
    const stage = managedPath(dataDir, `.${name}-${randomUUID()}.tmp`);
    writeFileSync(stage, Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]), { mode: 0o600, flag: "wx" });
    try { read(); renameSync(stage, path()); } finally { if (existsSync(stage)) unlinkSync(stage); }
  }
  // Used only by synchronous config transactions; no other store writer can interleave before rollback.
  function checkpoint(){const before=read();return ()=>{if(before===null){if(existsSync(path()))unlinkSync(path());}else write(before);};}
  return { read, write, checkpoint };
}
