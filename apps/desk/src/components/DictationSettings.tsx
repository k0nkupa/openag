import { useUnsavedChanges } from "../unsaved-changes";
import { useEffect, useRef, useState } from 'react';
import { messageOf, type Api } from '../api';
import type { DictationSettings as Setting, DictationStatus } from '../types';
import { SettingsSection } from './SettingsLayout';
import { Field, FieldGroup, FieldLabel } from './ui/field';
import { SelectField, SelectItem } from './ui/select';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';

export function DictationSettings({ api, revision, refreshing = false }: { api: Api; revision?: string; refreshing?: boolean }) {
  const [status, setStatus] = useState<DictationStatus | null>(null), [full, setFull] = useState(false);
  const [draft, setDraft] = useState<Setting>({ enabled: false, provider: 'openai', model: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);
  const [loadedRevision, setLoadedRevision] = useState<string | undefined>();
  const stale = refreshing || loadedRevision !== revision;
  useEffect(() => { let live = true;
    void Promise.all([api.getDictation(), api.whoami()]).then(([value, who]) => { if (live) { setStatus(value); setLoadedRevision(revision); if (!loaded.current) { setDraft({ enabled: value.enabled, provider: value.provider, model: value.model }); loaded.current = true; } setFull(who.kind === 'owner' || who.access === 'full'); } }).catch(err => { if (live) setError(messageOf(err)); });
    return () => { live = false; };
  }, [api, revision]);
  useUnsavedChanges(!!status && (draft.enabled !== status.enabled || draft.model !== status.model || draft.provider !== status.provider), busy);
  const models = status?.choices?.find(c => c.provider === draft.provider)?.models ?? [];
  const selected = models.find(m => m.id === `${draft.provider}/${draft.model}`);
  async function save() {
    setBusy(true); setError(null);
    try {
      await api.putSetting('dictation', { ...draft, ...(selected ? { snapshotId: selected.snapshotId } : {}) });
      const value = await api.getDictation();
      if (value.enabled !== draft.enabled || value.model !== draft.model || value.provider !== draft.provider) throw new Error('Dictation settings could not be confirmed. Refresh before saving again.');
      setStatus(value);
    } catch (err) {
      try {
        const value = await api.getDictation(); setStatus(value);
        if (value.enabled !== draft.enabled || value.model !== draft.model || value.provider !== draft.provider) setError(messageOf(err));
      } catch { setStatus(null); setError('Save is unconfirmed. Reload this page before saving again.'); }
    }
    finally { setBusy(false); }
  }
  return <SettingsSection icon="models" title="Dictation" description="Turn speech into a message draft.">
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {status && <Badge variant={!status.enabled ? 'secondary' : status.configured ? 'success' : 'attention'}>{!status.enabled ? 'Off' : status.configured ? 'Configured' : 'Needs setup'}</Badge>}
    {status?.enabled && !status.configured && <Alert><AlertDescription>{status.reason}</AlertDescription></Alert>}
    <FieldGroup>
      <Field><FieldLabel htmlFor="dictation-enabled">Transcription provider</FieldLabel><SelectField id="dictation-enabled" value={draft.enabled ? draft.provider : 'off'} disabled={!full || busy || !status || stale} onValueChange={value => setDraft(value === 'off' ? { ...draft, enabled: false } : { enabled: true, provider: value as Setting['provider'], model: value === draft.provider ? draft.model : '' })}><SelectItem value="off">Off</SelectItem><SelectItem value="openai">OpenAI</SelectItem><SelectItem value="ollama">Ollama (local)</SelectItem></SelectField></Field>
      <Field><FieldLabel htmlFor="dictation-model">Transcription model</FieldLabel><SelectField id="dictation-model" value={draft.model} disabled={!full || busy || !status || stale || !draft.enabled} onValueChange={value => setDraft({ ...draft, model: value as Setting['model'] })}>{status?.provider === draft.provider && status.model && !models.some(m => m.id === `${draft.provider}/${status.model}`) && <SelectItem value={status.model}>{status.model}</SelectItem>}{models.map(model => <SelectItem key={model.id} value={model.id.slice(draft.provider.length + 1)}>{model.name}</SelectItem>)}</SelectField></Field>
      <div><Button type="button" disabled={!full || busy || !status || stale || (draft.enabled && !draft.model) || (draft.enabled === status.enabled && draft.model === status.model && draft.provider === status.provider)} onClick={() => void save()}>{busy ? 'Saving…' : 'Save dictation'}</Button></div>
    </FieldGroup>
  </SettingsSection>;
}
