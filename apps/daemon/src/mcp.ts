import { COMPOSIO_TOOL_CLASSES, composioReadRequest, composioResult } from "./mcp/composio-contract.js";
import { ActionFailure } from "./action-receipts.js";
import { createMcpClient, connectMcpHttp, listMcpTools, invokeMcp, boundedMcpFetch, mcpRequestSignal } from "./mcp/client.js";
import type { InteractionBroker } from "./mcp/interactions.js";
import type { ToolExecContext } from "./tools/registry.js";
import { randomUUID } from "node:crypto";
import { remoteConfirmation, remoteEvidence } from "./mcp/evidence.js";
import { checkUrl, closeSsrfAgents, createGuardedFetch, ssrfReason } from "./mcp/ssrf-fetch.js";
import { isForbiddenHeaderEnvName } from "./secret-env.js";
import { readMcpConfig } from "./mcp-config.js";
import { existsSync, readFileSync, statSync } from "node:fs";
import { COMPOSIO_SERVER_ID, type ComposioConnect } from "./composio-connect.js";
import { launchCommand, packageProblem } from "./integration-packages.js";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ToolListChangedNotificationSchema, ErrorCode, McpError, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getDefaultRedactor, type Redactor } from "./redact.js";
import { setAdminToolClasses, TOOL_CLASSES, type ToolClass } from "./policy.js";
import { ExactEnvStdioTransport } from "./mcp/exact-env-stdio.js";
import { commandProblem, envNameProblem, reviewProblem, workDirOf, type ReviewRecord } from "./mcp-command-review-core.js";
import { ensureDirectory } from "./mcp-config-write.js";
import { NeedsSignInError, type McpOAuthEntry } from "./mcp-oauth.js";
import { unconfinedPermission, toExecutors, type ToolDef, type ToolRegistry } from "./tools/registry.js";

export type ServerState = "connected" | "down" | "skipped" | "invalid" | "refused";

export interface ServerStatus {
  id: string;
  transport: "stdio" | "http";
  state: ServerState;
  detail?: string;
  toolCount: number;
  version?: string;
  package?: { id: string; version: string; digest: string };
  requirements?: string[];
  tools?: { name: string; description: string; class: ToolClass }[];
  unavailable?: { name: string; reason: string }[];
  /** Who provides the server: bundled with OpenAg, a managed third-party connection (Composio), or added by the owner. */
  origin: ServerOrigin;
  enabled: boolean;
  /** Whether a ready server's tools are offered to ACP (Claude/Codex) bots through /mcp. */
  offerToAgents: boolean;
}

export type ServerOrigin = "builtin" | "connection" | "custom";

/** What the connector needs. `env` and `headers` are already resolved and contain only declared values. */
export interface ConnectorConfig {
  id: string;
  transport: "stdio" | "http";
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  headers: Record<string, string>;
  /** Owner opt-in: allow loopback, LAN, CGNAT/Tailscale and plain http targets for this http server. */
  allowPrivateNetwork?: boolean;
  timeoutMs: number;
  /** A reviewed desk command runs in its own directory under the data directory. */
  cwd?: string;
}

export interface McpConnection {
  client: Client;
  close(): Promise<void>;
}

export type McpConnector = (cfg: ConnectorConfig, signal?:AbortSignal) => Promise<McpConnection>;

export interface McpManagerOptions {
  dataDir: string;
  interactions?: InteractionBroker;
  composio?: ComposioConnect;
  redactor?: Redactor;
  connector?: McpConnector;
  /** Environment used to resolve ${NAME} references. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Resolves `${secret:NAME}` header references for one server and origin. Without it every such reference is missing (fails closed). */
  secrets?: { get(serverId: string, name: string, origin: string | undefined): string | undefined };
  /** Connects a custom http server that signs in with OAuth. Without it such an entry is reported invalid. */
  oauth?: { connect(cfg: { headers: Record<string, string> }, entry: McpOAuthEntry,signal?:AbortSignal): Promise<McpConnection> };
  /** `offeredChanged: false` means the set of tools offered to ACP bots did not change (default: assume it did). */
  onChange?: (info?: { offeredChanged: boolean }) => void;
}

export interface McpEntryView {
  id: string;
  origin: ServerOrigin;
  transport: "stdio" | "http";
  enabled: boolean;
  offerToAgents: boolean;
  timeoutMs: number;
  /** http only. Header values are `${NAME}` templates, never resolved values. */
  url?: string;
  allowPrivateNetwork?: boolean;
  /** A list, not a map: the redactor masks values whose key looks like Authorization/Token, and a template has to stay readable. */
  headers?: { name: string; template: string }[];
  /** OAuth sign-in settings (OA-457). */
  oauth?: { scope?: string; clientMetadataUrl?: string };
  /** A local command written from the desk (OA-456): reviewed before it runs. Operator-written commands have none of these. */
  managedBy?: "desk";
  command?: string;
  args?: string[];
  env?: { name: string; template: string }[];
  review?: { hash: string; executable: string; binding: string };
}
export interface McpEntries { digest: string; servers: McpEntryView[] }

export type McpCheckResult =
  | { ok: true; tools: { name: string; description: string }[]; truncated: boolean }
  | { ok: false; reason: string };

const CHECK_TOOL_LIMIT = 50;

export interface McpManager {
  readonly configPath: string;
  load(): Promise<void>;
  reload(): Promise<void>;
  /** Refresh only the curated Composio connection; unrelated servers remain live. */
  reloadComposio(): Promise<void>;
  /** Re-read `mcp.json` and bring ONE server in line with it (added, edited, enabled, disabled or removed); other servers stay live. */
  applyServer(id: string): Promise<void>;
  /** Connects to a remote candidate, lists its tools and closes again. Registers nothing and touches neither `mcp.json` nor any other server. */
  checkServer(item: unknown): Promise<McpCheckResult>;
  /** Editable view of every raw `mcp.json` item plus the file digest, for the owner's desk. Throws when the file is unsafe. */
  entries(): McpEntries;
  /** Tools of connected servers only. */
  toolDefs(): ToolDef[];
  /** Executors for every MCP tool; a tool of a down server fails with "tool <name> is not enabled". */
  executors(): ToolRegistry;
  /** Tools and executors of connected servers regardless of `offerToAgents`, for the owner's own health checks. Never hand these to a model. */
  ownerToolDefs(): ToolDef[];
  ownerExecutors(): ToolRegistry;
  status(): ServerStatus[];
  close(): Promise<void>;
}

const CONNECT_TIMEOUT_MS = 15_000;
const MAX_LITERAL = 100;
export const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
export const DEFAULT_TIMEOUT_MS = 30000;
/** Ids of the connectors that `setup install` publishes; a custom server must not take one. */
const BUILTIN_PACKAGE_IDS = ["local-reference", "apple-apps"];
/** Id of openagd's own MCP server (mcpserver.ts). A user config entry with this id is reported invalid. */
export const RESERVED_SERVER_ID = "openag";
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const REF_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
/** `${secret:NAME}`: a direct secret stored encrypted by the daemon (mcp-secrets.ts). Only an http header may use one. */
const SECRET_REF_RE = /\$\{secret:([A-Z][A-Z0-9_]{0,63})\}/g;
const CHILD_ENV_KEYS = ["PATH", "HOME", "LANG", "TMPDIR"] as const;

const toolClassesSchema = z.record(z.string().min(1).max(200), z.enum(TOOL_CLASSES));

const common = {
  id: z.string().regex(ID_RE, "id must match ^[a-z][a-z0-9_-]{0,31}$"),
  enabled: z.boolean().default(true),
  openagPackage: z.object({ id: z.enum(["local-reference", "apple-apps"]), version: z.literal("1.0.0"), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
  timeoutMs: z.number().int().min(1000).max(120000).default(DEFAULT_TIMEOUT_MS),
  toolClasses: toolClassesSchema.default({}),
  offerToAgents: z.boolean().default(true),
};
const entrySchema = z.discriminatedUnion("transport", [
  z.object({
    ...common,
    transport: z.literal("stdio"),
    command: z.string().min(1).max(500),
    args: z.array(z.string().max(2000)).max(100).default([]),
    env: z.record(z.string().regex(ENV_NAME_RE, "env names must be identifiers"), z.string().max(2048)).default({}),
    /** A command written from the desk (OA-456). It runs only with a matching review; hand-written entries have neither field. */
    managedBy: z.literal("desk").optional(),
    review: z.object({
      hash: z.string().regex(/^[a-f0-9]{64}$/), executable: z.string().min(1).max(1000), binding: z.string().regex(/^[a-f0-9]{64}$/),
      files: z.array(z.object({ arg: z.string().min(1).max(2000), path: z.string().min(1).max(1000), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(3),
    }).strict().optional(),
  }),
  z.object({
    ...common,
    transport: z.literal("http"),
    url: z.string().min(1).max(2048),
    headers: z.record(z.string().min(1).max(200), z.string().max(2048)).default({}),
    allowPrivateNetwork: z.boolean().default(false),
    /** Sign in with OAuth (OA-457). Only the scope and an optional client metadata document URL live here; no secret is ever in this file. */
    oauth: z.object({
      scope: z.string().min(1).max(200).regex(/^[\x21\x23-\x5b\x5d-\x7e]+( [\x21\x23-\x5b\x5d-\x7e]+)*$/, "scope is a space-separated list of tokens").optional(),
      clientMetadataUrl: z.string().min(1).max(500).optional(),
    }).strict().optional(),
  }),
]);
type Entry = z.infer<typeof entrySchema>;

interface Handle {
  client: Client;
  close: () => Promise<void>;
}

interface ServerRecord {
  id: string;
  transport: "stdio" | "http";
  state: ServerState;
  detail?: string;
  version?: string;
  requirements?: string[];
  /** Read from the raw file item, so even an invalid entry is grouped correctly. Defaults: custom, enabled, offered. */
  origin?: ServerOrigin;
  enabled?: boolean;
  offerToAgents?: boolean;
  /** Set only while connected. */
  handle?: Handle;
  defs: ToolDef[];
  /** The same tools without the offer switch, for owner-side checks only (never offered to a model). */
  ownerDefs?: ToolDef[];
  unavailable?: { name: string; reason: string }[];
  /** Overrides from toolClasses that applied to this server's connected tools (full daemon name -> class). */
  overrides: Record<string, ToolClass>;
}

type ReadResult = { kind: "absent" } | { kind: "refused" } | { kind: "invalid" } | { kind: "ok"; raw: unknown };

/** Strips anything a secret could hide in: URLs, long tails. Used for remote error text. */
function shortReason(text: string, redactor: Redactor): string {
  return redactor.redactString(text).replace(/https?:\/\/\S+/g, "[url]").slice(0, 120);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    timer.unref?.();
  });
  return Promise.race([p, expired]).finally(() => clearTimeout(timer));
}

function readConfig(path: string): ReadResult {
  // Preserve the existing administrator-managed MCP runtime contract. Setup applies its stronger directory guards separately.
  if (!existsSync(path)) return { kind: "absent" };
  const st = statSync(path), uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if ((st.mode & 0o022) !== 0 || (uid !== undefined && st.uid !== uid)) return { kind: "refused" };
  try { return { kind: "ok", raw: JSON.parse(readFileSync(path, "utf8")) as unknown }; }
  catch { return { kind: "invalid" }; }
}

/** Returns a reason when a literal (non-reference) part of a template is unsafe to keep in the file. */
function checkLiteral(text: string, redactor: Redactor, what: string, maxLength?: number, allowSecretRefs = false): string | null {
  const literal = text.replace(REF_RE, "").replace(allowSecretRefs ? SECRET_REF_RE : /(?!)/g, "");
  if (literal.includes("${")) return `${what} has a malformed \${NAME} reference`;
  if (maxLength !== undefined && literal.length > maxLength) return `${what} literal is too long`;
  if (redactor.redactString(literal) !== literal) return `${what} looks like a secret; use \${NAME}`;
  return null;
}

function checkEntry(entry: Entry, redactor: Redactor): string | null {
  if (entry.transport === "stdio" && entry.managedBy === "desk") {
    // A desk command is reviewed as written: no references in the program or its arguments, and an environment value may only name
    // an OPENAG_MCP_ variable or a stored secret.
    if (entry.command.includes("${") || entry.args.some(arg => arg.includes("${"))) return "a desk command takes no references in its program or arguments";
    const bad = commandProblem(entry.command, entry.args);
    if (bad) return bad;
    if (redactor.redactString(entry.command) !== entry.command || entry.args.some(arg => redactor.redactString(arg) !== arg)) return "command or argument looks like a secret; use an environment reference";
    for (const name of Object.keys(entry.env)) { const refused = envNameProblem(name); if (refused) return refused; }
    for (const value of Object.values(entry.env)) {
      const literal = checkLiteral(value, redactor, "env value", MAX_LITERAL, true);
      if (literal) return literal;
      for (const [, name] of value.matchAll(REF_RE)) if (isForbiddenHeaderEnvName(name!)) return `env references a daemon secret (${name})`;
    }
    return null;
  }
  if (entry.transport === "stdio") {
    const cmd = checkLiteral(entry.command, redactor, "command");
    if (cmd) return cmd;
    for (const arg of entry.args) {
      const bad = checkLiteral(arg, redactor, "argument");
      if (bad) return bad;
    }
    for (const value of Object.values(entry.env)) {
      const bad = checkLiteral(value, redactor, "env value", MAX_LITERAL);
      if (bad) return bad;
    }
    return null;
  }
  if (entry.url.includes("${")) return "url must not use references";
  if (entry.oauth?.clientMetadataUrl) {
    const reason = checkUrl(entry.oauth.clientMetadataUrl, {});
    if (reason) return `oauth.clientMetadataUrl is not acceptable (${reason})`;
  }
  if (redactor.redactString(entry.url) !== entry.url) return "url looks like it contains a secret";
  let url: URL;
  try {
    url = new URL(entry.url);
  } catch {
    return "url is not valid";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "url must be http or https";
  if (url.protocol === "http:" && !entry.allowPrivateNetwork) return "http requires allowPrivateNetwork";
  if (url.username !== "" || url.password !== "") return "url must not contain credentials";
  // The redactor ignores URL-shaped values, so a credential-looking query parameter has to be caught here by name.
  for (const [name, value] of url.searchParams) if (value !== "" && /(token|secret|key|passw|auth|sig)/i.test(name)) return "url query looks like it contains a secret; use a header reference";
  for (const value of Object.values(entry.headers)) {
    const bad = checkLiteral(value, redactor, "header value", MAX_LITERAL, true);
    if (bad) return bad;
    // A header goes to a remote host: it may never carry one of the daemon's own secrets (stdio children are reviewed as commands instead).
    for (const [, name] of value.matchAll(REF_RE)) if (isForbiddenHeaderEnvName(name!)) return `header references a daemon secret (${name})`;
  }
  return null;
}

type Resolved = { kind: "ok"; cfg: ConnectorConfig } | { kind: "missing"; name: string; secret?: boolean };
type SecretLookup = (name: string) => string | undefined;
/** What a skipped server reports for an unresolved reference. */
const missingDetail = (resolved: { name: string; secret?: boolean }) => (resolved.secret ? `missing secret ${resolved.name}` : `missing env ${resolved.name}`);

const ANY_REF_RE = /\$\{(?:secret:([A-Z][A-Z0-9_]{0,63})|([A-Za-z_][A-Za-z0-9_]*))\}/g;

/** One pass over the template, so a secret or variable whose VALUE contains `${...}` is never expanded again. */
function resolveTemplate(value: string, env: NodeJS.ProcessEnv, secret?: SecretLookup): { value: string } | { missing: string; secret?: boolean } {
  let missing: { name: string; secret: boolean } | undefined;
  const out = value.replace(ANY_REF_RE, (_m, secretName: string | undefined, envName: string | undefined) => {
    const v = secretName !== undefined ? secret?.(secretName) : env[envName!];
    if (v === undefined || v === "") { missing ??= { name: (secretName ?? envName)!, secret: secretName !== undefined }; return ""; }
    return v;
  });
  return missing === undefined ? { value: out } : { missing: missing.name, ...(missing.secret ? { secret: true } : {}) };
}

function resolveEntry(entry: Entry, env: NodeJS.ProcessEnv, secrets?: McpManagerOptions["secrets"], dataDir?: string): Resolved {
  let missingSecret = false;
  // A secret is bound to what it may be sent to: an http server's origin, or a desk command's reviewed program and arguments.
  const lookup: SecretLookup | undefined = !secrets ? undefined
    : entry.transport === "http" ? name => secrets.get(entry.id, name, originOfUrl(entry.url))
    : entry.managedBy === "desk" && entry.review ? name => secrets.get(entry.id, name, `stdio:${entry.review!.binding}`) : undefined;
  const resolveMap = (map: Record<string, string>): Record<string, string> | string => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) {
      const r = resolveTemplate(v, env, lookup);
      if ("missing" in r) { missingSecret = r.secret === true; return r.missing; }
      out[k] = r.value;
    }
    return out;
  };
  if (entry.transport === "stdio") {
    const env2 = resolveMap(entry.env);
    if (typeof env2 === "string") return { kind: "missing", name: env2, ...(missingSecret ? { secret: true } : {}) };
    // A reviewed command runs as reviewed: the resolved program (never looked up again) in its own working directory.
    const desk = entry.managedBy === "desk" && entry.review && dataDir;
    return {
      kind: "ok",
      cfg: { id: entry.id, transport: "stdio", command: desk ? entry.review!.executable : entry.command, args: entry.args, env: env2, headers: {}, timeoutMs: entry.timeoutMs, ...(desk ? { cwd: join(dataDir, workDirOf(entry.id)) } : {}) },
    };
  }
  const headers = resolveMap(entry.headers);
  if (typeof headers === "string") return { kind: "missing", name: headers, ...(missingSecret ? { secret: true } : {}) };
  return {
    kind: "ok",
    cfg: { id: entry.id, transport: "http", url: entry.url, args: [], env: {}, headers, allowPrivateNetwork: entry.allowPrivateNetwork, timeoutMs: entry.timeoutMs },
  };
}

const originOfUrl = (value: string): string | undefined => { try { return new URL(value).origin; } catch { return undefined; } };

/** Validates one raw entry the way loading does (schema, reserved ids, static checks) without registering it. Returns a reason or null. */
export function validateServerItem(item: unknown, redactor: Redactor = getDefaultRedactor()): string | null {
  const parsed = entrySchema.safeParse(item);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return `${issue && issue.path.length > 0 ? issue.path.join(".") : "entry"}: ${issue?.message ?? "not valid"}`;
  }
  if (parsed.data.id === RESERVED_SERVER_ID || parsed.data.id === COMPOSIO_SERVER_ID) return `id "${parsed.data.id}" is reserved`;
  if (BUILTIN_PACKAGE_IDS.includes(parsed.data.id) && !parsed.data.openagPackage) return `id "${parsed.data.id}" is reserved for a built-in connector`;
  return checkEntry(parsed.data, redactor);
}

/** Default connector: real stdio child (with a minimal env) or streamable HTTP. */
export async function defaultConnector(cfg: ConnectorConfig, signal?:AbortSignal): Promise<McpConnection> {
  signal?.throwIfAborted();
  if (cfg.transport === "http") {
    const guarded=createGuardedFetch({allowPrivateNetwork:cfg.allowPrivateNetwork});
    return connectMcpHttp(new URL(cfg.url??""),{signal,requestInit:{headers:cfg.headers},fetchForClient:client=>(input,init)=>boundedMcpFetch(input,init,guarded,mcpRequestSignal(client,init))});
  }
  const client = createMcpClient();
  const transport = new ExactEnvStdioTransport({
          command: cfg.command ?? "",
          args: cfg.args,
          env: { ...pickChildBase(process.env), ...cfg.env },
          ...(cfg.cwd ? { cwd: cfg.cwd } : {}),
        });
  const abort=()=>{void client.close().catch(()=>undefined);};
  signal?.addEventListener('abort',abort,{once:true});
  try {
    await client.connect(transport,{signal});
    signal?.throwIfAborted();
  } catch (err) {
    await client.close().catch(() => undefined);
    throw err;
  } finally { signal?.removeEventListener('abort',abort); }
  return { client, close: () => client.close() };
}

/** What stops a desk command from starting: it was never reviewed, or what runs is no longer what was reviewed. */
function deskProblem(entry: Entry): string | null {
  return entry.transport === "stdio" && entry.managedBy === "desk" ? reviewProblem({ id: entry.id, command: entry.command, args: entry.args, env: entry.env, review: entry.review as ReviewRecord | undefined }) : null;
}

function pickChildBase(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of CHILD_ENV_KEYS) {
    const v = env[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function sanitizeToolName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  return cleaned === "" ? "tool" : cleaned;
}

export function createMcpManager(opts: McpManagerOptions): McpManager {
  const redactor = opts.redactor ?? getDefaultRedactor();
  const connector = opts.connector ?? defaultConnector;
  const env = opts.env ?? process.env;
  const configPath = join(opts.dataDir, "mcp.json");
  let records: ServerRecord[] = [];
  let configuredClasses: Record<string, Record<string, ToolClass>> = {};
  let closing: Promise<void> | undefined;
  let chain: Promise<void> = Promise.resolve();
  const pendingConnections=new Set<AbortController>();
  const pendingCleanup = new Set<Promise<void>>();
  let cleanupFailed = false;

  /** Load and reload never interleave: each runs after the previous one settles. */
  function serialize(fn: () => Promise<void>): Promise<void> {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  }

  function trackCleanup(job: Promise<void>): Promise<void> {
    const cleanup = job.catch(() => { cleanupFailed = true; });
    pendingCleanup.add(cleanup);
    void cleanup.then(() => pendingCleanup.delete(cleanup));
    return cleanup;
  }

  function closeHandle(handle: Handle): Promise<void> {
    return trackCleanup(Promise.resolve().then(() => handle.close()));
  }

  async function closeAll(): Promise<void> {
    const old = records;
    records = [];
    await Promise.all(old.map(record => closeRecord(record)));
  }

  async function closeRecord(record: ServerRecord): Promise<void> {
    const handle = record.handle;
    record.handle = undefined;
    record.state = "down";
    if (handle) await closeHandle(handle);
  }

  function addComposioRecord(): ServerRecord | undefined {
    if (!opts.composio?.enabled()) return;
    const entry = entrySchema.parse({ id: COMPOSIO_SERVER_ID, transport: "http", url: "https://connect.composio.dev/mcp",
      // Reviewed Connect contracts only; execution/connection tools remain approval-gated.
      toolClasses: COMPOSIO_TOOL_CLASSES,
    });
    pending.set(COMPOSIO_SERVER_ID, entry);
    const record: ServerRecord = { id: COMPOSIO_SERVER_ID, transport: "http", state: "down", defs: [], overrides: {}, origin: "connection", enabled: true, offerToAgents: true };
    records.push(record);
    return record;
  }

  function invalidRecord(id: string, transport: "stdio" | "http", reason: string): ServerRecord {
    return { id, transport, state: "invalid", detail: `invalid: ${reason}`, defs: [], overrides: {} };
  }

  function parseEntries(raw: unknown, onlyId?: string): ServerRecord[] {
    const top = z.object({ servers: z.array(z.unknown()), toolClasses: z.record(z.string().regex(ID_RE), toolClassesSchema).default({}) }).safeParse(raw);
    if (!top.success) return [{ id: "config", transport: "stdio", state: "invalid", detail: "invalid: expected { servers: [...] }", defs: [], overrides: {} }];
    // A per-server read must not move other servers' classifications: those change only on a full reload.
    if (onlyId === undefined) configuredClasses = top.data.toolClasses;
    else { const { [onlyId]: _previous, ...others } = configuredClasses; configuredClasses = top.data.toolClasses[onlyId] ? { ...others, [onlyId]: top.data.toolClasses[onlyId]! } : others; }
    const seen = new Set<string>();
    const out: ServerRecord[] = [];
    top.data.servers.forEach((item, index) => {
      const probe = (item && typeof item === "object" ? item : {}) as { id?: unknown; transport?: unknown };
      const probeId = typeof probe.id === "string" && ID_RE.test(probe.id) ? probe.id : `entry-${index}`;
      const probeTransport = probe.transport === "http" ? "http" : "stdio";
      const parsed = entrySchema.safeParse(item);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const where = issue && issue.path.length > 0 ? issue.path.join(".") : "entry";
        out.push(invalidRecord(probeId, probeTransport, `${where}: ${issue?.message ?? "not valid"}`));
        return;
      }
      const entry = parsed.data;
      if (seen.has(entry.id)) {
        out.push(invalidRecord(probeId, probeTransport, "duplicate id"));
        return;
      }
      // The daemon's own MCP endpoint (/mcp) is registered to bots under this id: a user server must never take it.
      if (entry.id === RESERVED_SERVER_ID || entry.id === COMPOSIO_SERVER_ID) {
        out.push(invalidRecord(entry.id, entry.transport, `id "${entry.id}" is reserved`));
        return;
      }
      seen.add(entry.id);
      const bad = checkEntry(entry, redactor);
      if (bad) {
        out.push(invalidRecord(entry.id, entry.transport, bad));
        return;
      }
      const problem = packageProblem(opts.dataDir, entry) ?? deskProblem(entry);
      out.push(problem ? invalidRecord(entry.id, entry.transport, `${entry.enabled ? "" : "disabled: "}${problem}`) : { id: entry.id, transport: entry.transport, state: entry.enabled ? "down" : "skipped", detail: entry.enabled ? undefined : "disabled", defs: [], overrides: {} });
      const launch = entry.openagPackage && !problem ? { ...entry, ...launchCommand(opts.dataDir, entry), env: {} } : entry;
      const templates = launch.transport === "stdio" ? [launch.command, ...launch.args, ...Object.values(launch.env)] : Object.values(launch.headers);
      out[out.length - 1]!.requirements = [...new Set(templates.flatMap(value => [...value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(match => match[1]!)))];
      if (!onlyId || entry.id === onlyId) pending.set(launch.id, launch);
    });
    // Every item yields exactly one record, in order: tag each with what the raw item says (valid or not), so grouping never depends on validity.
    out.forEach((record, index) => {
      const raw = (top.data.servers[index] && typeof top.data.servers[index] === "object" ? top.data.servers[index] : {}) as { openagPackage?: unknown; enabled?: unknown; offerToAgents?: unknown };
      record.origin = raw.openagPackage ? "builtin" : "custom";
      record.enabled = raw.enabled !== false;
      record.offerToAgents = raw.offerToAgents !== false;
    });
    return onlyId ? out.filter(record => record.id === onlyId) : out;
  }

  // Validated entries waiting to connect, keyed by id. Filled by parseEntries for the current reload.
  const pending = new Map<string, Entry>();

  function recheckPackage(record: ServerRecord): void {
    const entry = pending.get(record.id); if (!entry?.openagPackage || record.state === "invalid") return;
    const problem = packageProblem(opts.dataDir, entry); if (!problem) return;
    const handle = record.handle; record.handle = undefined; record.state = "invalid"; record.detail = `${entry.enabled ? "" : "disabled: "}${problem}`;
    if (handle) void closeHandle(handle);
    try { opts.onChange?.(); } catch { /* status listeners cannot change package validation */ }
  }

  async function connectRecord(record: ServerRecord, entry: Entry): Promise<void> {
    const problem = packageProblem(opts.dataDir, entry) ?? deskProblem(entry);
    if (problem) { record.state = "invalid"; record.detail = problem; return; }
    if (entry.transport === "stdio" && entry.managedBy === "desk") {
      try { ensureDirectory(opts.dataDir, workDirOf(entry.id)); } catch { record.state = "invalid"; record.detail = "the working directory could not be prepared"; return; }
    }
    const resolved = resolveEntry(entry, env, opts.secrets, opts.dataDir);
    if (resolved.kind === "missing") {
      record.state = "skipped";
      record.detail = missingDetail(resolved);
      return;
    }
    let handle: Handle;
    let connecting: Promise<McpConnection> | undefined;
    const attempt=new AbortController();pendingConnections.add(attempt);
    try {
      if (entry.transport === "http" && entry.oauth && entry.id !== COMPOSIO_SERVER_ID && !opts.oauth) { record.state = "invalid"; record.detail = "OAuth sign-in is unavailable"; return; }
      connecting = (entry.id === COMPOSIO_SERVER_ID ? opts.composio!.connect()
        : entry.transport === "http" && entry.oauth ? opts.oauth!.connect(resolved.cfg, { id: entry.id, url: entry.url, allowPrivateNetwork: entry.allowPrivateNetwork, oauth: entry.oauth },attempt.signal)
        : connector(resolved.cfg,attempt.signal)).then(conn=>{
        let closed:Promise<void>|undefined;
        return {client:conn.client,close:()=>closed??=Promise.resolve().then(()=>conn.close())};
      });
      const conn = await withTimeout(connecting, CONNECT_TIMEOUT_MS, "connect timed out");
      if(attempt.signal.aborted||closing){await closeHandle(conn);return;}
      handle = { client: conn.client, close: () => conn.close() };
    } catch (err) {
      attempt.abort();
      if (connecting) trackCleanup(connecting.then(conn => conn.close(), () => undefined));
      if (err instanceof NeedsSignInError) { record.state = "skipped"; record.detail = "needs sign-in"; return; }
      record.state = "down";
      record.detail = err instanceof TimeoutError ? "connect timed out" : ssrfReason(err) ?? "connect failed";
      return;
    } finally { pendingConnections.delete(attempt); }
    // A crash or exit removes the server's tools; other servers and the daemon are unaffected.
    handle.client.onclose = () => {
      if (record.handle !== handle) return;
      record.handle = undefined;
      record.state = "down";
      record.detail = "connection closed";
      try { opts.onChange?.(); } catch { /* status listeners cannot break disconnect handling */ }
      void closeHandle(handle);
    };
    record.handle = handle;
    handle.client.setNotificationHandler?.(ToolListChangedNotificationSchema, async () => {
      if (record.handle !== handle || closing) return;
      record.state = "down"; record.detail = "refreshing tool catalogue"; publishClasses();
      try { opts.onChange?.(); } catch { /* listener only */ }
      await serialize(async () => {
        if (closing || record.handle !== handle) return;
        await refreshRecord(record, entry, handle);
        publishClasses();
        try { opts.onChange?.(); } catch { /* listener only */ }
      });
    });
    await refreshRecord(record, entry, handle);
  }

  async function refreshRecord(record: ServerRecord, entry: Entry, handle: Handle): Promise<void> {
    let tools: Awaited<ReturnType<Client["listTools"]>>["tools"];
    try {
      tools = await withTimeout(listMcpTools(handle.client), CONNECT_TIMEOUT_MS, "list timed out");
    } catch (error) {
      await closeHandle(handle);
      record.state = "down";
      record.detail = "list tools failed: " + shortReason(errorText(error),redactor);
      return;
    }
    if (new Set(tools.map(tool => tool.name)).size !== tools.length) {
      await closeHandle(handle);
      record.state = "down";
      record.detail = "duplicate remote tool name";
      return;
    }
    if (record.handle !== handle || closing) return;
    const revision = randomUUID();
    const unavailable: {name:string;reason:string}[] = [];
    const used = new Set<string>();
    const defs: ToolDef[] = [];
    const overrides: Record<string, ToolClass> = {};
    const connected = () => { recheckPackage(record); return record.handle === handle && (entry.id !== COMPOSIO_SERVER_ID || opts.composio?.enabled() === true); };
    const live = () => connected() && record.state === "connected" && record.defs === defs;
    for (const tool of tools) {
      const base = sanitizeToolName(tool.name);
      let local = base;
      for (let n = 2; used.has(local); n++) local = `${base}_${n}`;
      used.add(local);
      const full = `mcp.${entry.id}.${local}`;
      const configured = Object.hasOwn(configuredClasses, entry.id) ? configuredClasses[entry.id]! : {};
      const override = Object.hasOwn(configured, tool.name) ? configured[tool.name]
        : Object.hasOwn(entry.toolClasses, tool.name) ? entry.toolClasses[tool.name] : undefined;
      if (override) overrides[full] = override;
      const remoteName = tool.name;
      if (tool.execution?.taskSupport === "required") { unavailable.push({name:full,reason:"This tool requires asynchronous MCP tasks, which OpenAg does not support."}); continue; }
      let input: z.ZodType;
      try { input = z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]); z.toJSONSchema(input); }
      catch { unavailable.push({name:full,reason:"This tool's input schema is unsupported."}); continue; }
      defs.push({
        name: full,
        effectScope:(_ctx,args)=>{
          const known=entry.id===COMPOSIO_SERVER_ID&&entry.transport==='http'&&Object.hasOwn(COMPOSIO_TOOL_CLASSES,remoteName)?COMPOSIO_TOOL_CLASSES[remoteName]:undefined;
          return entry.id===COMPOSIO_SERVER_ID&&entry.transport==='http'&&(known==='read'||known==='search'||composioReadRequest(remoteName,args))?{kind:'read'}:{kind:'opaque'};
        },
        permission:(ctx,args)=>{
          if(entry.id===COMPOSIO_SERVER_ID&&entry.transport==='http'){
            const known=Object.hasOwn(COMPOSIO_TOOL_CLASSES,remoteName)?COMPOSIO_TOOL_CLASSES[remoteName]:undefined;
            if(known==='read'||known==='search')return {approval:'allow',effects:known};
            if(composioReadRequest(remoteName,args))return {approval:'allow',effects:'read'};
          }
          return unconfinedPermission(ctx,'This MCP operation');
        },
        class: override ?? "act-external",
        description: `[MCP ${entry.id}; class ${override ?? "act-external"}] ${(tool.description ?? "").slice(0, 300)}${entry.id===COMPOSIO_SERVER_ID&&remoteName==="COMPOSIO_MULTI_EXECUTE_TOOL"?" Confined modes support only daemon-reviewed read batches (OUTLOOK_GET_PROFILE, OUTLOOK_QUERY_EMAILS), with sync_response_to_workbench false. Other operations require Full access.":""}`,
        input,
        editable: false,
        // `offerToAgents` off keeps the tool out of every runtime's offered list and makes its executor refuse, not only ACP's.
        enabled: () => live() && entry.offerToAgents,
        review: () => ({ contractVersion: revision }),
        confirm: remoteConfirmation,
        execute: (ctx, args) => callRemote(handle.client, remoteName, args, entry.timeoutMs, entry.id, ctx, connected, live, tool),
      });
    }
    record.unavailable = unavailable;
    record.version = handle.client.getServerVersion?.()?.version?.slice(0, 100);
    record.handle = handle;
    record.state = "connected";
    record.detail = undefined;
    record.defs = defs;
    record.ownerDefs = defs.map(def => ({ ...def, enabled: live }));
    record.overrides = overrides;
  }

  async function callRemote(client: Client, name: string, args: unknown, timeoutMs: number, serverId: string, context: ToolExecContext, valid:()=>boolean, dispatchValid:()=>boolean, contract: Tool) {
    try {
      context.assertPermission?.();
      const guardedValidity=()=>{try{context.assertPermission?.();return valid();}catch{return false;}};
      const guardedDispatch=()=>{context.assertPermission?.();return dispatchValid();};
      const result = await invokeMcp(client,{serverId,toolName:name,context,valid:guardedValidity,dispatchValid:guardedDispatch,contract},opts.interactions,(args??{}) as Record<string,unknown>,timeoutMs);
      return remoteEvidence(serverId === COMPOSIO_SERVER_ID ? composioResult(name,result,args) : result,serverId,redactor);
    } catch (err) {
      if(err instanceof ActionFailure)throw err;
      if(context.signal?.aborted)throw new Error("MCP tool cancelled; its effect remains unconfirmed");
      if(errorText(err).includes("timed out"))throw new Error("MCP tool timed out");
      if (err instanceof McpError && err.code === ErrorCode.RequestTimeout) throw new Error("MCP tool timed out");
      throw new Error(`MCP tool failed: ${shortReason(errorText(err), redactor)}`);
    }
  }

  function publishClasses(): void {
    const admin: Record<string, ToolClass> = {};
    for (const record of records) if(record.state === "connected") Object.assign(admin, record.overrides);
    setAdminToolClasses(admin);
  }

  async function reloadInternal(): Promise<void> {
    if (closing) return;
    await closeAll();
    pending.clear();
    configuredClasses = {};
    const read = readConfig(configPath);
    if (read.kind === "absent") {
      records = [];
    } else if (read.kind === "refused") {
      records = [{ id: "config", transport: "stdio", state: "refused", detail: "unsafe permissions", defs: [], overrides: {} }];
    } else if (read.kind === "invalid") {
      records = [{ id: "config", transport: "stdio", state: "invalid", detail: "invalid: JSON could not be parsed", defs: [], overrides: {} }];
    } else {
      records = parseEntries(read.raw);
    }
    addComposioRecord();
    await Promise.all(
      records.map((r) => {
        const entry = pending.get(r.id);
        return entry && r.state === "down" ? connectRecord(r, entry) : undefined;
      }),
    );
    publishClasses();
  }

  return {
    configPath,
    load: () => serialize(reloadInternal),
    reload: () => {
      for (const attempt of pendingConnections) attempt.abort();
      return serialize(async () => { await reloadInternal(); try { opts.onChange?.(); } catch { /* A status listener cannot break a successful reload. */ } });
    },
    reloadComposio: () => serialize(async () => {
      if (closing) return;
      const old = records.filter(record => record.id === COMPOSIO_SERVER_ID && record.state !== "invalid");
      records = records.filter(record => !old.includes(record));
      for (const record of old) await closeRecord(record);
      pending.delete(COMPOSIO_SERVER_ID);
      const record = addComposioRecord();
      if (record) await connectRecord(record, pending.get(COMPOSIO_SERVER_ID)!);
      publishClasses();
      try { opts.onChange?.(); } catch { /* status listeners cannot break connector recovery */ }
    }),
    applyServer: (id) => serialize(async () => {
      // Composio has its own sign-in and refresh path; a file edit must never replace its live connection.
      if (closing || id === COMPOSIO_SERVER_ID) return;
      const offered = () => records.some(record => record.id === id && record.state === "connected" && (record.offerToAgents ?? true));
      // An unreadable file must not make a live server vanish: leave everything as it is until the file is fixed.
      const read = readConfig(configPath);
      if (read.kind === "refused" || read.kind === "invalid") return;
      const wasOffered = offered();
      const position = records.findIndex(record => record.id === id);
      const old = records.filter(record => record.id === id);
      records = records.filter(record => record.id !== id);
      for (const record of old) await closeRecord(record);
      pending.delete(id);
      if (read.kind === "ok") {
        const fresh = parseEntries(read.raw, id);
        records.splice(position >= 0 ? Math.min(position, records.length) : records.length, 0, ...fresh);
        for (const record of fresh) {
          const entry = pending.get(record.id);
          if (entry && record.state === "down") await connectRecord(record, entry);
        }
      }
      publishClasses();
      try { opts.onChange?.({ offeredChanged: wasOffered || offered() }); } catch { /* status listeners cannot break a per-server change */ }
    }),
    async checkServer(item): Promise<McpCheckResult> {
      if (closing) return { ok: false, reason: "the daemon is shutting down" };
      const invalid = validateServerItem(item, redactor);
      if (invalid) return { ok: false, reason: invalid };
      const entry = entrySchema.parse(item);
      // A stdio candidate would run a command: only remote servers are ever checked, from the desk or anywhere else.
      if (entry.transport !== "http") return { ok: false, reason: "only remote servers can be checked" };
      const resolved = resolveEntry(entry, env, opts.secrets, opts.dataDir);
      if (resolved.kind === "missing") return { ok: false, reason: missingDetail(resolved) };
      const attempt=new AbortController();pendingConnections.add(attempt);
      const connecting = connector(resolved.cfg,attempt.signal).then(conn=>{let closed:Promise<void>|undefined;return {client:conn.client,close:()=>closed??=Promise.resolve().then(()=>conn.close())};});
      let connection: McpConnection | undefined;
      try {
        connection = await withTimeout(connecting, CONNECT_TIMEOUT_MS, "connect timed out");
        attempt.signal.throwIfAborted();
        const abort=()=>{void closeHandle(connection!);};attempt.signal.addEventListener("abort",abort,{once:true});
        const tools = await withTimeout(listMcpTools(connection.client), CONNECT_TIMEOUT_MS, "list timed out");
        return {
          ok: true, truncated: tools.length > CHECK_TOOL_LIMIT,
          tools: tools.slice(0, CHECK_TOOL_LIMIT).map(tool => ({ name: redactor.redactString(tool.name).slice(0, 100), description: redactor.redactString(tool.description ?? "").slice(0, 200) })),
        };
      } catch (err) {
        // A connect that finishes after the timeout must still be closed.
        attempt.abort();
        if (!connection) trackCleanup(connecting.then(late => late.close(),()=>undefined));
        return { ok: false, reason: err instanceof TimeoutError ? err.message : ssrfReason(err) ?? "connect failed" };
      } finally {
        if(connection)await closeHandle(connection);
        pendingConnections.delete(attempt);
      }
    },
    entries(): McpEntries {
      const config = readMcpConfig(opts.dataDir);
      const servers = config.value.servers.map((item): McpEntryView | undefined => {
        if (!item || typeof item !== "object") return undefined;
        const raw = item as Record<string, unknown>;
        if (typeof raw.id !== "string") return undefined;
        const http = raw.transport === "http";
        const headers = http && raw.headers && typeof raw.headers === "object" && !Array.isArray(raw.headers)
          ? Object.entries(raw.headers as Record<string, unknown>).filter((pair): pair is [string, string] => typeof pair[1] === "string").map(([name, template]) => ({ name, template })) : undefined;
        const desk = !http && raw.managedBy === "desk";
        const review = desk && raw.review && typeof raw.review === "object" ? raw.review as { hash?: unknown; executable?: unknown; binding?: unknown } : undefined;
        const env = desk && raw.env && typeof raw.env === "object" && !Array.isArray(raw.env)
          ? Object.entries(raw.env as Record<string, unknown>).filter((pair): pair is [string, string] => typeof pair[1] === "string").map(([name, template]) => ({ name, template })) : undefined;
        return {
          ...(desk ? { managedBy: "desk" as const, command: typeof raw.command === "string" ? raw.command : "", args: Array.isArray(raw.args) ? raw.args.filter((arg): arg is string => typeof arg === "string") : [], ...(env ? { env } : {}),
            ...(typeof review?.hash === "string" && typeof review.executable === "string" && typeof review.binding === "string" ? { review: { hash: review.hash, executable: review.executable, binding: review.binding } } : {}) } : {}),
          id: raw.id, origin: raw.openagPackage ? "builtin" : "custom", transport: http ? "http" : "stdio",
          enabled: raw.enabled !== false, offerToAgents: raw.offerToAgents !== false,
          timeoutMs: typeof raw.timeoutMs === "number" ? raw.timeoutMs : DEFAULT_TIMEOUT_MS,
          ...(http ? { url: typeof raw.url === "string" ? raw.url : "", allowPrivateNetwork: raw.allowPrivateNetwork === true, ...(headers ? { headers } : {}), ...(raw.oauth && typeof raw.oauth === "object" ? { oauth: raw.oauth as { scope?: string; clientMetadataUrl?: string } } : {}) } : {}),
        };
      }).filter((view): view is McpEntryView => view !== undefined);
      return redactor.redact({ digest: config.digest, servers });
    },
    toolDefs() {
      return records.flatMap((r) => r.defs.filter((d) => d.enabled?.() ?? true));
    },
    executors() {
      return toExecutors(records.flatMap((r) => r.defs));
    },
    ownerToolDefs() {
      return records.flatMap((r) => (r.ownerDefs ?? []).filter((d) => d.enabled?.() ?? true));
    },
    ownerExecutors() {
      return toExecutors(records.flatMap((r) => r.ownerDefs ?? []));
    },
    status(): ServerStatus[] {
      for (const record of records) recheckPackage(record);
      return redactor.redact(records.map((r) => ({
        id: r.id,
        transport: r.transport,
        state: r.state,
        ...(r.detail ? { detail: r.detail } : {}),
        toolCount: r.state === "connected" ? r.defs.length : 0,
        ...(r.state === "connected" && r.version ? { version: r.version } : {}),
        ...(pending.get(r.id)?.openagPackage ? { package: pending.get(r.id)!.openagPackage } : {}),
        origin: r.origin ?? "custom",
        enabled: r.enabled ?? true,
        offerToAgents: r.offerToAgents ?? true,
        requirements: r.requirements ?? [],
        ...(r.unavailable?.length ? {unavailable:r.unavailable} : {}),
        tools: r.state === "connected" ? r.defs.map(d => ({ name: d.name, description: d.description, class: d.class })) : [],
      })));
    },
    close() {
      for(const attempt of pendingConnections)attempt.abort();
      closing ??= serialize(async () => {
        await closeAll();
        while (pendingCleanup.size) await Promise.all([...pendingCleanup]);
        await closeSsrfAgents();
        setAdminToolClasses({});
        if (cleanupFailed) throw Error("MCP cleanup unconfirmed");
      });
      return closing;
    },
  };
}
