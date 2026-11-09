import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { join } from "node:path";
import type { Auth } from "./auth.js";
import type { Ledger } from "./ledger.js";
import { ownerDirectory } from "./owner-credential.js";

const REQUEST = "open-desk\n";
const FAILURE = "Cannot open the desk. Check that this workspace's daemon is running as your OS user.";

export function ownerSocketPath(dataDir: string): string {
  const dir = ownerDirectory(dataDir), path = join(dir, "access.sock");
  if (Buffer.byteLength(path) <= 100) return path;
  // Long workspace paths still need to fit macOS sockaddr_un; the fallback remains owner-only.
  const runtime = `/tmp/openag-owner-${process.getuid?.()}`;
  try { mkdirSync(runtime, { mode: 0o700 }); }
  catch (err) { if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err; }
  const st = lstatSync(runtime);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid?.() || (st.mode & 0o077)) throw Error("Unsafe owner socket runtime directory");
  return join(runtime, createHash("sha256").update(dir).digest("hex").slice(0, 40) + ".sock");
}

export async function startOwnerAccess(dataDir: string, port: number, auth: Auth, ledger: Ledger) {
  const path = ownerSocketPath(dataDir);
  try {
    const st = lstatSync(path);
    if (!st.isSocket() || st.uid !== process.getuid?.() || (st.mode & 0o077)) throw Error("Unsafe owner access socket");
    const live = await new Promise<boolean>((resolve, reject) => {
      const probe = createConnection(path);
      probe.setTimeout(1000, () => { probe.destroy(); reject(Error("Owner access socket is busy")); });
      probe.once("connect", () => { probe.destroy(); resolve(true); });
      probe.once("error", (err: NodeJS.ErrnoException) => err.code === "ECONNREFUSED" ? resolve(false) : reject(Error("Cannot inspect owner access socket")));
    });
    if (live) throw Error("An owner access daemon already uses this workspace");
    const current = lstatSync(path);
    if (current.ino !== st.ino || current.dev !== st.dev) throw Error("Owner access socket changed");
    unlinkSync(path);
  } catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
  const clients = new Set<Socket>();
  const server = createServer(socket => {
    if (clients.size >= 8) { socket.destroy(); return; }
    clients.add(socket);
    socket.setTimeout(3000, () => socket.destroy());
    socket.on("error", () => socket.destroy());
    socket.once("close", () => clients.delete(socket));
    let input = "", handled = false;
    socket.on("data", chunk => {
      if (handled) return;
      input += chunk.toString("utf8");
      if (Buffer.byteLength(input) > 64 || !REQUEST.startsWith(input)) { socket.destroy(); return; }
      if (input !== REQUEST) return;
      handled = true;
      try {
        const { code, expiresAt } = auth.createPairingCode("owner", "full");
        ledger.append("_system", "user", "config", { action: "pairing_code_created", by: "owner", access: "full", via: "host" });
        socket.end(JSON.stringify({ url: `http://127.0.0.1:${port}/#/join/${code}/full`, expiresAt }) + "\n");
      } catch { socket.end(JSON.stringify({ error: "Cannot create pairing grant; active grants expire after five minutes" }) + "\n"); }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, resolve); });
  chmodSync(path, 0o600);
  const own = lstatSync(path);
  return () => {
    for (const client of clients) client.destroy();
    server.close();
    try { const st = lstatSync(path); if (st.ino === own.ino && st.dev === own.dev) unlinkSync(path); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
  };
}

/** Only contacts protected host state; never reads or sends the root credential. */
export async function requestDeskAccess(dataDir: string): Promise<string> {
  let path: string;
  try {
    path = ownerSocketPath(dataDir);
    const st = lstatSync(path);
    if (!st.isSocket() || st.uid !== process.getuid?.() || (st.mode & 0o077)) throw Error(FAILURE);
  } catch { throw Error(FAILURE); }
  return await new Promise<string>((resolve, reject) => {
    const socket = createConnection(path);
    let ended = false;
    const fail = () => { socket.destroy(); reject(Error(FAILURE)); };
    socket.setTimeout(4000, fail);
    socket.once("error", fail);
    socket.once("connect", () => socket.write(REQUEST));
    socket.once("close", () => { if (!ended) fail(); });
    let body = "";
    socket.on("data", chunk => { body += chunk.toString("utf8"); if (Buffer.byteLength(body) > 1024) fail(); });
    socket.once("end", () => {
      ended = true;
      socket.destroy();
      try {
        const value = JSON.parse(body) as { url?: unknown; error?: unknown };
        if (typeof value.error === "string") { reject(Error("Cannot create pairing grant; try again after five minutes")); return; }
        if (typeof value.url !== "string" || !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/#\/join\/[A-Z2-9]{4}-[A-Z2-9]{4}\/full$/.test(value.url)) throw Error();
        const port = Number(new URL(value.url).port || "80");
        if (!port || port > 65535) throw Error();
        resolve(value.url);
      } catch { reject(Error(FAILURE)); }
    });
  });
}
