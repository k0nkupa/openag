import { useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useAppLibrary } from "../app-library";
import { messageOf, type Api } from "../api";
import { isStaleDigest, useMcpEntries } from "../mcp-entries";
import { mcpHint } from "../mcp-hints";
import { hrefFor } from "../route";
import type { McpServerChange } from "../types";
import { McpCommandDialog } from "./McpCommandDialog";
import { McpOAuthSettings } from "./McpOAuthSettings";
import { McpServerDialog } from "./McpServerDialog";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Switch } from "./ui/switch";

const ORIGIN_NOTE: Record<"builtin" | "connection", string> = {
  builtin: "Built in to OpenAg and managed by OpenAg. It cannot be changed from here.",
  connection: "This connection is managed from its own sign-in screen above.",
};
const STALE_STATUS = "The change was saved, but current status could not be read. Refresh status before taking another action.";

/**
 * Settings for one MCP server. Custom remote servers can be switched, edited and removed by the owner; built-in servers, managed
 * connections and custom command servers say who manages them instead. A limited device sees no controls (the daemon refuses it too).
 */
export function McpServerSettings({ api, serverId }: { api: Api; serverId: string }) {
  const inventory = useAppLibrary();
  const mcp = useMcpEntries(api);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const keepServer = useRef<HTMLButtonElement | null>(null);
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const removeTrigger = useRef<HTMLButtonElement | null>(null);
  const server = inventory.data?.servers.find(item => item.id === serverId);
  const view = mcp.entries?.servers.find(item => item.id === serverId);
  if (!server) return null;
  if (server.origin !== "custom") return <section className="flex min-w-0 flex-col gap-2" aria-label="Server settings"><h3>Server settings</h3><p className="library-meta">{ORIGIN_NOTE[server.origin]}</p></section>;
  const hint = mcpHint(server.detail);

  async function run(label: string, action: () => Promise<McpServerChange>, success: string) {
    setBusy(label); setError(null); setNotice(null);
    let saved = false;
    try {
      const change = await action();
      saved = true;
      mcp.adopt(change);
      if (!await inventory.refresh()) throw new Error(STALE_STATUS);
      setNotice(success);
    } catch (err) {
      // A stale digest means the file changed elsewhere: show the latest and ask again. Any other refusal is shown as it is.
      if (isStaleDigest(err)) { await mcp.reload(); setError({ title: "Changed elsewhere", message: `${messageOf(err)}. The latest version is shown; try again.` }); }
      else setError({ title: saved ? "Saved, but status is stale" : "Change not saved", message: messageOf(err) });
    } finally { setBusy(null); }
  }

  const digest = mcp.entries?.digest;
  const locked = !!busy || !digest || !!inventory.error;
  return <section className="flex min-w-0 flex-col gap-3" aria-label="Server settings">
    <div className="flex flex-wrap items-center gap-2"><h3>Server settings</h3><Badge variant="secondary">Custom</Badge>{!server.enabled && <Badge variant="secondary">Disabled</Badge>}</div>
    {error && <Alert variant="destructive"><AlertTitle>{error.title}</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>}
    <p className="library-meta" role="status">{notice && !busy ? notice : ""}</p>
    {hint && server.state !== "connected" && <p className="library-meta">{hint}</p>}
    {!view ? <p className="library-meta">{mcp.entriesError ?? (mcp.loaded ? "Only the owner can change custom servers." : "Checking…")}</p>
      : view.transport !== "http" && view.managedBy !== "desk" ? <p className="library-meta">This server runs a command the operator wrote on the OpenAg machine, so it stays managed in mcp.json.</p>
      : <>
        <FieldGroup>
          <Field orientation="horizontal">
            <FieldContent><FieldLabel htmlFor={`mcp-enabled-${serverId}`}>Enabled</FieldLabel><FieldDescription>Turn off to disable the server without removing it.</FieldDescription></FieldContent>
            <Switch id={`mcp-enabled-${serverId}`} checked={server.enabled} disabled={locked} onCheckedChange={next => void run("enabled", () => api.updateMcpServer(serverId, { enabled: next }, digest!), next ? "Enabled." : "Disabled.")} />
          </Field>
          <Field orientation="horizontal">
            <FieldContent><FieldLabel htmlFor={`mcp-offer-${serverId}`}>Offer tools to agents</FieldLabel><FieldDescription>Agents can see and request this server’s tools.</FieldDescription></FieldContent>
            <Switch id={`mcp-offer-${serverId}`} checked={server.offerToAgents} disabled={locked} onCheckedChange={next => void run("offer", () => api.updateMcpServer(serverId, { offerToAgents: next }, digest!), next ? "Offered to agents." : "No longer offered to agents.")} />
          </Field>
        </FieldGroup>
        {view.transport === "http" && view.oauth && <McpOAuthSettings api={api} serverId={serverId} locked={locked} onChanged={async () => { await mcp.reload(); await inventory.refresh(); }} />}
        <div className="flex flex-wrap gap-2">
          <Button ref={editTrigger} type="button" variant="outline" disabled={locked} onClick={() => setEditing(true)}><Pencil data-icon="inline-start" />Edit</Button>
          <Button ref={removeTrigger} type="button" variant="destructive-outline" disabled={locked} onClick={() => setConfirm(true)}><Trash2 data-icon="inline-start" />Remove</Button>
        </div>
        {editing && view.transport !== "http" && <McpCommandDialog api={api} mode="edit" entry={view} open onOpenChange={setEditing} returnFocus={editTrigger}
          onApplied={async () => { await mcp.reload(); if (await inventory.refresh()) setNotice("Saved. The reviewed command was started."); else setError({ title: "Saved, but status is stale", message: STALE_STATUS }); }} />}
        {editing && view.transport === "http" && <McpServerDialog api={api} mode="edit" entry={view} digest={digest!} open onOpenChange={setEditing} reload={mcp.reload} returnFocus={editTrigger}
          onSaved={async change => { mcp.adopt(change); if (await inventory.refresh()) setNotice("Saved. The server was reconnected."); else setError({ title: "Saved, but status is stale", message: STALE_STATUS }); }} />}
        <AlertDialog open={confirm} onOpenChange={open => { if (!busy) setConfirm(open); }}>
          <AlertDialogContent initialFocus={keepServer} finalFocus={removeTrigger}>
            <AlertDialogHeader><AlertDialogTitle>Remove {serverId}?</AlertDialogTitle><AlertDialogDescription>OpenAg stops using this server and its tools, and cancels approvals waiting for them.</AlertDialogDescription></AlertDialogHeader>
            {error && <Alert variant="destructive"><AlertDescription>{error.message}</AlertDescription></Alert>}
            <AlertDialogFooter>
              <AlertDialogCancel ref={keepServer} disabled={!!busy}>Keep server</AlertDialogCancel>
              <Button variant="destructive" disabled={locked} onClick={() => void run("remove", async () => { const change = await api.removeMcpServer(serverId, digest!); setConfirm(false); window.location.hash = hrefFor({ kind: "connectors" }); return change; }, "Removed.")}>{busy === "remove" ? "Removing…" : "Remove server"}</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>}
  </section>;
}
