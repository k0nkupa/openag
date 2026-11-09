import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, messageOf, type Api } from "./api";
import type { BotInfo, BotModelState, ModelChoices, Reasoning } from "./types";
import { useStream } from "./stream";
import { useUnsavedChanges } from "./unsaved-changes";
import { useModelCatalogue } from "./model-catalogue";
import { compatibleReasoning } from "./components/ReasoningFields";

// Settings and the composer share the daemon's one-operation-per-bot boundary.
const operations = new WeakMap<Api, Map<string, Promise<unknown>>>();
function configurationOperation<T>(api: Api, id: string, run: () => Promise<T>): Promise<T> {
  let pending = operations.get(api);
  if (!pending) { pending = new Map(); operations.set(api, pending); }
  const next = (pending.get(id) ?? Promise.resolve()).catch(() => {}).then(run);
  pending.set(id, next);
  void next.finally(() => { if (pending.get(id) === next) pending.delete(id); }).catch(() => {});
  return next;
}

/** One model-configuration contract for Settings and the chat composer. */
export function useBotModelSettings(api: Api, bot: BotInfo, open: boolean, onSaved: () => void, followSaved = false) {
  const [state, setState] = useState<BotModelState | null>(null);
  const [target, setTarget] = useState(bot.runtime === "acp" ? "claude" : "openai");
  const [model, setModel] = useState("");
  const [resolvedDefault, setResolvedDefault] = useState("");
  const [reasoning, setReasoning] = useState<Reasoning>({});
  const [choices, setChoices] = useState<ModelChoices | null>(null);
  const [error, setError] = useState(""), [status, setStatus] = useState(""), [busy, setBusy] = useState(false);
  const inFlight = useRef(false), version = useRef(0), draft = useRef({ target, model });
  draft.current = { target, model };
  const { subscribe } = useStream();
  const dirtyRef = useRef(false), savedState = useRef(state), openRef = useRef(open);
  openRef.current = open;
  savedState.current = state;
  useEffect(() => {
    const current = ++version.current;
    setState(null); setResolvedDefault(""); setChoices(null); setError(""); setStatus(""); setBusy(false); inFlight.current = false;
    void api.getBotModel(bot.id).then(value => {
      if (current !== version.current) return;
      setState(value); setTarget(value.target ?? (bot.runtime === "acp" ? "claude" : "openai")); setModel(value.model ?? ""); setReasoning(value.reasoning);
    }).catch(e => { if (current === version.current) setError(messageOf(e)); });
    const refresh = () => { void api.getBotModel(bot.id).then(value => { if (current === version.current) {
      const changed = value.revision !== savedState.current?.revision;
      setState(value);
      if (changed && !inFlight.current && !dirtyRef.current) {
        setTarget(value.target ?? (bot.runtime === "acp" ? "claude" : "openai")); setModel(value.model ?? ""); setReasoning(value.reasoning); setResolvedDefault(""); setChoices(null);
        if (openRef.current) void catalogue.discover(value.target ?? (bot.runtime === "acp" ? "claude" : "openai"), value.model ?? undefined).then(found => {
          if (current === version.current && found.revision === value.revision) setChoices(found);
        }).catch(() => { if (current === version.current) setError("The saved model changed. Reload model settings to refresh its options."); });
      }
    } }).catch(() => {}); };
    const off = subscribe({ onOpen: refresh, onEvent: e => { if (e.actor === bot.id && ["model_report", "turn_finished"].includes(e.type) || e.type === "config" && (e.payload as { botId?: string } | null)?.botId === bot.id) refresh(); } });
    return () => { version.current++; off(); };
  }, [api, bot.id, bot.runtime, subscribe, followSaved]);
  const loadTargets = useCallback(() => api.botCreationTargets().then(r => r.targets.sort((a, b) => Number(b.id === draft.current.target) - Number(a.id === draft.current.target))), [api, bot.runtime]);
  const readChoices = useCallback((target: string, selected?: string) => {
    const model = selected ?? (target === draft.current.target ? draft.current.model : "");
    return configurationOperation(api, bot.id, () => api.discoverBotModel(bot.id, { target, ...(model ? { model } : {}) }).catch(e => { if (!selected && e instanceof ApiError && e.status === 409) return api.discoverBotModel(bot.id, { target }); throw e; }));
  }, [api, bot.id]);
  const catalogue = useModelCatalogue(loadTargets, readChoices, open && !!state && !state.override);
  useEffect(() => {
    if (!open || choices || busy) return;
    const initial = catalogue.defaults[target];
    if (initial && initial.revision === state?.revision && (!model || initial.model === model)) {
      setChoices(initial);
      if (!model) { setResolvedDefault(initial.model); setModel(initial.model); }
    }
  }, [open, choices, busy, catalogue.defaults, target, model, state?.revision]);
  async function choose(key: string, persist = false) {
    const selected = catalogue.models.find(m => m.id === key);
    if (!selected || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setStatus("");
    const current = version.current;
    try {
      const next = await catalogue.discover(selected.target, selected.model);
      if (current !== version.current) return;
      if (next.model !== selected.model) throw Error("This model is no longer available. Choose another model.");
      if (persist && state && next.revision !== state.revision) throw Error("Configuration changed. Reload model settings before changing it.");
      const supported = compatibleReasoning(next.controls, reasoning);
      setTarget(selected.target); setModel(next.model); setChoices(next); setReasoning(supported);
      if (persist) await writeSelection(next, selected.target, next.model, supported);
    } catch (e) { if (current === version.current) setError(messageOf(e)); }
    finally { if (current === version.current) { inFlight.current = false; setBusy(false); } }
  }
  async function writeSelection(selectedChoices: ModelChoices, selectedTarget: string, selectedModel: string, selectedReasoning: Reasoning) {
    const current = version.current;
    const target = selectedTarget, model = selectedModel, reasoning = selectedReasoning;
    async function confirmed(fresh: BotModelState, notice: string) {
      setChoices(previous => previous ? {...previous, revision: fresh.revision} : previous);
      setState(fresh); setTarget(target); setModel(model); setReasoning(reasoning); setStatus(notice); onSaved();
      if (followSaved) {
        setChoices(null);
        try {
          const found = await catalogue.discover(target, model);
          if (current === version.current && found.revision === fresh.revision) setChoices(found);
        } catch { if (current === version.current) setError("Model saved, but its options could not refresh. Reload model settings before changing them again."); }
      }
    }
    let submitted = false;
    const matches = (value: BotModelState) => value.model === model && value.target === target && JSON.stringify(value.reasoning) === JSON.stringify(reasoning);
    try {
      const next = await catalogue.discover(target, model);
      if (current !== version.current) return;
      if (next.revision !== selectedChoices.revision) throw Error("Configuration changed. Reopen model settings before saving.");
      if (next.model !== model) throw Error("This model is no longer available. Choose another model.");
      if (next.snapshotId !== selectedChoices.snapshotId) { setChoices(next); setReasoning(compatibleReasoning(next.controls, reasoning)); setError("Model catalogue changed. Review the model and reasoning, then save again."); return; }
      const supported = compatibleReasoning(next.controls, reasoning);
      setChoices(next);
      if (JSON.stringify(supported) !== JSON.stringify(reasoning)) { setReasoning(supported); setError("Effort options changed. Review them before saving."); return; }
      submitted = true;
      const fresh = await configurationOperation(api, bot.id, () => api.putBotModel(bot.id, { revision: next.revision, snapshotId: next.snapshotId, model, reasoning }));
      if (current !== version.current) return;
      setState(fresh); if (!matches(fresh)) throw Error("Readback differs. Your draft is kept.");
      await confirmed(fresh, "Saved.");
    } catch (e) {
      if (!submitted) { if (current === version.current) setError(messageOf(e)); return; }
      try {
        const fresh = await api.getBotModel(bot.id);
        if (current !== version.current) return;
        setState(fresh);
        if (matches(fresh)) { await confirmed(fresh, "Save confirmed by readback. No retry was sent."); }
        else setError(`Save was not confirmed. Your draft is kept. ${messageOf(e)}`);
      } catch { if (current === version.current) setError("Save is uncertain. Your draft is kept. Check status before retrying."); }
    }
  }
  async function save(nextReasoning = reasoning) {
    if (inFlight.current || catalogue.loading || !state || !choices) return;
    inFlight.current = true; setBusy(true); setError(""); setStatus("");
    const current = version.current;
    setReasoning(nextReasoning);
    try { await writeSelection(choices, target, model, nextReasoning); }
    finally { if (current === version.current) { inFlight.current = false; setBusy(false); } }
  }
  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setStatus("");
    const current = version.current;
    try {
      const fresh = await api.getBotModel(bot.id);
      if (current !== version.current) return;
      setState(fresh); setTarget(fresh.target ?? (bot.runtime === "acp" ? "claude" : "openai")); setModel(fresh.model ?? ""); setReasoning(fresh.reasoning); setChoices(null); catalogue.reload();
    } catch (e) { if (current === version.current) setError(messageOf(e)); }
    finally { if (current === version.current) { inFlight.current = false; setBusy(false); } }
  }
  const dirty = !!state && (model !== (state.model ?? resolvedDefault) || target !== (state.target ?? (bot.runtime === "acp" ? "claude" : "openai")) || JSON.stringify(reasoning) !== JSON.stringify(state.reasoning));
  dirtyRef.current = dirty;
  useUnsavedChanges(dirty, busy);
  function beginDiscovery() { setChoices(null); if (state) setError(""); catalogue.reload(); }
  return {state, target, model, reasoning, setReasoning, choices, error, status, busy, dirty, catalogue, choose, save, reload, beginDiscovery, isBlocked: () => inFlight.current || catalogue.loading || dirty};
}
