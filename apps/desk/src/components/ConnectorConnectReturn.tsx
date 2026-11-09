import { useEffect, useState } from "react";
import type { Api } from "../api";
import { messageOf } from "../api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { useAppLibrary } from "../app-library";
import { hrefFor } from "../route";
import { Button } from "./ui/button";

// Only a display hint: connection status is read back from the authenticated original desk.
const result = (() => {
  if (typeof window === "undefined" || window.location.pathname !== "/") return null;
  const url = new URL(window.location.href), value = url.searchParams.get("composioResult");
  if (!value) return null;
  url.searchParams.delete("composioResult"); window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  return ["connected", "cancelled", "failed"].includes(value) ? value : "failed";
})();

const googleReturnService = (() => {
  if (typeof window === "undefined" || window.location.pathname !== "/google-connect") return "gmail";
  try { const service = window.sessionStorage.getItem("openag-google-return-service"); window.sessionStorage.removeItem("openag-google-return-service"); return service === "drive" ? "drive" : "gmail"; } catch { return "gmail"; }
})();

// Capture once, before render. Never keep OAuth codes in history, storage, logs or the shared stream.
const callback = (() => {
  if (typeof window === "undefined" || !["/google-connect", "/composio-connect"].includes(window.location.pathname)) return null;
  const provider = window.location.pathname === "/composio-connect" ? "Composio" : "Google";
  const query = new URLSearchParams(window.location.search);
  const state = query.get("state"), code = query.get("code");
  window.history.replaceState(null, "", "/" + hrefFor({kind: "app-library", integrationId: provider === "Composio" ? "connector:composio" : "connector:" + googleReturnService}));
  return state && state.length <= 128 && code && code.length <= 4096 && !query.has("error") ? { state, code, provider } : { provider, error: `${provider} sign-in was cancelled or returned an invalid response.` };
})();
let completion: Promise<Record<string, unknown>> | null = null;

export function ConnectorConnectReturn({ api }: { api: Api }) {
  const [open, setOpen] = useState(!!callback || !!result), [message, setMessage] = useState(`Completing ${callback?.provider ?? "account"} sign-in…`);
  useEffect(() => {
    if (!callback) {
      if (!result) return;
      let active = true;
      if (result !== "connected") setMessage(result === "cancelled" ? "Composio sign-in was cancelled. Your existing connection is unchanged." : "Composio sign-in was not completed. Check connection status before trying again.");
      else void api.getComposio().then(status => { if (active) setMessage(status.state === "connected" ? "Composio account access is saved. Open Composio to check tool connection status." : "Composio connection needs attention. Open Composio to check its current status."); }, err => { if (active) setMessage(messageOf(err)); });
      return () => { active = false; };
    }
    if ("error" in callback) { setMessage(callback.error!); return; }
    let active = true;
    // React StrictMode may rerun the effect; exchange the single-use code only once.
    completion ??= callback.provider === "Composio" ? api.composioConnector("complete", { state: callback.state!, code: callback.code! }) : api.googleConnector("complete", { state: callback.state!, code: callback.code! });
    void completion.then(() => { if (active) setMessage(callback.provider === "Composio" ? "Composio sign-in completed. Open Composio to check tool connection status." : "Google account connected. Open the connector to check read access."); }, err => { if (active) setMessage(messageOf(err) + " Return to the connector and start sign-in again."); });
    return () => { active = false; };
  }, [api]);
  const inventory = useAppLibrary();
  function returnToConnection() {
    const integrationId = callback?.provider === "Google" ? "connector:" + googleReturnService : "connector:composio";
    const entry = inventory.error ? undefined : inventory.data?.entries.find(entry => entry.id === integrationId);
    window.location.hash = hrefFor({kind: entry?.installed ? "connectors" : "app-library", integrationId});
    setOpen(false);
  }
  return <Dialog open={open} onOpenChange={next => { if (!next) void returnToConnection(); }}><DialogContent><DialogHeader><DialogTitle>{callback?.provider ?? (result ? "Composio" : "Account")} connection</DialogTitle><DialogDescription>{message}</DialogDescription></DialogHeader><Button variant="outline" onClick={() => void returnToConnection()}>Return to connection</Button></DialogContent></Dialog>;
}
