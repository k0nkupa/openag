import { Alert, AlertDescription } from "./ui/alert";
import { useUnsavedChanges } from "../unsaved-changes";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Badge } from "./ui/badge";
import { Disclosure } from "./Disclosure";
import { Separator } from "./ui/separator";
import { Switch } from "./ui/switch";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, messageOf, type Api } from "../api";
import type { SlackSettings, SlackStatus } from "../types";

const OWNER_ONLY = "Only a Full access device can change Slack settings";
const EMPTY: SlackSettings = { enabled: false, roomId: null, channelId: null, allowedUsers: [] };

/** Splits on commas and newlines, trims, drops blanks, and keeps the first occurrence of each id. */
export function parseUserIds(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const id = raw.trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Blank text becomes null so the daemon treats the field as unset. */
const orNull = (text: string) => (text.trim() === "" ? null : text.trim());

export function SlackPanel({ api }: { api: Api }) {
  const [status, setStatus] = useState<SlackStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(EMPTY.enabled);
  const [roomId, setRoomId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [users, setUsers] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [savedForm, setSavedForm] = useState<string | null>(null);
  useUnsavedChanges(savedForm !== null && savedForm !== JSON.stringify([enabled, roomId, channelId, users]), saving);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getSlackStatus(), api.getSettings()]).then(
      ([st, settings]) => {
        if (cancelled) return;
        const current = settings.settings.slack ?? EMPTY;
        setStatus(st);
        setEnabled(current.enabled);
        setRoomId(current.roomId ?? "");
        setChannelId(current.channelId ?? "");
        setUsers(current.allowedUsers.join("\n"));
        setSavedForm(JSON.stringify([current.enabled, current.roomId ?? "", current.channelId ?? "", current.allowedUsers.join("\n")]));
      },
      (err: unknown) => {
        if (!cancelled) setLoadError(messageOf(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await api.putSlack({
        enabled,
        roomId: orNull(roomId),
        channelId: orNull(channelId),
        allowedUsers: parseUserIds(users),
      });
      setSavedForm(JSON.stringify([enabled, roomId, channelId, users]));
      setSaved(true);
      try {
        setStatus(await api.getSlackStatus());
      } catch {
        /* keep the previous status; the save itself succeeded */
      }
    } catch (err) {
      setSaveError(err instanceof ApiError && err.status === 403 ? OWNER_ONLY : messageOf(err));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <Alert variant="destructive" className="mt-1.5 min-h-0 text-destructive"><AlertDescription>
        Could not load Slack: {loadError}
      </AlertDescription></Alert>
    );
  }
  if (status === null) return <p className="text-muted-foreground">Checking...</p>;

  const connection = status.connected ? { label: "Connected", variant: "success" as const }
    : status.inert !== null ? { label: "Needs setup", variant: "attention" as const }
    : status.enabled ? { label: "Not connected", variant: "attention" as const }
    : { label: "Off", variant: "secondary" as const };

  return <div className="@container/slack flex min-w-0 flex-col gap-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium">Connection</span>
        <p className="m-0 text-sm text-muted-foreground">{status.inert ?? "Messages and replies stay in the selected Slack channel."}</p>
      </div>
      <Badge variant={connection.variant}>{connection.label}</Badge>
    </div>
    {status.lastError && <Alert variant="destructive"><AlertDescription>{status.lastError}</AlertDescription></Alert>}
    <form onSubmit={save} className="flex flex-col gap-6">
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent><FieldLabel htmlFor="slack-enabled">Enable Slack</FieldLabel><FieldDescription>Let the people you allow message your agents.</FieldDescription></FieldContent>
          <Switch id="slack-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </Field>
        <Separator />
        <div className="grid min-w-0 gap-5 @min-[560px]/slack:grid-cols-2">
          <Field><FieldLabel htmlFor="slack-room">Room id</FieldLabel><Input id="slack-room" placeholder="main" value={roomId} onChange={e => setRoomId(e.target.value)} /><FieldDescription>The OpenAg room that receives messages.</FieldDescription></Field>
          <Field><FieldLabel htmlFor="slack-channel">Channel id</FieldLabel><Input id="slack-channel" placeholder="C0123456789" value={channelId} onChange={e => setChannelId(e.target.value)} /><FieldDescription>One channel from your Slack workspace.</FieldDescription></Field>
        </div>
        <Field><FieldLabel htmlFor="slack-users">Allowed Slack user ids</FieldLabel><Textarea id="slack-users" rows={3} placeholder="U0123456789" value={users} onChange={e => setUsers(e.target.value)} /><FieldDescription>One per line or separated by commas. An empty list allows nobody. Only add people you trust with this room.</FieldDescription></Field>
      </FieldGroup>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="m-0 text-sm text-muted-foreground">Approvals always stay in OpenAg.</p>
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Slack settings"}</Button>
      </div>
      {saved && <p className="m-0 text-sm text-muted-foreground" role="status">Saved.</p>}
      {saveError && <Alert variant="destructive"><AlertDescription>{saveError}</AlertDescription></Alert>}
    </form>
    <Separator />
    <Disclosure title="Server setup">
      <p className="m-0 text-sm text-muted-foreground">An administrator sets SLACK_APP_TOKEN and SLACK_BOT_TOKEN in the daemon environment, then enables Socket Mode in the Slack app. Credentials never go in this form. Replies are visible to everyone in the channel.</p>
    </Disclosure>
    <Disclosure title="Connection activity">
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Received</dt><dd className="m-0">{status.received}</dd>
        <dt className="text-muted-foreground">Sent</dt><dd className="m-0">{status.sent}</dd>
        <dt className="text-muted-foreground">Dropped</dt><dd className="m-0">{status.dropped}</dd>
        <dt className="text-muted-foreground">Last event</dt><dd className="m-0 break-words">{status.lastEventAt === null ? "None yet" : new Date(status.lastEventAt).toLocaleString()}</dd>
      </dl>
    </Disclosure>
  </div>;
}
