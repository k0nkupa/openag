import { Alert, AlertDescription } from "./ui/alert";
import { useUnsavedChanges } from "../unsaved-changes";
import { Switch } from "./ui/switch";
import { useEffect, useRef, useState } from "react";
import { messageOf, type Api } from "../api";
import type { BotInfo, ReflectionRun, ReflectionSettings, ReflectionStatus } from "../types";
import { relativeTime } from "./DevicesPanel";

import { Button } from "./ui/button";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { SelectField, SelectItem } from "./ui/select";
import { defaultLabel } from "../lib/defaultBot";
import { ProactiveCard } from "./ProactiveCard";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function runLine(run: ReflectionRun, now: number): string {
  const when = run.finishedAt === null ? "still running" : `finished ${relativeTime(run.finishedAt, now)}`;
  return `${run.localDate} · ${run.status} · ${run.memoryProposals} memory notes / ${run.skillProposals} skill proposals · ${when}`;
}

export function ReflectionPanel({ api }: { api: Api }) {
  const pending = useRef(false);
  const [setting, setSetting] = useState<ReflectionSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState("");
  const [botId, setBotId] = useState("");
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<ReflectionRun[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useUnsavedChanges(!!setting && (enabled !== setting.enabled || time !== setting.time || botId !== (setting.botId ?? "")), busy);

  // Loads the saved setting and runs. Only called once on mount, so unsaved edits are never overwritten.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status: ReflectionStatus = await api.getReflection();
        if (cancelled) return;
        setSetting(status.setting);
        setEnabled(status.setting.enabled);
        setTime(status.setting.time);
        setBotId(status.setting.botId ?? "");
        setRunning(status.running);
        setRuns(status.runs);
      } catch (err) {
        if (!cancelled) setLoadError(messageOf(err));
      }
      api.listBots().then(({ bots: list }) => !cancelled && setBots(list), () => {});
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Refreshes only the run state, never the form fields.
  async function refreshRuns() {
    try {
      const status = await api.getReflection();
      setRunning(status.running);
      setRuns(status.runs);
    } catch {
      /* keep the last known run list */
    }
  }

  async function save() {
    if (!setting || pending.current) return;
    if (!TIME.test(time)) {
      setNotice(null);
      setError("Time must be HH:MM, 24-hour (for example 02:30).");
      return;
    }
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { botId: _old, ...rest } = setting;
      const value: ReflectionSettings = { ...rest, enabled, time, ...(botId ? { botId } : {}) };
      await api.putSetting("reflection", value);
      const fresh = await api.getReflection();
      if (fresh.setting.enabled !== enabled || fresh.setting.time !== time) throw new Error("The server returned different settings. Reload to review them.");
      setSetting(fresh.setting);
      setNotice("Saved.");
    } catch (err) {
      setError(`Operation was not confirmed. Your draft is kept. ${messageOf(err)}`);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function runNow() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.runReflection();
      setNotice("Run started. Proposals appear in the Inbox when it finishes.");
      setRunning(true);
      await refreshRuns();
    } catch (err) {
      setError(`Operation was not confirmed. Your draft is kept. ${messageOf(err)}`);
      await refreshRuns();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  if (!setting && !loadError) return <p className="text-muted-foreground">Loading reflection...</p>;
  if (!setting) {
    return (
      <Alert variant="destructive" className="mt-1.5 text-destructive"><AlertDescription>
        Could not load reflection: {loadError}
      </AlertDescription></Alert>
    );
  }

  const now = Date.now();

  return (
    <ProactiveCard
      title="Nightly reflection"
      description="Each night a bot reviews the day and saves memories automatically. Skill changes wait in the bot’s conversation for approval. Off by default."
      action={<Switch aria-label="Enable nightly reflection" disabled={busy} checked={enabled} onCheckedChange={v => { setEnabled(v); setNotice(null); }} />}
    >
      <FieldGroup>
        <FieldGroup className="sm:grid sm:grid-cols-2">
          <Field><FieldLabel htmlFor="reflection-bot">Bot</FieldLabel><SelectField id="reflection-bot" className="w-full min-h-11 max-w-full"value={botId} disabled={busy} onValueChange={(value) => { setBotId(value); setNotice(null); }}><SelectItem value="">{defaultLabel(bots)}</SelectItem>{bots.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectField></Field>
          <Field><FieldLabel htmlFor="reflection-time">Time (HH:MM)</FieldLabel><Input id="reflection-time" type="time" value={time} disabled={busy} onChange={e => { setTime(e.target.value); setNotice(null); }} /></Field>
        </FieldGroup>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void save()} disabled={busy}>Save</Button>
          <Button variant="outline" type="button" onClick={() => void runNow()} disabled={busy || running}>Run now</Button>
          <Button variant="ghost" type="button" onClick={() => void refreshRuns()} disabled={busy}>Refresh runs</Button>
          {running && <span className="text-muted-foreground">A run is in progress.</span>}
          {notice && <span className="mt-0 mb-2 text-muted-foreground [overflow-wrap:anywhere]" role="status">{notice}</span>}
        </div>
        {error && <Alert variant="destructive" className="mt-1.5 text-destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        <div className="border-t border-border pt-4">
          <h3 className="m-0 mb-1 text-sm font-semibold">Recent runs</h3>
          {runs.length === 0 ? (
            <p className="text-muted-foreground">No runs yet.</p>
          ) : (
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {runs.map((run) => (
                <li key={`${run.localDate}-${run.startedAt}`} className="border-b border-border py-2.5 text-[13px] text-muted-foreground [overflow-wrap:anywhere] last:border-b-0">{runLine(run, now)}</li>
              ))}
            </ul>
          )}
        </div>
      </FieldGroup>
    </ProactiveCard>
  );
}
