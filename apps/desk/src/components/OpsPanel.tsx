import { useUnsavedChanges } from "../unsaved-changes";
import { ChevronDown } from "lucide-react";
import { SettingsSection } from "./SettingsLayout";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Switch } from "./ui/switch";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Separator } from "./ui/separator";
import { Skeleton } from "./ui/skeleton";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, messageOf, type Api } from "../api";
import type { BackupSettings, BackupStatus, DaemonSettings, LimitsSettings, OpsStatus } from "../types";

const OWNER_BACKUP = "Only a Full access device can run a backup";
const OWNER_SAVE = "Only a Full access device can change operations settings";
const DEFAULT_BACKUP: BackupSettings = { enabled: false, time: "03:00", keep: 7 };
const DEFAULT_LIMITS: LimitsSettings = { maxTurnsPerBotPerDay: 0, maxUnattendedPerDay: 0 };
const MAX_LIMIT = 100000;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const KV = "m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5";

/** "Never" for a missing timestamp, otherwise the local date and time. */
export function formatTime(ms: number | null): string {
  return ms === null ? "Never" : new Date(ms).toLocaleString();
}

/** Human-readable size in B, KB, MB or GB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Parses a limit field: whole numbers from 0 to MAX_LIMIT. Returns null when invalid. */
export function parseLimit(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n <= MAX_LIMIT ? n : null;
}

function backupStatusLine(status: BackupStatus): string {
  if (status.last === null) return status.backups.length ? "Backup files exist; no run result is recorded." : "No recorded backup run.";
  const when = formatTime(status.last.at);
  if (status.last.ok) return `Last backup ${when}: ok${status.last.name ? ` (${status.last.name})` : ""}.`;
  return `Last backup ${when}: failed${status.last.error ? ` (${status.last.error})` : ""}.`;
}

export function OpsPanel({ api, onBackupsChange }: { api: Api; onBackupsChange?: (status: BackupStatus) => void }) {
  const [backups, setBackups] = useState<BackupStatus | null>(null);
  const [ops, setOps] = useState<OpsStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [backupForm, setBackupForm] = useState<BackupSettings>(DEFAULT_BACKUP);
  const [backupSaving, setBackupSaving] = useState(false);
  const [backupSaved, setBackupSaved] = useState(false);
  const [backupSaveError, setBackupSaveError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runNotice, setRunNotice] = useState<string | null>(null);

  const [keepText, setKeepText] = useState(String(DEFAULT_BACKUP.keep));
  const [limitTurns, setLimitTurns] = useState("0");
  const [limitUnattended, setLimitUnattended] = useState("0");
  const [limitsSaving, setLimitsSaving] = useState(false);
  const [limitsSaved, setLimitsSaved] = useState(false);
  const [limitsError, setLimitsError] = useState<string | null>(null);

  const [savedBackup, setSavedBackup] = useState<string | null>(null);
  const [savedLimits, setSavedLimits] = useState<string | null>(null);
  useUnsavedChanges(savedBackup !== null && savedBackup !== JSON.stringify([backupForm, keepText]) || savedLimits !== null && savedLimits !== JSON.stringify([limitTurns, limitUnattended]), backupSaving || limitsSaving);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getBackups(), api.getOps(), api.getSettings()]).then(
      ([bk, op, settings]: [BackupStatus, OpsStatus, { settings: DaemonSettings }]) => {
        if (cancelled) return;
        const b = settings.settings.backup ?? DEFAULT_BACKUP;
        const l = settings.settings.limits ?? DEFAULT_LIMITS;
        setBackups(bk);
        onBackupsChange?.(bk);
        setOps(op);
        setBackupForm(b);
        setKeepText(String(b.keep));
        setSavedBackup(JSON.stringify([b, String(b.keep)]));
        setSavedLimits(JSON.stringify([String(l.maxTurnsPerBotPerDay), String(l.maxUnattendedPerDay)]));
        setLimitTurns(String(l.maxTurnsPerBotPerDay));
        setLimitUnattended(String(l.maxUnattendedPerDay));
      },
      (err: unknown) => {
        if (!cancelled) setLoadError(messageOf(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, onBackupsChange]);

  async function refreshBackups() {
    try {
      const fresh = await api.getBackups();
      setBackups(fresh);
      onBackupsChange?.(fresh);
    } catch {
      /* keep the previous list; the run result is already shown */
    }
  }

  async function runNow() {
    setRunning(true);
    setRunError(null);
    setRunNotice(null);
    try {
      const res = await api.runBackup();
      setRunNotice(res.ok ? `Backup created${res.name ? `: ${res.name}` : ""}.` : (res.error ?? "Backup failed."));
    } catch (err) {
      setRunError(err instanceof ApiError && err.status === 403 ? OWNER_BACKUP : messageOf(err));
    } finally {
      setRunning(false);
      await refreshBackups();
    }
  }

  async function saveBackup(e: FormEvent) {
    e.preventDefault();
    setBackupSaving(true);
    setBackupSaved(false);
    setBackupSaveError(null);
    const keep = parseLimit(keepText);
    if (!TIME_RE.test(backupForm.time)) {
      setBackupSaveError("Time must be HH:MM (24-hour).");
      setBackupSaving(false);
      return;
    }
    if (keep === null || keep < 1 || keep > 60) {
      setBackupSaveError("Keep must be a whole number from 1 to 60.");
      setBackupSaving(false);
      return;
    }
    try {
      await api.putSetting("backup", { enabled: backupForm.enabled, time: backupForm.time, keep });
      setSavedBackup(JSON.stringify([backupForm, keepText]));
      setBackupSaved(true);
    } catch (err) {
      setBackupSaveError(err instanceof ApiError && err.status === 403 ? OWNER_SAVE : messageOf(err));
    } finally {
      setBackupSaving(false);
    }
  }

  async function saveLimits(e: FormEvent) {
    e.preventDefault();
    setLimitsSaving(true);
    setLimitsSaved(false);
    setLimitsError(null);
    const turns = parseLimit(limitTurns);
    const unattended = parseLimit(limitUnattended);
    if (turns === null || unattended === null) {
      setLimitsError(`Each limit must be a whole number from 0 to ${MAX_LIMIT}.`);
      setLimitsSaving(false);
      return;
    }
    try {
      await api.putSetting("limits", { maxTurnsPerBotPerDay: turns, maxUnattendedPerDay: unattended });
      setSavedLimits(JSON.stringify([limitTurns, limitUnattended]));
      setLimitsSaved(true);
    } catch (err) {
      setLimitsError(err instanceof ApiError && err.status === 403 ? OWNER_SAVE : messageOf(err));
    } finally {
      setLimitsSaving(false);
    }
  }

  if (loadError) return <Alert variant="destructive"><AlertDescription>Could not load operations: {loadError}</AlertDescription></Alert>;
  if (backups === null || ops === null) return <Skeleton className="h-48 w-full" aria-label="Loading operations" />;

  return <div className="flex min-w-0 flex-col gap-6">
    <SettingsSection icon="server" title="Backups" description="A verified copy of your database, kept on this server.">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1"><Badge variant={backups.enabled ? "secondary" : "outline"}>{backups.enabled ? "Scheduled" : "Off"}</Badge><p className="m-0 text-sm text-muted-foreground">{backupStatusLine(backups)}</p></div>
        <Button variant="outline" type="button" onClick={runNow} disabled={running}>{running ? "Backing up…" : "Back up now"}</Button>
      </div>
      {runNotice && <p role="status" className="m-0 text-sm">{runNotice}</p>}
      {runError && <Alert variant="destructive"><AlertDescription>{runError}</AlertDescription></Alert>}
      <Separator />
      <form noValidate onSubmit={saveBackup}><FieldGroup>
        <Field orientation="horizontal"><FieldContent><FieldLabel htmlFor="backup-enabled">Scheduled backups</FieldLabel><FieldDescription>Run once a day at the configured server time.</FieldDescription></FieldContent><Switch id="backup-enabled" checked={backupForm.enabled} disabled={backupSaving} onCheckedChange={enabled => { setBackupForm({ ...backupForm, enabled }); setBackupSaved(false); }} /></Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={!!backupSaveError}><FieldLabel htmlFor="backup-time">Daily time (server local)</FieldLabel><Input id="backup-time" type="time" value={backupForm.time} disabled={backupSaving} aria-invalid={!!backupSaveError} onChange={e => { setBackupForm({ ...backupForm, time: e.target.value }); setBackupSaved(false); }} /></Field>
          <Field data-invalid={!!backupSaveError}><FieldLabel htmlFor="backup-keep">Copies to keep</FieldLabel><Input id="backup-keep" type="number" min={1} max={60} value={keepText} disabled={backupSaving} aria-invalid={!!backupSaveError} onChange={e => { setKeepText(e.target.value); setBackupSaved(false); }} /><FieldDescription>Keep between 1 and 60 backups.</FieldDescription></Field>
        </div>
        <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={backupSaving}>{backupSaving ? "Saving…" : "Save backup settings"}</Button>{backupSaved && <span role="status">Saved.</span>}</div>
        {backupSaveError && <Alert variant="destructive"><AlertDescription>{backupSaveError}</AlertDescription></Alert>}
      </FieldGroup></form>
      <Collapsible><CollapsibleTrigger render={<Button variant="ghost" />}><ChevronDown data-icon="inline-start" />Backup files<Badge variant="secondary">{backups.backups.length}</Badge></CollapsibleTrigger><CollapsibleContent>
        <p className="text-sm text-muted-foreground break-all">{backups.dir}</p>
        <ul className="m-0 list-none divide-y divide-border p-0">{backups.backups.map(b => <li key={b.name} className="flex flex-wrap justify-between gap-2 py-3"><span className="break-all font-mono text-xs">{b.name}</span><span className="text-xs text-muted-foreground">{formatBytes(b.bytes)} · {formatTime(b.createdAt)}</span></li>)}</ul>
      </CollapsibleContent></Collapsible>
      <Alert><AlertDescription>Backups are not encrypted. {backups.mirror ? "An off-machine mirror folder is configured." : "An administrator can set OPENAG_BACKUP_DIR to keep an off-machine copy."} Database backups do not include memory files, skills or private credential files.</AlertDescription></Alert>
    </SettingsSection>
    <SettingsSection icon="bolt" title="Turn limits" description="Limit model turns per day. These limits do not measure spending.">
      <form noValidate onSubmit={saveLimits}><FieldGroup>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={!!limitsError}><FieldLabel htmlFor="limit-bot">Turns per bot</FieldLabel><Input id="limit-bot" type="number" min={0} max={MAX_LIMIT} value={limitTurns} aria-invalid={!!limitsError} disabled={limitsSaving} onChange={e => { setLimitTurns(e.target.value); setLimitsSaved(false); }} /><FieldDescription>0 means no limit.</FieldDescription></Field>
          <Field data-invalid={!!limitsError}><FieldLabel htmlFor="limit-unattended">Unattended turns</FieldLabel><Input id="limit-unattended" type="number" min={0} max={MAX_LIMIT} value={limitUnattended} aria-invalid={!!limitsError} disabled={limitsSaving} onChange={e => { setLimitUnattended(e.target.value); setLimitsSaved(false); }} /><FieldDescription>Total unattended turns per day. 0 means no limit.</FieldDescription></Field>
        </div>
        <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={limitsSaving}>{limitsSaving ? "Saving…" : "Save limits"}</Button>{limitsSaved && <span role="status">Saved.</span>}</div>
        {limitsError && <Alert variant="destructive"><AlertDescription>{limitsError}</AlertDescription></Alert>}
      </FieldGroup></form>
    </SettingsSection>
    <SettingsSection icon="server" title="Diagnostics" description="Liveness checks and this daemon process.">
      <dl className={KV}><dt className="text-muted-foreground">Liveness ping</dt><dd className="m-0">{ops.healthcheck.configured ? "Configured" : "Not configured"}</dd><dt className="text-muted-foreground">Last successful ping</dt><dd className="m-0">{formatTime(ops.healthcheck.lastOkAt)}</dd><dt className="text-muted-foreground">Last ping error</dt><dd className="m-0 break-words">{ops.healthcheck.lastError ?? "None"}</dd><dt className="text-muted-foreground">Started</dt><dd className="m-0">{formatTime(ops.startedAt)}</dd><dt className="text-muted-foreground">Log rotations</dt><dd className="m-0">{ops.logs.rotated} · last {formatTime(ops.logs.lastRotatedAt)}</dd></dl>
    </SettingsSection>
  </div>;
}
