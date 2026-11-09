import { Card, CardHeader, CardContent, CardTitle, CardDescription, CardFooter } from "./ui/card";
import { Field, FieldLabel } from "./ui/field";
import { SelectField, SelectItem } from "./ui/select";
import { IntegrationDetails, IntegrationMark, IntegrationStatus, integrationNextStep } from "./IntegrationDetails";
import { useRef, useState } from "react";
import { ArrowUpRight, RefreshCw, Server } from "lucide-react";
import { useSessionDraft } from "../session-draft";
import { hrefFor } from "../route";
import { messageOf, type Api } from "../api";
import { useAppLibrary } from "../app-library";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button, buttonVariants } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { Disclosure } from "./Disclosure";
import { AddMcpServerButton } from "./McpServerDialog";
import { Input } from "./ui/input";


function InventoryControls({ api }: { api: Api }) {
  const inventory = useAppLibrary();
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  async function run(kind: "status" | "apps" | "mcp") {
    setBusy(kind); setError(null); setNotice(null);
    try {
      if (kind === "apps") await api.reloadApps();
      if (kind === "mcp") await api.reloadMcp();
      if (!await inventory.refresh()) throw new Error("Current status could not be read. The last snapshot is shown; no operation was retried.");
      setNotice(kind === "status" ? "Inventory refreshed." : kind === "apps" ? "App folders reloaded." : "MCP reconnection checked.");
    } catch (err) { setError(messageOf(err)); }
    finally { setBusy(null); }
  }
  return <div className="library-controls">
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void run("status")}><RefreshCw data-icon="inline-start" />{busy === "status" ? "Refreshing…" : "Refresh status"}</Button>
    </div>
    <Disclosure title="Advanced maintenance"><p className="library-meta">Reload scans local app folders. Reconnect restarts all configured MCP connections; it does not edit their configuration.</p><div className="mt-3 flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={!!busy || !!inventory.error || !inventory.data?.appsDir} onClick={() => void run("apps")}>{busy === "apps" ? "Reloading…" : "Reload app folders"}</Button>
      <Button variant="outline" size="sm" disabled={!!busy || !!inventory.error || !inventory.data?.configPath} onClick={() => void run("mcp")}>{busy === "mcp" ? "Reconnecting…" : "Reconnect MCP"}</Button>
    </div></Disclosure>
    {notice && !inventory.error && <p role="status" className="library-meta">{notice}</p>}
    {error && <Alert variant="destructive"><AlertTitle>Could not complete the request</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
  </div>;
}

function LibraryEntries({ api, installedOnly, integrationId }: { api: Api; installedOnly: boolean; integrationId?: string }) {
  const { data, error } = useAppLibrary();
  const [search, setSearch] = useSessionDraft(`integration-${installedOnly ? "manage" : "browse"}-search`);
  const [category, setCategory] = useSessionDraft(`integration-${installedOnly ? "manage" : "browse"}-category`, "All");
  const opener = useRef<HTMLElement | null>(null);
  const entries = data?.entries ?? [];
  const query = search.trim().toLocaleLowerCase();
  const filtered = entries.filter(entry => (!installedOnly || entry.installed) && (category === "All" || category === entry.category) &&
    `${entry.name} ${entry.description} ${entry.runtimeId}`.toLocaleLowerCase().includes(query));
  const selected = entries.find(entry => entry.id === integrationId);
  const current = selected && (!installedOnly || selected.installed) ? selected : undefined;
  const destination = installedOnly ? "connectors" : "app-library";
  const suffix = installedOnly ? "installed" : "browse";
  return <Dialog open={!!current} onOpenChange={open => { if (!open) window.location.hash = hrefFor({kind: destination}); }}>
    <div className="library-filters">
      <Field><FieldLabel htmlFor={`library-search-${suffix}`}>Search apps and connectors</FieldLabel><Input id={`library-search-${suffix}`} placeholder="Search by name or purpose…" value={search} onChange={e => setSearch(e.target.value)} /></Field>
      <Field><FieldLabel htmlFor={`library-category-${suffix}`}>Category</FieldLabel><SelectField id={`library-category-${suffix}`} value={category} onValueChange={(value) => setCategory(value)}><SelectItem value="All">All</SelectItem>{[...new Set(entries.map(entry => entry.category))].sort().map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectField></Field>
    </div>
    <p className="library-meta" aria-live="polite">{filtered.length} {filtered.length === 1 ? "listing" : "listings"}{installedOnly ? " installed" : " available to browse"} · {data?.machine ?? "Checking machine…"}</p>
    {filtered.length ? <div className={installedOnly ? "library-installed" : "library-grid"}>
      {filtered.map(entry => <Card role="article" key={entry.id}>
        <CardHeader className="flex flex-row items-center justify-between"><IntegrationMark entry={entry} /><Badge variant="outline">{entry.kind === "app" ? "Local app" : entry.kind === "connector" ? "Connection" : data?.servers.find(server => server.id === entry.runtimeId)?.origin === "custom" ? "Custom MCP server" : "MCP connector"}</Badge></CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4"><div className="flex flex-col gap-2"><CardTitle><h2>{entry.name}</h2></CardTitle><CardDescription>{entry.description || "No description supplied."}</CardDescription></div>
        <div className="flex flex-wrap items-center justify-between gap-2"><span>{entry.category}</span><IntegrationStatus entry={entry} stale={!!error} /></div>
        {entry.state !== "ready" && <p className="library-reason">{integrationNextStep(entry)}</p>}
        </CardContent><CardFooter><Button variant="outline" nativeButton={false} render={<a href={hrefFor({kind: !installedOnly && entry.installed ? "connectors" : destination, integrationId: entry.id})} />} onClick={event => { opener.current = event.currentTarget; }}>{entry.installed ? "Manage connection" : entry.setupId || entry.kind === "connector" && entry.state === "available" ? "Set up" : "View requirements"}<ArrowUpRight data-icon="inline-end" /></Button></CardFooter></Card>)}
    </div> : <Empty><EmptyHeader><EmptyTitle>{search || category !== "All" ? "No matching integrations" : "No integrations added yet"}</EmptyTitle><EmptyDescription>{installedOnly ? "Browse the app library for supported examples. Local setup is managed on the OpenAg machine." : "Try another search or category."}</EmptyDescription></EmptyHeader></Empty>}
    {integrationId && data && !current && <Alert><AlertTitle>{selected ? "Integration not added" : "Integration not found"}</AlertTitle><AlertDescription>{selected ? <>This integration has not been added. <a className="underline" href={hrefFor({kind: "app-library", integrationId: selected.id})}>View setup in App library</a></> : <>This integration is no longer in the current inventory. <a className="underline" href={hrefFor({kind: destination})}>Close details</a></>}</AlertDescription></Alert>}
    {current && <IntegrationDetails key={current.id} api={api} entry={current} machine={data?.machine ?? "OpenAg machine"} inventoryError={!!error} managing={installedOnly} returnFocus={() => opener.current?.isConnected ? opener.current : document.getElementById(`library-search-${suffix}`)} />}
  </Dialog>;
}

function InventoryState() {
  const { data, error, loading } = useAppLibrary();
  return <>{loading && <p className="library-meta" role="status">Checking installed integrations…</p>}{error && <Alert variant="destructive"><AlertTitle>Could not refresh inventory</AlertTitle><AlertDescription>{error}{data ? " Showing the last received snapshot. Refresh status before managing an integration." : " Use Refresh status to try again."}</AlertDescription></Alert>}</>;
}

export function AppLibraryPage({ api, integrationId }: { api: Api; integrationId?: string }) {
  const { data } = useAppLibrary();
  return <section className="page library-page" aria-labelledby="app-library-title">
    <header className="page-head"><div><h1 id="app-library-title">App library</h1><p className="page-intro">Tools and connections for your OpenAg machine.</p></div><span className="library-machine"><Server aria-hidden="true" size={16} />{data?.machine ?? "Checking machine…"}</span></header>
    <InventoryControls api={api} /><InventoryState />
    <Button variant="outline" nativeButton={false} render={<a href={hrefFor({kind: "connectors"})} />}>Manage connections{data && <Badge variant="secondary">{data.counts.installed}</Badge>}<ArrowUpRight data-icon="inline-end" /></Button>
    {data && <LibraryEntries api={api} installedOnly={false} integrationId={integrationId} />}
  </section>;
}

export function InstalledConnections({ api, integrationId }: { api: Api; integrationId?: string }) {
  const { data } = useAppLibrary();
  return <div className="library-connections">
    <div className="library-connections-head"><p className="library-meta">{data ? `${data.counts.installed} added integrations · ${data.machine}` : "Checking machine…"}</p><a href="#/app-library" className={buttonVariants({ variant: "outline", size: "sm" })}>Browse app library<ArrowUpRight data-icon="inline-end" /></a></div>
    <AddMcpServerButton api={api} />
    <InventoryControls api={api} /><InventoryState />{data && <LibraryEntries api={api} installedOnly integrationId={integrationId} />}
  </div>;
}
