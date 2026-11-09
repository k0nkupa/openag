import { useCallback, useEffect, useRef, useState } from "react";
import { messageOf } from "./api";
import type { ModelChoices, ModelProvider } from "./types";
import type { Model } from "./components/ui/model-selector";

export interface CatalogueModel extends Model { target: string; model: string }
export const modelChoiceKey = (target: string, model: string) => JSON.stringify([target, model]);

/** Serialize discovery: the daemon admits only one model-configuration operation per bot. */
export function useModelCatalogue(loadTargets: () => Promise<ModelProvider[]>, discover: (target: string, model?: string) => Promise<ModelChoices>, enabled: boolean) {
  const [models, setModels] = useState<CatalogueModel[]>([]);
  const [defaults, setDefaults] = useState<Record<string, ModelChoices>>({});
  const [errors, setErrors] = useState<string[]>([]), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const read = useCallback((target: string, model?: string) => {
    const operation = queue.current.catch(() => {}).then(() => discover(target, model));
    queue.current = operation;
    return operation;
  }, [discover]);
  useEffect(() => {
    let cancelled = false;
    setLoading(enabled);
    if (enabled) setErrors([]);
    if (!enabled) return;
    void (async () => {
      try {
        const targets = (await loadTargets()).filter(t => t.configured !== false);
        if (cancelled) return;
        setModels(previous => previous.filter(m => targets.some(t => t.id === m.target)));
        for (const target of targets) {
          if (cancelled) return;
          try {
            const found = await read(target.id);
            if (cancelled) return;
            setDefaults(previous => ({ ...previous, [target.id]: found }));
            setModels(previous => [...previous.filter(m => m.target !== target.id), ...found.models.map(m => ({ ...m, id: modelChoiceKey(target.id, m.id), target: target.id, model: m.id, provider: target.name }))]);
          } catch (e) { if (!cancelled) { setModels(previous => previous.filter(m => m.target !== target.id)); setErrors(previous => [...previous, `${target.name}: ${messageOf(e)}`]); } }
        }
      } catch (e) { if (!cancelled) setErrors([messageOf(e)]); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [loadTargets, read, enabled, revision]);
  return { models, defaults, errors, loading, discover: read, reload: () => setRevision(v => v + 1) };
}
