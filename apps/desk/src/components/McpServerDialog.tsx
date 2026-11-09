import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useAppLibrary } from "../app-library";
import { messageOf, type Api } from "../api";
import { isStaleDigest, useMcpEntries } from "../mcp-entries";
import { mcpHint } from "../mcp-hints";
import type { McpEntryView, McpSecretView, McpServerChange, McpServerInput } from "../types";
import { McpCommandDialog } from "./McpCommandDialog";
import { McpServerCheck } from "./McpServerCheck";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";

interface Row { key: number; name: string; template: string }
let rowKey = 0;
const DEFAULT_TIMEOUT_MS = 30000;
const toRows = (entry: McpEntryView | undefined): Row[] => (entry?.headers ?? []).map(pair => ({ key: ++rowKey, name: pair.name, template: pair.template }));
const rowsKey = (rows: Row[]) => JSON.stringify(rows.map(row => [row.name, row.template]));
const snapshot = (entry: McpEntryView | undefined) => ({
  url: entry?.url ?? "", headers: rowsKey(toRows(entry)), allowPrivateNetwork: entry?.allowPrivateNetwork ?? false,
  timeout: entry && entry.timeoutMs !== DEFAULT_TIMEOUT_MS ? String(entry.timeoutMs) : "",
  oauthOn: !!entry?.oauth, scope: entry?.oauth?.scope ?? "",
});

const SECRET_REF = /\$\{secret:([A-Z][A-Z0-9_]{0,63})\}/g;
/** Secret names the headers refer to, in order of first use. */
const secretNames = (rows: Row[]) => [...new Set(rows.flatMap(row => [...row.template.matchAll(SECRET_REF)].map(match => match[1]!)))];

/** What the form currently describes, or an explanation of what is missing. Header values are references, never secrets. */
function build(mode: "add" | "edit", url: string, rows: Row[], allowPrivateNetwork: boolean, timeout: string, oauth: { on: boolean; scope: string; existing?: { scope?: string; clientMetadataUrl?: string } }): { input: McpServerInput } | { problem: string } {
  if (rows.some(row => !row.name.trim() && row.template.trim())) return { problem: "Each header needs a name. Fill it in or remove the row." };
  if (rows.some(row => row.template.includes("[REDACTED"))) return { problem: "A header value was hidden when it was loaded. Type its variable reference again." };
  const named = rows.filter(row => row.name.trim());
  const names = named.map(row => row.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) return { problem: "Header names must be different from each other." };
  const typed = timeout.trim() === "" ? undefined : Number(timeout);
  if (typed !== undefined && (!Number.isInteger(typed) || typed < 1000 || typed > 120000)) return { problem: "The timeout must be a whole number of milliseconds between 1000 and 120000." };
  // Clearing the field while editing resets to the default; adding with it blank just uses the default.
  const timeoutMs = typed ?? (mode === "edit" ? DEFAULT_TIMEOUT_MS : undefined);
  return { input: {
    url: url.trim(),
    headers: Object.fromEntries(named.map(row => [row.name.trim(), row.template])),
    allowPrivateNetwork,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    // On an edit, switching OAuth off sends null; the address of a client metadata document set elsewhere is kept.
    ...(oauth.on ? { oauth: { ...(oauth.scope.trim() ? { scope: oauth.scope.trim() } : {}), ...(oauth.existing?.clientMetadataUrl ? { clientMetadataUrl: oauth.existing.clientMetadataUrl } : {}) } } : mode === "edit" && oauth.existing ? { oauth: null } : {}),
  } };
}

/** Add or edit one custom remote server. The draft stays on screen when the daemon refuses it. */
export function McpServerDialog({ api, mode, entry, digest, open, onOpenChange, onSaved, reload, returnFocus }: {
  api: Api; mode: "add" | "edit"; entry?: McpEntryView; digest: string; open: boolean;
  onOpenChange: (open: boolean) => void; onSaved: (change: McpServerChange) => void | Promise<void>; reload: () => Promise<void>;
  /** Where focus goes when the dialog closes (the button that opened it). */
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const initial = useRef(snapshot(entry));
  const [id, setId] = useState(entry?.id ?? "");
  const [url, setUrl] = useState(initial.current.url);
  const [rows, setRows] = useState<Row[]>(() => toRows(entry));
  const [allowPrivateNetwork, setAllowPrivateNetwork] = useState(initial.current.allowPrivateNetwork);
  const [offerToAgents, setOfferToAgents] = useState(entry?.offerToAgents ?? true);
  const [timeout, setTimeoutText] = useState(initial.current.timeout);
  const [oauthOn, setOauthOn] = useState(!!entry?.oauth);
  const [scope, setScope] = useState(entry?.oauth?.scope ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Secrets are write-only: what is typed here is sent once after the server is saved and is never shown again.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [stored, setStored] = useState<McpSecretView[]>([]);
  // After the server is saved once, a retry saves it again only if the form changed, so a failed secret never hides a later edit.
  const savedChange = useRef<{ change: McpServerChange; sent: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const names = secretNames(rows);
  const loadStored = async () => { if (mode !== "edit" || !entry) return; try { setStored((await api.getMcpSecrets()).secrets.filter(secret => secret.serverId === entry.id)); } catch { setStored([]); } };
  useEffect(() => { void loadStored(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const built = build(mode, url, rows, allowPrivateNetwork, timeout, { on: oauthOn, scope, existing: entry?.oauth });
  // A check only connects and lists tools: sign-in settings are not part of it.
  const candidate = "input" in built && url.trim() ? { ...(({ oauth: _oauth, ...rest }) => rest)(built.input), ...(mode === "edit" && entry ? { id: entry.id } : id.trim() ? { id: id.trim() } : {}) } : null;
  const setRow = (key: number, patch: Partial<Row>) => setRows(current => current.map(row => (row.key === key ? { ...row, ...patch } : row)));

  // When the saved version changes underneath an open edit (after a stale save, or another writer), fields you have not touched take the
  // latest value and fields you edited keep your draft, so saving never silently replaces someone else's change with an old copy.
  const latest = JSON.stringify(entry ?? null);
  useEffect(() => {
    if (mode !== "edit" || !entry) return;
    const next = snapshot(entry), was = initial.current;
    if (JSON.stringify(next) === JSON.stringify(was)) return;
    setUrl(current => (current === was.url ? next.url : current));
    setRows(current => (rowsKey(current) === was.headers ? toRows(entry) : current));
    setAllowPrivateNetwork(current => (current === was.allowPrivateNetwork ? next.allowPrivateNetwork : current));
    setTimeoutText(current => (current === was.timeout ? next.timeout : current));
    setOauthOn(current => (current === was.oauthOn ? next.oauthOn : current));
    setScope(current => (current === was.scope ? next.scope : current));
    initial.current = next;
  }, [latest]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if ("problem" in built) { setError(built.problem); return; }
    setBusy(true); setError(null);
    try {
      // After the server is saved, a failed secret leaves the dialog open: a retry only sends the secrets, never saves the server twice.
      const sent = JSON.stringify(built.input), serverId = mode === "add" ? id.trim() : entry!.id;
      if (!savedChange.current || savedChange.current.sent !== sent) {
        const previous = savedChange.current;
        const change = previous ? await api.updateMcpServer(serverId, built.input, previous.change.change.digest)
          : mode === "add" ? await api.addMcpServer(serverId, { ...built.input, offerToAgents }, digest)
          : await api.updateMcpServer(serverId, built.input, digest);
        savedChange.current = { change, sent }; setSaved(true); await onSaved(change);
      }
      const origin = new URL(built.input.url).origin;
      for (const name of names) {
        const value = typed[name];
        if (!value) continue;
        try { await api.setMcpSecret(serverId, name, value, origin); setTyped(current => { const { [name]: _sent, ...rest } = current; return rest; }); }
        catch (err) { await loadStored(); setError(`The server was saved, but secret ${name} was not: ${messageOf(err)}`); return; }
      }
      onOpenChange(false);
    } catch (err) {
      // The draft stays as typed. A stale digest means the file changed elsewhere: load the latest (untouched fields follow it).
      if (isStaleDigest(err)) { await reload(); setError("Another change was saved first. Fields you did not edit now show the latest version and yours are kept. Review and save again."); }
      else setError(messageOf(err));
    } finally { setBusy(false); }
  }

  const hint = error ? mcpHint(error) : null;
  return <Dialog open={open} onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <DialogContent className="sm:max-w-xl" finalFocus={returnFocus}>
      <DialogHeader>
        <DialogTitle>{mode === "add" ? "Add MCP server" : `Edit ${entry?.id}`}</DialogTitle>
        <DialogDescription>A remote server OpenAg connects to.</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="flex min-w-0 flex-col gap-4" aria-label={mode === "add" ? "Add MCP server" : "Edit MCP server"}>
        <FieldGroup>
          {mode === "add" && <Field><FieldLabel htmlFor="mcp-server-id">Name</FieldLabel><Input id="mcp-server-id" value={id} disabled={saved} placeholder="linear" autoComplete="off" onChange={event => setId(event.target.value)} /><FieldDescription>Lowercase letters, numbers, hyphens and underscores. It cannot be changed later.</FieldDescription></Field>}
          <Field><FieldLabel htmlFor="mcp-server-url">Address</FieldLabel><Input id="mcp-server-url" value={url} placeholder="https://mcp.example.com/mcp" autoComplete="off" onChange={event => setUrl(event.target.value)} /><FieldDescription>Keep credentials out of the address; use a header.</FieldDescription></Field>
          <section className="flex min-w-0 flex-col gap-2" aria-label="Headers">
            <div className="flex flex-col gap-1"><h3>Headers</h3><p className="library-meta">A value can refer to a variable the administrator sets on the OpenAg machine, such as <code>Bearer ${"{OPENAG_MCP_LINEAR}"}</code>, or to a stored secret, such as <code>Bearer ${"{secret:LINEAR}"}</code>.</p></div>
            {rows.map(row => <div key={row.key} className="flex min-w-0 flex-wrap items-end gap-2">
              <Field className="min-w-32 flex-1"><FieldLabel htmlFor={`mcp-header-name-${row.key}`}>Header name</FieldLabel><Input id={`mcp-header-name-${row.key}`} value={row.name} placeholder="Authorization" autoComplete="off" onChange={event => setRow(row.key, { name: event.target.value })} /></Field>
              <Field className="min-w-40 flex-[2]"><FieldLabel htmlFor={`mcp-header-value-${row.key}`}>Variable reference</FieldLabel><Input id={`mcp-header-value-${row.key}`} value={row.template} placeholder={"Bearer ${secret:NAME}"} autoComplete="off" onChange={event => setRow(row.key, { template: event.target.value })} /></Field>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove header ${row.name || "row"}`} onClick={() => setRows(current => current.filter(other => other.key !== row.key))}><Trash2 aria-hidden="true" /></Button>
            </div>)}
            <div><Button type="button" variant="outline" size="sm" onClick={() => setRows(current => [...current, { key: ++rowKey, name: "", template: "" }])}><Plus data-icon="inline-start" />Add header</Button></div>
          </section>
          {names.length > 0 && <section className="flex min-w-0 flex-col gap-2" aria-label="Secrets">
            <div className="flex flex-col gap-1"><h3>Secrets</h3><p className="library-meta">Saved encrypted on the OpenAg machine and never shown again. A secret works only for this server’s address.</p></div>
            {names.map(name => {
              // A secret belongs to the address it was saved for: after the address moves to another origin the saved value is gone.
              const origin = (() => { try { return new URL(url.trim()).origin; } catch { return undefined; } })();
              const current = stored.find(secret => secret.name === name && secret.origin === origin);
              return <div key={name} className="flex min-w-0 flex-wrap items-end gap-2">
                <Field className="min-w-40 flex-1"><FieldLabel htmlFor={`mcp-secret-${name}`}>{name}</FieldLabel>
                  <Input id={`mcp-secret-${name}`} type="password" autoComplete="new-password" value={typed[name] ?? ""} placeholder={current ? (current.last4 ? `Set, ending ${current.last4}` : "Set") : "Not set"} onChange={event => setTyped(values => ({ ...values, [name]: event.target.value }))} />
                  <FieldDescription>{current ? "Leave blank to keep the saved value." : "Enter the value to save with this server."}</FieldDescription></Field>
                {current && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { await api.removeMcpSecret(entry!.id, name); await loadStored(); await reload(); } catch (err) { setError(messageOf(err)); } finally { setBusy(false); } }}>Delete {name}</Button>}
              </div>;
            })}
          </section>}
          <Field orientation="horizontal">
            <FieldContent><FieldLabel htmlFor="mcp-server-private">Allow private network</FieldLabel><FieldDescription>For a server on this machine or your own network, and plain http.</FieldDescription></FieldContent>
            <Switch id="mcp-server-private" checked={allowPrivateNetwork} onCheckedChange={setAllowPrivateNetwork} />
          </Field>
          <Field orientation="horizontal">
            <FieldContent><FieldLabel htmlFor="mcp-server-oauth">Sign in with OAuth</FieldLabel><FieldDescription>For servers that ask you to sign in with the provider instead of using a key. You sign in from the server’s settings.</FieldDescription></FieldContent>
            <Switch id="mcp-server-oauth" checked={oauthOn} onCheckedChange={setOauthOn} />
          </Field>
          {oauthOn && <Field><FieldLabel htmlFor="mcp-server-scope">Scope</FieldLabel><Input id="mcp-server-scope" value={scope} placeholder="read" autoComplete="off" onChange={event => setScope(event.target.value)} /><FieldDescription>Optional. Leave blank to let the provider decide.</FieldDescription></Field>}
          {mode === "add" && <Field orientation="horizontal">
            <FieldContent><FieldLabel htmlFor="mcp-server-offer">Offer tools to agents</FieldLabel><FieldDescription>Agents can see and request this server’s tools once it is enabled.</FieldDescription></FieldContent>
            <Switch id="mcp-server-offer" checked={offerToAgents} onCheckedChange={setOfferToAgents} />
          </Field>}
          <Field><FieldLabel htmlFor="mcp-server-timeout">Timeout (milliseconds)</FieldLabel><Input id="mcp-server-timeout" inputMode="numeric" value={timeout} placeholder={String(DEFAULT_TIMEOUT_MS)} autoComplete="off" onChange={event => setTimeoutText(event.target.value)} /><FieldDescription>Optional, between 1000 and 120000. Leave blank for the default.</FieldDescription></Field>
        </FieldGroup>
        {error && <Alert variant="destructive"><AlertDescription><p>{error}</p>{hint && <p>{hint}</p>}</AlertDescription></Alert>}
        <McpServerCheck api={api} candidate={candidate} />
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" disabled={busy || !url.trim() || (mode === "add" && !id.trim())}>{busy ? "Saving…" : mode === "add" ? "Add server" : "Save changes"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

/** The "Add MCP server" entry point. Rendered only for the owner (anyone else gets no editable view). */
export function AddMcpServerButton({ api }: { api: Api }) {
  const inventory = useAppLibrary();
  const mcp = useMcpEntries(api);
  const [open, setOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const commandTrigger = useRef<HTMLButtonElement | null>(null);
  if (!mcp.entries) return mcp.entriesError ? <p className="library-meta" role="status">{mcp.entriesError}</p> : null;
  return <div className="flex flex-wrap items-center gap-3">
    <Button ref={trigger} type="button" onClick={() => { setNotice(null); setOpen(true); }}><Plus data-icon="inline-start" />Add MCP server</Button>
    <Button ref={commandTrigger} type="button" variant="outline" onClick={() => { setNotice(null); setCommandOpen(true); }}><Plus data-icon="inline-start" />Add local command</Button>
    <p className="library-meta" role="status">{notice ?? ""}</p>
    {commandOpen && <McpCommandDialog api={api} mode="add" open onOpenChange={setCommandOpen} returnFocus={commandTrigger}
      onApplied={async id => { await mcp.reload(); setNotice(await inventory.refresh() ? `${id} added.` : `${id} was added, but current status could not be read. Refresh status before taking another action.`); }} />}
    {open && <McpServerDialog api={api} mode="add" digest={mcp.entries.digest} open onOpenChange={setOpen} reload={mcp.reload} returnFocus={trigger}
      onSaved={async change => { mcp.adopt(change); setNotice(await inventory.refresh() ? `${change.change.id} added.` : `${change.change.id} was added, but current status could not be read. Refresh status before taking another action.`); }} />}
  </div>;
}
