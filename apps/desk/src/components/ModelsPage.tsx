import { DictationSettings } from "./DictationSettings";
import { Card, CardContent } from "./ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { messageOf, type Api } from "../api";
import type { ModelsStatus, RouterOption, ModelCatalogueStatus } from "../types";
import { BrandLogo } from "./BrandLogo";
import { RoomRoutingPanel } from "./RoomRoutingPanel";
import { SettingsHeader, SettingsSection } from "./SettingsLayout";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

export function ModelsPage({ api }: { api: Api }) {
  const [catalogue, setCatalogue] = useState<ModelCatalogueStatus | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [status, setStatus] = useState<ModelsStatus | null>(null);
  const [routers, setRouters] = useState<RouterOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [routingError, setRoutingError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [providerQuery, setProviderQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const refresh = useCallback(() => {
    const request = ++version.current;
    setBusy(true);
    setError(null);
    void api.getModelCatalogue().then(value => { if (request === version.current) setCatalogue(value); }).catch(err => { if (request === version.current) setError(messageOf(err)); });
    void api.getModelsStatus().then(models => {
      if (request === version.current) setStatus(models);
    }, err => {
      if (request === version.current) setError(messageOf(err));
    }).finally(() => { if (request === version.current) setBusy(false); });
    void api.getRouterStrategies().then(routing => {
      if (request !== version.current) return;
      setRouters(routing.strategies);
      setRoutingError(null);
    }, err => {
      if (request !== version.current) return;
      setRouters([]);
      setRoutingError(messageOf(err));
    });
  }, [api]);
  useEffect(() => { void refresh(); return () => { version.current++; }; }, [refresh]);

  async function refreshModels() {
    setRefreshingModels(true); setError(null);
    try { setCatalogue(await api.refreshModelCatalogue()); }
    catch (err) { setError(messageOf(err)); }
    finally { setRefreshingModels(false); }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(text); }
    catch { setCopied(null); }
  }

  const setupFor = (p: ModelsStatus["providers"][number]) => (p.envMode === "all" ? p.envVars ?? [p.envVar] : [p.envVar]).map(name => `export ${name}=...`).join("\n");
  const providerRow = (p: ModelsStatus["providers"][number]) => <div className="list-row flex-wrap" key={p.id}>
    <BrandLogo brand={p.id} /><div className="list-row-main"><span className="list-row-title">{p.name}</span><span className="list-row-sub">{p.usedFor}</span>{p.set && <span className="list-row-sub">Key present{p.last4 ? ` · ••••${p.last4}` : ""}</span>}</div>
    <Badge variant={p.set ? "success" : "attention"}>{p.set ? "Present" : "Not configured"}</Badge>
    {!p.set && <Collapsible className="w-full"><CollapsibleTrigger render={<Button variant="ghost" />}><ChevronDown data-icon="inline-start" />Setup</CollapsibleTrigger><CollapsibleContent className="flex flex-col gap-3 pt-3"><code className="whitespace-pre-wrap break-all text-sm">{setupFor(p).replaceAll("...", "…")}</code>{p.docUrl && /^https?:\/\//.test(p.docUrl) && <a href={p.docUrl} target="_blank" rel="noreferrer">Setup documentation</a>}<div><Button variant="outline" onClick={() => void copy(setupFor(p))}>{copied === setupFor(p) ? "Copied" : "Copy setup example"}</Button></div></CollapsibleContent></Collapsible>}
  </div>;
  return <section className="settings-page" aria-labelledby="models-title">
    <SettingsHeader id="models-title" title="Models" description="Subscriptions, API providers and local models available to your agents." action={<Button variant="outline" disabled={busy} onClick={() => void refresh()}><RefreshCw data-icon="inline-start" />{busy ? "Checking…" : "Refresh status"}</Button>} />
    {error && <Alert variant="destructive"><AlertDescription>Could not refresh model status: {error}. Any status below is from the last successful check.</AlertDescription></Alert>}
    <SettingsSection icon="models" title="Subscription CLIs" description="Use an installed adapter with your existing subscription. Sign in from the CLI on the server.">
      <Card className="gap-0 py-0"><CardContent className="px-0">{!status && <div className="list-row">{busy ? "Checking…" : "Status unavailable"}</div>}{status?.clis.map(c => {
        const command = `pnpm --filter daemon add ${c.adapterPackage}`;
        return <div className="list-row flex-wrap" key={c.id}><BrandLogo brand={c.id} /><div className="list-row-main"><span className="list-row-title">{c.name}</span><span className="list-row-sub">{c.usedBy.length ? `Assigned to ${c.usedBy.join(", ")}` : "No agent assigned"}</span>{!c.adapterInstalled && <code className="break-all text-sm">{command}</code>}</div><Badge variant={c.adapterInstalled ? "success" : "attention"}>{c.adapterInstalled ? "Installed" : "Adapter missing"}</Badge>{!c.adapterInstalled && <Button variant="outline" onClick={() => void copy(command)}>{copied === command ? "Copied" : "Copy install command"}</Button>}</div>;
      })}</CardContent></Card>
    </SettingsSection>
    <SettingsSection icon="bell" title="API providers" description="Provider setup and available models.">
      {status?.providers.some(p => p.id !== "brave" && p.set) && <Card className="gap-0 py-0 provider-list" role="region" aria-label="Configured API providers" tabIndex={0}><CardContent className="px-0">{status.providers.filter(p => p.id !== "brave" && p.set).map(providerRow)}</CardContent></Card>}
      <Collapsible><CollapsibleTrigger render={<Button variant="outline" />}><ChevronDown data-icon="inline-start" />Browse all supported providers</CollapsibleTrigger><CollapsibleContent className="flex flex-col gap-4 pt-4">
      <Input aria-label="Search API providers" placeholder="Search providers…" value={providerQuery} onChange={e => setProviderQuery(e.target.value)} />
      <p className="hint">{status?.providers.filter(p => p.id !== "brave").length ?? 0} providers</p>
      <Card className="gap-0 py-0 provider-list" role="region" aria-label="All API providers" tabIndex={0}><CardContent className="px-0">{status?.providers.filter(p => p.id !== "brave" && `${p.name} ${p.id}`.toLowerCase().includes(providerQuery.toLowerCase())).map(providerRow)}
        {status && !status.providers.some(p => p.id !== "brave" && `${p.name} ${p.id}`.toLowerCase().includes(providerQuery.toLowerCase())) && <p className="p-4 text-sm text-muted-foreground">No matching providers.</p>}
      </CardContent></Card>
      </CollapsibleContent></Collapsible>

    </SettingsSection>
    <DictationSettings api={api} revision={JSON.stringify(catalogue)} refreshing={refreshingModels} />
    <SettingsSection icon="bell" title="Tool APIs" description="Services used by tools.">
      {status?.providers.filter(p => p.id === "brave").map(p => <Card className="gap-0 py-0" key={p.id}><CardContent className="px-0"><div className="list-row"><BrandLogo brand={p.id} /><div className="list-row-main"><span className="list-row-title">{p.name}</span><span className="list-row-sub break-all">{p.set ? "Key present" : `${p.envVar} is not set`}</span></div>{!p.set && <Button variant="outline" onClick={() => void copy(setupFor(p))}>{copied === setupFor(p) ? "Copied" : "Copy setup example"}</Button>}</div></CardContent></Card>)}
    </SettingsSection>
    <SettingsSection icon="models" title="Model catalogue" description="Models and reasoning options are saved on this server. Opening, selecting and saving use this catalogue. Sources refresh daily; Refresh models checks them now.">
      <Button variant="outline" disabled={refreshingModels} onClick={() => void refreshModels()}><RefreshCw data-icon="inline-start" />{refreshingModels ? "Refreshing models…" : "Refresh models"}</Button>
      {catalogue?.sources.filter(s => s.configured !== false).map(s => <div className="list-row flex-wrap" key={s.id}><div className="list-row-main"><span className="list-row-title">{s.name}</span><span className="list-row-sub">{s.refreshedAt ? `Last refreshed ${new Date(s.refreshedAt).toLocaleString()}` : "No saved models yet"}</span>{s.error && <span className="list-row-sub">{s.error}</span>}</div><Badge variant={s.error ? "destructive" : s.refreshing || !s.refreshedAt ? "attention" : "success"}>{s.error ? "Refresh failed" : s.refreshing ? "Refreshing" : s.refreshedAt ? "Cached" : "Needs refresh"}</Badge></div>)}
    </SettingsSection>
    <SettingsSection icon="models" title="Local" description="Local models through Ollama.">
      {status && <Card className="gap-0 py-0"><CardContent className="px-0"><div className="list-row flex-wrap"><BrandLogo brand="ollama" /><div className="list-row-main"><span className="list-row-title">Ollama</span><span className="list-row-sub break-all">{status.ollama.url}</span></div><Badge variant={status.ollama.reachable ? "success" : "destructive"}>{status.ollama.reachable ? "Responding" : "Unreachable"}</Badge></div><div className="list-row"><dl className="kv"><dt>Installed models</dt><dd>{status.ollama.models.join(", ") || "None returned"}</dd><dt>Embeddings</dt><dd>{status.ollama.embedEnabled ? `${status.ollama.embedModel} · configured` : "Disabled (OPENAG_EMBED=off)"}</dd></dl></div></CardContent></Card>}
    </SettingsSection>
    <SettingsSection icon="bolt" title="Room routing" description="An explicit @mention takes priority. Without one, use the room lead or a configured decision service."><RoomRoutingPanel api={api} routerOptions={routers.length ? routers : undefined} availabilityError={routingError} /></SettingsSection>
  </section>;
}
