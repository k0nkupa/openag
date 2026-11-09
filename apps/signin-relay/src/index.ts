type Callback = { state: string; code?: string; error?: string; iss?: string };
type Envelope = { key: string; iv: string; ciphertext: string };
type Session = { state: string; publicKey: string; readHash: string; expires: number; sealed?: Envelope; closed?: boolean };
const statePattern = /^[A-Za-z0-9_-]{43}$/;
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
const refused = () => json({ error: "Sign-in unavailable or expired" }, 404);
async function boundedBody(request: Request): Promise<string> {
  if (!request.body) throw Error();
  const reader = request.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1024) throw Error(); chunks.push(value); } }
  finally { await reader.cancel(); }
  return new TextDecoder().decode(Uint8Array.from(chunks.flatMap(chunk => [...chunk])));
}
async function hash(secret: string) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)))].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
const encode = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const aad = (state: string) => new TextEncoder().encode("openag-signin-v1:" + state);
const publicKey = (value: string) => crypto.subtle.importKey("raw", decode(value), { name: "ECDH", namedCurve: "P-256" }, false, []);
async function seal(callback: Callback, recipient: string): Promise<Envelope> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  if (!("privateKey" in pair)) throw Error("Invalid callback key");
  // Generated Workers types spell this field $public; the Web Crypto runtime uses public.
  const derivation = { name: "ECDH", public: await publicKey(recipient) };
  const shared = await crypto.subtle.deriveBits(derivation, pair.privateKey, 256);
  const material = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: aad(callback.state), info: aad(callback.state) }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(callback.state) }, key, new TextEncoder().encode(JSON.stringify(callback)));
  const ephemeral = await crypto.subtle.exportKey("raw", pair.publicKey);
  if (!(ephemeral instanceof ArrayBuffer)) throw Error("Invalid callback key");
  return { key: encode(ephemeral), iv: encode(iv), ciphertext: encode(ciphertext) };
}
function receivedPage() {
  const nonce = crypto.randomUUID();
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Return to OpenAg</title><script nonce="${nonce}">history.replaceState(null,'','/done');window.close();</script><h1>Return to OpenAg</h1><p>Your sign-in response was received. OpenAg will check the connection. You can close this tab.</p></html>`, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.url.length > 8192) return refused();
      if (url.pathname === "/health" && request.method === "GET") return json({ ok: true });
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (!(await env.REQUEST_LIMIT.limit({ key: ip })).success || !(await env.REQUEST_TOTAL_LIMIT.limit({ key: "requests" })).success) return json({ error: "Try sign-in again later" }, 429);
      if (url.pathname === "/sessions" && request.method === "POST") {
        if (!(await env.CREATE_LIMIT.limit({ key: ip })).success || !(await env.TOTAL_LIMIT.limit({ key: "create" })).success) return json({ error: "Try sign-in again later" }, 429);
        const body = JSON.parse(await boundedBody(request));
        if (!body || Object.keys(body).sort().join(",") !== "publicKey,readHash,state" || !statePattern.test(body.state) || !/^[a-f0-9]{64}$/.test(body.readHash) || !/^[A-Za-z0-9_-]{87}$/.test(body.publicKey)) return refused();
        await publicKey(body.publicKey);
        return await env.SESSIONS.get(env.SESSIONS.idFromName(body.state)).fetch(new Request("https://session/create", { method: "POST", body: JSON.stringify(body) }));
      }
      if (url.pathname === "/composio-connect" && request.method === "GET") {
        const callback: Record<string, string> = {};
        for (const key of ["state", "code", "error", "iss"]) { const values = url.searchParams.getAll(key); if (values.length > 1) return refused(); if (values.length) callback[key] = values[0]!; }
        if (!statePattern.test(callback.state ?? "") || (!!callback.code === !!callback.error) || (callback.code?.length ?? 0) > 4096 || (callback.error?.length ?? 0) > 256 || callback.iss && callback.iss !== "https://connect.composio.dev") return refused();
        const result = await env.SESSIONS.get(env.SESSIONS.idFromName(callback.state!)).fetch(new Request("https://session/callback", { method: "POST", body: JSON.stringify(callback) }));
        return result.ok ? receivedPage() : refused();
      }
      const match = /^\/sessions\/([A-Za-z0-9_-]{43})$/.exec(url.pathname);
      if (match && (request.method === "GET" || request.method === "DELETE")) {
        const bearer = request.headers.get("Authorization") ?? "";
        if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(bearer)) return refused();
        return await env.SESSIONS.get(env.SESSIONS.idFromName(match[1]!)).fetch(new Request("https://session/result", { method: request.method, headers: { Authorization: bearer } }));
      }
      return refused();
    } catch { return refused(); }
  },
} satisfies ExportedHandler<Env>;

export class RelaySession {
  constructor(private state: DurableObjectState) {}
  async fetch(request: Request): Promise<Response> {
    return this.state.blockConcurrencyWhile(async () => {
      const url = new URL(request.url), saved = await this.state.storage.get<Session>("session");
      if (url.pathname === "/create") {
        if (saved) return refused();
        const { readHash, state, publicKey } = await request.json() as { readHash: string; state: string; publicKey: string };
        const expires = Date.now() + 5 * 60000;
        await this.state.storage.put("session", { readHash, state, publicKey, expires }); await this.state.storage.setAlarm(expires);
        return json({ expiresAt: expires }, 201);
      }
      if (!saved || saved.closed || saved.expires <= Date.now()) return refused();
      if (url.pathname === "/callback") {
        if (saved.sealed) return refused();
        saved.sealed = await seal(await request.json() as Callback, saved.publicKey);
        await this.state.storage.put("session", saved);
        return json({ received: true });
      }
      const token = (request.headers.get("Authorization") ?? "").slice(7);
      if (await hash(token) !== saved.readHash) return refused();
      if (request.method === "DELETE") {
        // Keep a tombstone until expiry so an old state cannot be registered again.
        await this.state.storage.put("session", { ...saved, closed: true, sealed: undefined });
        return json({ closed: true });
      }
      return json(saved.sealed ? { status: "received", sealed: saved.sealed } : { status: "pending" });
    });
  }
  async alarm() { await this.state.storage.deleteAll(); }
}
