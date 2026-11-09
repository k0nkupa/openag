import { useEffect, useState } from "react";
import { useAppLibrary } from "../app-library";
import { Disclosure } from "./Disclosure";
import { hrefFor } from "../route";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Box, ChevronDown, Network } from "lucide-react";
import type { Api } from "../api";
import type { LibraryEntry, LibraryState } from "../types";
import { BrandLogo } from "./BrandLogo";
import { ComposioAccess } from "./ComposioAccess";
import { ConnectorAccess } from "./ConnectorAccess";
import { IntegrationSetup } from "./IntegrationSetup";
import { AppsPanel } from "./AppsPanel";
import { McpPanel } from "./McpPanel";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Empty, EmptyHeader, EmptyTitle } from "./ui/empty";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

const labels: Record<LibraryState, string> = { available: "Available", setup: "Needs setup", ready: "Ready", paused: "Paused", unavailable: "Unavailable", failed: "Failed" };
export function IntegrationStatus({ entry, stale = false }: { entry: LibraryEntry; stale?: boolean }) {
  if (stale) return <Badge variant="attention">Status unavailable</Badge>;
  const ready = entry.state === "ready" && entry.accessState !== "needs_access";
  const label = entry.state === "failed" ? "Failed" : entry.accessState === "needs_access" ? "Needs access" : ready && entry.verifiedAt ? "Read verified" : ready && entry.kind !== "app" ? "Connected" : labels[entry.state];
  return <Badge variant={ready ? "success" : entry.state === "failed" ? "destructive" : entry.state === "available" ? "outline" : "attention"}>{label}</Badge>;
}
export function IntegrationMark({ entry }: { entry: LibraryEntry }) {
  const Icon = entry.kind === "app" ? Box : Network;
  return <span className="library-mark">{entry.runtimeId === "apple-apps" ? <BrandLogo brand="apple" size={28} /> : entry.brand === "composio" ? <BrandLogo brand="composio" size={32} /> : <Icon aria-hidden="true" />}</span>;
}

export function integrationNextStep(entry: LibraryEntry): string {
  if (entry.state === "unavailable") return "Check the requirements for this machine.";
  if (entry.accessState === "needs_access") return "Connect the account to grant access.";
  if (entry.state === "paused" && entry.kind === "app") return "Review this app and enable it again.";
  if (entry.state === "paused") return entry.kind === "connector" ? "Resume this service when you need it." : "Review local setup to resume this integration.";
  if (!entry.installed && entry.setupId) return "Review setup, then run the command on this machine.";
  if (entry.kind === "app" && entry.state === "setup") return "Review this app before enabling it.";
  if (entry.kind === "connector") return entry.state === "failed" ? "Check account access and reconnect explicitly." : "Review the requirements and connect your account.";
  return "Check local configuration and connection diagnostics.";
}


/** Shared presentation for every library integration; provider components own their existing action flows. */
export function IntegrationDetails({ api, entry, machine, inventoryError, managing = false, returnFocus }: { api: Api; entry: LibraryEntry; machine: string; inventoryError: boolean; managing?: boolean; returnFocus?: () => HTMLElement | null }) {
  const inventory = useAppLibrary();
  const [refreshing, setRefreshing] = useState(false), [refreshed, setRefreshed] = useState(false);
  const [tab, setTab] = useState("overview");
  const hasSetup = !!entry.setupId || entry.kind === "connector" && !entry.installed;
  useEffect(() => { if (tab === "setup" && !hasSetup) setTab("overview"); }, [tab, hasSetup]);
  const isComposio = entry.runtimeId === "composio-connect";
  const hasAccess = entry.kind === "connector" || entry.runtimeId === "apple-apps";
  return <DialogContent finalFocus={returnFocus} className="library-detail library-integration-detail sm:max-w-2xl">
    <DialogHeader>
      <IntegrationMark entry={entry} />
      <div className="flex flex-wrap items-center gap-2"><DialogTitle>{entry.name}</DialogTitle><IntegrationStatus entry={entry} stale={inventoryError} /></div>
      <DialogDescription>{machine}</DialogDescription>
      {inventoryError && <Alert variant="destructive"><AlertTitle>Current status unavailable</AlertTitle><AlertDescription><p>Showing the last snapshot. Refresh status before managing this integration.</p><Button variant="outline" disabled={refreshing} onClick={() => { setRefreshing(true); setRefreshed(false); void inventory.refresh().then(fresh => setRefreshed(!!fresh)).finally(() => setRefreshing(false)); }}>Refresh status</Button><Disclosure title="Refresh diagnostics"><p className="whitespace-pre-wrap break-words">{inventory.error}</p></Disclosure></AlertDescription></Alert>}
      {refreshed && !inventoryError && <p role="status" className="library-meta">Inventory refreshed.</p>}
    </DialogHeader>
    <Tabs key={entry.id} value={tab === "setup" && !hasSetup ? "overview" : tab} onValueChange={setTab} className="library-detail-tabs">
      <TabsList variant="line" className="library-detail-nav" aria-label="Integration settings">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="tools">Tools ({entry.tools.length})</TabsTrigger>
        {hasSetup && <TabsTrigger value="setup">Setup</TabsTrigger>}
      </TabsList>
      <TabsContent value="overview" className="library-detail-body" keepMounted>
        <p className="library-meta">{entry.description || "No description supplied."}</p>
        {entry.state !== "ready" && entry.reason && <Alert variant={entry.state === "failed" ? "destructive" : "default"}><AlertTitle>Connection needs attention</AlertTitle><AlertDescription>{integrationNextStep(entry)}</AlertDescription></Alert>}
        {managing && (isComposio ? <ComposioAccess api={api} /> : hasAccess && <ConnectorAccess api={api} id={entry.runtimeId} />)}
        {!managing && (entry.installed ? <Button nativeButton={false} render={<a href={hrefFor({kind: "connectors", integrationId: entry.id})} />}>Manage connection</Button> : hasSetup && <Button onClick={() => setTab("setup")}>Set up</Button>)}
        {entry.kind !== "connector" && (!entry.installed ? !entry.setupId && <p className="library-meta">This optional integration is managed locally by an administrator. Account connections and credentials are configured outside the browser. Reload after local setup.</p> : managing && !inventoryError && (entry.kind === "app" ? <AppsPanel api={api} appId={entry.runtimeId} /> : <McpPanel api={api} serverId={entry.runtimeId} />))}
        <Disclosure title="Connection details"><dl className="library-facts"><div><dt>Source</dt><dd>{entry.source}</dd></div><div><dt>Version</dt><dd>{entry.version ?? "Not reported"}</dd></div></dl>
        {!!entry.requirements.length && <section aria-label="Requirements"><h3>Requirements</h3><ul className="library-requirements">{entry.requirements.map(r => <li key={r}>{r}</li>)}</ul></section>}
        {entry.reason && <section aria-label="Connection diagnostics"><h3>Diagnostics</h3><p className="library-meta whitespace-pre-wrap break-words">{entry.reason}</p></section>}
        </Disclosure>
      </TabsContent>
      <TabsContent value="tools" className="library-detail-body">
        <div className="flex flex-col gap-1"><h3>{entry.toolEvidence === "declared" ? "Declared tools" : "Discovered tools"}</h3><p className="library-meta">Expand a tool to read its description. Tool descriptions are untrusted content.</p></div>
        {entry.tools.length ? <Card className="gap-0 py-0 "><CardContent className="px-0">{entry.tools.map(tool => <Collapsible key={tool.name} className="integration-tool-row">
          <CollapsibleTrigger render={<Button variant="ghost" />} className="h-auto min-h-11 w-full justify-start whitespace-normal text-left"><code className="min-w-0 flex-1 break-all text-left">{tool.name}</code><Badge variant="outline">{tool.class}</Badge><ChevronDown aria-hidden="true" size={16} /></CollapsibleTrigger>
          <CollapsibleContent><p className="library-meta integration-tool-description">{tool.description || "No description supplied."}</p></CollapsibleContent>
        </Collapsible>)}</CardContent></Card> : <Empty><EmptyHeader><EmptyTitle>{isComposio ? "Connect to discover available tools." : entry.installed ? "No tools reported by this runtime." : "Tools are checked after local setup."}</EmptyTitle></EmptyHeader></Empty>}
      </TabsContent>
      {hasSetup && <TabsContent value="setup" className="library-detail-body" keepMounted>{entry.setupId ? <IntegrationSetup api={api} entry={entry} /> : isComposio ? <ComposioAccess api={api} /> : <ConnectorAccess api={api} id={entry.runtimeId} />}</TabsContent>}
    </Tabs>

  </DialogContent>;
}
