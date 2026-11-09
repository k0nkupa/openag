import { Alert, AlertDescription } from "./ui/alert";
import { useUnsavedChanges } from "../unsaved-changes";
import { Switch } from "./ui/switch";
import { useEffect, useRef, useState } from "react";
import { messageOf, type Api } from "../api";
import type { PushSettings, PushStatus } from "../types";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Field, FieldGroup, FieldLabel } from "./ui/field";

const DEFAULTS: PushSettings = {
  enabled: false,
  server: "https://ntfy.sh",
  topic: null,
  publicUrl: null,
  includeDetail: false,
  maxPerHour: 20,
};

export function NotificationsPanel({ api }: { api: Api }) {
  const pending = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(DEFAULTS.enabled);
  const [server, setServer] = useState(DEFAULTS.server);
  const [topic, setTopic] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState("");
  const [includeDetail, setIncludeDetail] = useState(DEFAULTS.includeDetail);
  const [maxPerHour, setMaxPerHour] = useState(String(DEFAULTS.maxPerHour));
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshStatus = async () => {
    try {
      setStatus(await api.getPushStatus());
    } catch {
      setStatus(null);
    }
  };

  const [savedForm, setSavedForm] = useState<string | null>(null);
  useUnsavedChanges(savedForm !== null && savedForm !== JSON.stringify([enabled, server, publicUrl, includeDetail, maxPerHour]), busy);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { settings } = await api.getSettings();
        if (cancelled) return;
        const p: PushSettings = { ...DEFAULTS, ...(settings.push ?? {}) };
        setEnabled(p.enabled);
        setServer(p.server);
        setTopic(p.topic);
        setPublicUrl(p.publicUrl ?? "");
        setIncludeDetail(p.includeDetail);
        setMaxPerHour(String(p.maxPerHour));
        setLoaded(true);
        setSavedForm(JSON.stringify([p.enabled, p.server, p.publicUrl ?? "", p.includeDetail, String(p.maxPerHour)]));
      } catch (err) {
        if (!cancelled) setError(messageOf(err));
      }
    })();
    (async () => {
      try {
        const st = await api.getPushStatus();
        if (!cancelled) setStatus(st);
      } catch {
        /* the status line is optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function generate() {
    if (pending.current || !loaded) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const { topic: next } = await api.generatePushTopic();
      setTopic(next);
      setConfirmReplace(false);
      setNotice("New topic created. Subscribe to it in the ntfy app, then Save.");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function copyTopic() {
    if (!topic) return;
    try {
      await navigator.clipboard.writeText(topic);
      setNotice("Topic copied.");
    } catch {
      setError("Could not copy the topic. Select it and copy it by hand.");
    }
  }

  async function save() {
    if (pending.current || !loaded) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const value: PushSettings = {
        enabled,
        server: server.trim(),
        topic,
        publicUrl: publicUrl.trim() === "" ? null : publicUrl.trim(),
        includeDetail,
        maxPerHour: Number(maxPerHour),
      };
      await api.putSetting("push", value);
      const { settings } = await api.getSettings();
      if (Object.entries(value).some(([k, v]) => settings.push?.[k as keyof PushSettings] !== v)) throw new Error("Saved values were not confirmed. Reload to review them.");
      setSavedForm(JSON.stringify([enabled, server, publicUrl, includeDetail, maxPerHour]));
      setNotice("Saved.");
      void refreshStatus();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function sendTest() {
    if (pending.current || !loaded) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setTestNote(null);
    try {
      const r = await api.sendPushTest();
      setTestNote(r.ok ? "Test sent. Check your phone." : `Test not sent: ${r.reason ?? "unknown reason"}.`);
      void refreshStatus();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  if (!loaded && !error) return <p className="text-muted-foreground">Loading notifications...</p>;

  return (
    <div className="grid gap-4" onChange={() => setNotice(null)}>
      <fieldset disabled={busy || !loaded} className="min-w-0 border-0 p-0" data-slot="field-set"><FieldGroup>
      <p className="text-muted-foreground">
        ntfy.sh is a public service. Anyone who learns your topic name can read these notifications, so the topic is
        kept secret and messages contain no details by default.
      </p>

      <Field orientation="horizontal"><FieldLabel htmlFor="push-enabled">Enable push notifications</FieldLabel><Switch id="push-enabled" checked={enabled} onCheckedChange={setEnabled} /></Field>

      <Field><FieldLabel htmlFor="push-server">Server</FieldLabel>
        <Input id="push-server" className="text-foreground" value={server} onChange={(e) => setServer(e.target.value)} maxLength={200} />
      </Field>

      <div>
        <span>Topic</span>
        {topic === null ? (
          <Button variant="outline" type="button" onClick={generate} disabled={busy}>
            Generate topic
          </Button>
        ) : (
          <>
            <code aria-label="Topic">{topic}</code>{" "}
            <Button variant="outline" type="button" onClick={copyTopic}>
              Copy
            </Button>
            <p className="text-muted-foreground">Install the ntfy app and subscribe to this topic.</p>
            {confirmReplace ? (
              <p>
                Replace the topic? Devices subscribed to the old one stop getting notifications.{" "}
                <Button variant="outline" type="button" onClick={generate} disabled={busy}>
                  Replace topic
                </Button>{" "}
                <Button variant="outline" type="button" onClick={() => setConfirmReplace(false)}>
                  Cancel
                </Button>
              </p>
            ) : (
              <Button variant="outline" type="button" onClick={() => setConfirmReplace(true)} disabled={busy}>
                Generate a new topic
              </Button>
            )}
          </>
        )}
      </div>

      <Field><FieldLabel htmlFor="push-url">Public URL</FieldLabel>
        <Input id="push-url"
          className="text-foreground"
          value={publicUrl}
          onChange={(e) => setPublicUrl(e.target.value)}
          placeholder="https://<your-machine>.<tailnet>.ts.net"
          maxLength={300}
        />
      </Field>
      <p className="text-muted-foreground">Where tapping a notification opens OpenAg.</p>

      <Field orientation="horizontal"><FieldLabel htmlFor="push-detail">Include details in pings</FieldLabel><Switch id="push-detail" checked={includeDetail} onCheckedChange={setIncludeDetail} /></Field>
      <p className="text-muted-foreground">
        {includeDetail
          ? "On: ping notifications include the start of the bot's reason. The topic is public-relay traffic, so keep it secret."
          : "Off: notifications only say that something needs you."}
      </p>

      <Field><FieldLabel htmlFor="push-max">Max notifications per hour</FieldLabel>
        <Input id="push-max"
          className="text-foreground"
          type="number"
          min={1}
          max={100}
          value={maxPerHour}
          onChange={(e) => setMaxPerHour(e.target.value)}
        />
      </Field>

      <div>
        <Button variant="outline" type="button" onClick={save} disabled={busy || !loaded}>
          Save notifications
        </Button>{" "}
        <Button variant="outline" type="button" onClick={sendTest} disabled={busy}>
          Send test
        </Button>
      </div>

      {testNote && <p className="mb-2 text-muted-foreground [overflow-wrap:anywhere]" role="status">{testNote}</p>}
      {notice && <p className="mb-2 text-muted-foreground [overflow-wrap:anywhere]" role="status">{notice}</p>}
      {status && (
        <p className="text-muted-foreground">
          Sent this hour: {status.sentThisHour}. Dropped: {status.dropped}. Last error: {status.lastError ?? "none"}.
        </p>
      )}
      {error && (
        <Alert variant="destructive" className="mt-1.5 min-h-0 text-destructive"><AlertDescription>
          {error}
        </AlertDescription></Alert>
      )}
      </FieldGroup></fieldset>
    </div>
  );
}
