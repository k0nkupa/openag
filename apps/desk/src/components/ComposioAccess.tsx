import { useEffect, useRef, useState } from "react";
import { Link2, RefreshCw, Unplug } from "lucide-react";
import { ApiError, messageOf, type Api } from "../api";
import type { ComposioStatus } from "../types";
import { useAppLibrary } from "../app-library";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { hrefFor } from "../route";
import { Disclosure } from "./Disclosure";
import { Button } from "./ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "./ui/alert-dialog";

export function ComposioAccess({ api }: { api: Api }) {
  const accountSection = useRef<HTMLElement>(null);
  const keepConnection = useRef<HTMLButtonElement>(null);
  const disconnectTrigger = useRef<HTMLButtonElement>(null);
  const { data: inventory, error: inventoryError, refresh } = useAppLibrary();
  const [status, setStatus] = useState<ComposioStatus | null>(null), [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const pending = useRef<{ attempt?: string; popup: Window; controller: AbortController } | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false), [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { let active = true; void api.getComposio().then(value => { if (active) { setStatus(value); setReadError(null); } }, err => { if (active) setReadError(messageOf(err)); }); return () => { active = false; }; }, [api, inventory]);
  useEffect(() => () => {
    const flow = pending.current;
    if (flow) { flow.controller.abort(); flow.popup.close(); if (flow.attempt) void api.composioConnector("cancel", { attempt: flow.attempt }, AbortSignal.timeout(5000)).catch(() => {}); }
  }, [api]);
  function connect() {
    const popup = window.open("about:blank", "_blank");
    if (!popup) { setError("Allow sign-in pop-ups, then connect Composio again."); return; }
    popup.opener = null;
    const flow = { popup, controller: new AbortController(), attempt: undefined as string | undefined };
    pending.current = flow; setSigningIn(true);
    void run(async () => {
      try {
        const preparing = AbortSignal.any([flow.controller.signal, AbortSignal.timeout(30000)]);
        const who = await api.whoami(preparing);
        if (who.kind !== "device" || who.access !== "full") throw Error("Connect Composio from a Full access device.");
        const result = await api.composioConnector("start", { origin: window.location.origin }, preparing);
        if (typeof result.url !== "string") throw Error("The Composio sign-in link is unavailable");
        const url = new URL(result.url);
        if (url.origin !== "https://connect.composio.dev" || url.pathname !== "/oauth/authorize" || url.username || url.password) throw Error("The Composio sign-in link is invalid");
        if (typeof result.attempt !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(result.attempt) || typeof result.expiresAt !== "number") throw Error("Update the OpenAg daemon to use one-click sign-in.");
        flow.attempt = result.attempt;
        if (flow.controller.signal.aborted) { await api.composioConnector("cancel", { attempt: flow.attempt }, AbortSignal.timeout(5000)); return; }
        popup.location.replace(url.href);
        const deadline = Math.min(result.expiresAt, Date.now() + 5 * 60000);
        while (!flow.controller.signal.aborted && Date.now() < deadline) {
          let state: Record<string, unknown>;
          try { state = await api.composioConnector("status", { attempt: flow.attempt }, AbortSignal.any([flow.controller.signal, AbortSignal.timeout(Math.max(1, Math.min(10000, deadline - Date.now())))])); }
          catch (err) { if (flow.controller.signal.aborted) return; if (!(err instanceof TypeError) && !(err instanceof ApiError && (err.status === 0 || err.status === 429 || err.status >= 500))) throw err; state = { status: "pending", retryAfterMs: 2000 }; }
          if (state.status === "connected") { setNotice("Composio connected."); return; }
          if (state.status !== "pending") { setNotice(state.status === "cancelled" ? "Composio sign-in was cancelled. Your existing connection is unchanged." : "Composio sign-in was not completed. Check connection status before trying again."); return; }
          await new Promise<void>(resolve => { const timer = setTimeout(done, Math.max(0, Math.min(deadline - Date.now(), typeof state.retryAfterMs === "number" ? Math.max(1000, Math.min(state.retryAfterMs, 10000)) : 1000))); function done() { clearTimeout(timer); flow.controller.signal.removeEventListener("abort", done); resolve(); } flow.controller.signal.addEventListener("abort", done, { once: true }); });
        }
        if (!flow.controller.signal.aborted) throw Error("Composio sign-in expired. Connect again to retry.");
      } catch (err) { if (!flow.controller.signal.aborted) throw err; }
      finally {
        if (flow.attempt) void api.composioConnector("cancel", { attempt: flow.attempt }, AbortSignal.timeout(5000)).catch(() => {});
        popup.close(); if (pending.current === flow) pending.current = null; setSigningIn(false);
      }
    });
  }
  async function cancel() {
    const flow = pending.current; if (!flow) return;
    flow.controller.abort(); flow.popup.close();
    try {
      const result = flow.attempt ? await api.composioConnector("cancel", { attempt: flow.attempt }, AbortSignal.timeout(5000)) : null;
      setNotice(result?.status === "connected" ? "Composio connected." : "Composio sign-in cancelled. Your existing connection is unchanged.");
    } catch (err) { setError(messageOf(err)); }
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null); setNotice(null);
    try { await action(); }
    catch (err) { setError(messageOf(err)); }
    finally { try { setStatus(await api.getComposio(AbortSignal.timeout(5000))); setReadError(null); if (!await refresh()) throw Error("Current integration status could not be read. Refresh status before taking another action."); } catch (err) { setNotice(null); setReadError(messageOf(err)); } setBusy(false); }
  }
  return <section ref={accountSection} tabIndex={-1} className="flex min-w-0 flex-col gap-4" aria-label="Composio account access">
    {readError && !inventoryError && <Alert variant="destructive"><AlertTitle>Current account status unavailable</AlertTitle><AlertDescription>{status ? "Showing the last account snapshot. Refresh status before taking another action." : "Account details could not be read. Refresh status to try again."} {!inventoryError && <Button variant="outline" onClick={() => void refresh()}>Refresh status</Button>}<Disclosure title="Account diagnostics"><p className="whitespace-pre-wrap break-words">{readError ?? inventoryError}</p></Disclosure></AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertTitle>Access needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && !busy && !readError && !inventoryError && <p role="status" className="library-meta">{notice}</p>}
    {(busy || !status) && <p role="status" className="library-meta">{busy ? "Updating connection…" : "Checking connection…"}</p>}
    {status?.hasAccount && <p className="library-meta">Account access saved</p>}
    {status && !status.configured && <p className="library-meta">{status.reason ?? "Check sign-in setup on the OpenAg computer."}</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy || !!readError || !!inventoryError || !status?.configured} onClick={connect}>{status?.hasAccount ? <RefreshCw data-icon="inline-start" /> : <Link2 data-icon="inline-start" />}{status?.hasAccount ? "Reconnect" : "Connect"}</Button>
      {signingIn && <Button variant="outline" onClick={() => void cancel()}>Cancel sign-in</Button>}
      {status?.hasAccount && <Button ref={disconnectTrigger} variant="destructive-outline" disabled={busy || !!readError || !!inventoryError} onClick={() => setConfirm(true)}><Unplug data-icon="inline-start" />Disconnect</Button>}
    </div>
    <AlertDialog open={confirm} onOpenChangeComplete={open => { if (!open && document.activeElement === document.body) (document.querySelector<HTMLElement>('[role="dialog"] [role="tab"][aria-selected="true"]') ?? accountSection.current)?.focus(); }} onOpenChange={open => { if (!busy) setConfirm(open); }}>
      <AlertDialogContent initialFocus={keepConnection} finalFocus={() => !busy && disconnectTrigger.current?.isConnected ? disconnectTrigger.current : document.querySelector<HTMLElement>('[role="dialog"] [role="tab"][aria-selected="true"]') ?? accountSection.current} onOutsidePress={() => { if (!busy) setConfirm(false); }}>
        <AlertDialogHeader><AlertDialogTitle>Disconnect Composio?</AlertDialogTitle><AlertDialogDescription>This removes OpenAg’s local access. Your service connections at Composio remain. Revoke the provider grant in your Composio account if needed.</AlertDialogDescription></AlertDialogHeader>
        {(error || readError || inventoryError) && <Alert variant="destructive"><AlertDescription>{error ?? "Current status is unavailable. Keep the connection, then refresh status."}</AlertDescription></Alert>}
        <AlertDialogFooter><AlertDialogCancel ref={keepConnection} disabled={busy}>Keep connection</AlertDialogCancel><Button variant="destructive" disabled={busy || !!readError || !!inventoryError} onClick={() => void run(async () => { await api.composioConnector("disconnect", {}); setConfirm(false); if (window.location.hash === hrefFor({kind: "connectors", integrationId: "connector:composio"})) window.location.hash = hrefFor({kind: "app-library", integrationId: "connector:composio"}); setNotice("OpenAg’s Composio access was removed. Provider revocation was not confirmed."); })}>{busy ? "Disconnecting…" : "Disconnect"}</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
