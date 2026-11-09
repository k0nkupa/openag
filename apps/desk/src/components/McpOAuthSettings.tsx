import { useEffect, useRef, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { ApiError, messageOf, type Api } from "../api";
import type { McpOAuthStatus } from "../types";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Sign-in for one custom server that uses OAuth. The owner approves in a browser tab the daemon points at the provider; the daemon
 * receives the result through its managed callback route and this panel only polls the attempt. No token or code ever reaches the page.
 */
export function McpOAuthSettings({ api, serverId, locked, onChanged }: { api: Api; serverId: string; locked: boolean; onChanged: () => Promise<void> | void }) {
  const [status, setStatus] = useState<McpOAuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const flow = useRef<{ attempt?: string; popup: Window | null; controller: AbortController } | null>(null);
  const gone = useRef(false);
  const load = async () => { try { const next = await api.getMcpOAuth(serverId); if (!gone.current) setStatus(next); } catch (err) { if (!gone.current) setError(messageOf(err)); } };
  useEffect(() => { void load(); }, [serverId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      const current = flow.current;
      if (current) { current.controller.abort(); current.popup?.close(); if (current.attempt) void api.mcpOAuth(serverId, "cancel", { attempt: current.attempt }).catch(() => undefined); }
    };
  }, [api, serverId]);

  async function signIn() {
    setError(null); setNotice(null);
    // Opened first, inside the click, so the browser allows it; the address is set once the daemon has prepared the sign-in.
    const popup = window.open("about:blank", "_blank");
    if (!popup) { setError("Allow sign-in pop-ups, then try again."); return; }
    popup.opener = null;
    const current = { popup, controller: new AbortController(), attempt: undefined as string | undefined };
    flow.current = current; setSigningIn(true);
    try {
      const started = await api.mcpOAuth(serverId, "start", { origin: window.location.origin }, AbortSignal.any([current.controller.signal, AbortSignal.timeout(30000)]));
      const attempt = started.attempt, url = started.url, expiresAt = started.expiresAt;
      if (typeof url !== "string" || typeof attempt !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(attempt) || typeof expiresAt !== "number") throw new Error("The sign-in link is unavailable");
      const target = new URL(url);
      if (!/^https?:$/.test(target.protocol) || target.username || target.password) throw new Error("The sign-in link is invalid");
      current.attempt = attempt;
      if (current.controller.signal.aborted) { await api.mcpOAuth(serverId, "cancel", { attempt }); return; }
      popup.location.replace(target.href);
      const deadline = Math.min(expiresAt, Date.now() + 5 * 60000);
      while (!current.controller.signal.aborted && Date.now() < deadline) {
        let state: Record<string, unknown>;
        try { state = await api.mcpOAuth(serverId, "status", { attempt }, AbortSignal.any([current.controller.signal, AbortSignal.timeout(10000)])); }
        catch (err) { if (current.controller.signal.aborted) return; if (!(err instanceof TypeError) && !(err instanceof ApiError && (err.status === 0 || err.status === 429 || err.status >= 500))) throw err; state = { status: "pending" }; }
        if (state.status === "connected") { setNotice("Signed in."); await load(); await onChanged(); return; }
        if (state.status !== "pending") { setNotice(state.status === "cancelled" ? "Sign-in was cancelled." : "Sign-in was not completed. Try again."); return; }
        await sleep(typeof state.retryAfterMs === "number" ? Math.max(500, Math.min(state.retryAfterMs, 10000)) : 1000);
      }
      if (!current.controller.signal.aborted) throw new Error("Sign-in expired. Try again.");
    } catch (err) { if (!current.controller.signal.aborted) setError(messageOf(err)); }
    finally {
      if (current.attempt) void api.mcpOAuth(serverId, "cancel", { attempt: current.attempt }).catch(() => undefined);
      popup.close(); if (flow.current === current) flow.current = null; if (!gone.current) setSigningIn(false);
    }
  }
  async function cancel() {
    const current = flow.current; if (!current) return;
    current.controller.abort(); current.popup?.close();
    try { if (current.attempt) await api.mcpOAuth(serverId, "cancel", { attempt: current.attempt }); setNotice("Sign-in was cancelled."); } catch (err) { setError(messageOf(err)); }
  }
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(null); setNotice(null);
    try { await action(); setNotice(success); await load(); await onChanged(); } catch (err) { setError(messageOf(err)); } finally { setBusy(false); }
  }

  return <section className="flex min-w-0 flex-col gap-3" aria-label="OAuth sign-in">
    <div className="flex flex-wrap items-center gap-2"><h3>Sign-in</h3>{status && <Badge variant={status.state === "signed_in" ? "success" : "attention"}>{status.state === "signed_in" ? "Signed in" : "Needs sign-in"}</Badge>}</div>
    {error && <Alert variant="destructive"><AlertTitle>Sign-in problem</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    <p className="library-meta" role="status">{notice ?? ""}</p>
    {status?.needsScope && <p className="library-meta">The server asked for more access ({status.needsScope}). Sign in again to grant it.</p>}
    <div className="flex flex-wrap gap-2">
      {signingIn
        ? <Button type="button" variant="outline" onClick={() => void cancel()}>Cancel sign-in</Button>
        : <Button type="button" disabled={locked || busy} onClick={() => void signIn()}><LogIn data-icon="inline-start" />{status?.state === "signed_in" ? "Sign in again" : "Sign in"}</Button>}
      {status?.state === "signed_in" && !signingIn && <Button type="button" variant="outline" disabled={locked || busy} onClick={() => void run(() => api.mcpOAuth(serverId, "disconnect", {}), "Disconnected from this device. The provider was not asked to revoke access.")}><LogOut data-icon="inline-start" />Disconnect</Button>}
    </div>
    <div className="flex flex-col gap-2">
      <h4>Registered client</h4>
      <FieldGroup>
        <Field><FieldLabel htmlFor={`mcp-oauth-client-${serverId}`}>Client ID</FieldLabel>
          <Input id={`mcp-oauth-client-${serverId}`} value={clientId} placeholder={status?.hasOwnerClient ? "Saved" : "Optional"} autoComplete="off" onChange={event => setClientId(event.target.value)} />
          <FieldDescription>Only if the provider gave you one. Otherwise OpenAg registers itself when the provider allows it.</FieldDescription></Field>
        <Field><FieldLabel htmlFor={`mcp-oauth-secret-${serverId}`}>Client secret</FieldLabel>
          <Input id={`mcp-oauth-secret-${serverId}`} type="password" autoComplete="new-password" value={clientSecret} placeholder={status?.hasOwnerClient ? "Leave blank to keep" : "Optional"} onChange={event => setClientSecret(event.target.value)} /></Field>
      </FieldGroup>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={locked || busy || !clientId.trim()} onClick={() => void run(async () => { await api.setMcpOAuthClient(serverId, clientId.trim(), clientSecret || undefined); setClientId(""); setClientSecret(""); }, "Client saved. Sign in again to use it.")}>Save client</Button>
        {status?.hasOwnerClient && <Button type="button" variant="outline" size="sm" disabled={locked || busy} onClick={() => void run(() => api.removeMcpOAuthClient(serverId), "Client removed.")}>Remove client</Button>}
      </div>
    </div>
  </section>;
}
