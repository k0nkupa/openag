import { z } from "zod";
import { managedPath } from "./package-files.js";
import { McpAuditError, McpConfigBusyError, McpConfigConflictError, updateMcpConfig, withSetupLock, type McpConfigValue } from "./mcp-config-write.js";
import { McpSecretError, type McpSecrets, type McpSecretView } from "./mcp-secrets.js";
import { McpOAuthError } from "./mcp-oauth.js";
import { buildReview, workDirOf, type ReviewRecord } from "./mcp-command-review-core.js";
import { ensureDirectory } from "./mcp-config-write.js";
import { McpConfigUnsafeError } from "./mcp-config.js";
import { newReferenceProblem } from "./secret-env.js";
import { COMPOSIO_SERVER_ID } from "./composio-connect.js";
import { ID_RE, validateServerItem, type McpManager, type ServerStatus } from "./mcp.js";
import type { Approvals } from "./approvals.js";

/** The owner's write path for custom MCP servers: validate, write `mcp.json` under the shared lock, bring ONE server in line, expire stale approvals. */

export const MAX_MCP_SERVERS = 50;

export class McpServerError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 503) { super(message); }
}

const headers = z.record(z.string().min(1).max(200), z.string().max(2048));
/** OAuth sign-in settings for a remote server. No secret is part of them. */
export const oauthSchema = z.object({ scope: z.string().min(1).max(200).optional(), clientMetadataUrl: z.string().min(1).max(500).optional() }).strict();
const fields = {
  url: z.string().min(1).max(2048),
  headers,
  allowPrivateNetwork: z.boolean(),
  offerToAgents: z.boolean(),
  enabled: z.boolean(),
  timeoutMs: z.number().int().min(1000).max(120000),
  oauth: oauthSchema.nullable(),
};
export const addServerSchema = z.object({
  id: z.string().regex(ID_RE, "id must match ^[a-z][a-z0-9_-]{0,31}$"),
  url: fields.url,
  headers: headers.default({}),
  allowPrivateNetwork: fields.allowPrivateNetwork.default(false),
  offerToAgents: fields.offerToAgents.default(true),
  enabled: fields.enabled.default(true),
  timeoutMs: fields.timeoutMs.optional(),
  oauth: oauthSchema.optional(),
  digest: z.string().min(1).max(128).optional(),
}).strict();
export const updateServerSchema = z.object({ ...fields, digest: z.string().min(1).max(128) }).partial({ url: true, headers: true, allowPrivateNetwork: true, offerToAgents: true, enabled: true, timeoutMs: true, oauth: true }).strict();
export const removeServerSchema = z.object({ digest: z.string().min(1).max(128) }).strict();

type Raw = Record<string, unknown>;
export interface CommandProposal {
  id: string; command: string; args: string[]; env: { name: string; template: string }[];
  timeoutMs?: number; offerToAgents: boolean; enabled: boolean;
  /** The review hash of the desk command being replaced, or null for a new server. */
  replacesHash: string | null;
  /** What the owner approved. */
  review: ReviewRecord;
}
export interface McpServerChange { id: string; action: "added" | "updated" | "removed"; headerNames: string[]; digest: string; status: ServerStatus | undefined }

export interface McpServerService {
  add(input: z.infer<typeof addServerSchema>): Promise<McpServerChange>;
  update(id: string, input: z.infer<typeof updateServerSchema>): Promise<McpServerChange>;
  remove(id: string, input: z.infer<typeof removeServerSchema>): Promise<McpServerChange>;
  /**
   * Writes an APPROVED command review (OA-456): the entry is added, or the desk command it replaces is changed. Only a desk command
   * can be replaced, only if it is still the one the review was proposed against, and the review is rebuilt and must still match.
   */
  upsertCommand(proposal: CommandProposal): Promise<McpServerChange>;
  /** The reason a proposal would be refused when written (the same validation as the write), or null. Writes nothing. */
  previewCommand(proposal: Omit<CommandProposal, "review"> & { review: ReviewRecord }): string | null;
  /** Direct secrets (OA-455): names and last four only, never a value. */
  listSecrets(): McpSecretView[];
  /** `expectedOrigin` is the origin the owner was looking at; a different current origin is refused rather than bound. */
  setSecret(serverId: string, name: string, value: string, expectedOrigin?: string): Promise<McpSecretView>;
  removeSecret(serverId: string, name: string): Promise<void>;
}

/** The owner's editable view is redacted, so a client that sends it back unchanged would save a marker in place of a real value. */
const rejectRedactionMarker = (item: Raw) => { if (JSON.stringify(item).includes("[REDACTED")) throw new McpServerError("a value contains a redaction marker; type it again", 400); };
export const originOf = (value: unknown): string | undefined => { try { return new URL(String(value)).origin; } catch { return undefined; } };
const headerValues = (item: Raw): string[] => (item.headers && typeof item.headers === "object" ? Object.values(item.headers as Record<string, unknown>).filter((v): v is string => typeof v === "string") : []);
const headerNames = (item: Raw): string[] => (item.headers && typeof item.headers === "object" ? Object.keys(item.headers as Record<string, unknown>) : []);

export function createMcpServerService(deps: { dataDir: string; mcp: McpManager; approvals: Approvals; secrets?: McpSecrets; /** Sign-in state is dropped with the server (OA-457). */ oauth?: { dropServer(id: string): void;checkpoint():()=>void } }): McpServerService {
  const root = () => managedPath(deps.dataDir);

  /** Maps writer failures to HTTP-shaped errors; anything else is a real fault and propagates. */
  async function write<T>(run: () => Promise<T>): Promise<T> {
    try { return await run(); }
    catch (err) {
      if (err instanceof McpServerError) throw err;
      if (err instanceof McpSecretError) throw new McpServerError(err.message, err.status);
      if (err instanceof McpOAuthError) throw new McpServerError(err.message, err.status === 404 || err.status === 409 || err.status === 503 ? err.status : err.status === 403 ? 409 : 400);
      if (err instanceof McpConfigConflictError) throw new McpServerError("MCP configuration changed since you loaded it; reload and review again", 409);
      if (err instanceof McpConfigBusyError) throw new McpServerError(err.message, 409);
      if (err instanceof McpConfigUnsafeError) throw new McpServerError(`MCP configuration cannot be edited: ${err.message}`, 409);
      // Refused before anything was written: the audit file has to be fixed on the machine first.
      if (err instanceof McpAuditError) throw new McpServerError(`${err.message}; nothing was changed`, 409);
      throw err;
    }
  }

  const dropCredentials=(id:string,oauth:boolean,secrets:boolean)=>{
    const restore=[...(oauth&&deps.oauth?[deps.oauth.checkpoint()]:[]),...(secrets&&deps.secrets?[deps.secrets.checkpoint()]:[])];
    const rollback=()=>{for(const undo of restore.reverse())undo();};
    try{if(oauth)deps.oauth?.dropServer(id);if(secrets)deps.secrets?.dropServer(id);}catch(error){rollback();throw error;}
    return rollback;
  };

  const expireApprovals = (id: string) => {
    for (const approval of deps.approvals.listPending()) if (approval.toolName.startsWith(`mcp.${id}.`)) deps.approvals.expire(approval.id, "The MCP server changed. Request a fresh proposal.");
  };

  const finish = async (id: string, action: McpServerChange["action"], names: string[], digest: string): Promise<McpServerChange> => {
    await deps.mcp.applyServer(id);
    expireApprovals(id);
    return { id, action, headerNames: names, digest, status: deps.mcp.status().find(server => server.id === id) };
  };

  /** Finds the single raw item for an id the desk may change, or explains why it cannot. */
  function editable(servers: unknown[], id: string): { index: number; item: Raw } {
    if (id === COMPOSIO_SERVER_ID) throw new McpServerError("This connection is managed from its own sign-in screen", 409);
    const matches = servers.map((item, index) => ({ item, index })).filter(({ item }) => item && typeof item === "object" && (item as Raw).id === id);
    if (matches.length === 0) throw new McpServerError("server not found", 404);
    if (matches.length > 1) throw new McpServerError("this id appears more than once in mcp.json; fix the file by hand first", 409);
    const { item, index } = matches[0]!;
    const raw = item as Raw;
    if (raw.openagPackage) throw new McpServerError("This server is built in to OpenAg and managed by OpenAg", 409);
    // A command written by the operator stays theirs. Only a command written from the desk (and reviewed there) is managed here.
    if (raw.transport !== "http" && !(raw.transport === "stdio" && raw.managedBy === "desk")) throw new McpServerError("This is a local command server managed in mcp.json; the desk only manages commands it wrote itself", 409);
    return { index, item: raw };
  }

  /** What a stored secret is bound to for an entry the owner can attach one to: a remote server's origin, or a desk command's reviewed program and arguments. */
  function secretBinding(id: string): string {
    let entry;
    try { entry = deps.mcp.entries().servers.find(server => server.id === id); }
    catch (err) { if (err instanceof McpConfigUnsafeError) throw new McpServerError(`MCP configuration cannot be read: ${err.message}`, 409); throw err; }
    if (!entry) throw new McpServerError("server not found", 404);
    if (entry.origin === "custom" && entry.transport === "http" && entry.url) {
      const origin = originOf(entry.url);
      if (!origin) throw new McpServerError("the server address is not valid", 409);
      return origin;
    }
    if (entry.origin === "custom" && entry.managedBy === "desk" && entry.review) return `stdio:${entry.review.binding}`;
    throw new McpServerError("secrets can only be attached to a custom remote server or a command written from the desk", 409);
  }

  return {
    add: (input) => write(async () => {
      const item: Raw = { id: input.id, transport: "http", url: input.url, headers: input.headers, allowPrivateNetwork: input.allowPrivateNetwork, offerToAgents: input.offerToAgents, enabled: input.enabled, ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}), ...(input.oauth ? { oauth: input.oauth } : {}) };
      const invalid = validateServerItem(item);
      if (invalid) throw new McpServerError(invalid, 400);
      rejectRedactionMarker(item);
      const bad = newReferenceProblem([], Object.values(input.headers));
      if (bad) throw new McpServerError(`a header can reference only OPENAG_MCP_ variables (${bad})`, 400);
      const { digest } = await updateMcpConfig(root(), {
        expectedDigest: input.digest,
        auditEvent: { operation: "desk-add", id: input.id },
        mutate: current => {
          if (current.value.servers.length >= MAX_MCP_SERVERS) throw new McpServerError(`at most ${MAX_MCP_SERVERS} servers can be configured`, 409);
          if (current.value.servers.some(entry => entry && typeof entry === "object" && (entry as Raw).id === input.id)) throw new McpServerError("a server with this id already exists", 409);
          const classes = (current.value as Raw).toolClasses;
          if (classes && typeof classes === "object" && Object.hasOwn(classes, input.id)) throw new McpServerError("mcp.json already has tool class overrides for this id; remove them first so a new server cannot inherit them", 409);
          return { next: { ...current.value, servers: [...current.value.servers, item] }, result: undefined };
        },
      });
      return finish(input.id, "added", headerNames(item), digest);
    }),

    update: (id, input) => write(async () => {
      const { digest: expectedDigest, ...patch } = input;
      if (Object.keys(patch).length === 0) throw new McpServerError("nothing to change", 400);
      let names: string[] = [];
      const { digest } = await updateMcpConfig(root(), {
        expectedDigest,
        auditEvent: { operation: "desk-update", id, fields: Object.keys(patch) },
        mutate: current => {
          const { index, item } = editable(current.value.servers, id);
          // A command changes only through a new review; a remote address, header or network switch makes no sense for one.
          if (item.transport === "stdio" && ("url" in patch || "headers" in patch || "allowPrivateNetwork" in patch)) throw new McpServerError("a local command server has no address or headers; change its command through a new review", 400);
          const merged: Raw = { ...item, ...patch };
          if (patch.oauth === null) delete merged.oauth;
          const invalid = validateServerItem(merged);
          if (invalid) throw new McpServerError(invalid, 400);
          rejectRedactionMarker(merged);
          // Pointing an existing header reference at a different host would hand that variable to a new party: every reference is then new.
          const moved = patch.url !== undefined && originOf(patch.url) !== originOf(item.url);
          const bad = newReferenceProblem(moved ? [] : headerValues(item), headerValues(merged));
          if (bad) throw new McpServerError(moved ? `changing the server address means every header can reference only OPENAG_MCP_ variables (${bad})` : `a header can reference only OPENAG_MCP_ variables (${bad})`, 400);
          names = headerNames(merged);
          // A secret is bound to the origin it was stored for: moving the server takes its secrets with it, so none can reach the new host.
          // The sign-in store is cleared first: if it cannot be, nothing else has been changed yet.

          // Turning sign-in off, or changing who signs in, leaves no stored grant behind.

          const servers = [...current.value.servers]; servers[index] = merged;
          return { next: { ...current.value, servers }, result: undefined,rollback:dropCredentials(id,moved||patch.oauth===null,moved) };
        },
      });
      return finish(id, "updated", names, digest);
    }),

    listSecrets() {
      if (!deps.secrets) throw new McpServerError("MCP secrets are unavailable", 503);
      try { return deps.secrets.list(); } catch (err) { if (err instanceof McpSecretError) throw new McpServerError(err.message, err.status); throw err; }
    },

    setSecret: (serverId, name, value, expectedOrigin) => write(async () => {
      const secrets = deps.secrets; if (!secrets) throw new McpServerError("MCP secrets are unavailable", 503);
      // Under the same lock as every config write, so an edit cannot repoint the server between reading its origin and saving the secret.
      const view = await withSetupLock(root(), () => {
        const binding = secretBinding(serverId);
        if (expectedOrigin !== undefined && expectedOrigin !== binding) throw new McpServerError("the server changed since you loaded it; reload and enter the secret again", 409);
        return secrets.set(serverId, name, value, binding);
      });
      await finish(serverId, "updated", [], "");
      return view;
    }),

    removeSecret: (serverId, name) => write(async () => {
      const secrets = deps.secrets; if (!secrets) throw new McpServerError("MCP secrets are unavailable", 503);
      const removed = await withSetupLock(root(), () => secrets.remove(serverId, name));
      if (!removed) throw new McpServerError("secret not found", 404);
      await finish(serverId, "updated", [], "");
    }),

    previewCommand: proposal => {
      const item: Raw = { id: proposal.id, transport: "stdio", command: proposal.command, args: proposal.args, env: Object.fromEntries(proposal.env.map(pair => [pair.name, pair.template])), enabled: proposal.enabled, offerToAgents: proposal.offerToAgents, ...(proposal.timeoutMs !== undefined ? { timeoutMs: proposal.timeoutMs } : {}), managedBy: "desk", review: proposal.review };
      return validateServerItem(item);
    },

    upsertCommand: (proposal) => write(async () => {
      const env = Object.fromEntries(proposal.env.map(pair => [pair.name, pair.template]));
      // The review is rebuilt now: if the program or a reviewed file is no longer what the owner approved, nothing is written.
      const fresh = buildReview({ id: proposal.id, command: proposal.command, args: proposal.args, env });
      if ("problem" in fresh) throw new McpServerError(`the command can no longer be reviewed: ${fresh.problem}`, 409);
      if (fresh.review.hash !== proposal.review.hash) throw new McpServerError("the command changed since it was reviewed; request a new review", 409);
      const item: Raw = { id: proposal.id, transport: "stdio", command: proposal.command, args: proposal.args, env, enabled: proposal.enabled, offerToAgents: proposal.offerToAgents, ...(proposal.timeoutMs !== undefined ? { timeoutMs: proposal.timeoutMs } : {}), managedBy: "desk", review: fresh.review };
      const invalid = validateServerItem(item);
      if (invalid) throw new McpServerError(invalid, 400);
      rejectRedactionMarker(item);
      let replaced = false,dropSecrets=false;
      const { digest } = await updateMcpConfig(root(), {
        auditEvent: { operation: "desk-command-approved", id: proposal.id, hash: proposal.review.hash },
        mutate: current => {
          const servers = [...current.value.servers];
          const matches = servers.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry && typeof entry === "object" && (entry as Raw).id === proposal.id);
          if (matches.length > 1) throw new McpServerError("this id appears more than once in mcp.json; fix the file by hand first", 409);
          const existing = matches[0];
          if (existing) {
            const raw = existing.entry as Raw, review = raw.review as { hash?: unknown; binding?: unknown } | undefined;
            // Anything the operator wrote, or a command the owner has not reviewed, is never replaced from the desk.
            if (raw.transport !== "stdio" || raw.managedBy !== "desk") throw new McpServerError("an entry with this id is managed in mcp.json and cannot be replaced from the desk", 409);
            if (proposal.replacesHash === null || review?.hash !== proposal.replacesHash) throw new McpServerError("the server changed since this review was requested; request a new review", 409);
            replaced = true;
            // The program or its arguments changed: its secrets belonged to the old command.
            if (review?.binding !== fresh.review.binding) dropSecrets=true;
            // Fields the new proposal leaves out are not inherited (a stale timeout, say). If the program or arguments changed, class overrides
            // the owner wrote for the old program's tools must not apply to the new one's.
            const { timeoutMs: _previousTimeout, ...kept } = raw;
            servers[existing.index] = { ...kept, ...item };
            if (review?.binding !== fresh.review.binding) {
              const classes = (current.value as Raw).toolClasses;
              if (classes && typeof classes === "object" && Object.hasOwn(classes, proposal.id)) { const { [proposal.id]: _dropped, ...rest } = classes as Raw; (current.value as Raw).toolClasses = rest; }
            }
          } else {
            if (proposal.replacesHash !== null) throw new McpServerError("the server was removed since this review was requested; request a new review", 409);
            if (servers.length >= MAX_MCP_SERVERS) throw new McpServerError(`at most ${MAX_MCP_SERVERS} servers can be configured`, 409);
            const classes = (current.value as Raw).toolClasses;
            if (classes && typeof classes === "object" && Object.hasOwn(classes, proposal.id)) throw new McpServerError("mcp.json already has tool class overrides for this id; remove them first so a new server cannot inherit them", 409);
            dropSecrets=true;
            servers.push(item);
          }
          ensureDirectory(root(), workDirOf(proposal.id));
          return { next: { ...current.value, servers }, result: undefined,rollback:dropCredentials(proposal.id,false,dropSecrets) };
        },
      });
      return finish(proposal.id, replaced ? "updated" : "added", proposal.env.map(pair => pair.name), digest);
    }),

    remove: (id, input) => write(async () => {
      let names: string[] = [];
      const { digest } = await updateMcpConfig(root(), {
        expectedDigest: input.digest,
        auditEvent: { operation: "desk-remove", id },
        mutate: current => {
          const { index, item } = editable(current.value.servers, id);
          names = headerNames(item);
          // An id can be reused, so a removed server must not leave its secrets behind for its successor.

          const servers = current.value.servers.filter((_, position) => position !== index);
          // An id can be reused, so a removed server must not leave classification overrides behind for its successor.
          const classes = (current.value as Raw).toolClasses;
          const next: McpConfigValue = { ...current.value, servers };
          if (classes && typeof classes === "object" && Object.hasOwn(classes, id)) { const { [id]: _dropped, ...rest } = classes as Raw; next.toolClasses = rest; }
          return { next, result: undefined,rollback:dropCredentials(id,true,true) };
        },
      });
      return finish(id, "removed", names, digest);
    }),
  };
}
