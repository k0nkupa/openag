import { Card, CardContent } from "./ui/card";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, ContactRound, Globe, Link2, ListTodo, Mail, MessageCircle, NotebookPen, Pause, Play, RefreshCw, Unplug, type LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Skeleton } from "./ui/skeleton";
import { ApiError, messageOf, type Api } from "../api";
import type { ConnectorStatus } from "../types";
import { useAppLibrary } from "../app-library";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Disclosure } from "./Disclosure";
import { Button } from "./ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from "./ui/alert-dialog";
import { Badge } from "./ui/badge";

const names: Record<string, string> = { mail: "Mail", calendar: "Calendar", contacts: "Contacts", reminders: "Reminders", notes: "Notes", messages: "Messages", safari: "Safari" };

const icons: Record<string, LucideIcon> = { mail: Mail, calendar: CalendarDays, contacts: ContactRound, reminders: ListTodo, notes: NotebookPen, messages: MessageCircle, safari: Globe };

export function ConnectorAccess({ api, id }: { api: Api; id: string }) {
  const accountSection = useRef<HTMLElement>(null);
  const keepConnection = useRef<HTMLButtonElement>(null);
  const disconnectTrigger = useRef<HTMLButtonElement>(null);
  const { data: inventory, error: inventoryError, refresh } = useAppLibrary();
  const [data, setData] = useState<ConnectorStatus | null>(null), [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<{message: string; requiresFull: boolean} | null>(null);
  function recordReadError(err: unknown) { setReadError({message: messageOf(err), requiresFull: err instanceof ApiError && err.status === 403}); }
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<string | null>(null), [confirm, setConfirm] = useState(false);
  useEffect(() => { let active = true; void api.getConnectors().then(r => { if (active) { setData(r); setReadError(null); } }, err => { if (active) recordReadError(err); }); return () => { active = false; }; }, [api, id, inventory]);
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError(null); setNotice(null);
    try { await action(); setNotice(success); }
    catch (err) { setError(messageOf(err)); }
    finally {
      try { setData(await api.getConnectors()); setReadError(null); if (!await refresh()) throw Error("Current integration status could not be read. Refresh status before taking another action."); } catch (err) { setNotice(null); recordReadError(err); }
      setBusy(false);
    }
  }
  const service = data?.google?.services.find(s => s.id === id);
  return <section ref={accountSection} tabIndex={-1} className="flex min-w-0 flex-col gap-4" aria-label="Account and app access">
    {readError && !inventoryError && <Alert variant="destructive"><AlertTitle>{readError.requiresFull ? "Full access required" : "Current account status unavailable"}</AlertTitle><AlertDescription><p>{readError.requiresFull ? "Manage this connection from a Full access device." : data ? "Showing the last account snapshot. Refresh status before taking another action." : "Account details could not be read. Refresh status to try again."}</p>{!readError.requiresFull && <Button variant="outline" onClick={() => void refresh()}>Refresh status</Button>}<Disclosure title="Account diagnostics"><p className="whitespace-pre-wrap break-words">{readError.message}</p></Disclosure></AlertDescription></Alert>}
    {error && <Alert variant="destructive"><AlertTitle>Access needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && !busy && !readError && !inventoryError && <p className="library-meta" role="status">{notice}</p>}
    {id === "apple-apps" ? <>
      <div className="flex flex-col gap-1"><h3>macOS permissions</h3><p className="library-meta">Choose an app to manage permission and check read access.</p></div>
      {!data && !error && !readError && <div className="flex flex-col gap-3" role="status" aria-label="Loading app permissions">{[0, 1, 2].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>}
      <Card className="gap-0 py-0 "><CardContent className="px-0">
        {data?.apple?.apps.map(app => {
          const Icon = icons[app.app] ?? Globe;
          return <Collapsible key={app.app} className="apple-access-row">
            <CollapsibleTrigger render={<Button variant="ghost" />} className="h-auto min-h-11 w-full justify-start whitespace-normal text-left" aria-label={`Manage ${names[app.app] ?? app.app} access`}>
              <span className="apple-access-icon"><Icon aria-hidden="true" size={19} /></span>
              <span className="min-w-0 flex-1 text-left">{names[app.app] ?? app.app}</span>
              <Badge variant={app.verifiedAt ? "success" : !app.available ? "attention" : app.permission === "granted" ? "success" : app.permission === "denied" || app.permission === "failed" ? "destructive" : "attention"}>{app.verifiedAt ? "Read verified" : !app.available ? "Needs setup" : app.permission === "granted" ? "Granted" : app.permission === "denied" ? "Not granted" : app.permission === "failed" ? "Check failed" : "Not checked"}</Badge>
              <ChevronDown className="apple-access-chevron" aria-hidden="true" size={16} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="apple-access-actions">
                <p className="library-meta">{app.requirement}</p>
                {app.verifiedAt && <p className="library-meta">Last verified {new Date(app.verifiedAt).toLocaleString()}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" aria-label={`Ask macOS for access to ${names[app.app]}`} disabled={busy || !!readError || !!inventoryError || !app.available} onClick={() => void run(() => api.appleConnector("permission", app.app), "macOS permission checked. Read access is checked separately.")}>Request permission</Button>
                  <Button variant="secondary" size="sm" aria-label={`Check ${names[app.app]} read access`} disabled={busy || !!readError || !!inventoryError || !app.available || !data.apple?.connected} onClick={() => void run(() => api.appleConnector("verify", app.app), "Read access checked. This does not enable write tools.")}><Check aria-hidden="true" data-icon="inline-start" />Check read access</Button>
                </div>
                {!data.apple?.connected && <p className="library-meta">Read checks need a connected runtime. Review the runtime details in Overview and Setup.</p>}
              </div>
            </CollapsibleContent>
          </Collapsible>;
        })}
      </CardContent></Card>
      <p className="library-meta">Permission requests may open an app or a macOS prompt on the OpenAg machine. Read checks use a small sample; its contents are not displayed here.</p>
      <p className="library-meta">To pause access, use the disable command in Setup. Messages history also needs Full Disk Access for the launching service.</p>
    </> : <>
      {data && <p className="library-meta break-words">{data.google?.account ? `Google account: ${data.google.account.email}` : "No Google account connected."}</p>}
      {data && !data.google?.configured && <p className="library-meta">Ask the machine administrator to configure Google sign-in and its return URL. Credentials are configured on the daemon, outside the browser.</p>}

      {service?.verifiedAt && <p className="library-meta">Read access last verified {new Date(service.verifiedAt).toLocaleString()}. This checks the account, not every item.</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || !!readError || !!inventoryError || !data?.google?.configured} onClick={() => void run(async () => {
          const who = await api.whoami();
          if (who.kind !== "device" || who.access !== "full") throw Error("Connect Google from a Full access device. Temporary Owner actions access ends when this page navigates to Google.");
          const result = await api.googleConnector("start", { service: id });
          if (typeof result.url !== "string") throw Error("The Google sign-in link is unavailable");
          const url = new URL(result.url); if (url.protocol !== "https:" || url.hostname !== "accounts.google.com") throw Error("The Google sign-in link is invalid");
          try { window.sessionStorage.setItem("openag-google-return-service", id); } catch { /* The callback can fall back to Gmail when session storage is unavailable. */ }
          window.location.assign(url.href);
        }, "Opening Google sign-in…")}>{data?.google?.account ? <RefreshCw data-icon="inline-start" /> : <Link2 data-icon="inline-start" />}{service?.state === "needs_access" && data?.google?.account ? "Grant read access" : data?.google?.account ? "Reconnect" : "Connect"}</Button>
        {service?.enabled && <Button variant="outline" disabled={busy || !!readError || !!inventoryError || service.state !== "connected"} onClick={() => void run(() => api.googleConnector("verify", { service: id }), "Account read access checked.")}><Check aria-hidden="true" data-icon="inline-start" />Check read access</Button>}
        {data?.google?.account && <Button variant="outline" disabled={busy || !!readError || !!inventoryError || service?.state === "needs_access"} onClick={() => void run(() => api.googleConnector("pause", { service: id, enabled: !service?.enabled }), service?.enabled ? "This service is paused." : "This service is enabled.")}>{service?.enabled ? <Pause aria-hidden="true" data-icon="inline-start" /> : <Play aria-hidden="true" data-icon="inline-start" />}{service?.enabled ? "Pause this service" : "Resume this service"}</Button>}
        {data?.google?.account && <Button ref={disconnectTrigger} variant="destructive-outline" disabled={busy || !!readError || !!inventoryError} onClick={() => setConfirm(true)}><Unplug data-icon="inline-start" />Disconnect</Button>}
      </div>
      <AlertDialog open={confirm} onOpenChangeComplete={open => { if (!open && document.activeElement === document.body) (document.querySelector<HTMLElement>('[role="dialog"] [role="tab"][aria-selected="true"]') ?? accountSection.current)?.focus(); }} onOpenChange={open => { if (!busy) setConfirm(open); }}>
        <AlertDialogContent initialFocus={keepConnection} finalFocus={() => !busy && disconnectTrigger.current?.isConnected ? disconnectTrigger.current : document.querySelector<HTMLElement>('[role="dialog"] [role="tab"][aria-selected="true"]') ?? accountSection.current} onOutsidePress={() => { if (!busy) setConfirm(false); }}>
          <AlertDialogHeader><AlertDialogTitle>Disconnect Gmail and Drive?</AlertDialogTitle><AlertDialogDescription>Both services will lose access on this machine. To stop only {id === "drive" ? "Drive" : "Gmail"}, keep this connection and pause that service.</AlertDialogDescription></AlertDialogHeader>
          {(error || readError || inventoryError) && <Alert variant="destructive"><AlertDescription>{error ?? "Current status is unavailable. Keep the connection, then refresh status."}</AlertDescription></Alert>}
          <AlertDialogFooter><AlertDialogCancel ref={keepConnection} disabled={busy}>Keep connection</AlertDialogCancel><Button variant="destructive" disabled={busy || !!readError || !!inventoryError} onClick={() => void run(async () => { const result = await api.googleConnector("disconnect", {}); setConfirm(false); if (!result.revoked) throw Error("Local access was removed. Google revocation could not be confirmed; review the grant in your Google account."); }, "Google account disconnected.")}>{busy ? "Disconnecting…" : "Disconnect both services"}</Button></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>}
  </section>;
}
