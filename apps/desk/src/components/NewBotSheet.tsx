import { Disclosure } from "./Disclosure";
import { modelChoiceKey, useModelCatalogue } from "../model-catalogue";
import { Dialog } from "@base-ui/react/dialog";
import { Plus } from "lucide-react";
import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, messageOf, type Api, type Whoami } from "../api";
import type { BotInfo, ModelChoices, Reasoning } from "../types";
import { newCreationRequestId } from "../lib/creationRequestId";
import { getOwnerToken } from "../ownerSession";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "./ui/sheet";
import { Button } from "./ui/button";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Alert, AlertDescription } from "./ui/alert";
import { ModelSelector } from "./ui/model-selector";
import { compatibleReasoning, ReasoningFields } from "./ReasoningFields";

const CreationAccess = createContext<{ allowed: boolean; handle: ReturnType<typeof Dialog.createHandle> } | null>(null);

export function NewBotTrigger({ iconOnly = false }: { iconOnly?: boolean }) {
  const creation = useContext(CreationAccess);
  if (!creation) return null;
  const { allowed, handle } = creation;
  return <SheetTrigger handle={handle} render={<Button type="button" variant={iconOnly ? "ghost" : "default"} size={iconOnly ? "icon-sm" : "default"} disabled={!allowed} aria-label={iconOnly ? "New agent" : undefined} title={allowed ? "New agent" : "Full access is required to create an agent"} />}>
    <Plus aria-hidden="true" data-icon={iconOnly ? undefined : "inline-start"} />{!iconOnly && "New bot"}
  </SheetTrigger>;
}

export function NewBotSheet({ api, identity, onCreated, children }: { api: Api; identity: Whoami | null; onCreated: (bot: BotInfo) => void; children: ReactNode }) {
  const [handle] = useState(() => Dialog.createHandle());
  const [triggerId, setTriggerId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("codex");
  const [name, setName] = useState(""), [description, setDescription] = useState(""), [instructions, setInstructions] = useState("");
  const [choices, setChoices] = useState<ModelChoices | null>(null), [reasoning, setReasoning] = useState<Reasoning>({});
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState("");
  const requestId = useRef(newCreationRequestId()), inFlight = useRef(false), version = useRef(0);
  useEffect(() => () => { version.current++; }, [api]);
  const allowed = identity?.kind === "owner" || identity?.kind === "device" && identity.access === "full" || getOwnerToken() !== null;
  const creationId = requestId.current;
  const loadTargets = useCallback(() => api.botCreationTargets().then(r => r.targets.sort((a, b) => Number(b.id === "codex") - Number(a.id === "codex"))), [api]);
  const readChoices = useCallback((target: string, model?: string) => api.discoverBotCreation({ requestId: creationId, target, ...(model ? { model } : {}) }), [api, creationId]);
  const catalogue = useModelCatalogue(loadTargets, readChoices, open && !!allowed);
  useEffect(() => {
    if (!open || choices || busy || uncertain) return;
    const initial = catalogue.defaults[target] ?? (!catalogue.loading ? Object.values(catalogue.defaults)[0] : undefined);
    if (initial?.revision === creationId) { setTarget(initial.target); setChoices(initial); }
  }, [open, choices, busy, uncertain, catalogue.defaults, catalogue.loading, target, creationId]);
  function finish(bot: BotInfo) {
    setOpen(false); setUncertain(false); setName(""); setDescription(""); setInstructions(""); setChoices(null); setReasoning({}); setError(""); requestId.current = newCreationRequestId(); onCreated(bot);
  }
  async function choose(key: string) {
    const selected = catalogue.models.find(m => m.id === key);
    if (!selected || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    const current = version.current;
    try {
      const next = await catalogue.discover(selected.target, selected.model);
      if (current !== version.current) return;
      if (next.model !== selected.model) throw Error("This model is no longer available. Choose another model.");
      setTarget(selected.target); setChoices(next); setReasoning(previous => compatibleReasoning(next.controls, previous));
    } catch (e) { if (current === version.current) setError(messageOf(e)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function checkStatus() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    const current = version.current;
    try {
      const { bot } = await api.botCreationStatus(requestId.current);
      if (current !== version.current) return;
      if (bot) finish(bot); else { setUncertain(false); setError("No creation was recorded. Your draft is kept; you can try again."); }
    } catch { if (current === version.current) { setUncertain(true); setError("Creation is still uncertain. Check status before retrying."); } }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function create() {
    if (inFlight.current || !choices || uncertain) return;
    inFlight.current = true; setBusy(true); setError("");
    const current = version.current;
    let submitted = false;
    try {
      const fresh = await catalogue.discover(target, choices.model);
      if (current !== version.current) return;
      if (fresh.model !== choices.model) throw Error("This model is no longer available. Choose another model.");
      if (fresh.snapshotId !== choices.snapshotId) { setChoices(fresh); setReasoning(compatibleReasoning(fresh.controls, reasoning)); setError("Model catalogue changed. Review the model and reasoning, then create again."); return; }
      const supported = compatibleReasoning(fresh.controls, reasoning);
      setChoices(fresh);
      if (JSON.stringify(supported) !== JSON.stringify(reasoning)) { setReasoning(supported); setError("Effort options changed. Review them before creating the bot."); return; }
      submitted = true;
      const { bot } = await api.createBot({ requestId: requestId.current, name, description, instructions, target, model: fresh.model, snapshotId: fresh.snapshotId, reasoning }); if (current === version.current) finish(bot);
    }
    catch (e) {
      if (current !== version.current) return;
      if (!submitted || e instanceof ApiError && [400, 401, 403, 409].includes(e.status)) { setError(`${messageOf(e)} Your draft is kept.`); return; }
      try { const { bot } = await api.botCreationStatus(requestId.current); if (current !== version.current) return; if (bot) finish(bot); else setError(`${messageOf(e)} Your draft is kept.`); }
      catch { if (current === version.current) { setUncertain(true); setError("Creation is uncertain. Your draft is kept. Check status before retrying."); } }
    } finally { inFlight.current = false; setBusy(false); }
  }
  const disabled = busy || uncertain;
  return <CreationAccess.Provider value={{ allowed, handle }}>
    {children}
    <Sheet handle={handle} triggerId={triggerId} open={open} onOpenChange={(next, details) => { if (!busy) { setOpen(next); setTriggerId(details.trigger?.id ?? null);  } }}>
      <SheetContent finalFocus={() => document.getElementById(triggerId ?? "") ?? document.querySelector<HTMLButtonElement>('[data-slot="sidebar-trigger"]')} className="overflow-y-auto">
        <SheetHeader><SheetTitle>New bot</SheetTitle><SheetDescription>Create an agent with its own instructions, memory and permissions. Creation starts no conversation or model turn.</SheetDescription></SheetHeader>
        <form className="flex flex-col gap-5 p-4" onSubmit={e => { e.preventDefault(); void create(); }}>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {uncertain && <Button type="button" disabled={busy} onClick={() => void checkStatus()}>Check creation status</Button>}
          <FieldGroup>
            <Field><FieldLabel htmlFor="new-bot-name">Name</FieldLabel><Input id="new-bot-name" required maxLength={40} value={name} disabled={disabled} onChange={e => setName(e.target.value)} /><p className="text-sm text-muted-foreground">Names may repeat. OpenAg assigns a unique, stable @handle.</p></Field>
            <Field><FieldLabel htmlFor="new-bot-description">Description</FieldLabel><Input id="new-bot-description" maxLength={200} value={description} disabled={disabled} onChange={e => setDescription(e.target.value)} /></Field>
            <Field><FieldLabel htmlFor="new-bot-instructions">Instructions</FieldLabel><Textarea id="new-bot-instructions" maxLength={8000} rows={4} value={instructions} disabled={disabled} onChange={e => setInstructions(e.target.value)} /></Field>
            <Field><FieldLabel htmlFor="new-bot-model">Model</FieldLabel><ModelSelector id="new-bot-model" models={catalogue.models} loading={catalogue.loading || busy} value={choices ? modelChoiceKey(target, choices.model) : undefined} disabled={disabled || !catalogue.models.length} onValueChange={key => void choose(key)} /></Field>
            {choices && <ReasoningFields id="new-bot" controls={choices.controls} value={reasoning} onChange={setReasoning} disabled={disabled} />}
            {!catalogue.loading && !catalogue.models.length && <p role="status" className="text-sm text-muted-foreground">No models are available. Check Models in Settings.</p>}
            {!!catalogue.errors.length && <Disclosure className="text-sm text-muted-foreground" title={<> Unavailable model sources </>}> {catalogue.errors.map(e => <p key={e}>{e}</p>)}<Button type="button" variant="outline" disabled={disabled} onClick={catalogue.reload}>Try again</Button></Disclosure>}
          </FieldGroup>
          <Button type="submit" disabled={disabled || !name.trim() || !choices}>{busy ? "Working…" : "Create bot"}</Button>
        </form>
      </SheetContent>
    </Sheet>
  </CreationAccess.Provider>;
}
