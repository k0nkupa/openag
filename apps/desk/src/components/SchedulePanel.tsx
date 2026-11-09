import { Badge } from "./ui/badge";
import { useUnsavedChanges } from "../unsaved-changes";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Switch } from "./ui/switch";
import { useCallback, useEffect, useRef, useState } from "react";
import { messageOf, type Api } from "../api";
import type { BotInfo, BriefResult, DaemonSettings, WakeDecision, WakeSettings } from "../types";

import { Button } from "./ui/button";
import { ProactiveCard } from "./ProactiveCard";
import { Field, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "./ui/field";
import { Input } from "./ui/input";
import { SelectField, SelectItem } from "./ui/select";
import { defaultLabel } from "../lib/defaultBot";

type ScheduleKey = "heartbeat" | "activeHours" | "wake" | "brief";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const BRIEF_REASON: Record<Exclude<BriefResult, { sent: true }>["reason"], string> = {
  empty: "Nothing to send.",
  disabled: "The morning brief is turned off.",
  already_sent: "Already sent today.",
  not_due: "Outside the brief window.",
  off_day: "Not an active brief day.",
};

const DECISION_LABEL: Record<WakeDecision["decision"], string> = {
  ping: "ping",
  digest: "digest",
  silent: "silent",
  suppressed: "suppressed",
};

function downgradeLabel(suppressedBy: string | null): string | null {
  if (!suppressedBy) return null;
  if (suppressedBy === "invalid") return "no parseable verdict";
  if (suppressedBy === "dedupe") return "suppressed: duplicate";
  return `downgraded: ${suppressedBy.replace("_", " ")}`;
}

export function SchedulePanel({ api }: { api: Api }) {
  const [loaded, setLoaded] = useState<DaemonSettings | null>(null);
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [everyMinutes, setEveryMinutes] = useState("60");
  const [botId, setBotId] = useState("");
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("22:00");
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const pending = useRef(false);
  const [saving, setSaving] = useState<ScheduleKey | null>(null);
  const [outcomes, setOutcomes] = useState<Partial<Record<ScheduleKey, { error?: string; saved?: boolean }>>>({});
  const [budget, setBudget] = useState("3");
  const [dedupeHours, setDedupeHours] = useState("24");
  const [urgencyThreshold, setUrgencyThreshold] = useState<WakeSettings["urgencyThreshold"]>("normal");
  const [decisions, setDecisions] = useState<WakeDecision[]>([]);
  const [decisionsError, setDecisionsError] = useState<string | null>(null);
  const [briefEnabled, setBriefEnabled] = useState(true);
  const [briefTime, setBriefTime] = useState("07:30");
  const [briefDays, setBriefDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [digestCount, setDigestCount] = useState<number | null>(null);
  const [briefNote, setBriefNote] = useState<string | null>(null);
  const [briefSending, setBriefSending] = useState(false);

  useUnsavedChanges(!!loaded && (
    enabled !== loaded.heartbeat.enabled || everyMinutes !== String(loaded.heartbeat.everyMinutes) || botId !== (loaded.heartbeat.botId ?? "") ||
    start !== loaded.activeHours.start || end !== loaded.activeHours.end || JSON.stringify(days) !== JSON.stringify(loaded.activeHours.days) ||
    budget !== String(loaded.wake.dailyPingBudget) || dedupeHours !== String(loaded.wake.dedupeHours) || urgencyThreshold !== loaded.wake.urgencyThreshold ||
    briefEnabled !== loaded.brief.enabled || briefTime !== loaded.brief.time || JSON.stringify(briefDays) !== JSON.stringify(loaded.brief.days)
  ), saving !== null);

  const loadDecisions = useCallback(async () => {
    try {
      const { decisions: list } = await api.getWakeDecisions(10);
      setDecisions(list);
      setDecisionsError(null);
    } catch (err) {
      setDecisionsError(messageOf(err));
    }
  }, [api]);

  const loadDigest = useCallback(async () => {
    try {
      const { items } = await api.getDigest();
      setDigestCount(items.length);
    } catch {
      setDigestCount(null);
    }
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getSettings(), api.listBots()]).then(
      ([{ settings }, { bots: list }]) => {
        if (cancelled) return;
        setLoaded(settings);
        setBots(list);
        setEnabled(settings.heartbeat.enabled);
        setEveryMinutes(String(settings.heartbeat.everyMinutes));
        setBotId(settings.heartbeat.botId ?? "");
        setStart(settings.activeHours.start);
        setEnd(settings.activeHours.end);
        setDays(settings.activeHours.days);
        setBudget(String(settings.wake.dailyPingBudget));
        setDedupeHours(String(settings.wake.dedupeHours));
        setUrgencyThreshold(settings.wake.urgencyThreshold);
        setBriefEnabled(settings.brief.enabled);
        setBriefTime(settings.brief.time);
        setBriefDays(settings.brief.days);
      },
      (err: unknown) => {
        if (!cancelled) setLoadError(messageOf(err));
      },
    );
    void loadDecisions();
    void loadDigest();
    return () => {
      cancelled = true;
    };
  }, [api, loadDecisions, loadDigest]);

  async function sendBriefNow() {
    setBriefNote(null);
    setBriefSending(true);
    try {
      const result = await api.sendBriefNow();
      setBriefNote(result.sent ? "Sent." : BRIEF_REASON[result.reason]);
      void loadDigest();
    } catch (err) {
      setBriefNote(messageOf(err));
    } finally {
      setBriefSending(false);
    }
  }

  async function save(key: ScheduleKey) {
    if (pending.current || !loaded) return;
    const values = {
      heartbeat: { enabled, everyMinutes: Number(everyMinutes), botId: botId || null, prompt: loaded.heartbeat.prompt },
      activeHours: { start, end, days },
      wake: { dailyPingBudget: Number(budget), dedupeHours: Number(dedupeHours), urgencyThreshold },
      brief: { enabled: briefEnabled, time: briefTime, days: briefDays },
    };
    const problems = {
      heartbeat: !everyMinutes.trim() || !Number.isInteger(Number(everyMinutes)) || Number(everyMinutes) < 5 || Number(everyMinutes) > 1440 ? "Minutes must be a whole number from 5 to 1440." : null,
      activeHours: !TIME.test(start) || !TIME.test(end) || !days.length ? "Choose valid start/end times and at least one active day." : null,
      wake: !budget.trim() || !Number.isInteger(Number(budget)) || Number(budget) < 0 || Number(budget) > 50 || !dedupeHours.trim() || !Number.isInteger(Number(dedupeHours)) || Number(dedupeHours) < 1 || Number(dedupeHours) > 168 ? "Budget must be 0–50 and dedupe hours 1–168, both whole numbers." : null,
      brief: !TIME.test(briefTime) || !briefDays.length ? "Choose a valid brief time and at least one day." : null,
    };
    setOutcomes(o => ({ ...o, [key]: {} }));
    if (problems[key]) { setOutcomes(o => ({ ...o, [key]: { error: problems[key]! } })); return; }
    pending.current = true;
    setSaving(key);
    try {
      await api.putSetting(key, values[key]);
      const { settings } = await api.getSettings();
      if (JSON.stringify(settings[key]) !== JSON.stringify(values[key])) {
        // Property order can differ in a server-normalized object.
        const actual = settings[key] as unknown as Record<string, unknown>;
        if (Object.entries(values[key]).some(([k, v]) => JSON.stringify(actual[k]) !== JSON.stringify(v))) throw new Error("The server returned different values. Reload to review them.");
      }
      setLoaded(old => old ? { ...old, [key]: settings[key] } : old);
      setOutcomes(o => ({ ...o, [key]: { saved: true } }));
      void loadDecisions();
    } catch (err) {
      setOutcomes(o => ({ ...o, [key]: { error: `Save was not confirmed. Your draft is kept; check the server before retrying. ${messageOf(err)}` } }));
    } finally { pending.current = false; setSaving(null); }
  }

  function outcome(key: ScheduleKey, label: string) {
    return <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={saving !== null}>{saving === key ? "Saving…" : `Save ${label}`}</Button>{outcomes[key]?.saved && <span role="status">Saved.</span>}{outcomes[key]?.error && <p className="mt-1.5 text-[var(--warn)]" role="alert">{outcomes[key]?.error}</p>}</div>;
  }

  if (loadError) {
    return (
      <p className="mt-1.5 text-[var(--warn)]" role="alert">
        Could not load the schedule: {loadError}
      </p>
    );
  }
  if (!loaded) return <p className="text-muted-foreground">Loading schedule...</p>;

  return (
    <div className="grid gap-4 in-data-[slot=proactive-page]:flex in-data-[slot=proactive-page]:flex-col in-data-[slot=proactive-page]:gap-5">
      <ProactiveCard title="Checking frequency" description="Choose how often an agent checks for updates.">
      <form onSubmit={e => { e.preventDefault(); void save("heartbeat"); }} onChange={() => setOutcomes(o => ({ ...o, heartbeat: {} }))}>
        <FieldSet disabled={saving !== null}><FieldLegend className="sr-only">Checking frequency</FieldLegend><FieldGroup className="sm:grid sm:grid-cols-2">
          <Field className="sm:col-span-2" orientation="horizontal"><FieldLabel htmlFor="heartbeat-enabled">Enable scheduled checks</FieldLabel><Switch id="heartbeat-enabled" checked={enabled} onCheckedChange={v => { setEnabled(v); setOutcomes(o => ({ ...o, heartbeat: {} })); }} /></Field>
          <Field><FieldLabel htmlFor="heartbeat-minutes">Check every (minutes)</FieldLabel><Input id="heartbeat-minutes" type="number" min={5} max={1440} value={everyMinutes} onChange={e => setEveryMinutes(e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="heartbeat-bot">Agent</FieldLabel><SelectField id="heartbeat-bot" className="w-full min-h-11 max-w-full" value={botId} onValueChange={(value) => setBotId(value)}><SelectItem value="">{defaultLabel(bots)}</SelectItem>{bots.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectField></Field>
          {outcome("heartbeat", "checking frequency")}
        </FieldGroup></FieldSet>
      </form>
      </ProactiveCard>
      <ProactiveCard title="Proactive alerts" description="Choose when agents may notify you and how repeated alerts are limited.">
      <form onSubmit={e => { e.preventDefault(); void save("activeHours"); }} onChange={() => setOutcomes(o => ({ ...o, activeHours: {} }))}>
        <FieldSet disabled={saving !== null}><FieldLegend>Notification hours</FieldLegend><p className="text-muted-foreground">Applies to proactive alerts.</p><FieldGroup className="sm:grid sm:grid-cols-2">
          <div className="grid gap-5 sm:col-span-2 sm:grid-cols-2"><Field><FieldLabel htmlFor="active-start">Notification hours start</FieldLabel><Input id="active-start" type="time" value={start} onChange={e => setStart(e.target.value)} /></Field><Field><FieldLabel htmlFor="active-end">Notification hours end</FieldLabel><Input id="active-end" type="time" value={end} onChange={e => setEnd(e.target.value)} /></Field></div>
          <FieldSet className="sm:col-span-2"><FieldLegend variant="label">Notification days</FieldLegend><ToggleGroup multiple variant="outline" spacing={0} className="flex-wrap" aria-label="Notification days" value={days.map(String)} onValueChange={values => setDays(values.map(Number).sort((a, b) => a - b))}>{DAYS.map((name, i) => <ToggleGroupItem key={name} value={String(i)}>{name}</ToggleGroupItem>)}</ToggleGroup></FieldSet>
          {outcome("activeHours", "notification hours")}
        </FieldGroup></FieldSet>
      </form>
      <form onSubmit={e => { e.preventDefault(); void save("wake"); }} onChange={() => setOutcomes(o => ({ ...o, wake: {} }))}>
        <FieldSet disabled={saving !== null}><FieldLegend className="sr-only">Notification limits</FieldLegend><FieldGroup className="sm:grid sm:grid-cols-2">
          <Field><FieldLabel htmlFor="wake-budget">Daily notification limit</FieldLabel><Input id="wake-budget" type="number" min={0} max={50} value={budget} onChange={e => setBudget(e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="wake-dedupe">Suppress repeated alerts (hours)</FieldLabel><Input id="wake-dedupe" type="number" min={1} max={168} value={dedupeHours} onChange={e => setDedupeHours(e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="wake-urgency">Minimum urgency</FieldLabel><SelectField id="wake-urgency" className="w-full min-h-11 max-w-full" value={urgencyThreshold} onValueChange={(value) => setUrgencyThreshold(value as WakeSettings["urgencyThreshold"])}><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem></SelectField></Field>
          {outcome("wake", "notification limits")}
        </FieldGroup></FieldSet>
      </form>
      <Collapsible><CollapsibleTrigger render={<Button variant="ghost" />}><ChevronDown data-icon="inline-start" />Recent notification decisions</CollapsibleTrigger><CollapsibleContent>
        {decisionsError && (
          <p className="mt-1.5 text-[var(--warn)]" role="alert">
            Could not load decisions: {decisionsError}
          </p>
        )}
        {!decisionsError && decisions.length === 0 && <p className="text-muted-foreground">No wake decisions yet.</p>}
        <ul className="m-0 list-none p-0">
          {decisions.slice(0, 10).map((d) => (
            <li key={d.id} className="grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-4 border-b border-border py-3 last:border-b-0 max-[640px]:grid-cols-[minmax(0,1fr)] max-[640px]:gap-1.5">
              <time className="font-mono text-xs leading-[18px] text-muted-foreground" dateTime={new Date(d.ts).toISOString()}>{new Date(d.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</time>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm leading-5 text-foreground">{d.reason}</span>
                <code className="overflow-hidden font-mono text-xs leading-[18px] text-ellipsis whitespace-nowrap text-muted-foreground">{d.dedupeKey}</code>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <Badge variant="outline">{DECISION_LABEL[d.decision]}</Badge>
                {downgradeLabel(d.suppressedBy) && <span className="text-muted-foreground">{downgradeLabel(d.suppressedBy)}</span>}
              </div>
            </li>
          ))}
        </ul>
      </CollapsibleContent></Collapsible>
      </ProactiveCard>
      <ProactiveCard title="Morning brief" description="A summary of queued updates and pending approvals.">
      <form onSubmit={e => { e.preventDefault(); void save("brief"); }} onChange={() => setOutcomes(o => ({ ...o, brief: {} }))}>
        <FieldSet disabled={saving !== null}><FieldLegend className="sr-only">Morning brief</FieldLegend><FieldGroup className="sm:grid sm:grid-cols-2">
          <Field className="sm:col-span-2" orientation="horizontal"><FieldLabel htmlFor="brief-enabled">Enable morning brief</FieldLabel><Switch id="brief-enabled" checked={briefEnabled} onCheckedChange={v => { setBriefEnabled(v); setOutcomes(o => ({ ...o, brief: {} })); }} /></Field>
          <Field><FieldLabel htmlFor="brief-time">Brief time</FieldLabel><Input id="brief-time" type="time" value={briefTime} onChange={e => setBriefTime(e.target.value)} /></Field>
          <FieldSet className="sm:col-span-2"><FieldLegend variant="label">Brief days</FieldLegend><ToggleGroup multiple variant="outline" spacing={0} className="flex-wrap" aria-label="Brief days" value={briefDays.map(String)} onValueChange={values => setBriefDays(values.map(Number).sort((a, b) => a - b))}>{DAYS.map((name, i) => <ToggleGroupItem key={name} value={String(i)}>{name}</ToggleGroupItem>)}</ToggleGroup></FieldSet>
          {outcome("brief", "morning brief")}
        </FieldGroup></FieldSet>
        <div className="mt-4 flex flex-wrap items-center gap-3"><span className="text-muted-foreground">Waiting digest items: {digestCount ?? "unknown"}</span><Button variant="outline" type="button" onClick={() => void sendBriefNow()} disabled={briefSending || saving !== null}>Send brief now</Button>{briefNote && <p role="status">{briefNote}</p>}</div>
      </form>

      </ProactiveCard>
    </div>
  );
}
