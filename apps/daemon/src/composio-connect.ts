import { SignInUnavailable, type SignInRoute } from "./signin-routes.js";
import { randomBytes } from "node:crypto";
import { connectMcpHttp, boundedMcpFetch, mcpRequestSignal } from "./mcp/client.js";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthClientInformationSchema, OAuthTokensSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { z } from "zod";
import { connectorCallback, trustedDeskOrigin, type ConnectorSignIn } from "./callback-address.js";
import { resolveConnectorKey } from "./connector-key.js";
import { connectorCredentialStore } from "./connector-credentials.js";
import { getDefaultRedactor } from "./redact.js";

export const COMPOSIO_SERVER_ID = "composio-connect";
const SERVER = "https://connect.composio.dev/mcp";
const recordSchema = z.object({ client: OAuthClientInformationSchema, tokens: OAuthTokensSchema, expiresAt: z.number(), needsAccess: z.boolean(), redirectUri: z.string().optional() }).strict();
type Account = z.infer<typeof recordSchema>;
type Flow = { reading?: boolean; route?: SignInRoute; returnTo?: string; redirect: string; actor: string; expires: number; generation: number; verifier?: string; client?: Account["client"]; tokens?: Account["tokens"]; cancelled?: boolean; exchanging?: boolean; url?: string };
export interface ComposioOptions {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  localOrigin?: () => string | undefined;
  getSignIn?: () => ConnectorSignIn;
  prepareSignIn?: (state: string, browserOrigin?: string) => Promise<SignInRoute>;
  fetch?: typeof fetch;
  now?: () => number;
  onChange?: () => Promise<void> | void;
  audit?: (action: string) => void;
}

/** Fixed optional connection. OAuth credentials never enter mcp.json, SQLite or bot environments. */
export function createComposioConnect(opts: ComposioOptions) {
  const env = opts.env ?? process.env, fetcher = opts.fetch ?? fetch, now = opts.now ?? Date.now, redactor = getDefaultRedactor();
  let store: ReturnType<typeof connectorCredentialStore> | undefined, account: Account | null = null;
  let failure: string | null = null, closed = false, disconnecting = false, generation = 0;
  let controller = new AbortController(), refreshing: Promise<void> | null = null;
  const flows = new Map<string, Flow>();
  const clients = new Set<{ close(): Promise<void> }>();
  const attempts = new Map<string, { actor: string; expiresAt: number; status: "pending" | "connected" | "cancelled" | "failed" }>();
  function finish(state: string, status: "connected" | "cancelled" | "failed") {
    const attempt = attempts.get(state); if (attempt?.status === "pending") attempt.status = status;
    const flow = flows.get(state); if (flow) { flow.cancelled = true; void flow.route?.close?.().catch(() => {}); }
    flows.delete(state);
  }
  function remember(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [name, secret] of Object.entries(value)) if (["access_token", "refresh_token", "id_token", "client_secret", "registration_access_token"].includes(name) && typeof secret === "string") redactor.addSecret(secret);
  }
  if (env.OPENAG_CONNECTOR_KEY) redactor.addSecret(env.OPENAG_CONNECTOR_KEY);
  try {
    store = connectorCredentialStore(opts.dataDir, resolveConnectorKey(opts.dataDir, "composio", env.OPENAG_CONNECTOR_KEY), "composio");
    const saved = store.read();
    if (saved) { account = recordSchema.parse(saved); remember(account.tokens); remember(account.client); }
  } catch { failure = "Connector credentials need recovery on the OpenAg computer. Restore the original private key and encrypted credential files; do not generate replacements."; }
  const signIn = () => opts.getSignIn?.() ?? { callbackOrigin: null, deskOrigins: [] };
  function redirect(): string {
    const original = account?.redirectUri;
    const config = signIn();
    if (original && !env.OPENAG_PUBLIC_URL && !env.OPENAG_COMPOSIO_REDIRECT_URI && !config.callbackOrigin) return connectorCallback({ OPENAG_COMPOSIO_REDIRECT_URI: original });
    return connectorCallback(env, opts.localOrigin?.(), config.callbackOrigin);
  }
  function deskOrigin(origin: string | undefined, uri: string): string {
    return trustedDeskOrigin(origin ?? new URL(uri).origin, uri, opts.localOrigin?.(), signIn().deskOrigins);
  }
  const configured = () => !!store && !failure && !closed;
  const enabled = () => configured() && !!account && !account.needsAccess;
  function valid(revision: number) { if (closed || revision !== generation) throw Error("Composio connection changed"); }
  function save(next: Account | null) { if (!store) throw Error("Composio setup is incomplete"); store.write(next); account = next; }
  function changed() { generation++; controller.abort(); controller = new AbortController(); for (const state of flows.keys()) finish(state, "cancelled"); }
  async function notify() { await opts.onChange?.(); }
  function needsAccess() {
    if (!account || account.needsAccess) return;
    save({ ...account, needsAccess: true }); changed();
    opts.audit?.("composio_needs_access"); void notify().catch(() => {});
  }
  // Trust only the provider's documented endpoints, including discovery's cross-origin token endpoint.
  function allowed(url: URL) {
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
    return url.origin === "https://connect.composio.dev" && ["/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server", "/.well-known/openid-configuration"].includes(url.pathname)
      || url.origin === "https://login.composio.dev" && ["/oauth2/register", "/oauth2/token"].includes(url.pathname);
  }
  async function request(input: string | URL | Request, init: RequestInit = {}, signal = controller.signal, limit = 65536, invocationSignal?: AbortSignal) {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (!allowed(url)) throw Error("Composio endpoint is not permitted");
    if(url.pathname==='/mcp')return boundedMcpFetch(url,{...init,redirect:'error',signal:AbortSignal.any([signal,...(init.signal?[init.signal]:[])])},fetcher,invocationSignal);
    const response = await fetcher(url, { ...init, redirect: "error", signal: AbortSignal.any([signal, ...(init.signal ? [init.signal] : []), AbortSignal.timeout(15000)]) });
    if (!response.body) return response;
    let size = 0;
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, output) {
      size += chunk.byteLength;
      if (size > limit) throw Error("Composio response too large");
      output.enqueue(chunk);
    } }));
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  function provider(flow: Flow, state?: string): OAuthClientProvider {
    const check = () => { valid(flow.generation); if (flow.cancelled || flow.actor && flow.expires <= now()) throw Error("Composio sign-in expired"); if (state && (flows.get(state) !== flow || flow.expires <= now())) throw Error("Composio sign-in expired"); };
    return {
      redirectUrl: flow.redirect,
      clientMetadata: { client_name: "OpenAg", redirect_uris: [flow.redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" },
      state: () => { check(); return state!; },
      clientInformation: () => { check(); return flow.client; },
      saveClientInformation: info => { check(); remember(info); flow.client = info; },
      tokens: () => { check(); return flow.tokens; },
      saveTokens: tokens => { check(); remember(tokens); flow.tokens = tokens; },
      saveCodeVerifier: verifier => { check(); redactor.addSecret(verifier); flow.verifier = verifier; },
      codeVerifier: () => { check(); if (!flow.verifier) throw Error("Missing Composio verifier"); return flow.verifier; },
      redirectToAuthorization: url => {
        check();
        if (!state) throw Error("Composio sign-in required");
        if (url.origin !== "https://connect.composio.dev" || url.pathname !== "/oauth/authorize" || url.username || url.password) throw Error("Invalid Composio sign-in URL");
        flow.url = url.href;
      },
      // Stop the SDK's automatic recovery from silently registering/retrying after invalid credentials.
      invalidateCredentials: () => { throw Error("Composio sign-in required"); },
    };
  }
  async function authenticate(flow: Flow, state?: string, code?: string) {
    const signal = controller.signal;
    return auth(provider(flow, state), { serverUrl: SERVER, ...(code ? { authorizationCode: code } : {}), fetchFn: (url, init) => request(url, init, signal) });
  }
  async function access() {
    if (!enabled() || !account) throw Error("Composio sign-in required");
    if (account.expiresAt > now() + 60000) return account.tokens.access_token;
    if (!refreshing) {
      const revision = generation, prior = account;
      refreshing = (async () => {
        if (!prior.tokens.refresh_token) { needsAccess(); throw Error("Composio sign-in required"); }
        const flow: Flow = { redirect: prior.redirectUri ?? redirect(), actor: "", expires: 0, generation: revision, client: prior.client, tokens: prior.tokens };
        try {
          if (await authenticate(flow) !== "AUTHORIZED" || !flow.tokens) throw Error("Sign-in required");
          valid(revision);
          save(recordSchema.parse({ client: flow.client, tokens: { ...flow.tokens, refresh_token: flow.tokens.refresh_token || prior.tokens.refresh_token }, expiresAt: now() + (flow.tokens.expires_in ?? 0) * 1000, needsAccess: false, ...(prior.redirectUri || env.OPENAG_COMPOSIO_REDIRECT_URI ? { redirectUri: flow.redirect } : {}) }));
        } catch { if (revision === generation) needsAccess(); throw Error("Composio access could not be refreshed. Reconnect Composio."); }
      })().finally(() => { refreshing = null; });
    }
    await refreshing;
    if (!enabled() || !account) throw Error("Composio sign-in required");
    return account.tokens.access_token;
  }
  async function complete(input: unknown, actor: string, authorize: (actor: string) => boolean) {
    const { state, code } = z.object({ state: z.string().min(40).max(128), code: z.string().min(1).max(4096) }).strict().parse(input);
    redactor.addSecret(code);
    const flow = flows.get(state);
    if (!flow || !authorize(actor) || flow.exchanging || flow.actor !== actor || flow.expires <= now() || flow.generation !== generation || !configured()) throw Error("Composio sign-in expired or belongs to another device");
    // Consume before exchanging: duplicate callbacks cannot exchange a single-use code twice.
    flow.exchanging = true;
    try {
      if (await authenticate(flow, undefined, code) !== "AUTHORIZED" || !flow.client || !flow.tokens) throw Error("Authorization incomplete");
      valid(flow.generation);
      if (!authorize(actor) || flow.cancelled || flow.expires <= now()) throw Error("Composio sign-in expired");
      save(recordSchema.parse({ client: flow.client, tokens: flow.tokens, expiresAt: now() + (flow.tokens.expires_in ?? 0) * 1000, needsAccess: false, redirectUri: flow.redirect }));
      changed(); const attempt = attempts.get(state); if (attempt) attempt.status = "connected"; opts.audit?.("composio_connected"); await notify();
    } catch { throw Error("Composio connection was not completed. Check the connection status before trying again."); }
    finally { if (flows.has(state)) finish(state, "failed"); }
  }
  async function finishCallback(input: unknown, authorize: (actor: string) => boolean) {
      const value = z.object({ state: z.string().min(40).max(128), code: z.string().min(1).max(4096).optional(), error: z.string().min(1).max(256).optional(), iss: z.string().max(2048).optional() }).strict().parse(input);
      const flow = flows.get(value.state);
      if (!flow || (!flow.returnTo && !flow.route) || flow.exchanging || flow.cancelled || flow.expires <= now() || flow.generation !== generation) throw Error("Composio sign-in expired. Return to your original desk and start again.");
      if (value.code) redactor.addSecret(value.code);
      const destination = flow.returnTo ? new URL(flow.returnTo) : null;
      if (destination) deskOrigin(destination.origin, flow.redirect);
      let result = "failed";
      try {
        if (value.iss && value.iss !== "https://connect.composio.dev") throw Error("Invalid issuer");
        if (value.error || !value.code) { result = value.error === "access_denied" ? "cancelled" : "failed"; }
        else { await complete({ state: value.state, code: value.code }, flow.actor, authorize); result = "connected"; }
      } catch { result = "failed"; }
      finally { if (flows.has(value.state)) finish(value.state, result === "cancelled" ? "cancelled" : "failed"); }
      destination?.searchParams.set("composioResult", result);
      return destination?.href ?? "/#/app-library";
  }
  return {
    enabled,
    status(browserOrigin?: string) {
      let reason = failure;
      if (!reason && !opts.prepareSignIn) { try { const uri = redirect(); if (browserOrigin) deskOrigin(browserOrigin, uri); } catch (err) { reason = err instanceof Error ? err.message : "Sign-in setup needs attention on the OpenAg computer."; } }
      return { configured: configured() && !reason, state: failure ? "failed" as const : enabled() ? "connected" as const : reason ? "setup" as const : "needs_access" as const,
        reason, hasAccount: !!account, signIn: { ...signIn(), effectiveCallbackOrigin: (() => { try { return new URL(redirect()).origin; } catch { return null; } })(), callbackLocked: !!(env.OPENAG_PUBLIC_URL || env.OPENAG_COMPOSIO_REDIRECT_URI) } };
    },
    async start(actor: string, browserOrigin?: string, authorize?: (actor: string) => boolean) {
      if (!configured() || disconnecting) throw Error("Composio setup is incomplete or disconnect is in progress");
      const legacyRedirect = opts.prepareSignIn ? undefined : redirect();
      const legacyOrigin = legacyRedirect ? deskOrigin(browserOrigin, legacyRedirect) : undefined;
      for (const [state, flow] of flows) if (flow.expires <= now()) finish(state, "cancelled");
      for (const [state, attempt] of attempts) if (attempt.expiresAt <= now()) attempts.delete(state);
      if (flows.size >= 5) throw Error("Too many Composio sign-in attempts");
      const state = randomBytes(32).toString("base64url"); redactor.addSecret(state);
      const flow: Flow = { redirect: "", actor, expires: now() + 5 * 60000, generation };
      flows.set(state, flow);
      try {
        if (opts.prepareSignIn) {
          if (!authorize?.(actor)) throw Error("Full device required");
          flow.route = await opts.prepareSignIn(state, browserOrigin);
          if (!authorize(actor) || flow.cancelled || flow.generation !== generation || flow.expires <= now()) throw Error("Sign-in cancelled");
          flow.redirect = connectorCallback({ OPENAG_COMPOSIO_REDIRECT_URI: flow.route.callback });
          // No return address is needed: the original desk remains open and reads its own attempt.
          attempts.set(state, { actor, expiresAt: flow.expires, status: "pending" });
          while (attempts.size > 10) { const oldest = [...attempts].find(([, a]) => a.status !== "pending"); if (!oldest) break; attempts.delete(oldest[0]); }
        } else {
          flow.redirect = legacyRedirect!;
          flow.returnTo = legacyOrigin + "/#/app-library";
        }
        const registered = account?.redirectUri ?? env.OPENAG_COMPOSIO_REDIRECT_URI;
        flow.client = registered === flow.redirect ? account?.client : undefined;
        if (await authenticate(flow, state) !== "REDIRECT" || !flow.url) throw Error("No authorization URL");
        return { url: flow.url, expiresAt: flow.expires, ...(flow.route ? { attempt: state, route: flow.route.kind } : {}) };
      } catch { if (!flows.has(state)) void flow.route?.close?.().catch(() => {}); finish(state, "failed"); throw Error("Composio sign-in could not start. Try again or ask the OpenAg operator to check sign-in service availability."); }
    },
    async attempt(state: string, actor: string, authorize: (actor: string) => boolean) {
      const attempt = attempts.get(state);
      if (!attempt || attempt.actor !== actor || !authorize(actor)) throw Error("Sign-in attempt unavailable");
      if (attempt.status === "pending" && attempt.expiresAt <= now()) finish(state, "cancelled");
      const flow = flows.get(state);
      if (flow?.route?.receive && !flow.exchanging && !flow.reading) {
        flow.reading = true;
        try {
          const callback = await flow.route.receive();
          if (callback) await finishCallback(callback, authorize);
        } catch (err) {
          if (err instanceof SignInUnavailable) return { status: "pending", expiresAt: attempt.expiresAt, retryAfterMs: 2000 };
          finish(state, "failed");
        } finally { flow.reading = false; }
      }
      return { status: attempt.status, expiresAt: attempt.expiresAt };
    },
    cancel(state: string, actor: string) { const attempt = attempts.get(state); if (!attempt || attempt.actor !== actor) throw Error("Sign-in attempt unavailable"); if (attempt.status === "pending") finish(state, "cancelled"); return { status: attempt.status }; },
    isManagedState(state: string) { return !!flows.get(state)?.route; },
    complete(input: unknown, actor: string, authorize: (actor: string) => boolean) { return complete(input, actor, authorize); },
    callback: finishCallback,
    hasPendingState(state: string) {
      const flow = flows.get(state);
      return !!flow && !!(flow.returnTo || flow.route) && !flow.exchanging && !flow.cancelled && flow.expires > now() && flow.generation === generation;
    },
    invalidateFlows() { for (const state of flows.keys()) finish(state, "cancelled"); },
    async connect() {
      if (!enabled()) throw Error("Composio sign-in required");
      const revision = generation, signal = controller.signal;
      // No transport authProvider: a 401 must never cause an external tool call to be replayed.
      let connection: Awaited<ReturnType<typeof connectMcpHttp>>;
      try { connection = await connectMcpHttp(new URL(SERVER), { fetchForClient: client => async (url, init) => {
        valid(revision);
        const token = await access(); valid(revision);
        const headers = new Headers(init?.headers); headers.set("Authorization", `Bearer ${token}`);
        const response = await request(url, { ...init, headers }, signal, 2 * 1024 * 1024, mcpRequestSignal(client, init));
        if (response.status === 401 || response.status === 403) { await response.body?.cancel(); if (revision === generation) needsAccess(); throw Error("Composio sign-in required; the operation was not retried"); }
        return response;
      } }); }
      catch { throw Error("Composio MCP connection failed. Check connection status."); }
      try { valid(revision); } catch (error) { await connection.close(); throw error; }
      clients.add(connection);
      return { client: connection.client, close: async () => { clients.delete(connection); await connection.close(); } };
    },
    async disconnect() {
      if (!configured()) throw Error("Composio setup is incomplete");
      if (disconnecting) throw Error("Composio disconnect is already in progress");
      disconnecting = true;
      try {
        save(null); changed();
        await Promise.allSettled([...clients].map(client => client.close())); clients.clear();
        opts.audit?.("composio_disconnected"); await notify();
        // Provider metadata does not advertise revocation. Never claim local disconnect revoked the grant.
        return { disconnected: true, revoked: false };
      } finally { disconnecting = false; }
    },
    revokeDevice(actor: string) { for (const [state, flow] of flows) if (flow.actor === actor) finish(state, "cancelled"); },
    async close() { closed = true; changed(); await Promise.allSettled([...clients].map(client => client.close())); clients.clear(); },
  };
}
export type ComposioConnect = ReturnType<typeof createComposioConnect>;
