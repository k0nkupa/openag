import { Card, CardContent } from "./ui/card";
import { Alert, AlertDescription } from "./ui/alert";
import { useUnsavedChanges } from "../unsaved-changes";
import { useEffect, useRef, useState } from "react";
import { SelectField, SelectItem } from "./ui/select";
import { Button } from "./ui/button";
import { Field, FieldLabel } from "./ui/field";
import { ModelSelector } from "./ui/model-selector";
import { compatibleReasoning, ReasoningFields } from "./ReasoningFields";
import { ApiError, messageOf, type Api } from "../api";
import type { ModelChoices, Reasoning, Room, RouterOption, RouterStrategy } from "../types";
import type { Model } from "./ui/model-selector";

const LABEL: Record<RouterStrategy, string> = { lead: "Room lead", jev: "Jev", "openai-decision": "Decision model (OpenAI)", "cheap-same-model": "Chat model" };
const ORDER: RouterStrategy[] = ["lead", "jev", "openai-decision", "cheap-same-model"];
const errorMessage = (e: unknown) => e instanceof ApiError && e.status === 403 ? "Only the owner can change routing." : messageOf(e);

const choiceKey = (provider: string, model: string) => `${provider}::${model}`;

export function RoomRouting({ api, room, options, disabled, onSaved, hideHeader }: { hideHeader?: boolean; api: Api; room: Room; options: RouterOption[]; disabled: boolean; onSaved: (room: Room) => void }) {
  const [strategy, setStrategy] = useState(room.router ?? "lead");
  const [provider, setProvider] = useState(room.routerConfig?.provider ?? "");
  const [model, setModel] = useState(room.routerConfig?.model ?? "");
  const [reasoning, setReasoning] = useState<Reasoning>(room.routerConfig?.reasoning ?? {});
  const [choices, setChoices] = useState<ModelChoices | null>(null);
  const [resetCount, setResetCount] = useState(0);
  const [catalog, setCatalog] = useState<Model[] | null>(null), [loadingCatalog, setLoadingCatalog] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  useUnsavedChanges(strategy !== (room.router ?? "lead") || provider !== (room.routerConfig?.provider ?? "") || model !== (room.routerConfig?.model ?? "") || JSON.stringify(reasoning) !== JSON.stringify(room.routerConfig?.reasoning ?? {}), busy);
  const inFlight = useRef(false), version = useRef(0);
  useEffect(() => () => { version.current++; }, []);
  const providers = options.find(o => o.strategy === strategy)?.providers ?? [];
  const usable = providers.filter(p => p.configured !== false);
  const usableIds = usable.map(p => p.id).join(",");
  const providerName = (id: string) => providers.find(p => p.id === id)?.name ?? id;
  // One list across every configured provider that can serve this strategy. Discovery only reads model lists; it creates no model turn.
  useEffect(() => {
    if (strategy === "lead") { setCatalog(null); return; }
    let cancelled = false;
    setLoadingCatalog(true); setCatalog(null);
    void Promise.allSettled(usable.map(p => api.discoverRoomRouter(room.id, { strategy, provider: p.id }).then(found => ({ p, found })))).then(results => {
      if (cancelled) return;
      const entries = results.flatMap(r => r.status === "fulfilled" ? r.value.found.models.map(m => ({ id: choiceKey(r.value.p.id, m.id), name: m.name, provider: r.value.p.name })) : []);
      const failed = results.find(r => r.status === "rejected");
      setCatalog(entries); setLoadingCatalog(false);
      if (!entries.length) setError(failed ? errorMessage((failed as PromiseRejectedResult).reason) : "No compatible provider is configured.");
    });
    return () => { cancelled = true; };
  }, [api, room.id, strategy, usableIds]);
  function reset() {
    setStrategy(room.router ?? "lead"); setProvider(room.routerConfig?.provider ?? ""); setModel(room.routerConfig?.model ?? ""); setReasoning(room.routerConfig?.reasoning ?? {}); setChoices(null); setError(""); setStatus("");
    if (strategy === (room.router ?? "lead")) setResetCount(count => count + 1);
  }
  async function discover(forProvider: string, selected: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    const current = version.current;
    try {
      const next = await api.discoverRoomRouter(room.id, { strategy, provider: forProvider, model: selected });
      if (current !== version.current) return;
      if (next.model !== selected) throw Error("This model is no longer available. Choose another model.");
      setChoices(next); setModel(next.model);
      setReasoning(previous => compatibleReasoning(next.controls, previous));
    } catch (e) { if (current === version.current) { setChoices(null); setError(errorMessage(e)); } }
    finally { inFlight.current = false; if (current === version.current) setBusy(false); }
  }
  // A stored configuration needs its controls and snapshot before it can be edited or re-saved.
  useEffect(() => { if (catalog && provider && model && !choices) void discover(provider, model); }, [catalog, resetCount, choices]);
  function choose(key: string) {
    const at = key.indexOf("::");
    const nextProvider = key.slice(0, at), nextModel = key.slice(at + 2);
    setProvider(nextProvider); setModel(nextModel); setChoices(null); setStatus(""); setError("");
    void discover(nextProvider, nextModel);
  }
  async function save() {
    if (inFlight.current || strategy !== "lead" && !choices) return;
    inFlight.current = true; setBusy(true); setError(""); setStatus("");
    const current = version.current;
    const matches = (r: Room) => (r.router ?? "lead") === strategy && (strategy === "lead" || r.routerConfig?.provider === provider && r.routerConfig.model === model && JSON.stringify(r.routerConfig.reasoning) === JSON.stringify(reasoning));
    try {
      let reviewed = choices;
      if (strategy !== "lead") {
        const next = await api.discoverRoomRouter(room.id, { strategy, provider, model });
        if (current !== version.current) return;
        if (next.revision !== choices!.revision) throw Error("Routing configuration changed. Reopen routing before saving.");
        if (next.model !== model) throw Error("This model is no longer available. Choose another model.");
        const supported = compatibleReasoning(next.controls, reasoning);
        setChoices(next); reviewed = next;
        if (JSON.stringify(supported) !== JSON.stringify(reasoning)) { setReasoning(supported); setError("Effort options changed. Review them before saving."); return; }
      }
      const input = { strategy, revision: reviewed?.revision ?? room.routerRevision, ...(strategy !== "lead" ? { provider, model, reasoning, snapshotId: reviewed!.snapshotId } : {}) };
      await api.setRoomRouting(room.id, input);
      const fresh = (await api.listRooms()).rooms.find(r => r.id === room.id);
      if (current !== version.current) return;
      if (!fresh || !matches(fresh)) throw Error("Readback differs. Your draft is kept; reload before saving again.");
      onSaved(fresh); setChoices(null); setStatus("Saved. Service acceptance is checked when routing runs.");
    } catch (e) {
      try {
        const fresh = (await api.listRooms()).rooms.find(r => r.id === room.id);
        if (current !== version.current) return;
        if (fresh && matches(fresh)) { onSaved(fresh); setChoices(null); setStatus("Save confirmed by readback. No retry was sent."); }
        else setError(errorMessage(e));
      } catch { if (current === version.current) setError("Save is uncertain. Reload status before retrying."); }
    } finally { inFlight.current = false; if (current === version.current) setBusy(false); }
  }
  const blocked = busy || disabled;
  const selected = provider && model ? choiceKey(provider, model) : "";
  const models = catalog ?? [];
  const withSelected = selected && !models.some(m => m.id === selected) ? [{ id: selected, name: model, provider: providerName(provider) }, ...models] : models;
  return <div className={hideHeader ? "flex flex-col gap-4" : "list-row room-routing-row"}>
    {!hideHeader && <div className="flex min-w-0 flex-col"><span className="list-row-title">{room.name}</span><span className="list-row-sub">{room.members.length} members{room.leadBotId ? ` · lead ${room.leadBotId}` : ""}</span></div>}
    <Field><FieldLabel htmlFor={`router-${room.id}`}>Routing</FieldLabel><SelectField id={`router-${room.id}`} aria-label={`Routing for ${room.name}`} value={strategy} disabled={blocked} onValueChange={(value) => { setStrategy(value as RouterStrategy); setProvider(""); setModel(""); setReasoning({}); setChoices(null); setStatus(""); setError(""); }}>{ORDER.map(id => <SelectItem key={id} value={id}>{LABEL[id]}</SelectItem>)}</SelectField></Field>
    {strategy !== "lead" && <>
      <Field><FieldLabel htmlFor={`routing-model-${room.id}`}>Model</FieldLabel><ModelSelector id={`routing-model-${room.id}`} placeholder={loadingCatalog ? "Loading models…" : "Select a model"} disabled={blocked || !withSelected.length} loading={loadingCatalog || busy} models={withSelected} value={selected} onValueChange={choose} /></Field>
      <ReasoningFields id={`routing-${room.id}`} controls={choices?.controls ?? []} value={reasoning} onChange={setReasoning} disabled={blocked} />
      {choices?.reason && <p className="hint">{choices.reason}</p>}
    </>}
    <div className="flex gap-2"><Button aria-label={`Save routing for ${room.name}`} disabled={blocked || strategy !== "lead" && !choices} onClick={() => void save()}>Save routing</Button><Button variant="outline" disabled={blocked} onClick={reset}>Cancel</Button></div>
    {status && <p role="status" className="hint">{status}</p>}{error && <Alert variant="destructive" className="error"><AlertDescription>{error}</AlertDescription></Alert>}
  </div>;
}

export function RoomRoutingPanel({ api, routerOptions, availabilityError }: { api: Api; routerOptions?: RouterOption[]; availabilityError?: string | null }) {
  const [rooms, setRooms] = useState<Room[] | null>(null), [options, setOptions] = useState<RouterOption[] | null>(null), [roomError, setRoomError] = useState(""), [routingError, setRoutingError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void api.listRooms().then(r => { if (!cancelled) { setRooms(r.rooms.filter(r => !r.id.startsWith("_"))); setRoomError(""); } }, e => { if (!cancelled) setRoomError(messageOf(e)); });
    if (!routerOptions) void api.getRouterStrategies().then(o => { if (!cancelled) { setOptions(o.strategies); setRoutingError(""); } }, e => { if (!cancelled) setRoutingError(messageOf(e)); });
    return () => { cancelled = true; };
  }, [api, routerOptions]);
  const error = roomError || availabilityError || (!routerOptions ? routingError : "");
  const available = routerOptions ?? options;
  return <div className="flex flex-col gap-5">
    <p className="hint">Messages without an @mention go to the room lead unless routing is enabled. Choose a model from the available sources. Routing sends redacted message text (first 1000 characters) to that provider. @mentions and @everyone take priority. If routing fails, the lead answers.</p>
    {(error || availabilityError) && <Alert variant="destructive" className="error"><AlertDescription>Could not refresh routing: {error || availabilityError}</AlertDescription></Alert>}
    {!rooms || !available ? !error && <p>Checking…</p> : rooms.length === 0 ? <p>No rooms yet.</p> : <Card className="gap-0 py-0"><CardContent className="px-0">{rooms.map(room => <RoomRouting key={room.id} api={api} room={room} options={available} disabled={!!availabilityError} onSaved={saved => setRooms(list => (list ?? []).map(r => r.id === saved.id ? saved : r))} />)}</CardContent></Card>}
  </div>;
}
