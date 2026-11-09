import { hrefFor, replaceRoute, type Route, type AutomationTab } from "../route";
import { useUnsavedChanges } from "../unsaved-changes";
import { Alert, AlertDescription } from "./ui/alert";
import { SettingsHeader } from "./SettingsLayout";
import { MoreHorizontal, Plus, RefreshCw } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { Skeleton } from "./ui/skeleton";
import { Checkbox } from "./ui/checkbox";
import {ResponsibilitiesPanel} from "./ResponsibilitiesPanel";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "./ui/sheet";
import { Field, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "./ui/field";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { SelectField, SelectItem } from "./ui/select";
import {useStream} from "../stream";
import {AutomationsTable} from "./AutomationsTable";
import {AutomationHistory} from "./AutomationHistory";
import {Button} from "./ui/button";
import {Switch} from "./ui/switch";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { messageOf, type Api } from "../api";
import type { Automation, AutomationInput, SchedulePreview, BotInfo, Room, TriggerKind, Verdict } from "../types";

const CUSTOM = "custom";
const PRESETS = [
  { label: "Every day at 09:00", cron: "0 9 * * *" },
  { label: "Every weekday at 09:00", cron: "0 9 * * 1-5" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
];

const KIND_LABEL: Record<TriggerKind, string> = {
  cron: "Schedule",
  webhook: "Webhook",
  github: "GitHub",
  slack: "Slack",
  github_poll: "GitHub poll",
};

/** Trigger picker entries, in display order. */
const TRIGGER_OPTIONS: { kind: TriggerKind; label: string }[] = [
  { kind: "cron", label: KIND_LABEL.cron },
  { kind: "webhook", label: KIND_LABEL.webhook },
  { kind: "github", label: KIND_LABEL.github },
  { kind: "github_poll", label: "GitHub (polling, no tunnel)" },
  { kind: "slack", label: KIND_LABEL.slack },
];

const SECRET_MIN = 8;
const SECRET_MAX = 256;

const TOKEN_MIN = 12;
const TOKEN_MAX = 255;
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const POLL_INTERVALS: { minutes: number; label: string }[] = [
  { minutes: 5, label: "Every 5 minutes" },
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 30, label: "Every 30 minutes" },
  { minutes: 60, label: "Every hour" },
  { minutes: 360, label: "Every 6 hours" },
  { minutes: 1440, label: "Every day" },
];
const POLL_DEFAULT_EVENTS = ["issues", "issue_comment", "pull_request"];
const GITHUB_POLL_EVENTS = [
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "push",
  "release",
  "create",
  "delete",
  "fork",
  "watch",
  "discussion",
  "commit_comment",
];

interface Form {
  id: string | null;
  name: string;
  triggerKind: TriggerKind;
  /** A preset cron, or CUSTOM to use customCron. */
  preset: string;
  customCron: string;
  tz: string | null;
  /** Cron only: "room" posts in a room, "wake" is a watcher. */
  outputMode: "room" | "wake";
  botId: string;
  roomId: string;
  prompt: string;
  hookSlug: string;
  hookEvents: string;
  /** Typed by the user, never prefilled. Cleared on submit. */
  secret: string;
  /** github_poll: "owner/name". */
  pollRepo: string;
  pollEvery: number;
  pollEvents: string[];
  /** github_poll: typed by the user, never prefilled. Cleared on submit. */
  pollToken: string;
  allowTools: boolean;
  allowApprovals: boolean;
  enabled: boolean;
}

/** The one-time secret box. Lives only in component state until dismissed. */
interface ShownSecret {
  name: string;
  url: string;
  secret: string;
}

function relativeTime(ts: number, now = Date.now()): string {
  const min = Math.round((now - ts) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function statusLabel(status: string | null): string {
  if (status === null) return "Never run";
  if (status === "ok") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "incomplete") return "Incomplete";
  if (status === "cancelled") return "Cancelled";
  if (status.startsWith("skipped")) return "Skipped: busy";
  return "Error";
}

function parseEvents(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Hook kinds take a slug, events and a signing secret. The poll kind is handled on its own. */
function isHookKind(kind: TriggerKind): boolean {
  return kind !== "cron" && kind !== "github_poll";
}

function needsSigningSecret(kind: TriggerKind): boolean {
  return kind === "github" || kind === "slack";
}

function secretLengthOk(secret: string): boolean {
  return secret.length >= SECRET_MIN && secret.length <= SECRET_MAX;
}

function tokenOk(token: string): boolean {
  return token.length >= TOKEN_MIN && token.length <= TOKEN_MAX && !/\s/.test(token);
}

/** First validation error for a github_poll form, or null. `token` is "" when left blank. */
function pollFormError(repo: string, events: string[], token: string, creating: boolean): string | null {
  if (!REPO_RE.test(repo) || repo.split("/").some((part) => part === "..")) {
    return "Enter the repository as owner/name.";
  }
  if (events.length === 0) return "Choose at least one event.";
  if ((creating || token !== "") && !tokenOk(token)) {
    return `The token must be ${TOKEN_MIN} to ${TOKEN_MAX} characters with no spaces.`;
  }
  return null;
}

function fullHookUrl(slug: string): string {
  return `${window.location.origin}/hooks/${slug}`;
}

export function AutomationsPanel({ api, route }: { api: Api; route?: Extract<Route, {kind: "automations"}> }) {
  const {subscribe}=useStream();
  const tab = route?.tab ?? "automations", historyFor = route?.automationId;
  const selectTab = (tab: AutomationTab, automationId?: string, runId?: string) => { window.location.hash = hrefFor({kind: "automations", tab, automationId, runId}); };
  const editKey = useRef<string | undefined>(undefined);
  const editorAction = useRef<string | undefined>(undefined);
  const newButton = useRef<HTMLButtonElement>(null);
  const [closeAfterSave, setCloseAfterSave] = useState(false);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [bots, setBots] = useState<BotInfo[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading,setLoading]=useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const scheduleKey = form?.triggerKind === "cron" ? JSON.stringify({scheduleCron: form.preset === CUSTOM ? form.customCron.trim() : form.preset, tz: form.tz, outputMode: form.outputMode, enabled: form.enabled}) : null;
  const [preview, setPreview] = useState<{key: string; value?: SchedulePreview; error?: string} | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  useEffect(() => {
    if (!scheduleKey) { setPreview(null); return; }
    const controller = new AbortController(); let active = true;
    setPreview({key: scheduleKey});
    const timer = setTimeout(() => { void api.previewAutomationSchedule(JSON.parse(scheduleKey), controller.signal).then(value => { if (active) setPreview({key: scheduleKey, value}); }, err => { if (active) setPreview({key: scheduleKey, error: messageOf(err)}); }); }, 250);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [api, scheduleKey, previewRevision]);
  const currentPreview = preview?.key === scheduleKey ? preview : null;
  useEffect(() => {
    const value = currentPreview?.value;
    if (!value?.nextScheduledAt) return;
    const timer = setTimeout(() => setPreviewRevision(revision => revision + 1), Math.max(1, Math.min(2147000000, value.nextScheduledAt - value.evaluatedAt)));
    return () => clearTimeout(timer);
  }, [currentPreview?.value]);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useUnsavedChanges(form !== null, saving);
  const submitting = useRef(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [confirmingRotate, setConfirmingRotate] = useState<string | null>(null);
  const [shown, setShown] = useState<ShownSecret | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const uid = useId();
  const loadVersion=useRef(0);

  const load = useCallback(async () => {
    const version=++loadVersion.current;
    setLoading(true);
    try {
      const [{ automations: list }, { bots: botList }, { rooms: roomList }] = await Promise.all([
        api.listAutomations(),
        api.listBots(),
        api.listRooms(),
      ]);
      if(version!==loadVersion.current)return;
      setAutomations(list);
      setBots(botList);
      setRooms(roomList.filter((r) => !r.id.startsWith("_")));
      setLoadError(null);
    } catch (err) {
      if(version===loadVersion.current)setLoadError(messageOf(err));
    } finally {if(version===loadVersion.current)setLoading(false);}
  }, [api]);

  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    const schedule=()=>{if(timer===undefined)timer=setTimeout(()=>{timer=undefined;void load();},300);};
    void load();const off=subscribe({onOpen:schedule,onEvent:event=>{if(event.type==='automation_updated'||event.type==='config')schedule();}});
    return()=>{clearTimeout(timer);loadVersion.current++;off();};
  },[load,subscribe]);

  useEffect(()=>{
    const deadlines=automations.map(a=>a.runtime?.recheckAfterMs).filter((ms):ms is number=>typeof ms==='number'&&ms>0);
    if(!deadlines.length)return;
    const timer=setTimeout(()=>void load(),Math.min(2147000000,Math.min(...deadlines)+50));
    return()=>clearTimeout(timer);
  },[automations,load]);

  const botName = (id: string) => bots.find((b) => b.id === id)?.name ?? id;
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? id;

  function openNew() {
    editorAction.current = undefined;
    setFormError(null);
    setForm({
      id: null,
      name: "",
      triggerKind: "cron",
      preset: PRESETS[0]!.cron,
      customCron: "",
      tz: null,
      outputMode: "room",
      botId: bots[0]?.id ?? "",
      roomId: rooms[0]?.id ?? "",
      prompt: "",
      hookSlug: "",
      hookEvents: "",
      secret: "",
      pollRepo: "",
      pollEvery: 15,
      pollEvents: POLL_DEFAULT_EVENTS,
      pollToken: "",
      allowTools: false,
      allowApprovals: false,
      enabled: true,
    });
  }

  function openEdit(a: Automation) {
    editorAction.current = a.id;
    setFormError(null);
    const isPreset = a.scheduleCron !== null && PRESETS.some((p) => p.cron === a.scheduleCron);
    setForm({
      id: a.id,
      name: a.name,
      triggerKind: a.triggerKind,
      preset: isPreset ? a.scheduleCron! : CUSTOM,
      customCron: a.scheduleCron ?? "",
      tz: a.tz,
      outputMode: a.outputMode,
      botId: a.botId,
      roomId: a.roomId ?? "",
      prompt: a.prompt,
      hookSlug: a.hookSlug ?? "",
      hookEvents: a.hookEvents.join(", "),
      secret: "",
      pollRepo: a.pollRepo ?? "",
      pollEvery: a.pollEveryMinutes ?? 15,
      pollEvents: a.hookEvents,
      pollToken: "",
      allowTools: a.allowTools,
      allowApprovals: a.allowApprovals,
      enabled: a.enabled,
    });
  }

  useEffect(() => {
    const next = route?.editId;
    if (next !== editKey.current) { setForm(null); editKey.current = undefined; }
    if (!next || next === editKey.current || loading || loadError) return;
    editKey.current = next;
    const automation = automations.find(item => item.id === next);
    if (automation) openEdit(automation);
  }, [route?.editId, loading, loadError, automations]);
  useEffect(() => { if (closeAfterSave && !saving) { setCloseAfterSave(false); if (route?.editId) void replaceRoute(hrefFor({kind: "automations"})); } }, [closeAfterSave, saving, route?.editId]);
  function closeEditor() { if (route?.editId) window.location.hash = hrefFor({kind: "automations"}); else setForm(null); }

  /** Sends the request and shows the outcome. Shared by every trigger kind. */
  async function submit(id: string | null, input: AutomationInput) {
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setFormError(null);
    try {
      if (id === null) {
        const res = await api.createAutomation(input);
        if (res.secret !== undefined && res.automation.hookSlug !== null) {
          setShown({ name: res.automation.name, url: fullHookUrl(res.automation.hookSlug), secret: res.secret });
        }
        setNotice("Automation created.");
      } else {
        await api.updateAutomation(id, input);
        setNotice("Automation saved.");
      }
      setForm(null); setCloseAfterSave(true);
      await load();
    } catch (err) {
      setFormError(messageOf(err));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  async function save() {
    if (!form || submitting.current) return;
    if (form.triggerKind === "cron" && !currentPreview?.value) { setFormError("Check the schedule preview before saving."); return; }
    // The typed secret and token never outlive the submit, whatever the outcome.
    const secret = form.secret;
    const token = form.pollToken;
    setForm({ ...form, secret: "", pollToken: "" });

    if (form.triggerKind === "github_poll") {
      const repo = form.pollRepo.trim();
      const err = pollFormError(repo, form.pollEvents, token, form.id === null);
      if (err) {
        setFormError(err);
        return;
      }
      const shared = {
        name: form.name,
        botId: form.botId,
        prompt: form.prompt,
        pollRepo: repo,
        pollEveryMinutes: form.pollEvery,
        hookEvents: form.pollEvents,
        allowTools: false,
      };
      const input: AutomationInput =
        form.id === null
          ? { ...shared, triggerKind: "github_poll", pollToken: token }
          : { ...shared, enabled: form.enabled, ...(token !== "" ? { pollToken: token } : {}) };
      await submit(form.id, input);
      return;
    }

    const hook = isHookKind(form.triggerKind);
    const events = parseEvents(form.hookEvents);
    if (hook && needsSigningSecret(form.triggerKind)) {
      if (events.length === 0) {
        setFormError("Enter at least one event.");
        return;
      }
      if (form.id === null && !secretLengthOk(secret)) {
        setFormError(`The signing secret must be ${SECRET_MIN} to ${SECRET_MAX} characters.`);
        return;
      }
      if (form.id !== null && secret !== "" && !secretLengthOk(secret)) {
        setFormError(`The signing secret must be ${SECRET_MIN} to ${SECRET_MAX} characters.`);
        return;
      }
    }

    const base = {
      name: form.name,
      botId: form.botId,
      prompt: form.prompt,
      enabled: form.enabled,
    };
    let input: AutomationInput;
    if (form.triggerKind === "cron") {
      input = {
        ...base,
        tz: form.tz,
        scheduleCron: form.preset === CUSTOM ? form.customCron.trim() : form.preset,
        roomId: form.outputMode === "room" ? form.roomId : null,
        allowApprovals: form.allowApprovals,
        outputMode: form.outputMode,
      };
      if (form.id === null) input.triggerKind = "cron";
    } else {
      // Hook kinds always route through the wake filter and never post to a room.
      input = {
        ...base,
        allowApprovals: false,
        outputMode: "wake",
        allowTools: form.allowTools,
        ...(needsSigningSecret(form.triggerKind) ? { hookEvents: events } : {}),
      };
      if (form.id === null) {
        input.triggerKind = form.triggerKind;
        if (form.hookSlug.trim() !== "") input.hookSlug = form.hookSlug.trim();
        if (needsSigningSecret(form.triggerKind)) input.secret = secret;
      } else if (needsSigningSecret(form.triggerKind) && secret !== "") {
        input.secret = secret;
      }
    }

    await submit(form.id, input);
  }

  async function toggle(a: Automation, enabled: boolean) {
    setRowError(null);
    try {
      const { automation } = await api.updateAutomation(a.id, { enabled });
      setAutomations((list) => list.map((x) => (x.id === a.id ? automation : x)));
    } catch (err) {
      setRowError(messageOf(err));
    }
  }

  async function runNow(a: Automation) {
    setRowError(null);
    try {
      const result=await api.runAutomation(a.id);
      setNotice(result.started?`Started "${a.name}". See its run history for the recorded outcome.`:`Not started: ${result.reason??'unavailable'}`);
      await load();
    } catch (err) {
      setRowError(messageOf(err));
    }
  }

  async function remove(a: Automation) {
    setRowError(null);
    setConfirming(null);
    try {
      await api.deleteAutomation(a.id);
      setAutomations((list) => list.filter((x) => x.id !== a.id));
      setNotice(`Deleted "${a.name}".`);
    } catch (err) {
      setRowError(messageOf(err));
    }
  }

  async function rotate(a: Automation) {
    setRowError(null);
    setConfirmingRotate(null);
    try {
      const { secret } = await api.rotateAutomationSecret(a.id);
      if (a.hookSlug !== null) setShown({ name: a.name, url: fullHookUrl(a.hookSlug), secret });
      setAutomations((list) => list.map((x) => (x.id === a.id ? { ...x, hasSecret: true } : x)));
    } catch (err) {
      setRowError(messageOf(err));
    }
  }

  async function copySecret() {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown.secret);
      setNotice("Secret copied.");
    } catch {
      setRowError("Could not copy the secret. Select it and copy it by hand.");
    }
  }

  function dismissSecret() {
    setShown(null);
  }

  function toggleEvent(name: string, checked: boolean) {
    if (!form) return;
    const next = GITHUB_POLL_EVENTS.filter((n) => (n === name ? checked : form.pollEvents.includes(n)));
    setForm({ ...form, pollEvents: next });
  }

  const field = (name: string) => `${uid}-${name}`;
  const hookSubmitLabel = (kind: TriggerKind) => (kind === "webhook" ? "Create webhook" : `Create ${KIND_LABEL[kind]} automation`);

  const toolsToggle = (form: Form) => (
    <>
      <Field orientation="horizontal"><Checkbox id={field("allowTools")}
          checked={form.allowTools}
          aria-describedby={field("tools-note")}
          onCheckedChange={checked => setForm({ ...form, allowTools: checked })}
        /><FieldLabel htmlFor={field("allowTools")}> Allow read-only, offline tools (riskier: the event text is untrusted)</FieldLabel></Field>
      <p id={field("tools-note")} className="text-muted-foreground">
        Off by default. The event text comes from outside, so turning this on lets it steer read-only tools. Search, browsing and writes stay blocked.
      </p>
    </>
  );

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <SettingsHeader id="automations-title" title="Automations" description="Manage scheduled tasks, event triggers and standing responsibilities." action={<Button ref={newButton} type="button" onClick={openNew} disabled={loading || !!loadError || bots.length === 0 || !!form || !!route?.editId}><Plus data-icon="inline-start" />New automation</Button>} />

      {loadError && (
        <Alert variant="destructive"><AlertDescription>Could not load automations: {loadError}</AlertDescription></Alert>
      )}
      {rowError && (
        <Alert variant="destructive"><AlertDescription>{rowError}</AlertDescription></Alert>
      )}
      {notice && (
        <p className="mt-0 mb-2 text-[var(--warn)] [overflow-wrap:anywhere]" role="status">
          {notice}
        </p>
      )}

      {shown && (
        <Alert aria-label="Webhook secret"><AlertDescription className="flex min-w-0 flex-col gap-3">
          <h3 className="m-0">Secret for {shown.name}</h3>
          <p className="mt-0 mb-2 text-[var(--warn)] [overflow-wrap:anywhere]">Shown once. It cannot be retrieved later.</p>
          <p>
            Call: <code>{shown.url}</code>
          </p>
          <p className="text-muted-foreground">
            This address is your LAN/Tailscale one. For GitHub or Slack, use your tunnel hostname instead (same /hooks/... path); see docs/cloudflare-tunnel.md. Send the secret in the X-OpenAg-Secret header.
          </p>
          <code className="block text-[13px] select-all [overflow-wrap:anywhere]">{shown.secret}</code>
          <div>
            <Button variant="outline" type="button" onClick={() => void copySecret()}>
              Copy
            </Button>{" "}
            <Button type="button" onClick={dismissSecret}>
              I have saved it
            </Button>
          </div>
        </AlertDescription></Alert>
      )}

      {route?.editId && !loading && !loadError && !automations.some(item => item.id === route.editId) && <Alert><AlertDescription>Automation not found. <Button variant="outline" nativeButton={false} render={<a href={hrefFor({kind: "automations"})} />}>Return to automations</Button></AlertDescription></Alert>}
      <Tabs value={tab} onValueChange={value => selectTab(value as AutomationTab)}>
        <TabsList variant="line" aria-label="Automation views"><TabsTrigger value="automations">Automations</TabsTrigger><TabsTrigger value="responsibilities">Responsibilities</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>
        <TabsContent value="automations">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="m-0 text-sm text-muted-foreground">{automations.length} automations · {automations.filter(a => a.enabled).length} enabled</p><Button variant="ghost" disabled={loading} onClick={() => void load()}><RefreshCw data-icon="inline-start" />{loading ? "Refreshing…" : "Refresh"}</Button></div>
            {loading && automations.length === 0 ? <Skeleton className="h-40 w-full" aria-label="Loading automations" /> : automations.length === 0 && !loadError ? <Empty><EmptyHeader><EmptyTitle>No automations yet</EmptyTitle><EmptyDescription>{bots.length ? "Choose an agent, a trigger and the task it should perform." : "Create an agent before adding an automation."}</EmptyDescription></EmptyHeader><EmptyContent><Button onClick={openNew} disabled={loading || bots.length === 0}>Create your first automation</Button></EmptyContent></Empty> : <AutomationsTable rows={automations} bots={bots} rooms={rooms} actions={a => <div className="flex items-center justify-end gap-3">
              <Switch checked={a.enabled} aria-label={`Enabled: ${a.name}`} onCheckedChange={enabled => void toggle(a, enabled)} />
              <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon" />} id={`automation-actions-${a.id}`} aria-label={`Actions for ${a.name}`}><MoreHorizontal /></DropdownMenuTrigger>
                <DropdownMenuContent align="end"><DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => { window.location.hash = hrefFor({kind: "automations", editId: a.id}); }}>Edit</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => selectTab("history", a.id)}>History</DropdownMenuItem>
                  <DropdownMenuItem disabled={!a.enabled || !!a.runtime?.reason} onClick={() => void runNow(a)}>Run now</DropdownMenuItem>
                  {a.triggerKind === "webhook" && <DropdownMenuItem onClick={() => setConfirmingRotate(a.id)}>Rotate secret…</DropdownMenuItem>}
                </DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem variant="destructive" onClick={() => setConfirming(a.id)}>Delete…</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent>
              </DropdownMenu>
            </div>} />}
            <p className="m-0 text-xs text-muted-foreground">Each run uses one model turn. Schedules must be at least 5 minutes apart.</p>
          </div>
        </TabsContent>
        <TabsContent value="responsibilities" keepMounted><ResponsibilitiesPanel api={api} /></TabsContent>
        <TabsContent value="history"><AutomationHistory api={api} automationId={historyFor} runId={route?.runId} onSelectRun={id => selectTab("history", historyFor, id)} onAll={() => selectTab("history")} /></TabsContent>
      </Tabs>
      <Dialog open={confirming !== null || confirmingRotate !== null} onOpenChange={open => { if (!open) { setConfirming(null); setConfirmingRotate(null); } }}>
        <DialogContent><DialogHeader><DialogTitle>{confirming ? "Delete automation?" : "Rotate webhook secret?"}</DialogTitle><DialogDescription>{confirming ? "This removes the automation. Its recorded run history remains available." : "The old secret will stop working. Update the sender with the replacement before its next delivery."}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => { setConfirming(null); setConfirmingRotate(null); }}>Cancel</Button><Button variant={confirming ? "destructive" : "default"} onClick={() => { const a = automations.find(a => a.id === (confirming ?? confirmingRotate)); if (a) void (confirming ? remove(a) : rotate(a)); }}>{confirming ? "Delete automation" : "Rotate secret"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Sheet open={form !== null} disablePointerDismissal onOpenChange={(_next, event) => event.cancel()}>
        <SheetContent finalFocus={() => editorAction.current ? document.getElementById(`automation-actions-${editorAction.current}`) ?? newButton.current : newButton.current} className="overflow-y-auto" showCloseButton={false}>
          <SheetHeader><SheetTitle>{form?.id === null ? "New automation" : "Edit automation"}</SheetTitle><SheetDescription>Choose when this runs and what the agent should do.</SheetDescription></SheetHeader>
        {form && <form
          className="grid min-w-0 gap-2 px-5 pb-6"
          aria-label={form.id === null ? "New automation" : "Edit automation"}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={saving} className="min-w-0 border-0 p-0"><FieldGroup>

          {form.id === null ? (
            <>
              <Field><FieldLabel htmlFor={field("trigger")}>Trigger</FieldLabel>
<SelectField className="w-full"
                id={field("trigger")}
                value={form.triggerKind}
                onValueChange={(value) => setForm({ ...form, triggerKind: value as TriggerKind, secret: "", pollToken: "" })}
              >
                {TRIGGER_OPTIONS.map((o) => (
                  <SelectItem key={o.kind} value={o.kind}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectField></Field>
            </>
          ) : (
            <p className="text-muted-foreground">Trigger: {KIND_LABEL[form.triggerKind]} (cannot be changed)</p>
          )}

          <Field><FieldLabel htmlFor={field("name")}>Name</FieldLabel>
<Input id={field("name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>

          {form.triggerKind === "cron" && (
            <>
              <Field><FieldLabel htmlFor={field("schedule")}>Schedule</FieldLabel>
<SelectField className="w-full"
                id={field("schedule")}
                value={form.preset}
                onValueChange={(value) => setForm({ ...form, preset: value })}
              >
                {PRESETS.map((p) => (
                  <SelectItem key={p.cron} value={p.cron}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM}>Custom</SelectItem>
              </SelectField></Field>
              {form.preset === CUSTOM && (
                <>
                  <Field><FieldLabel htmlFor={field("cron")}>Cron expression</FieldLabel>
<Input
                    id={field("cron")}
                    value={form.customCron}
                    placeholder="minute hour day month weekday"
                    onChange={(e) => setForm({ ...form, customCron: e.target.value })}
                  /></Field>
                </>
              )}

              <section aria-label="Schedule preview" className="flex flex-col gap-2 text-sm">
                {!currentPreview?.value && !currentPreview?.error && <p role="status">Checking schedule…</p>}
                {currentPreview?.value && <><p>Time zone: <strong>{currentPreview.value.timezone}</strong>{form.tz === null ? " (server default)" : ""}</p><p role="status">{currentPreview.value.nextScheduledAt === null ? "Paused — no scheduled run." : "Next scheduled time: " + new Date(currentPreview.value.nextScheduledAt).toLocaleString(undefined, {timeZone: currentPreview.value.timezone, timeZoneName: "short"})}</p></>}
                {currentPreview?.error && <Alert variant="destructive"><AlertDescription>{currentPreview.error}</AlertDescription></Alert>}
                <Button type="button" variant="outline" disabled={saving} onClick={() => setPreviewRevision(value => value + 1)}>Refresh schedule preview</Button>
              </section>

              <Field><FieldLabel htmlFor={field("output")}>Output</FieldLabel>
<SelectField className="w-full"
                id={field("output")}
                value={form.outputMode}
                aria-describedby={field("output-note")}
                onValueChange={(value) => setForm({ ...form, outputMode: value as "room" | "wake" })}
              >
                <SelectItem value="room">Post in the room</SelectItem>
                <SelectItem value="wake">Notify when needed</SelectItem>
              </SelectField></Field>
              <p id={field("output-note")} className="text-muted-foreground">
                {form.outputMode === "wake" ? "Checks at most every 15 minutes. Results pass through your notification rules." : "The agent’s reply appears in the selected room."}
              </p>
            </>
          )}

          <Field><FieldLabel htmlFor={field("bot")}>Agent</FieldLabel>
<SelectField className="w-full" id={field("bot")} value={form.botId} onValueChange={(value) => setForm({ ...form, botId: value })}>
            {bots.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectField></Field>

          {form.triggerKind === "cron" && form.outputMode === "room" && (
            <>
              <Field><FieldLabel htmlFor={field("room")}>Room</FieldLabel>
<SelectField className="w-full" id={field("room")} value={form.roomId} onValueChange={(value) => setForm({ ...form, roomId: value })}>
                {rooms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectField></Field>
            </>
          )}

          <Field><FieldLabel htmlFor={field("prompt")}>Prompt</FieldLabel>
<Textarea id={field("prompt")} rows={4} value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} /></Field>

          {isHookKind(form.triggerKind) && (
            <>
              {form.id === null && (
                <>
                  <Field><FieldLabel htmlFor={field("slug")}>Slug (optional)</FieldLabel>
<Input
                    id={field("slug")}
                    value={form.hookSlug}
                    placeholder="leave empty to generate one"
                    onChange={(e) => setForm({ ...form, hookSlug: e.target.value })}
                  /></Field>
                </>
              )}

              {needsSigningSecret(form.triggerKind) && (
                <>
                  <Field><FieldLabel htmlFor={field("events")}>Events</FieldLabel>
<Input
                    id={field("events")}
                    value={form.hookEvents}
                    aria-describedby={field("events-hint")}
                    placeholder={form.triggerKind === "github" ? "issues, pull_request, push" : "app_mention"}
                    onChange={(e) => setForm({ ...form, hookEvents: e.target.value })}
                  /></Field>
                  <p id={field("events-hint")} className="text-muted-foreground">
                    Comma separated. Examples: {form.triggerKind === "github" ? "issues, pull_request, push" : "app_mention"}
                  </p>

                  <Field><FieldLabel htmlFor={field("secret")}>Signing secret{form.id !== null ? " (leave empty to keep)" : ""}</FieldLabel>
<Input
                    id={field("secret")}
                    type="password"
                    autoComplete="new-password"
                    value={form.secret}
                    aria-describedby={field("secret-hint")}
                    onChange={(e) => setForm({ ...form, secret: e.target.value })}
                  /></Field>
                  <p id={field("secret-hint")} className="text-muted-foreground">
                    {SECRET_MIN} to {SECRET_MAX} characters, copied from {form.triggerKind === "github" ? "GitHub" : "Slack"}.
                    It is stored by the daemon and never shown again.
                  </p>
                </>
              )}

              {toolsToggle(form)}
            </>
          )}

          {form.triggerKind === "github_poll" && (
            <>
              <Field><FieldLabel htmlFor={field("repo")}>Repository</FieldLabel>
<Input
                id={field("repo")}
                value={form.pollRepo}
                placeholder="owner/name"
                autoComplete="off"
                onChange={(e) => setForm({ ...form, pollRepo: e.target.value })}
              /></Field>

              <FieldSet><FieldLegend variant="label">Events</FieldLegend>
                {GITHUB_POLL_EVENTS.map((name) => (
                  <Field key={name} orientation="horizontal">
                    <Checkbox id={field("event-" + name)}
                      checked={form.pollEvents.includes(name)}
                      onCheckedChange={checked => toggleEvent(name, checked)}
                    />{" "}
                    <FieldLabel htmlFor={field("event-" + name)}>{name}</FieldLabel>
                  </Field>
                ))}
              </FieldSet>

              <Field><FieldLabel htmlFor={field("interval")}>Check every</FieldLabel>
<SelectField className="w-full"
                id={field("interval")}
                value={String(form.pollEvery)}
                onValueChange={(value) => setForm({ ...form, pollEvery: Number(value) })}
              >
                {POLL_INTERVALS.map((i) => (
                  <SelectItem key={i.minutes} value={String(i.minutes)}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectField></Field>

              <Field><FieldLabel htmlFor={field("token")}>GitHub token{form.id !== null ? " (leave blank to keep the stored token)" : ""}</FieldLabel>
<Input
                id={field("token")}
                type="password"
                autoComplete="off"
                value={form.pollToken}
                aria-describedby={field("token-hint")}
                onChange={(e) => setForm({ ...form, pollToken: e.target.value })}
              /></Field>
              <p id={field("token-hint")} className="text-muted-foreground">
                Use a read-only token that can read this repository only. Stored on this machine, never shown again. OpenAg
                only talks to api.github.com, and GitHub events can be delayed by several minutes.
              </p>

              <p className="text-muted-foreground">Poll runs never get tools: the token stays on this machine and issue text is untrusted.</p>
            </>
          )}

          {form.triggerKind === "cron" && (
            <>
              <Field orientation="horizontal"><Checkbox id={field("allowApprovals")}
                  checked={form.allowApprovals}
                  aria-describedby={field("approvals-note")}
                  onCheckedChange={checked => setForm({ ...form, allowApprovals: checked })}
                /><FieldLabel htmlFor={field("allowApprovals")}> Allow this automation to ask for approvals</FieldLabel></Field>
              <p id={field("approvals-note")} className="text-muted-foreground">
                Off: the automation can only read and search and never asks you for anything. On: it can raise approvals in your
                Inbox.
              </p>
            </>
          )}

          <Field orientation="horizontal"><Checkbox id={field("enabled")}
              checked={form.enabled}
              onCheckedChange={checked => setForm({ ...form, enabled: checked })}
            /><FieldLabel htmlFor={field("enabled")}> Enabled</FieldLabel></Field>

          {formError && (
            <p className="mt-1.5 text-[var(--warn)]" role="alert">
              {formError}
            </p>
          )}
          <Button type="submit" disabled={saving || (form.triggerKind === "cron" && !currentPreview?.value)}>
            {form.id !== null
              ? "Save automation"
              : form.triggerKind === "github_poll"
                ? "Create GitHub poll automation"
                : isHookKind(form.triggerKind)
                  ? hookSubmitLabel(form.triggerKind)
                  : "Create automation"}
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={closeEditor}>
            Cancel
          </Button>
          </FieldGroup></fieldset>
        </form>}
        </SheetContent>
      </Sheet>
    </div>
  );
}
