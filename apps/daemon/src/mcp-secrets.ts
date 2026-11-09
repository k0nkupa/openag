import { existsSync } from "node:fs";
import { connectorCredentialStore } from "./connector-credentials.js";
import { resolveConnectorKey } from "./connector-key.js";
import { managedPath } from "./package-files.js";
import { getDefaultRedactor, type Redactor } from "./redact.js";

/**
 * Direct secrets for custom MCP http servers (OA-455). Values live ONLY in `connector-mcp.enc` (the connector store, encrypted with
 * the stable `.connectors/key`), never in `mcp.json`, the database, the ledger or any environment. A header refers to one as
 * `${secret:NAME}`. Each secret belongs to ONE server and is bound to that server's origin: it resolves only while the entry still
 * points at that origin, so a repointed or reused id can never send it to another host. Anything unresolvable fails closed.
 */

export const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
export const MAX_SECRET_VALUE = 1024;
/** The store record is capped at 60000 bytes; 40 secrets of at most 1 KiB (plus keys and origins) stay well inside it. */
export const MAX_SECRETS = 40;

export class McpSecretError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 503) { super(message); }
}

interface Record_ { value: string; origin: string }
type Book = { version: 1; servers: Record<string, Record<string, Record_>> };

export interface McpSecretView { serverId: string; name: string; origin: string; /** Last four characters, only when the value is long enough that this reveals little; otherwise null ("set"). */ last4: string | null }

export interface McpSecrets {
  /** The value, but only while the secret exists for this server AND its origin still matches. Never throws. */
  get(serverId: string, name: string, origin: string | undefined): string | undefined;
  /** Names and last four only. Throws McpSecretError when the store cannot be read (for example the key needs recovery). */
  list(): McpSecretView[];
  set(serverId: string, name: string, value: string, origin: string): McpSecretView;
  remove(serverId: string, name: string): boolean;
  /** Removes every secret of a server (the server was removed or repointed). Returns how many. */
  dropServer(serverId: string): number;
  checkpoint():()=>void;
  /** Registers every stored value with the redactor (startup). */
  register(): void;
}

const own = <T>(object: Record<string, T>, key: string): T | undefined => (Object.hasOwn(object, key) ? object[key] : undefined);

export function createMcpSecrets(opts: { dataDir: string; env?: NodeJS.ProcessEnv; redactor?: Redactor }): McpSecrets {
  const redactor = opts.redactor ?? getDefaultRedactor();
  const file = () => managedPath(opts.dataDir, "connector-mcp.enc");
  // The key is resolved only when a record exists or is about to be written, so an installation without secrets never creates one.
  const store = () => connectorCredentialStore(opts.dataDir, resolveConnectorKey(opts.dataDir, "mcp", (opts.env ?? process.env).OPENAG_CONNECTOR_KEY), "mcp");

  function read(): Book {
    if (!existsSync(file())) return { version: 1, servers: {} };
    let raw: unknown;
    try { raw = store().read(); } catch { throw new McpSecretError("MCP secrets cannot be read; the connector key or file needs recovery on the OpenAg computer", 503); }
    const book = raw as Book | null;
    if (!book || book.version !== 1 || typeof book.servers !== "object" || book.servers === null) throw new McpSecretError("MCP secrets file is not valid", 503);
    return book;
  }
  function write(book: Book): void {
    try { store().write(book); } catch { throw new McpSecretError("MCP secrets could not be saved", 503); }
  }
  const count = (book: Book) => Object.values(book.servers).reduce((total, server) => total + Object.keys(server).length, 0);
  const view = (serverId: string, name: string, record: Record_): McpSecretView =>
    ({ serverId, name, origin: record.origin, last4: record.value.length >= 12 ? record.value.slice(-4) : null });

  return {
    get(serverId, name, origin) {
      try {
        if (origin === undefined) return undefined;
        const record = own(own(read().servers, serverId) ?? {}, name);
        return record && record.origin === origin && record.value !== "" ? record.value : undefined;
      } catch { return undefined; }
    },
    list() {
      const book = read();
      return Object.entries(book.servers).flatMap(([serverId, secrets]) => Object.entries(secrets).map(([name, record]) => view(serverId, name, record)))
        .sort((a, b) => a.serverId.localeCompare(b.serverId) || a.name.localeCompare(b.name));
    },
    set(serverId, name, value, origin) {
      if (!SECRET_NAME_RE.test(name)) throw new McpSecretError("a secret name uses A-Z, 0-9 and _, starts with a letter and has at most 64 characters", 400);
      if (value === "" || value.length > MAX_SECRET_VALUE || /[\u0000-\u001f\u007f]/.test(value)) throw new McpSecretError(`a secret value is 1 to ${MAX_SECRET_VALUE} characters without control characters`, 400);
      const book = read();
      const existing = own(book.servers, serverId) ?? {};
      if (!Object.hasOwn(existing, name) && count(book) >= MAX_SECRETS) throw new McpSecretError(`at most ${MAX_SECRETS} secrets can be stored`, 409);
      // Registered before it is saved: from here on no log, ledger or approval line can carry it.
      redactor.addSecret(value);
      // The redactor skips values it cannot match safely (short ones, ones with spaces, path- or URL-like ones). Storing such a value would let a server echo it into a result unmasked.
      if (redactor.redactString(value) === value) throw new McpSecretError("a secret value needs at least 12 characters, with no spaces, so it can be kept out of logs", 400);
      const record = { value, origin };
      write({ version: 1, servers: { ...book.servers, [serverId]: { ...existing, [name]: record } } });
      return view(serverId, name, record);
    },
    remove(serverId, name) {
      const book = read(), existing = own(book.servers, serverId);
      if (!existing || !Object.hasOwn(existing, name)) return false;
      const { [name]: _gone, ...rest } = existing;
      const { [serverId]: _server, ...others } = book.servers;
      write({ version: 1, servers: Object.keys(rest).length ? { ...others, [serverId]: rest } : others });
      return true;
    },
    checkpoint:()=>existsSync(file())?store().checkpoint():()=>{},
    dropServer(serverId) {
      const book = read(), existing = own(book.servers, serverId);
      if (!existing) return 0;
      const { [serverId]: _server, ...others } = book.servers;
      write({ version: 1, servers: others });
      return Object.keys(existing).length;
    },
    register() {
      try { for (const secrets of Object.values(read().servers)) for (const record of Object.values(secrets)) redactor.addSecret(record.value); } catch { /* unreadable store: nothing to register; entries fail closed */ }
    },
  };
}
