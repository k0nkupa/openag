import { SettingsHeader } from "./SettingsLayout";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ChevronDown, MonitorSmartphone, Plus, ShieldCheck } from "lucide-react";
import QRCode from "qrcode";
import { ApiError, messageOf, type Api, type Device, type DeviceAccess, type PairingCode, type Whoami } from "../api";
import { getOwnerToken, subscribeOwnerToken } from "../ownerSession";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "./ui/dialog";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "./ui/field";
import { SelectField, SelectItem } from "./ui/select";
import { Switch } from "./ui/switch";
import { Skeleton } from "./ui/skeleton";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "./ui/empty";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./ui/collapsible";

export function relativeTime(ts: number | null, now: number): string {
  if (ts === null) return "never";
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Name of the device that created `id`, or the raw id if it is no longer listed. */
function addedBy(devices: Device[], id: string): string {
  return devices.find((d) => d.id === id)?.name ?? id;
}

/** Active devices created (directly or through other devices) by `id`. */
function activeDescendants(devices: Device[], id: string): number {
  const seen = new Set<string>([id]);
  const queue = [id];
  let active = 0;
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const d of devices) {
      if (d.createdBy !== parent || seen.has(d.id)) continue;
      seen.add(d.id);
      queue.push(d.id);
      if (d.revokedAt === null) active++;
    }
  }
  return active;
}

export function DevicesPanel({ api, onSignOut, identity = null, onIdentityChange }: {
  api: Api;
  onSignOut: () => void;
  identity?: Whoami | null;
  onIdentityChange?: (who: Whoami) => void;
}) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const [pairOpen, setPairOpen] = useState(false);
  const [code, setCode] = useState<PairingCode | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [newAccess, setNewAccess] = useState<DeviceAccess>("limited");
  const [managedId, setManagedId] = useState<string | null>(null);
  const [access, setAccess] = useState<DeviceAccess>("limited");
  const [removing, setRemoving] = useState(false);
  const [cascade, setCascade] = useState(true);
  const [busy, setBusy] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const ownerUnlocked = useSyncExternalStore(subscribeOwnerToken, getOwnerToken, getOwnerToken) !== null;
  const canManage = identity?.kind === "owner" || identity?.access === "full" || ownerUnlocked;
  const active = devices?.filter(d => d.revokedAt === null).sort((a, b) => Number(b.current) - Number(a.current)) ?? [];
  const revoked = devices?.filter(d => d.revokedAt !== null) ?? [];
  const managed = devices?.find(d => d.id === managedId);
  const descendants = managed && devices ? activeDescendants(devices, managed.id) : 0;
  const expired = code !== null && code.expiresAt <= now;
  const localOnly = window.location.hostname === "localhost" || window.location.hostname.endsWith(".localhost") || /^127(?:\.\d{1,3}){3}$/.test(window.location.hostname) || ["[::1]", "::1", "0.0.0.0"].includes(window.location.hostname);

  useEffect(() => {
    let cancelled = false;
    api.listDevices().then(r => { if (!cancelled) setDevices(r.devices); }, err => { if (!cancelled) setError(messageOf(err)); });
    return () => { cancelled = true; };
  }, [api]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), pairOpen && code ? 1000 : 60000);
    return () => clearInterval(timer);
  }, [pairOpen, code]);
  const codeText = code?.code;
  useEffect(() => {
    let cancelled = false;
    setQr(null); setCopied(null);
    if (codeText && !localOnly) QRCode.toDataURL(`${window.location.origin}/#/join/${codeText}`, { margin: 2, width: 176 }).then(url => { if (!cancelled) setQr(url); }, () => undefined);
    return () => { cancelled = true; };
  }, [codeText, localOnly]);

  async function reload() {
    setError(null);
    try { setDevices((await api.listDevices()).devices); return true; }
    catch (err) { setError(`Could not refresh devices: ${messageOf(err)}`); return false; }
  }
  async function createCode() {
    if (creating) return;
    setCreating(true); setCodeError(null);
    try { setCode(await api.createPairingCode(newAccess)); setNow(Date.now()); }
    catch (err) { setCodeError(err instanceof ApiError && err.status === 429 ? "Too many active pairing codes. Wait for one to expire or be used, then try again." : `Could not create a code: ${messageOf(err)}`); }
    finally { setCreating(false); }
  }
  async function copyCode() {
    if (!code || code.expiresAt <= Date.now()) return;
    const text = code.code;
    try { await navigator.clipboard.writeText(text); setCopied(text); }
    catch { setCodeError("Could not copy. Select the code and copy it manually."); }
  }
  async function saveAccess() {
    if (!managed || busy) return;
    setBusy(true); setManageError(null); setNotice(null);
    try {
      const result = await api.setDeviceAccess(managed.id, access);
      setDevices(previous => previous?.map(d => d.id === result.id ? { ...d, access: result.access } : d) ?? null);
      if (managed.current && identity?.kind === "device") onIdentityChange?.({ ...identity, access: result.access });
      setManagedId(null); setNotice("Access updated.");
      await reload();
    } catch (err) { setManageError(`Could not change access: ${messageOf(err)}`); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!managed || busy) return;
    setBusy(true); setManageError(null); setNotice(null);
    try {
      await api.revokeDevice(managed.id, { cascade });
      if (managed.current) { onSignOut(); return; }
      setManagedId(null); setNotice("Device access removed.");
      await reload();
    } catch (err) { setManageError(`Could not remove access: ${messageOf(err)}`); }
    finally { setBusy(false); }
  }

  return <div className="flex min-w-0 flex-col gap-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <SettingsHeader id="devices-title" title="Devices" description="Review paired browsers and phones, manage access or connect another device." />
      <Dialog open={pairOpen} onOpenChange={open => { setNow(Date.now()); setPairOpen(open); }}>
        <DialogTrigger render={<Button />}><Plus data-icon="inline-start" />{code && !expired ? "View pairing code" : "Pair device"}</DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto [overflow-wrap:anywhere]">
          <DialogHeader><DialogTitle>Pair a device</DialogTitle><DialogDescription>A one-time code connects another browser to this OpenAg server.</DialogDescription></DialogHeader>
          {code && !expired ? <div className="flex flex-col items-center gap-4 py-2">
            {qr && <img className="size-44 rounded-lg" src={qr} alt="Scan to open this desk with the pairing code filled in" />}
            <div className="font-mono text-3xl font-semibold tracking-wider tabular-nums" aria-label="Pairing code">{code.code}</div>
            <div className="flex items-center gap-2"><Badge variant="outline">{newAccess === "full" ? "Full access" : "Limited access"}</Badge><span className="text-sm tabular-nums text-muted-foreground" role="timer">Expires in {countdown(code.expiresAt - now)}</span></div>
            <p className="m-0 text-center text-sm leading-relaxed text-muted-foreground">On the new device, open this desk and choose Pair with a code. Valid for 5 minutes, one use.</p>
            {localOnly && <Alert><AlertDescription>This address only works on this computer. On your phone, open a reachable LAN or Tailscale desk address and enter the code.</AlertDescription></Alert>}
            <Button autoFocus variant="outline" onClick={() => void copyCode()}>{copied === code.code ? "Copied" : "Copy code"}</Button>
          </div> : <FieldGroup>
            {expired && <Alert><AlertDescription>This code has expired. Create a new code to continue.</AlertDescription></Alert>}
            <Field><FieldLabel htmlFor="new-access">Access for the new device</FieldLabel>
              <SelectField id="new-access" className="w-full" value={newAccess} onValueChange={(value) => setNewAccess(value as DeviceAccess)} disabled={creating}>
                <SelectItem value="limited">Limited access</SelectItem>
                <SelectItem value="full" disabled={!canManage}>Full access</SelectItem>
              </SelectField>
              <FieldDescription>{newAccess === "full" ? "Can change settings, bots, integrations and device access. Only share with someone you trust." : "Can chat, review approvals and watch activity. Recommended for phones."}</FieldDescription>
            </Field>
            {!canManage && <p className="m-0 text-sm text-muted-foreground">Only a Full access device can grant Full access.</p>}
          </FieldGroup>}
          {codeError && <Alert variant="destructive"><AlertDescription>{codeError}</AlertDescription></Alert>}
          {(!code || expired) && <DialogFooter><Button autoFocus={expired} onClick={() => void createCode()} disabled={creating || (newAccess === "full" && !canManage)}>{creating ? "Creating…" : expired ? "Create a new code" : "Create pairing code"}</Button></DialogFooter>}
        </DialogContent>
      </Dialog>
    </header>
    {error && <Alert variant="destructive"><AlertDescription>{error} <Button variant="link" onClick={() => void reload()}>Retry</Button></AlertDescription></Alert>}
    {notice && <p className="m-0 text-sm text-muted-foreground" role="status">{notice}</p>}
    <Dialog open={Boolean(managed)} onOpenChange={open => { if (!open && !busy) setManagedId(null); }}>
      <section className="flex flex-col gap-3" aria-labelledby="active-devices-title">
        <div className="flex items-center gap-2"><h2 className="m-0 text-sm font-medium" id="active-devices-title">Active devices</h2>{devices && <Badge variant="secondary">{active.length}</Badge>}</div>
        {devices === null && !error ? <div className="flex flex-col gap-3" aria-label="Loading devices"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div> : devices && active.length === 0 ? <Empty><EmptyHeader><EmptyMedia variant="icon"><MonitorSmartphone /></EmptyMedia><EmptyTitle>No active devices</EmptyTitle><EmptyDescription>Pair a browser or phone to access this workspace.</EmptyDescription></EmptyHeader></Empty> : <ul className="m-0 list-none divide-y divide-border overflow-hidden rounded-xl border border-border p-0" aria-label="Devices">
          {active.map(d => <li key={d.id} className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-4 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto_auto] sm:gap-4 sm:px-5 sm:py-5">
            <span className="row-span-2 flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground sm:row-span-1" aria-hidden="true"><MonitorSmartphone className="size-5" /></span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="break-words font-medium">{d.name}</span>{d.current && <Badge variant="secondary">This device</Badge>}</div>
              <p className="m-0 text-xs leading-relaxed text-muted-foreground">{d.lastSeenAt === null ? "Not used yet" : `Last seen ${relativeTime(d.lastSeenAt, now)}`}{d.createdBy !== "owner" && <> · Added by {addedBy(devices ?? [], d.createdBy)}</>}</p>
            </div>
            <div className="contents">
              <Badge className="col-start-2 row-start-2 justify-self-start sm:col-start-3 sm:row-start-1" variant="outline">{d.access === "full" && <ShieldCheck data-icon="inline-start" />}{d.access === "full" ? "Full access" : "Limited"}</Badge>
              <DialogTrigger className="col-start-3 row-span-2 row-start-1 sm:col-start-4 sm:row-span-1" render={<Button variant="ghost" />} aria-label={`Manage ${d.name}`} onClick={() => { setManagedId(d.id); setAccess(d.access); setRemoving(false); setCascade(true); setManageError(null); }}>Manage</DialogTrigger>
            </div>
          </li>)}
        </ul>}
      </section>
      {managed && <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto [overflow-wrap:anywhere]" showCloseButton={!busy}>
        <DialogHeader><DialogTitle className="pr-7">{removing ? "Remove device access?" : managed.name}</DialogTitle><DialogDescription>{removing ? `Remove ${managed.name} from this workspace. It can join again with a new pairing code.` : "Review this browser’s access to your OpenAg workspace."}</DialogDescription></DialogHeader>
        {removing ? <FieldGroup>
          {managed.current && <Alert><AlertDescription>This is your current device. Removing it signs you out.</AlertDescription></Alert>}
          {descendants > 0 && <Field orientation="horizontal"><FieldLabel htmlFor="cascade-devices">Also remove {descendants} device{descendants === 1 ? "" : "s"} it added</FieldLabel><Switch id="cascade-devices" checked={cascade} onCheckedChange={setCascade} disabled={busy} /></Field>}
        </FieldGroup> : <FieldGroup>
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2 text-sm"><dt className="text-muted-foreground">Added</dt><dd className="m-0">{new Date(managed.createdAt).toLocaleDateString()}</dd><dt className="text-muted-foreground">Last seen</dt><dd className="m-0">{managed.lastSeenAt === null ? "Not used yet" : relativeTime(managed.lastSeenAt, now)}</dd><dt className="text-muted-foreground">Added by</dt><dd className="m-0 break-words">{managed.createdBy === "owner" ? "Owner" : addedBy(devices ?? [], managed.createdBy)}</dd></dl>
          <Field><FieldLabel htmlFor="device-access">Access</FieldLabel><SelectField className="w-full" id="device-access" value={access} onValueChange={(value) => setAccess(value as DeviceAccess)} disabled={!canManage || busy}><SelectItem value="limited">Limited access</SelectItem><SelectItem value="full">Full access</SelectItem></SelectField>
            <FieldDescription>{!canManage ? "Only a Full access device can change access." : access === "full" ? "Can manage settings, bots, integrations and device access." : managed.current ? "You will lose owner actions on this browser. You can recover access from the daemon host." : "Can chat, review approvals and watch activity."}</FieldDescription>
          </Field>
        </FieldGroup>}
        {manageError && <Alert variant="destructive"><AlertDescription>{manageError}</AlertDescription></Alert>}
        <DialogFooter>
          {removing ? <><Button variant="outline" disabled={busy} onClick={() => setRemoving(false)}>Back</Button><Button variant="destructive" disabled={busy} onClick={() => void revoke()}>{busy ? "Removing…" : "Remove device"}</Button></> : <><Button variant="ghost" disabled={busy} onClick={() => setRemoving(true)}>Remove access</Button><Button disabled={!canManage || busy || access === managed.access} onClick={() => void saveAccess()}>{busy ? "Saving…" : "Save access"}</Button></>}
        </DialogFooter>
      </DialogContent>}
    </Dialog>
    {revoked.length > 0 && <Collapsible><CollapsibleTrigger render={<Button variant="ghost" />}><ChevronDown data-icon="inline-start" />Revoked devices<Badge variant="secondary">{revoked.length}</Badge></CollapsibleTrigger><CollapsibleContent><ul className="m-0 mt-3 list-none divide-y divide-border rounded-xl border border-border px-4" aria-label="Revoked devices">{revoked.map(d => <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-4"><div className="min-w-0"><span className="break-words text-sm font-medium">{d.name}</span><p className="m-0 mt-1 text-xs text-muted-foreground">Removed {new Date(d.revokedAt!).toLocaleDateString()}{d.createdBy !== "owner" && <> · Added by {addedBy(devices ?? [], d.createdBy)}</>}</p></div><Badge variant="outline">Revoked</Badge></li>)}</ul></CollapsibleContent></Collapsible>}
  </div>;
}
