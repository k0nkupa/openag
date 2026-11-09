import { Alert, AlertDescription } from "./ui/alert";
import { useUnsavedChanges } from "../unsaved-changes";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Switch } from "./ui/switch";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { useEffect, useState, type FormEvent } from "react";
import { ApiError, messageOf, type Api } from "../api";
import type { RtcInvite, RtcSettings, RtcStatus } from "../types";

const OWNER_ONLY = "Only a Full access device can change WebRTC settings";
const EMPTY: RtcSettings = { enabled: false, server: null, topic: null, stun: [] };
/** Sent in PUT /settings/rtc to keep the stored signaling topic unchanged. */
const KEEP_TOPIC = "(set)";

/** One STUN url per line; blanks dropped, duplicates removed, first occurrence kept. */
export function parseStun(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const url = raw.trim();
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

const orNull = (text: string) => (text.trim() === "" ? null : text.trim());

function statusLabel(status: RtcStatus): string {
  if (status.inert !== null) return `Inert: ${status.inert}`;
  return status.subscribed ? "Listening" : status.enabled ? "Not listening" : "Off";
}

/** The invite as shown to the owner: the wire fields only, without the expiry. */
function inviteJson(invite: RtcInvite): string {
  const { server, topic, stun, code, secret } = invite;
  return JSON.stringify({ server, topic, stun, code, secret }, null, 2);
}

export function RtcPanel({ api }: { api: Api }) {
  const [status, setStatus] = useState<RtcStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(EMPTY.enabled);
  const [server, setServer] = useState("");
  const [stun, setStun] = useState("");
  const [topicSet, setTopicSet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [topicError, setTopicError] = useState<string | null>(null);
  const [invite, setInvite] = useState<RtcInvite | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [savedForm, setSavedForm] = useState<string | null>(null);
  useUnsavedChanges(savedForm !== null && savedForm !== JSON.stringify([enabled, server, stun]), saving);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getRtcStatus(), api.getSettings()]).then(
      ([st, settings]) => {
        if (cancelled) return;
        const current = settings.settings.rtc ?? EMPTY;
        setStatus(st);
        setEnabled(current.enabled);
        setServer(current.server ?? "");
        setStun(current.stun.join("\n"));
        setTopicSet(current.topic !== null);
        setSavedForm(JSON.stringify([current.enabled, current.server ?? "", current.stun.join("\n")]));
      },
      (err: unknown) => {
        if (!cancelled) setLoadError(messageOf(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function generateTopic() {
    setTopicError(null);
    try {
      const res = await api.generateRtcTopic();
      setTopicSet(res.rtc.topic !== null);
    } catch (err) {
      setTopicError(err instanceof ApiError && err.status === 403 ? OWNER_ONLY : messageOf(err));
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await api.putRtc({
        enabled,
        server: orNull(server),
        topic: topicSet ? KEEP_TOPIC : null,
        stun: parseStun(stun),
      });
      setSavedForm(JSON.stringify([enabled, server, stun]));
      setSaved(true);
      try {
        setStatus(await api.getRtcStatus());
      } catch {
        /* keep the previous status; the save itself succeeded */
      }
    } catch (err) {
      setSaveError(err instanceof ApiError && err.status === 403 ? OWNER_ONLY : messageOf(err));
    } finally {
      setSaving(false);
    }
  }

  async function createInvite() {
    setInviting(true);
    setInviteError(null);
    try {
      setInvite(await api.createRtcInvite());
    } catch (err) {
      setInvite(null);
      setInviteError(messageOf(err));
    } finally {
      setInviting(false);
    }
  }

  if (loadError) {
    return (
      <Alert variant="destructive" className="mt-1.5 min-h-0 text-destructive"><AlertDescription>
        Could not load WebRTC: {loadError}
      </AlertDescription></Alert>
    );
  }
  if (status === null) return <p className="text-muted-foreground">Checking...</p>;

  return (
    <div>
      <p className="text-muted-foreground">
        WebRTC lets phones and other browsers reach the daemon without a VPN. Signaling goes through a private ntfy topic;
        the data channel is end to end. The direct path is used whenever it works.
      </p>

      <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5">
        <dt className="text-muted-foreground">Status</dt>
        <dd className="m-0 [overflow-wrap:anywhere]">{statusLabel(status)}</dd>
        <dt className="text-muted-foreground">Peers</dt>
        <dd className="m-0 [overflow-wrap:anywhere]">{status.peers}</dd>
        <dt className="text-muted-foreground">Offers</dt>
        <dd className="m-0 [overflow-wrap:anywhere]">{status.offers}</dd>
        <dt className="text-muted-foreground">Rejected</dt>
        <dd className="m-0 [overflow-wrap:anywhere]">{status.rejected}</dd>
      </dl>
      {status.lastError && (
        <Alert variant="destructive" className="mt-1.5 min-h-0 text-destructive"><AlertDescription>
          {status.lastError}
        </AlertDescription></Alert>
      )}

      <form onSubmit={save} aria-label="WebRTC settings">
        <FieldGroup>
          <Field orientation="horizontal"><FieldLabel htmlFor="rtc-enabled">Enable direct join</FieldLabel><Switch id="rtc-enabled" checked={enabled} onCheckedChange={setEnabled} /></Field>
          <Field><FieldLabel htmlFor="rtc-server">Signaling server</FieldLabel><Input id="rtc-server" type="url" placeholder="https://ntfy.example.com" value={server} onChange={e => setServer(e.target.value)} /></Field>
          <Field><FieldLabel htmlFor="rtc-stun">STUN servers, one per line</FieldLabel><Textarea id="rtc-stun" value={stun} onChange={e => setStun(e.target.value)} /></Field>
        <p className="text-muted-foreground">Signaling topic: {topicSet ? "set" : "not set"}</p>
        <Button variant="outline" type="button" onClick={generateTopic}>
          Generate topic
        </Button>
        {topicError && (
          <Alert variant="destructive" className="mt-1.5 min-h-0 text-destructive"><AlertDescription>
            {topicError}
          </AlertDescription></Alert>
        )}
        <Button variant="outline" type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
        {saved && (
          <p className="mb-2 text-muted-foreground [overflow-wrap:anywhere]" role="status">
            Saved.
          </p>
        )}
        {saveError && (
          <Alert variant="destructive" className="mt-1.5 min-h-0 text-destructive"><AlertDescription>
            {saveError}
          </AlertDescription></Alert>
        )}
        </FieldGroup>
      </form>

      <div>
        <h3>Phone invite</h3>
        <p className="text-muted-foreground">Creates a single-use invite that expires in 5 minutes.</p>
        <Button variant="outline" type="button" onClick={createInvite} disabled={inviting}>
          {inviting ? "Creating..." : "Create phone invite"}
        </Button>
        {inviteError && (
          <Alert variant="destructive" className="mt-1.5 min-h-0 text-destructive"><AlertDescription>
            {inviteError}
          </AlertDescription></Alert>
        )}
        {invite && (
          <>
            <p className="mt-1.5 min-h-0 text-[var(--warn)]" role="note">
              Warning: this invite is single use, expires in 5 minutes, and contains secrets. Do not share it.
            </p>
            <FieldGroup><Field><FieldLabel htmlFor="rtc-invite">Invite JSON</FieldLabel><Textarea id="rtc-invite" readOnly value={inviteJson(invite)} rows={8} /></Field></FieldGroup>
          </>
        )}
      </div>
    </div>
  );
}
