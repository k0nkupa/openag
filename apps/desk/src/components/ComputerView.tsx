import { SettingsSection } from "./SettingsLayout";
import { Alert, AlertDescription } from "./ui/alert";
import { SelectField, SelectItem } from "./ui/select";
import { Field, FieldLabel } from "./ui/field";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { hrefFor } from "../route";
import { useCallback, useEffect, useRef, useState } from "react";
import { messageOf, type Api } from "../api";
import type { ComputerBackend, ComputerStatus, TakeoverStatus } from "../types";
import { relativeTime } from "./DevicesPanel";

const POLL_MS = 3000;
const KICK_MS = 1000;

const LABEL: Record<ComputerStatus["state"], string> = {
  absent: "Not created",
  running: "Running",
  stopped: "Stopped",
  unknown: "Unknown",
};

const BACKENDS: ComputerBackend[] = ["cua", "browserbase", "docker", "ssh"];

const BACKEND_LABEL: Record<ComputerBackend, string> = {
  cua: "Cua sandbox (default)",
  browserbase: "Browserbase (hosted browser)",
  docker: "Docker box",
  ssh: "Remote box (SSH)",
};

// Non-compact layout: panels, key/value rows, hints and the phone action row (2 equal columns, 48px targets).
const KV = "m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5";
const DT = "text-muted-foreground";
const DD = "m-0 [overflow-wrap:anywhere]";
const HINT = "mt-1.5 text-[13px] text-muted-foreground [overflow-wrap:anywhere]";
const ERROR = "mt-1.5 min-h-0 text-destructive";
const ACTIONS = "flex flex-wrap gap-2 max-[859px]:grid max-[859px]:grid-cols-[repeat(2,minmax(0,1fr))]";
const SHOT = "mt-3 block h-auto max-w-full rounded-[8px] border border-border";

export function ComputerView({ api, compact = false, enabled = true }: { api: Api; compact?: boolean; enabled?: boolean }) {
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  const [confirmingDestroy, setConfirmingDestroy] = useState(false);
  const [takeover, setTakeover] = useState<TakeoverStatus | null>(null);
  const [takeoverBusy, setTakeoverBusy] = useState(false);
  const [backendBusy, setBackendBusy] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const alive = useRef(true);
  const mounted = useRef(true);
  const refreshing = useRef(false);
  const currentApi = useRef(api);
  currentApi.current = api;
  const kickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shotRef = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (shotRef.current) URL.revokeObjectURL(shotRef.current);
      shotRef.current = null;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const [computer, control] = await Promise.allSettled([api.getComputer(), api.getTakeover()]);
      if (!alive.current || currentApi.current !== api) return;
      setStatus(computer.status === "fulfilled" ? computer.value : null);
      setTakeover(control.status === "fulfilled" ? control.value : null);
      const errors = [computer, control].flatMap(result => result.status === "rejected" ? [messageOf(result.reason)] : []);
      setLoadError(errors.length ? errors.join("; ") : null);
    } finally { refreshing.current = false; }
  }, [api]);

  useEffect(() => {
    alive.current = enabled;
    if (!enabled) {
      if (shotRef.current) URL.revokeObjectURL(shotRef.current);
      shotRef.current = null;
      setShotUrl(null);
      return;
    }
    setStatus(null); setTakeover(null); setLoadError(null);
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
      clearTimeout(kickTimer.current);
    };
  }, [refresh, enabled]);

  // A lifecycle call changes the state within seconds, so re-read sooner than the regular poll.
  const kick = () => {
    clearTimeout(kickTimer.current);
    kickTimer.current = setTimeout(() => void refresh(), KICK_MS);
  };

  async function act(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      if (alive.current) setActionError(messageOf(err));
    }
    if (alive.current) {
      setConfirmingDestroy(false);
      kick();
    }
  }

  /**
   * Takes control, then opens the viewer. The viewPath is a bearer ticket: it is used once here and never
   * stored or rendered. The "Open viewer" button re-runs this if the popup was blocked.
   */
  async function takeControl() {
    setActionError(null);
    setTakeoverBusy(true);
    try {
      const grant = await api.takeControl();
      if (alive.current) window.open(grant.viewPath, "_blank", "noopener");
    } catch (err) {
      if (alive.current) setActionError(messageOf(err));
    } finally {
      if (mounted.current) {
        setTakeoverBusy(false);
        if (alive.current) void refresh();
      }
    }
  }

  async function handBack() {
    setActionError(null);
    setTakeoverBusy(true);
    try {
      await api.handBack();
    } catch (err) {
      if (alive.current) setActionError(messageOf(err));
    } finally {
      if (mounted.current) {
        setTakeoverBusy(false);
        if (alive.current) void refresh();
      }
    }
  }

  /** Backend selection is explicit; ordinary status reads never apply it. */
  async function chooseBackend(next: ComputerBackend) {
    setBackendError(null);
    setBackendBusy(true);
    try {
      await api.putComputerBackend(next);
      await api.applyComputerBackend();
    } catch (err) {
      if (alive.current) setBackendError(messageOf(err));
    } finally {
      if (mounted.current) {
        setBackendBusy(false);
        if (alive.current) void refresh();
      }
    }
  }

  async function takeScreenshot() {
    setActionError(null);
    try {
      const blob = await api.computerScreenshot();
      if (!alive.current) return;
      const url = URL.createObjectURL(blob);
      if (shotRef.current) URL.revokeObjectURL(shotRef.current);
      shotRef.current = url;
      setShotUrl(url);
    } catch (err) {
      if (alive.current) setActionError(messageOf(err));
    }
  }

  const busy = status?.busy ?? false;
  const state = status?.state ?? "absent";
  const exists = status?.exists ?? false;
  const badge = busy ? "Working..." : status ? LABEL[state] : "Checking...";
  const held = takeover?.active ?? false;
  const holder = takeover?.by?.kind === "owner" ? "owner" : (takeover?.by?.name ?? "a device");
  const now = Date.now();
  const backendList = status?.backends;
  const reasonOf = (kind: ComputerBackend): string | null =>
    backendList?.find((b) => b.backend === kind)?.reason ?? null;
  const viewMode = status?.capabilities?.view;
  const noLiveView = viewMode === "none";
  const external = viewMode === "external";
  const actionLocked = busy || takeoverBusy || backendBusy;
  const backendLocked = actionLocked || held;
  const selectedBackend: ComputerBackend = status?.wantedBackend ?? status?.backend ?? "cua";
  const switchPending = status?.backend !== undefined && status.wantedBackend !== undefined && status.backend !== status.wantedBackend;
  const lifecycleBlocked = backendLocked || !!loadError || reasonOf(status?.backend ?? "cua") !== null || state === "unknown" || switchPending;
  const explanation = !status ? "Status is unavailable. Refresh status before taking any computer action."
    : state === "unknown" ? "The computer reported an unrecognised state. Refresh status, then inspect the backend on the OpenAg machine if it remains unknown. No recovery action has been run."
    : status.lastError ? "This backend needs attention. Review the reported reason and refresh status after correcting it on the OpenAg machine."
    : state === "absent" ? "No computer was found. Start creates one only when you explicitly choose it."
    : state === "stopped" ? "The computer is stopped. Start resumes it."
    : held ? "A person has control. Agent input stays paused until control is handed back."
    : "The computer is running. Opening this page does not grant control or approve an action.";
  const inspection = <div className="flex flex-col gap-3"><p className={HINT}>{explanation}</p><Button variant="outline" className="self-start" disabled={backendBusy} onClick={() => void refresh()}>Refresh status</Button></div>;

  if (compact) return <section className="flex min-w-0 flex-col gap-4 text-sm" aria-label="Shared computer">
    <h3 className="font-medium">Shared computer</h3>
    <p className="text-muted-foreground">This computer is shared across the desk. Work activity below shows recorded use; it does not assign the computer to one Work item.</p>
    {loadError && <Alert variant="destructive" className="text-destructive"><AlertDescription>Computer status unavailable: {loadError}</AlertDescription></Alert>}
    {actionError && <Alert variant="destructive" className="text-destructive"><AlertDescription>{actionError}</AlertDescription></Alert>}
    {status && <><div className="flex flex-wrap gap-2"><Badge variant={state === "running" ? "success" : "attention"}>{LABEL[state]}</Badge><Badge variant={held ? "attention" : "secondary"}>{!takeover ? "Control status unavailable" : held ? `Human control · ${holder}` : state === "running" ? "Agent input available" : "No active session"}</Badge></div><p>{status.backend ? BACKEND_LABEL[status.backend] : "Backend unavailable"}{busy ? " · Busy" : ""}</p></>}
    {status?.lastError && <Alert variant="destructive" className="text-destructive"><AlertDescription>{status.lastError}</AlertDescription></Alert>}
    {inspection}
    <div className="flex flex-wrap gap-2">
      {!noLiveView && <Button variant="outline" disabled={actionLocked || state!=="running" || !takeover || !!loadError} onClick={()=>void takeControl()}>{held ? "Open viewer" : "Take over computer"}</Button>}
      {held && <Button variant="outline" disabled={actionLocked} onClick={()=>void handBack()}>Hand back</Button>}
      <Button variant="outline" disabled={actionLocked || state!=="running" || !!loadError} onClick={()=>void takeScreenshot()}>Refresh screen</Button>
    </div>
    {shotUrl && <img src={shotUrl} alt="Latest screen of the shared computer" className="w-full rounded-lg border"/>}
    <p className="text-muted-foreground">Takeover pauses agent input. It does not cancel Work or approve an action.</p>
    <Button variant="ghost" nativeButton={false} render={<a href={hrefFor({kind:"computer"})}/>}>Full computer controls</Button>
  </section>;

  return (
    <section className="flex min-w-0 flex-col gap-6" aria-labelledby="computer-title">
      <h1 className="m-0 text-2xl font-semibold tracking-tight" id="computer-title">Computer</h1>
      {inspection}
      {held && (
        <Alert role="status"><AlertDescription className="flex min-w-0 flex-col gap-3">
          <p>Human control active (held by {holder}). Agent input is paused.</p>
          <dl className={KV}>
            {takeover?.since !== undefined && (
              <>
                <dt className={DT}>Since</dt>
                <dd className={DD}>{relativeTime(takeover.since, now)}</dd>
              </>
            )}
            {takeover?.idleExpiresAt !== undefined && (
              <>
                <dt className={DT}>Auto-release</dt>
                <dd className={DD}>
                  {new Date(takeover.idleExpiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} if idle
                </dd>
              </>
            )}
          </dl>
          {external && <p className={HINT}>Opens the provider's live view in a new tab.</p>}
          <div className={`${ACTIONS} mt-2`}>
            {!noLiveView && (
              <Button type="button" disabled={actionLocked} onClick={() => void takeControl()}>
                Open viewer
              </Button>
            )}
            <Button type="button" disabled={actionLocked} onClick={() => void handBack()}>
              Hand back
            </Button>
          </div>
        </AlertDescription></Alert>
      )}
      {backendList && (
        <SettingsSection icon="computer" title="Backend">
          <Field className="max-w-full">
            <FieldLabel htmlFor="computer-backend">Backend</FieldLabel>
            <SelectField
              id="computer-backend"
              className="w-full max-w-full box-border"
              value={selectedBackend}
              disabled={backendLocked}
              onValueChange={(value) => void chooseBackend(value as ComputerBackend)}
            >
              {BACKENDS.map((kind) => {
                const reason = reasonOf(kind);
                return (
                  <SelectItem key={kind} value={kind} disabled={reason !== null}>
                    {BACKEND_LABEL[kind]}
                    {reason !== null ? " (not configured)" : ""}
                  </SelectItem>
                );
              })}
            </SelectField>
          </Field>
          {BACKENDS.map((kind) => {
            const reason = reasonOf(kind);
            return reason === null ? null : (
              <p key={kind} className={HINT}>
                {BACKEND_LABEL[kind]}: {reason}
              </p>
            );
          })}
          {backendError && (
            <Alert variant="destructive" className={ERROR}><AlertDescription>
              {backendError}
            </AlertDescription></Alert>
          )}
          {status?.backend && <p>Active: {BACKEND_LABEL[status.backend]}</p>}
          {switchPending && (
            <div><p className={HINT} role="status">Switch pending. Wait until the computer is idle and nobody has control, then apply the selected backend.</p><Button variant="outline" disabled={backendLocked} onClick={() => void chooseBackend(selectedBackend)}>Apply selected backend</Button></div>
          )}
          {status?.capabilities && !status.capabilities.shell && (
            <p className={HINT}>This backend has no shell: computer_shell is unavailable.</p>
          )}
          {noLiveView && <p className={HINT}>No live view on this backend.</p>}
        </SettingsSection>
      )}

      <SettingsSection icon="computer" title="Sandbox">
        {loadError && (
          <Alert variant="destructive" className={ERROR}><AlertDescription>
            Could not read the computer: {loadError}
          </AlertDescription></Alert>
        )}
        {status?.lastError && (
          <Alert variant="destructive" className={ERROR}><AlertDescription>
            {status.lastError}
          </AlertDescription></Alert>
        )}
        {actionError && (
          <Alert variant="destructive" className={ERROR}><AlertDescription>
            {actionError}
          </AlertDescription></Alert>
        )}
        {status && (
          <dl className={KV}>
            <dt className={DT}>State</dt>
            <dd className={DD}>
              <Badge variant={!busy && state === "running" ? "success" : "attention"}>{badge}</Badge>
            </dd>
            {status.status && (
              <>
                <dt className={DT}>Status</dt>
                <dd className={DD}>{status.status}</dd>
              </>
            )}
            {status.image && (
              <>
                <dt className={DT}>Image</dt>
                <dd className={DD}>{status.image}</dd>
              </>
            )}
            {status.runtime && (
              <>
                <dt className={DT}>Runtime</dt>
                <dd className={DD}>{status.runtime}</dd>
              </>
            )}
          </dl>
        )}

        <div className={ACTIONS}>
          {status && (state === "absent" || state === "stopped") && (
            <Button type="button" disabled={lifecycleBlocked} onClick={() => void act(() => api.startComputer())}>
              Start
            </Button>
          )}
          {status && state === "running" && (
            <Button type="button" variant="outline" disabled={lifecycleBlocked} onClick={() => void act(() => api.stopComputer())}>
              Stop
            </Button>
          )}
          {status && state === "running" && !held && !noLiveView && (
            <Button type="button" disabled={actionLocked} onClick={() => void takeControl()}>
              Take control
            </Button>
          )}
          {status && state === "running" && !held && external && !noLiveView && (
            <p className={HINT}>Opens the provider's live view in a new tab.</p>
          )}
          {status && state === "running" && (
            <Button type="button" variant="outline" disabled={actionLocked} onClick={() => void takeScreenshot()}>
              Take screenshot
            </Button>
          )}
          {status && exists && state !== "unknown" && !confirmingDestroy && (
            <Button type="button" variant="destructive-outline" disabled={lifecycleBlocked} onClick={() => setConfirmingDestroy(true)}>
              Destroy
            </Button>
          )}
          {confirmingDestroy && (
            <>
              <span>Delete this computer and everything in it?</span>
              <Button type="button" variant="destructive" disabled={lifecycleBlocked} onClick={() => void act(() => api.destroyComputer())}>
                Confirm destroy
              </Button>
              <Button variant="ghost" type="button" onClick={() => setConfirmingDestroy(false)}>
                Cancel
              </Button>
            </>
          )}
        </div>

        {shotUrl && <img src={shotUrl} alt="Computer screenshot" className={SHOT} />}
      </SettingsSection>
    </section>
  );
}
