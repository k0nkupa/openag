import { randomBytes, createHash, createECDH, createDecipheriv, hkdfSync } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDefaultRedactor } from "./redact.js";
import { connectorCallback } from "./callback-address.js";

export type SignInCallback = { state: string; code?: string; error?: string; iss?: string };
export type SignInRoute = { kind: "hosted" | "tailscale" | "direct"; callback: string; receive?: () => Promise<SignInCallback | null>; close?: () => Promise<void> };
const runFile = promisify(execFile);
export class SignInUnavailable extends Error {}
class InvalidRelayResponse extends Error {}
type Run = (args: string[]) => Promise<string>;

/** Outbound-only mailbox; the read credential never travels through the browser. */
export function hostedSignInRoute(opts: { base?: string; fetch?: typeof fetch } = {}) {
  if (!opts.base) throw new SignInUnavailable("Hosted sign-in is not configured");
  const base = new URL(opts.base);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw Error("Invalid hosted sign-in configuration");
  const fetcher = opts.fetch ?? fetch;
  async function request(path: string, init: RequestInit) {
    try {
      const response = await fetcher(new URL(path, base), { ...init, redirect: "error", signal: AbortSignal.timeout(8000) });
      if (!response.ok) { await response.body?.cancel(); if (response.status === 429 || response.status >= 500) throw new SignInUnavailable(); throw new InvalidRelayResponse(); }
      const reader = response.body?.getReader(); let size = 0, text = ""; const decoder = new TextDecoder();
      if (reader) try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 8192) throw new InvalidRelayResponse(); text += decoder.decode(value, { stream: true }); } } finally { await reader.cancel(); }
      try { return JSON.parse(text); } catch { throw new InvalidRelayResponse(); }
    } catch (err) { if (err instanceof InvalidRelayResponse) throw Error("Invalid hosted sign-in response"); throw new SignInUnavailable("Hosted sign-in is temporarily unavailable"); }
  }
  return async (state: string): Promise<SignInRoute> => {
    const recipient = createECDH("prime256v1"); recipient.generateKeys();
    const secret = randomBytes(32).toString("base64url"); getDefaultRedactor().addSecret(secret);
    await request("/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, publicKey: recipient.getPublicKey().toString("base64url"), readHash: createHash("sha256").update(secret).digest("hex") }) });
    const headers = { Authorization: "Bearer " + secret };
    return { kind: "hosted", callback: new URL("/composio-connect", base).href,
      receive: async () => {
        const value = await request("/sessions/" + state, { headers }); if (value.status === "pending") return null;
        const sealed = value.sealed;
        if (value.status !== "received" || !sealed || typeof sealed.key !== "string" || !/^[A-Za-z0-9_-]{87}$/.test(sealed.key) || typeof sealed.iv !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(sealed.iv) || typeof sealed.ciphertext !== "string" || !/^[A-Za-z0-9_-]{22,8000}$/.test(sealed.ciphertext)) throw Error("Invalid sign-in response");
        const context = Buffer.from("openag-signin-v1:" + state);
        const key = hkdfSync("sha256", recipient.computeSecret(Buffer.from(sealed.key, "base64url")), context, context, 32);
        const ciphertext = Buffer.from(sealed.ciphertext, "base64url");
        const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(sealed.iv, "base64url"));
        decipher.setAAD(context); decipher.setAuthTag(ciphertext.subarray(-16));
        const callback = JSON.parse(Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString("utf8"));
        if (callback.state !== state) throw Error("Invalid sign-in response"); return callback;
      },
      close: async () => { await request("/sessions/" + state, { method: "DELETE", headers }); },
    };
  };
}

/** Only the Composio callback path is managed; never reset Serve or enable Funnel. */
export function tailscaleSignInRoute(opts: { localOrigin: () => string | undefined; run?: Run }) {
  const run: Run = opts.run ?? (async args => (await runFile("tailscale", args, { timeout: 15000, maxBuffer: 512 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG, TMPDIR: process.env.TMPDIR } })).stdout);
  let preparing: Promise<SignInRoute> | undefined;
  return async (browserOrigin?: string): Promise<SignInRoute> => {
    const local = new URL(opts.localOrigin() ?? "");
    if (local.protocol !== "http:" || local.hostname !== "127.0.0.1" || !local.port) throw Error("Local daemon address is unavailable");
    const status = JSON.parse(await run(["status", "--json"]));
    const name = status.Self?.DNSName?.replace(/\.$/, "");
    if (status.BackendState !== "Running" || typeof name !== "string" || !/^[a-z0-9-]+\.[a-z0-9.-]+\.ts\.net$/.test(name)) throw Error("Tailscale is unavailable");
    if (browserOrigin && ![name, "127.0.0.1", ...(status.Self?.TailscaleIPs ?? [])].includes(new URL(browserOrigin).hostname)) throw Error("This browser needs the hosted sign-in route. Private Tailscale callbacks require the host's tailnet address.");
    return preparing ??= (async () => {
      const address = name + ":443", path = "/composio-connect", target = local.origin + path;
      const before = JSON.parse(await run(["serve", "status", "--json"]));
      const existing = before.Web?.[address]?.Handlers?.[path];
      if (before.AllowFunnel?.[address] || before.TCP?.["443"] && !before.TCP["443"].HTTPS || existing && existing.Proxy !== target) throw Error("Tailscale callback conflicts with an existing route");
      if (!existing) await run(["serve", "--bg", "--yes", "--https=443", "--set-path=" + path, target]);
      const after = JSON.parse(await run(["serve", "status", "--json"]));
      if (after.Web?.[address]?.Handlers?.[path]?.Proxy !== target || after.AllowFunnel?.[address]) throw Error("Tailscale callback could not be verified");
      return { kind: "tailscale" as const, callback: "https://" + name + path };
    })().finally(() => { preparing = undefined; });
  };
}

export function createSignInRoutes(opts: { env?: NodeJS.ProcessEnv; localOrigin: () => string | undefined; callbackOrigin?: () => string | null; fetch?: typeof fetch; run?: Run }) {
  const env = opts.env ?? process.env;
  // Built once so an invalid relay URL fails at startup instead of silently falling back.
  const hostedRoute = env.OPENAG_SIGNIN_RELAY_URL ? hostedSignInRoute({ base: env.OPENAG_SIGNIN_RELAY_URL, fetch: opts.fetch }) : undefined;
  const hosted = (state: string) => hostedRoute!(state);
  const tailscale = tailscaleSignInRoute(opts);
  return async (state: string, browserOrigin?: string): Promise<SignInRoute> => {
    if (env.OPENAG_COMPOSIO_REDIRECT_URI || env.OPENAG_PUBLIC_URL || opts.callbackOrigin?.()) {
      const callback = connectorCallback(env, opts.localOrigin(), opts.callbackOrigin?.());
      if (new URL(callback).protocol === "http:" && browserOrigin !== new URL(callback).origin) throw Error("The operator's loopback callback cannot serve this browser. Use a managed sign-in route.");
      return { kind: "direct", callback };
    }
    if (env.OPENAG_SIGNIN_ROUTE !== undefined && !["auto", "hosted", "tailscale"].includes(env.OPENAG_SIGNIN_ROUTE)) throw Error("Invalid sign-in route configuration");
    if (env.OPENAG_SIGNIN_ROUTE === "tailscale") return tailscale();
    if (env.OPENAG_SIGNIN_ROUTE === "hosted" && !hostedRoute) throw Error("Hosted sign-in is not configured. Set OPENAG_SIGNIN_RELAY_URL.");
    if (hostedRoute) {
      try { return await hosted(state); }
      catch { if (env.OPENAG_SIGNIN_ROUTE === "hosted") throw Error("Hosted sign-in is unavailable. Try again later."); }
    }
    try { return await tailscale(browserOrigin); }
    catch { throw Error("Sign-in is temporarily unavailable. The OpenAg operator needs to check hosted sign-in or Tailscale access."); }
  };
}
