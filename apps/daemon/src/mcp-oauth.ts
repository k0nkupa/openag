import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { z } from "zod";
import { discoverOAuthServerInfo, exchangeAuthorization, refreshAuthorization, registerClient, startAuthorization } from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthorizationServerMetadata, OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { connectorCredentialStore } from "./connector-credentials.js";
import { resolveConnectorKey } from "./connector-key.js";
import { boundedMcpFetch, connectMcpHttp, mcpRequestSignal } from "./mcp/client.js";
import { checkUrl, createGuardedFetch, type GuardedFetchOptions } from "./mcp/ssrf-fetch.js";
import { managedPath } from "./package-files.js";
import { getDefaultRedactor } from "./redact.js";
import type { SignInRoute } from "./signin-routes.js";

/**
 * OAuth for custom remote MCP servers (OA-457). The daemon is the OAuth client: it discovers the server's authorization server,
 * registers (an owner-entered client, then a client metadata document, then dynamic registration), sends the owner through the
 * managed callback route, checks `state` and `iss` BEFORE it spends a code, and keeps tokens only in `connector-mcp-oauth.enc`.
 * Every OAuth request goes through the guarded fetch (the entry's `allowPrivateNetwork` decides about plain http and private hosts).
 *
 * MCP requests carry a bearer from one single-flight token manager instead of the SDK's `authProvider`: fresh stateless clients are
 * created per invocation, and each running the SDK's own refresh could rotate one refresh token twice. A 401 or a failed refresh turns
 * the server into "needs sign-in"; the request that hit it is never retried or replayed.
 */

export class NeedsSignInError extends Error {
  constructor(message = "needs sign-in") { super(message); }
}
export class McpOAuthError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 503 = 400) { super(message); }
}

export interface McpOAuthEntry { id: string; url: string; allowPrivateNetwork: boolean; oauth: { scope?: string; clientMetadataUrl?: string } }

const clientSchema = z.object({ client_id: z.string().min(1).max(2048), client_secret: z.string().max(4096).optional() }).passthrough();
const tokensSchema = z.object({ access_token: z.string().min(1), token_type: z.string(), refresh_token: z.string().optional(), expires_in: z.number().optional(), scope: z.string().optional(), id_token: z.string().optional() }).passthrough();
const serverRecord = z.object({
  origin: z.string(), issuer: z.string(), resource: z.string().optional(), redirectUri: z.string(), source: z.enum(["preregistered", "cimd", "dcr"]),
  client: clientSchema, tokens: tokensSchema.optional(), expiresAt: z.number().optional(), needsSignIn: z.boolean().default(false), needsScope: z.string().optional(),
}).strict();
const bookSchema = z.object({
  version: z.literal(1),
  /** Owner-entered clients, bound to the origin of the server they were entered for. */
  preregistered: z.record(z.string(), z.object({ clientId: z.string().min(1).max(512), clientSecret: z.string().max(4096).optional(), origin: z.string() }).strict()).default({}),
  servers: z.record(z.string(), serverRecord).default({}),
}).strict();
type Book = z.infer<typeof bookSchema>;
type ServerRecord = z.infer<typeof serverRecord>;

/** OAuth error codes that mean the grant or client is no longer accepted. `server_error` and the like are only an unavailable server. */
const REJECTED: ReadonlySet<string> = new Set(["invalid_grant", "invalid_client", "unauthorized_client", "invalid_request", "access_denied", "invalid_scope", "unsupported_grant_type", "invalid_token"]);
const FLOW_MS = 5 * 60_000;
const REFRESH_MARGIN_MS = 60_000;
const MAX_BODY = 65536;
const own = <T>(object: Record<string, T>, key: string): T | undefined => (Object.hasOwn(object, key) ? object[key] : undefined);
const sameUrl = (a: string, b: string) => { try { return new URL(a).href.replace(/\/$/, "") === new URL(b).href.replace(/\/$/, ""); } catch { return false; } };

interface Flow {
  serverId: string; actor: string; expires: number; redirect: string; verifier: string; state: string; resource?: string;
  issuer: string; metadata: AuthorizationServerMetadata; client: OAuthClientInformationMixed; source: ServerRecord["source"]; origin: string;
  entry: McpOAuthEntry; route?: SignInRoute; exchanging?: boolean; cancelled?: boolean; reading?: boolean;
}

export interface McpOAuthOptions {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  /** The current configuration of a custom http server that uses OAuth, or undefined. */
  entry(id: string): McpOAuthEntry | undefined;
  /** The managed callback route (hosted mailbox, Tailscale or operator-configured), the same one Composio uses. */
  prepareSignIn(state: string, browserOrigin?: string): Promise<SignInRoute>;
  now?: () => number;
  /** A server's sign-in state changed (signed in, needs sign-in, disconnected): bring that one server in line. */
  onChange?: (serverId: string) => Promise<void> | void;
  audit?: (action: string, serverId: string) => void;
  /** Test seams for the guarded fetch (fake DNS, a stand-in fetch). Production leaves them out. */
  guarded?: Pick<GuardedFetchOptions, "lookup" | "fetchImpl">;
}

export interface McpOAuthStatus {
  state: "signed_in" | "needs_sign_in";
  issuer: string | null; registration: ServerRecord["source"] | null; hasOwnerClient: boolean; scope?: string; needsScope?: string;
}

export function createMcpOAuth(opts: McpOAuthOptions) {
  const env = opts.env ?? process.env, now = opts.now ?? Date.now, redactor = getDefaultRedactor();
  const file = () => managedPath(opts.dataDir, "connector-mcp-oauth.enc");
  const store = () => connectorCredentialStore(opts.dataDir, resolveConnectorKey(opts.dataDir, "mcp-oauth", env.OPENAG_CONNECTOR_KEY), "mcp-oauth");
  const starting=new Set<{serverId:string;actor:string;cancelled:boolean}>();
  const pendingStarts=new Set<Promise<unknown>>();
  const flows = new Map<string, Flow>();
  const attempts = new Map<string, { actor: string; serverId: string; expiresAt: number; status: "pending" | "connected" | "cancelled" | "failed" }>();
  const lifetime=new AbortController();
  const pendingConnections=new Set<Promise<unknown>>();
  const refreshing = new Map<string, Promise<void>>();
  const connections = new Map<string, Set<{ close(): Promise<void> }>>();
  let queue: Promise<unknown> = Promise.resolve(), closed = false;

  const remember = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [name, secret] of Object.entries(value)) if (["access_token", "refresh_token", "id_token", "client_secret", "registration_access_token"].includes(name) && typeof secret === "string") redactor.addSecret(secret);
  };
  function read(): Book {
    if (!existsSync(file())) return { version: 1, preregistered: {}, servers: {} };
    try { return bookSchema.parse(store().read()); } catch { throw new McpOAuthError("OAuth credentials cannot be read; the connector key or file needs recovery on the OpenAg computer", 503); }
  }
  /** Read-modify-write one at a time, so two updates in this process can never overwrite each other. */
  function update<T>(change: (book: Book) => T): Promise<T> {
    const run = queue.then(() => {
      const book = read(), result = change(book);
      try { store().write(book); } catch { throw new McpOAuthError("OAuth credentials could not be saved", 503); }
      return result;
    });
    queue = run.catch(() => undefined);
    return run;
  }
  // Loaded records are registered with the redactor once, so nothing stored can later appear in a log or ledger line.
  try { const book = read(); for (const record of Object.values(book.servers)) { remember(record.tokens); remember(record.client); } for (const client of Object.values(book.preregistered)) if (client.clientSecret) redactor.addSecret(client.clientSecret); } catch { /* unreadable: every server needs sign-in */ }

  const guardedFetch = (entry: McpOAuthEntry): typeof fetch => {
    const base = createGuardedFetch({ allowPrivateNetwork: entry.allowPrivateNetwork, ...opts.guarded });
    // Time and size limits for the metadata, registration and token calls; a hostile server cannot hold a request open or stream a huge body.
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const response = await base(input, { ...init, signal: AbortSignal.any([lifetime.signal,AbortSignal.timeout(15000), ...(init?.signal ? [init.signal] : [])]) });
      if (!response.body) return response;
      let size = 0;
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, output) { size += chunk.byteLength; if (size > MAX_BODY) throw Error("OAuth response too large"); output.enqueue(chunk); } }));
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }) as typeof fetch;
  };
  const originOf = (url: string): string => new URL(url).origin;
  const endpointProblem = (value: string | undefined, entry: McpOAuthEntry, what: string): string | null => {
    if (!value) return `${what} is missing`;
    const reason = checkUrl(value, { allowPrivateNetwork: entry.allowPrivateNetwork });
    if (reason) return `${what} is not acceptable (${reason})`;
    return new URL(value).hash ? `${what} must not have a fragment` : null;
  };

  /** Discovery plus every check the SDK leaves to us. Throws McpOAuthError with a fixed reason. */
  async function discover(entry: McpOAuthEntry, fetchFn: typeof fetch) {
    let info;
    try { info = await discoverOAuthServerInfo(new URL(entry.url), { fetchFn }); }
    catch (error) { throw new McpOAuthError(`The server's sign-in service could not be discovered (${(error as Error).message.slice(0, 120)})`); }
    const metadata = info.authorizationServerMetadata;
    if (!metadata) throw new McpOAuthError("The server does not advertise an authorization server");
    const issuer = String(info.authorizationServerUrl);
    const refused = endpointProblem(metadata.issuer, entry, "issuer") ?? endpointProblem(metadata.authorization_endpoint, entry, "authorization endpoint") ?? endpointProblem(metadata.token_endpoint, entry, "token endpoint")
      ?? (metadata.registration_endpoint ? endpointProblem(metadata.registration_endpoint, entry, "registration endpoint") : null);
    if (refused) throw new McpOAuthError(`Sign-in refused: ${refused}`);
    // RFC 8414: the issuer in the metadata must be the address it was discovered from, or a different server could impersonate it.
    if (!sameUrl(metadata.issuer, issuer)) throw new McpOAuthError("Sign-in refused: the authorization server's issuer does not match where it was discovered");
    if (!Array.isArray(metadata.code_challenge_methods_supported) || !metadata.code_challenge_methods_supported.includes("S256")) throw new McpOAuthError("Sign-in refused: the authorization server does not support PKCE (S256)");
    if (!metadata.response_types_supported?.includes("code")) throw new McpOAuthError("Sign-in refused: the authorization server does not support the authorization code flow");
    // RFC 9728: the protected resource must be on the server's own origin.
    // Only a resource the server advertised is sent as the resource indicator; inventing one could make a provider answer invalid_target.
    const advertised = info.resourceMetadata?.resource;
    if (advertised !== undefined && originOf(advertised) !== originOf(entry.url)) throw new McpOAuthError("Sign-in refused: the protected resource is on a different origin than the server");
    return { issuer, metadata, resource: advertised !== undefined ? new URL(advertised).href : undefined };
  }

  async function register(entry: McpOAuthEntry, found: Awaited<ReturnType<typeof discover>>, redirect: string, fetchFn: typeof fetch): Promise<{ client: OAuthClientInformationMixed; source: ServerRecord["source"] }> {
    const book = read(), preset = own(book.preregistered, entry.id);
    if (preset && preset.origin === originOf(entry.url)) return { client: { client_id: preset.clientId, ...(preset.clientSecret ? { client_secret: preset.clientSecret } : {}) }, source: "preregistered" };
    const metadataUrl = entry.oauth.clientMetadataUrl;
    if (metadataUrl && (found.metadata as { client_id_metadata_document_supported?: boolean }).client_id_metadata_document_supported === true) {
      if (checkUrl(metadataUrl, {}) === null) return { client: { client_id: metadataUrl }, source: "cimd" };
    }
    const saved = own(book.servers, entry.id);
    if (saved && saved.issuer === found.issuer && saved.redirectUri === redirect && saved.source === "dcr" && saved.origin === originOf(entry.url)) return { client: saved.client, source: "dcr" };
    if (!found.metadata.registration_endpoint) throw new McpOAuthError("This server needs a pre-registered client: enter its client ID in the server settings");
    try {
      const clientMetadata = { client_name: "OpenAg", redirect_uris: [redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", application_type: "web" };
      const client = await registerClient(found.issuer, { metadata: found.metadata, clientMetadata: clientMetadata as never, ...(entry.oauth.scope ? { scope: entry.oauth.scope } : {}), fetchFn });
      remember(client);
      return { client, source: "dcr" };
    } catch (error) { throw new McpOAuthError(`The server refused client registration (${(error as Error).message.slice(0, 120)})`); }
  }

  const finish = (state: string, status: "connected" | "cancelled" | "failed") => {
    const attempt = attempts.get(state); if (attempt?.status === "pending") attempt.status = status;
    const flow = flows.get(state); if (flow) { flow.cancelled = true; void flow.route?.close?.().catch(() => {}); }
    flows.delete(state);
  };
  const stop = (serverId: string) => {for(const start of starting)if(start.serverId===serverId)start.cancelled=true; for (const [state, flow] of flows) if (flow.serverId === serverId) finish(state, "cancelled"); };
  /**
   * Marks a server as needing sign-in. `failed` names the credential that was rejected: if the stored grant has since been replaced
   * (the owner signed in again while a slow request was still running), the newer grant is left alone.
   */
  const needsSignIn = async (serverId: string, scope?: string, failed?: { access?: string; refresh?: string }) => {
    let changed = false;
    await update(book => {
      const record = own(book.servers, serverId);
      if (!record) return;
      if (failed?.access !== undefined && record.tokens?.access_token !== failed.access) return;
      if (failed?.refresh !== undefined && record.tokens?.refresh_token !== failed.refresh) return;
      if (!record.needsSignIn || record.needsScope !== scope) { record.needsSignIn = true; delete record.tokens; delete record.expiresAt; if (scope) record.needsScope = scope; changed = true; }
    }).catch(() => undefined);
    // Not awaited: this can run inside a connect the manager is waiting on, and bringing the server in line waits for that same connect.
    if (changed) { opts.audit?.("mcp_oauth_needs_sign_in", serverId); void Promise.resolve().then(() => opts.onChange?.(serverId)).catch(() => undefined); }
  };

  async function exchange(flow: Flow, code: string) {
    const fetchFn = guardedFetch(flow.entry);
    const tokens = await exchangeAuthorization(flow.issuer, { metadata: flow.metadata, clientInformation: flow.client, authorizationCode: code, codeVerifier: flow.verifier, redirectUri: flow.redirect, ...(flow.resource ? { resource: new URL(flow.resource) } : {}), fetchFn });
    if (tokens.token_type.toLowerCase() !== "bearer") throw Error("Unsupported token type");
    remember(tokens);
    return tokens;
  }
  // No expires_in: a grant that can be refreshed is refreshed after about an hour; one that cannot is a non-expiring token (some providers issue those).
  const expiry = (tokens: OAuthTokens) => (tokens.expires_in !== undefined ? now() + tokens.expires_in * 1000 : tokens.refresh_token ? now() + 55 * 60_000 : Number.MAX_SAFE_INTEGER);

  async function finishCallback(input: unknown, authorize: (actor: string) => boolean): Promise<void> {
    const value = z.object({ state: z.string().min(40).max(128), code: z.string().min(1).max(4096).optional(), error: z.string().min(1).max(256).optional(), iss: z.string().max(2048).optional() }).strict().parse(input);
    const flow = flows.get(value.state);
    if (!flow || flow.exchanging || flow.cancelled || flow.expires <= now() || closed) throw Error("expired");
    if (value.code) redactor.addSecret(value.code);
    let outcome: "connected" | "cancelled" | "failed" = "failed";
    try {
      // RFC 9207: the issuer the browser reports must be the one the flow started with. A missing one is refused when the server promised to send it.
      const advertised = (flow.metadata as { authorization_response_iss_parameter_supported?: boolean }).authorization_response_iss_parameter_supported === true;
      if (value.iss !== undefined ? !sameUrl(value.iss, flow.metadata.issuer) : advertised) throw Error("issuer");
      if (value.error || !value.code) { outcome = value.error === "access_denied" ? "cancelled" : "failed"; throw Error("not authorized"); }
      if (!authorize(flow.actor)) throw Error("authority");
      // Consumed before the exchange: a duplicate callback cannot spend the single-use code twice.
      flow.exchanging = true;
      const tokens = await exchange(flow, value.code);
      if (!authorize(flow.actor) || flow.cancelled || flow.expires <= now() || opts.entry(flow.serverId)?.url === undefined || originOf(opts.entry(flow.serverId)!.url) !== flow.origin) throw Error("changed");
      await update(book => { book.servers[flow.serverId] = serverRecord.parse({ origin: flow.origin, issuer: flow.issuer, resource: flow.resource, redirectUri: flow.redirect, source: flow.source, client: flow.client, tokens, expiresAt: expiry(tokens), needsSignIn: false }); });
      outcome = "connected";
      opts.audit?.("mcp_oauth_signed_in", flow.serverId);
      await opts.onChange?.(flow.serverId);
    } catch { if (outcome === "connected") outcome = "failed"; throw Error("sign-in was not completed"); }
    finally { if (flows.has(value.state)) finish(value.state, outcome); }
  }

  async function refresh(entry: McpOAuthEntry, record: ServerRecord): Promise<void> {
    const refreshToken = record.tokens?.refresh_token;
    if (!refreshToken) { await needsSignIn(entry.id, undefined, { access: record.tokens?.access_token }); throw new NeedsSignInError(); }
    try {
      const fetchFn = guardedFetch(entry);
      const found = await discover(entry, fetchFn);
      if (!sameUrl(found.issuer, record.issuer)) throw new McpOAuthError("Sign-in refused: the authorization server changed");
      const tokens = await refreshAuthorization(found.issuer, { metadata: found.metadata, clientInformation: record.client, refreshToken, ...(record.resource ? { resource: new URL(record.resource) } : {}), fetchFn });
      remember(tokens);
      await update(book => {
        const current = own(book.servers, entry.id);
        // Only the record this refresh started from may be replaced: a disconnect or a new sign-in in the meantime wins.
        if (!current || current.tokens?.refresh_token !== refreshToken) return;
        book.servers[entry.id] = { ...current, tokens: { ...tokens, refresh_token: tokens.refresh_token ?? refreshToken }, expiresAt: expiry(tokens), needsSignIn: false };
      });
    } catch (error) {
      // The server said no (or the grant is gone): sign in again. A network failure or a 5xx is only an unavailable server and keeps the grant.
      const rejected = (error instanceof OAuthError && REJECTED.has(error.errorCode)) || (error instanceof McpOAuthError && /refused/.test(error.message));
      if (rejected) { await needsSignIn(entry.id, undefined, { refresh: refreshToken }); throw new NeedsSignInError(); }
      throw new Error("The sign-in service is not reachable right now");
    }
  }

  /** The bearer for a server. One refresh at a time per server; everyone else waits for it and reads the result. */
  async function accessToken(entry: McpOAuthEntry): Promise<string> {
    const record = own(read().servers, entry.id);
    if (!record || record.needsSignIn || !record.tokens || record.origin !== originOf(entry.url)) throw new NeedsSignInError();
    if ((record.expiresAt ?? 0) > now() + REFRESH_MARGIN_MS) return record.tokens.access_token;
    let pending = refreshing.get(entry.id);
    if (!pending) { pending = refresh(entry, record).finally(() => refreshing.delete(entry.id)); refreshing.set(entry.id, pending); }
    await pending;
    // Whatever the refresh stored is used as it is, even if it is short-lived: asking again straight away would only rotate the token twice.
    const fresh = own(read().servers, entry.id);
    if (!fresh || fresh.needsSignIn || !fresh.tokens || fresh.origin !== originOf(entry.url)) throw new NeedsSignInError();
    return fresh.tokens.access_token;
  }

  return {
    async status(serverId: string): Promise<McpOAuthStatus> {
      const book = read(), record = own(book.servers, serverId), preset = own(book.preregistered, serverId);
      const entry = opts.entry(serverId);
      const signedIn = !!record && !record.needsSignIn && !!record.tokens && !!entry && record.origin === originOf(entry.url);
      return { state: signedIn ? "signed_in" : "needs_sign_in", issuer: record?.issuer ?? null, registration: record?.source ?? null, hasOwnerClient: !!preset && !!entry && preset.origin === originOf(entry.url), ...(entry?.oauth.scope ? { scope: entry.oauth.scope } : {}), ...(record?.needsScope ? { needsScope: record.needsScope } : {}) };
    },

    start(serverId: string, actor: string, browserOrigin: string | undefined, authorize: (actor: string) => boolean) {
      const job=(async()=>{
      const entry = opts.entry(serverId);
      if (!entry) throw new McpOAuthError("This server does not use OAuth", 409);
      if (closed || !authorize(actor)) throw new McpOAuthError("A Full device is required", 403);
      for (const [state, flow] of flows) if (flow.expires <= now()) finish(state, "cancelled");
      for (const [state, attempt] of attempts) if (attempt.expiresAt <= now()) attempts.delete(state);
      if (flows.size+starting.size >= 5) throw new McpOAuthError("Too many sign-in attempts are open; finish or cancel one first", 409);
      stop(serverId);
      const pending={serverId,actor,cancelled:false};starting.add(pending);
      const current=()=>{const latest=opts.entry(serverId);if(closed||pending.cancelled||!authorize(actor)||!latest||latest.url!==entry.url||JSON.stringify(latest.oauth)!==JSON.stringify(entry.oauth))throw new McpOAuthError("The sign-in was cancelled or the server changed",409);};
      try{
      const fetchFn = guardedFetch(entry);
      const found = await discover(entry, fetchFn);current();
      // Refuse now, before any route is prepared, when there is no way to get a client.
      {
        const book = read(), preset = own(book.preregistered, entry.id), saved = own(book.servers, entry.id);
        const cimd = entry.oauth.clientMetadataUrl && (found.metadata as { client_id_metadata_document_supported?: boolean }).client_id_metadata_document_supported === true;
        const reusable = saved && saved.issuer === found.issuer && saved.source !== "preregistered";
        if (!(preset && preset.origin === originOf(entry.url)) && !cimd && !reusable && !found.metadata.registration_endpoint) throw new McpOAuthError("This server needs a pre-registered client: enter its client ID in the server settings");
      }
      const state = randomBytes(32).toString("base64url"); redactor.addSecret(state);
      let route: SignInRoute | undefined;
      try {
        route = await opts.prepareSignIn(state, browserOrigin);
        current();
        const redirect = route.callback;
        const { client, source } = await register(entry, found, redirect, fetchFn);
        current();
        const started = await startAuthorization(found.issuer, { metadata: found.metadata, clientInformation: client, redirectUrl: redirect, ...(entry.oauth.scope ? { scope: entry.oauth.scope } : {}), state, ...(found.resource ? { resource: new URL(found.resource) } : {}) });
        redactor.addSecret(started.codeVerifier);
        // The browser is sent only to the address discovery validated.
        if (new URL(started.authorizationUrl).origin !== originOf(found.metadata.authorization_endpoint) || endpointProblem(started.authorizationUrl.href, entry, "authorization address")) throw new McpOAuthError("Sign-in refused: the authorization address is not acceptable");
        current();
        const flow: Flow = { serverId, actor, expires: now() + FLOW_MS, redirect, verifier: started.codeVerifier, state, resource: found.resource, issuer: found.issuer, metadata: found.metadata, client, source, origin: originOf(entry.url), entry, route };
        flows.set(state, flow);
        attempts.set(state, { actor, serverId, expiresAt: flow.expires, status: "pending" });
        while (attempts.size > 10) { const oldest = [...attempts].find(([, a]) => a.status !== "pending"); if (!oldest) break; attempts.delete(oldest[0]); }
        return { url: started.authorizationUrl.href, attempt: state, expiresAt: flow.expires, route: route.kind };
      } catch (error) {
        void route?.close?.().catch(() => {});
        if (error instanceof McpOAuthError) throw error;
        throw new McpOAuthError("Sign-in could not start. Try again, or ask the OpenAg operator to check the sign-in route.", 503);
      }
      }finally{starting.delete(pending);}
      })();pendingStarts.add(job);void job.then(()=>pendingStarts.delete(job),()=>pendingStarts.delete(job));return job;
    },

    async attempt(state: string, actor: string, authorize: (actor: string) => boolean) {
      const attempt = attempts.get(state);
      if (!attempt || attempt.actor !== actor || !authorize(actor)) throw new McpOAuthError("Sign-in attempt unavailable", 404);
      if (attempt.status === "pending" && attempt.expiresAt <= now()) finish(state, "cancelled");
      const flow = flows.get(state);
      if (flow?.route?.receive && !flow.exchanging && !flow.reading) {
        flow.reading = true;
        try { const callback = await flow.route.receive(); if (callback) await finishCallback(callback, authorize); }
        catch (error) { if ((error as Error).name === "SignInUnavailable" || error instanceof Error && /temporarily unavailable/.test(error.message)) return { status: "pending" as const, expiresAt: attempt.expiresAt, retryAfterMs: 2000 }; finish(state, "failed"); }
        finally { flow.reading = false; }
      }
      return { status: attempt.status, expiresAt: attempt.expiresAt };
    },
    cancel(state: string, actor: string) {
      const attempt = attempts.get(state);
      if (!attempt || attempt.actor !== actor) throw new McpOAuthError("Sign-in attempt unavailable", 404);
      if (attempt.status === "pending") finish(state, "cancelled");
      return { status: attempt.status };
    },
    /** True while a sign-in for this exact state is waiting for its callback, so a probe with an unknown state costs nothing here. */
    hasPendingState: (state: string) => { const flow = flows.get(state); return !!flow && !flow.exchanging && !flow.cancelled && flow.expires > now(); },
    callback: finishCallback,

    /** A connection for the manager: every request carries the current bearer, and nothing is retried after a 401. */
    connect(cfg: { headers: Record<string, string> }, entry: McpOAuthEntry,signal?:AbortSignal) {
      const connectionSignal=AbortSignal.any([lifetime.signal,...(signal?[signal]:[])]);
      const tokenForConnection=()=>new Promise<string>((resolve,reject)=>{
        connectionSignal.throwIfAborted();
        const abort=()=>reject(connectionSignal.reason??Error("cancelled"));connectionSignal.addEventListener("abort",abort,{once:true});
        void accessToken(entry).then(token=>{connectionSignal.removeEventListener("abort",abort);resolve(token);},error=>{connectionSignal.removeEventListener("abort",abort);reject(error);});
      });
      const job=(async()=>{
      connectionSignal.throwIfAborted();
      if (closed) throw new Error("closed");
      // Fail before any request when there is nothing to send: this is "needs sign-in", not a failed connection.
      await tokenForConnection();
      // MCP traffic keeps the MCP limits (large tool lists, long calls, event streams); only the OAuth calls above are size- and time-limited.
      const guarded = createGuardedFetch({ allowPrivateNetwork: entry.allowPrivateNetwork, ...opts.guarded });
      connectionSignal.throwIfAborted();
      const connection = await connectMcpHttp(new URL(entry.url), {signal:connectionSignal, requestInit: { headers: cfg.headers }, fetchForClient: client => async (url, init) => {
        const token = await tokenForConnection();
        const headers = new Headers(init?.headers); headers.set("Authorization", `Bearer ${token}`);
        const response = await boundedMcpFetch(url, { ...init, headers }, guarded, mcpRequestSignal(client, init));
        if (response.status === 401 || response.status === 403) {
          const challenge = response.headers.get("www-authenticate") ?? "";
          await response.body?.cancel();
          const scope = response.status === 403 && /insufficient_scope/.test(challenge) ? (/scope="([^"]{1,200})"/.exec(challenge)?.[1] ?? "more access") : undefined;
          if (response.status === 401 || scope) await needsSignIn(entry.id, scope, { access: token });
          throw new Error("The server needs you to sign in again; the operation was not retried");
        }
        return response;
      } });
      if(connectionSignal.aborted||closed){await connection.close();throw Error("closed");}
      const set = connections.get(entry.id) ?? new Set(); connections.set(entry.id, set); set.add(connection);
      return { client: connection.client, close: async () => { set.delete(connection); await connection.close(); } };
      })();pendingConnections.add(job);void job.then(()=>pendingConnections.delete(job),()=>pendingConnections.delete(job));return job;
    },

    /** Clears this server's tokens and registered client. The provider is not asked to revoke anything: that is unconfirmed. */
    async disconnect(serverId: string) {
      stop(serverId);
      await update(book => { delete book.servers[serverId]; });
      await Promise.allSettled([...(connections.get(serverId) ?? [])].map(connection => connection.close())); connections.delete(serverId);
      opts.audit?.("mcp_oauth_disconnected", serverId);
      await opts.onChange?.(serverId);
      return { disconnected: true, revoked: false };
    },
    /** The server was removed or moved to another origin: nothing stored for it may stay. Runs inside the config write, so it is synchronous. */
    checkpoint:()=>existsSync(file())?store().checkpoint():()=>{},
    dropServer(serverId: string): void {
      stop(serverId);
      if (!existsSync(file())) return;
      const book = read();
      if (!own(book.servers, serverId) && !own(book.preregistered, serverId)) return;
      delete book.servers[serverId]; delete book.preregistered[serverId];
      try { store().write(book); } catch { throw new McpOAuthError("OAuth credentials could not be saved", 503); }
    },
    async setClient(serverId: string, clientId: string, clientSecret: string | undefined, origin: string) {
      if (clientSecret) redactor.addSecret(clientSecret);
      await update(book => {
        const previous = own(book.preregistered, serverId);
        const secret = clientSecret ?? (previous?.clientId === clientId && previous.origin === origin ? previous.clientSecret : undefined);
        book.preregistered[serverId] = { clientId, ...(secret ? { clientSecret: secret } : {}), origin };
        // A different client means the old grant and registration no longer apply.
        delete book.servers[serverId];
      });
      stop(serverId);
    },
    async removeClient(serverId: string) {
      let had = false;
      await update(book => { had = own(book.preregistered, serverId) !== undefined; delete book.preregistered[serverId]; if (own(book.servers, serverId)?.source === "preregistered") delete book.servers[serverId]; });
      if (!had) throw new McpOAuthError("No owner-entered client", 404);
      stop(serverId);
      await opts.onChange?.(serverId);
    },
    revokeDevice(actor: string) {for(const start of starting)if(start.actor===actor)start.cancelled=true; for (const [state, flow] of flows) if (flow.actor === actor) finish(state, "cancelled"); },
    async close() { closed = true;for(const start of starting)start.cancelled=true;lifetime.abort();await Promise.allSettled([...pendingStarts,...pendingConnections,...refreshing.values(),queue]); for (const state of flows.keys()) finish(state, "cancelled"); await Promise.allSettled([...connections.values()].flatMap(set => [...set].map(connection => connection.close()))); connections.clear(); },
  };
}
export type McpOAuth = ReturnType<typeof createMcpOAuth>;
