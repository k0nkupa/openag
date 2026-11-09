import { Card, CardContent } from "./ui/card";
import { Field, FieldLabel } from "./ui/field";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { Checkbox } from "./ui/checkbox";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ApiError, messageOf, type Api } from "../api";
import { useAppLibrary } from "../app-library";
import { Disclosure } from "./Disclosure";
import { Button } from "./ui/button";
import type { AppInfo, AppState } from "../types";

const STATE_LABEL: Record<AppState, string> = { enabled: "Enabled", disabled: "Disabled", invalid: "Invalid" };
const OWNER_ONLY = "Full access is required. Ask a trusted Full access device, or run pnpm desk:open on the daemon host.";
const EMPTY = "text-muted-foreground";
const ERROR = "mt-1.5 mb-0 min-h-0 text-destructive";
const NOTICE = "mt-0 mb-2 text-muted-foreground wrap-anywhere";
const CMD = "wrap-anywhere whitespace-pre-wrap";
const TOOLS = "my-1.5 grid list-none gap-1.5 p-0 pl-2.5 text-[13px]";

/** 403 means a paired device tried an owner action; everything else keeps the server's message. */
function ownerAwareMessage(err: unknown): string {
  return err instanceof ApiError && err.status === 403 ? OWNER_ONLY : messageOf(err);
}

export function AppsPanel({ api, appId }: { api: Api; appId?: string }) {
  const inventory = useAppLibrary();
  const apps = inventory.data?.apps.filter(app => !appId || app.id === appId) ?? null;
  const appsDir = inventory.data?.appsDir;
  const loadError = inventory.error;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Fresh owner-authorised review. Its exact hash is sent to enable. */
  const [reviewing, setReviewing] = useState<AppInfo | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [confirmDisableId, setConfirmDisableId] = useState<string | null>(null);

  useEffect(() => { if (loadError) { setReviewing(null); setReviewed(false); setConfirmDisableId(null); } }, [loadError]);

  function closeReview() {
    setReviewing(null);
    setReviewed(false);
  }

  async function reload() {
    setBusy(true);
    setError(null);
    closeReview();
    setConfirmDisableId(null);
    try {
      await api.reloadApps();
      if (!await inventory.refresh()) throw new Error("The operation finished, but current status could not be read. Refresh status before taking another action.");
    } catch (err) {
      setError(ownerAwareMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function openReview(app: AppInfo) {
    if (reviewing?.id === app.id) { closeReview(); return; }
    setBusy(true); setError(null);
    try { const result = await api.reviewApp(app.id); setReviewing(result.app); setReviewed(false); }
    catch (err) { setError(ownerAwareMessage(err)); }
    finally { setBusy(false); }
  }

  async function enable() {
    if (!reviewing || !reviewed) return;
    setBusy(true);
    setError(null);
    try {
      await api.enableApp(reviewing.id, reviewing.hash);
      closeReview();
      if (!await inventory.refresh()) throw new Error("The operation finished, but current status could not be read. Refresh status before taking another action.");
      closeReview();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(`${err.message} Reload and review again.`);
        closeReview();
      } else {
        setError(ownerAwareMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function disable(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.disableApp(id);
      setConfirmDisableId(null);
      if (!await inventory.refresh()) throw new Error("The operation finished, but current status could not be read. Refresh status before taking another action.");
      setConfirmDisableId(null);
    } catch (err) {
      setError(ownerAwareMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {!appId && <p className={EMPTY}>
        Apps are folders you copy into <code className={CMD}>{appsDir ?? "your apps folder"}</code>. An enabled app
        runs code on this machine.
      </p>}
      <Disclosure title="Advanced maintenance"><Button type="button" variant="outline" onClick={reload} disabled={busy || !!inventory.error}><RefreshCw data-icon="inline-start" />
        {busy ? "Reloading..." : "Reload app folders"}
      </Button></Disclosure>

      {!appId && <p className={EMPTY}>Tool approval modes do not sandbox installed code. Enabling grants no automatic tool approval.</p>}
      {error && (
        <Alert variant="destructive" className={ERROR}><AlertDescription>
          {error}
        </AlertDescription></Alert>
      )}

      {loadError ? (
        <Alert variant="destructive" className={ERROR}><AlertDescription>
          Could not load apps: {loadError}
        </AlertDescription></Alert>
      ) : apps === null ? (
        <p className={EMPTY}>Checking...</p>
      ) : apps.length === 0 ? (
        <p className={EMPTY}>
          No apps found. Copy an app folder into <code className={CMD}>{appsDir ?? "your apps folder"}</code> and press
          Reload.
        </p>
      ) : (
        <ul className="my-2 grid list-none gap-3 p-0">
          {apps.map((app) => {
            const isReviewing = reviewing?.id === app.id;
            return (
              <li className="min-w-0 border-t border-border pt-2.5 wrap-anywhere" key={app.id}>
                {!appId && <div>
                  <strong>{app.name}</strong> <code className={CMD}>{app.id}</code>{" "}
                  <span className={EMPTY}>v{app.version}</span>{" "}
                  <Badge variant={app.state === "enabled" ? "success" : app.state === "invalid" ? "destructive" : "secondary"}>{STATE_LABEL[app.state]}</Badge>
                </div>}
                {!appId && <p className={EMPTY}>{app.description}</p>}
                {app.error && <p className={ERROR}>{app.error}</p>}

                {!appId && app.tools.length > 0 && (
                  <ul className={TOOLS}>
                    {app.tools.map((t) => (
                      <li key={t.name}>
                        <code className={CMD}>{t.name}</code> <Badge variant="secondary">{t.class}</Badge>
                        <div className={EMPTY}>{t.description}</div>
                      </li>
                    ))}
                  </ul>
                )}

                {app.state === "disabled" && (
                  <div>
                    <Button
                      type="button"
                      onClick={() => void openReview(app)}
                      disabled={busy}
                    >
                      {isReviewing ? "Close review" : "Review and enable"}
                    </Button>
                  </div>
                )}

                {app.state === "disabled" && isReviewing && reviewing && (
                  <Card role="region" aria-label={`Review ${app.name}`}><CardContent className="flex min-w-0 flex-col gap-3">
                    <p className={NOTICE}>Enabling lets this app run code on this machine as you. Only enable apps you trust.</p>
                    <p className={EMPTY}>
                      Whole-folder hash <code className={CMD}>{reviewing.hash}</code>
                    </p>
                    {reviewing.tools.length === 0 ? (
                      <p className={EMPTY}>This app declares no tools.</p>
                    ) : (
                      <ul className={TOOLS}>
                        {reviewing.tools.map((t) => (
                          <li key={t.name}>
                            <code className={CMD}>{t.name}</code> <Badge variant="secondary">{t.class}</Badge>
                            <div>
                              Command: <code className={CMD}>{t.argv.join(" ")}</code>
                            </div>
                            <div>Env: {t.env.length > 0 ? <code className={CMD}>{t.env.join(", ")}</code> : "none"}</div>
                            <div>Time limit: {t.timeoutSec}s</div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <Field orientation="horizontal"><Checkbox id={`app-review-${app.id}`} checked={reviewed} onCheckedChange={setReviewed} /><FieldLabel className="min-h-11" htmlFor={`app-review-${app.id}`}>I reviewed this app</FieldLabel></Field>
                    <div>
                      <Button type="button" onClick={enable} disabled={!reviewed || busy}>
                        Enable
                      </Button>
                    </div>
                  </CardContent></Card>
                )}

                {app.state === "enabled" &&
                  (confirmDisableId === app.id ? (
                    <div>
                      <p className={NOTICE}>Disable {app.name}? It stops running until you enable it again.</p>
                      <Button type="button" onClick={() => disable(app.id)} disabled={busy}>
                        Confirm disable
                      </Button>{" "}
                      <Button type="button" onClick={() => setConfirmDisableId(null)} disabled={busy}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button type="button" onClick={() => setConfirmDisableId(app.id)} disabled={busy}>
                      Disable
                    </Button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
