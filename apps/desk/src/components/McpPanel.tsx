import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useAppLibrary } from "../app-library";
import { Disclosure } from "./Disclosure";
import { McpServerSettings } from "./McpServerSettings";
import { Button } from "./ui/button";
import { messageOf, type Api } from "../api";
import type { McpServerState } from "../types";

const BADGE: Record<McpServerState, string> = {
  connected: "Connected",
  down: "Down",
  skipped: "Skipped",
  invalid: "Invalid",
  refused: "Refused",
};

export function McpPanel({ api, serverId }: { api: Api; serverId?: string }) {
  const inventory = useAppLibrary();
  const status = inventory.data;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setBusy(true);
    setError(null);
    try {
      await api.reloadMcp();
      if (!await inventory.refresh()) throw new Error("The operation finished, but current status could not be read. Refresh status before taking another action.");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {!serverId && <p className="text-muted-foreground">
        Servers are listed from mcp.json in your OpenAg data folder. The owner can add and manage custom remote servers from
        Settings, Connectors; built-in servers and managed connections are changed elsewhere. Unknown tools always ask for approval.
      </p>}
      {serverId && <McpServerSettings api={api} serverId={serverId} />}
      {(error || inventory.error) && (
        <Alert variant="destructive" className="text-destructive"><AlertDescription>
          {error || inventory.error}
        </AlertDescription></Alert>
      )}
      {status === null ? (
        !(error || inventory.error) && <p className="text-muted-foreground">Checking...</p>
      ) : status.servers.length === 0 ? (
        !serverId && <p className="text-muted-foreground">No connectors configured.</p>
      ) : serverId ? null : (
        <ul>
          {status.servers.filter(s => !serverId || s.id === serverId).map((s) => (
            <li key={s.id}>
              <strong>{s.id}</strong> <span className="text-muted-foreground">{s.transport}</span>{" "}
              <Badge variant={s.state === "connected" ? "success" : s.state === "skipped" ? "attention" : "destructive"}>{BADGE[s.state]}</Badge>{" "}
              <span>
                {s.toolCount} {s.toolCount === 1 ? "tool" : "tools"}
              </span>
              {s.detail && <div className="text-muted-foreground">{s.detail}</div>}
            </li>
          ))}
        </ul>
      )}
      {status?.servers.filter(server=>!serverId||server.id===serverId).map(server=>server.unavailable?.length?<section key={server.id} aria-label={`${server.id} unavailable tools`}><h4>Unavailable tools</h4><ul>{server.unavailable.map(tool=><li key={tool.name}><strong>{tool.name}</strong>: {tool.reason}</li>)}</ul></section>:null)}
      <Disclosure title="Advanced maintenance"><p className="text-muted-foreground">Reconnects all configured MCP servers, including this one. Configuration is unchanged.</p><Button type="button" variant="outline" onClick={reload} disabled={busy || !!inventory.error}><RefreshCw data-icon="inline-start" />
        {busy ? "Reconnecting..." : "Reconnect MCP"}
      </Button></Disclosure>
    </div>
  );
}
