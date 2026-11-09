import { COMPOSIO_SERVER_ID } from "./composio-connect.js";
import type { ServerStatus } from "./mcp.js";
import { enabledTools, type ToolDef } from "./tools/registry.js";

/**
 * Which MCP-client tools are offered to ACP (Claude/Codex) bots through the daemon's own `/mcp` server.
 * A server is forwarded when it is connected and its `offerToAgents` switch is on, and it is a custom server the owner added,
 * the Apple package, or the managed Composio connection. Other built-ins (the `local-reference` example) are never forwarded.
 * Forwarding offers a tool, it never approves one: every forwarded call still goes through the daemon's gate. A custom tool is
 * `act-external` and asks by default; it asks unless the owner has declared it read or search, and Composio's reviewed discovery tools
 * are read-class too, so those two kinds run without a prompt exactly as they do for any other runtime.
 */

const isForwardable = (server: ServerStatus): boolean =>
  server.state === "connected" && server.offerToAgents &&
  ((server.origin === "custom" && server.id !== "local-reference") || (server.id === "apple-apps" && server.package?.id === "apple-apps") || server.id === COMPOSIO_SERVER_ID);

/** The manager already prefixes and caps a description; a custom server's text also loses line breaks so it cannot lay out its own instructions. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

export function forwardedMcpTools(input: {
  status: ServerStatus[];
  /** Every offered MCP-client tool (`mcp.<server>.<tool>`). */
  defs: ToolDef[];
  /** Names that belong to first-party or App tools: an MCP tool may never take one. */
  reserved: ReadonlySet<string>;
}): ToolDef[] {
  const offered = new Map(input.status.filter(isForwardable).map(server => [`mcp.${server.id}.`, server] as const));
  const seen = new Set<string>();
  const out: ToolDef[] = [];
  for (const def of input.defs) {
    const prefix = [...offered.keys()].find(candidate => def.name.startsWith(candidate));
    if (!prefix || input.reserved.has(def.name) || seen.has(def.name)) continue;
    seen.add(def.name);
    out.push(offered.get(prefix)!.origin === "custom" ? { ...def, description: oneLine(def.description) } : def);
  }
  return out;
}

/**
 * Everything a Claude or Codex bot is offered through `/mcp`: the allow-listed first-party tools, enabled App tools and the forwarded
 * MCP servers. `main.ts` and the ACP auto-allow check both use this one function, so the offered list and the allow list cannot drift.
 */
export function acpOfferedTools(input: {
  mcp: { status(): ServerStatus[]; toolDefs(): ToolDef[] };
  firstPartyDefs: ToolDef[];
  /** Names of first-party tools that ACP bots may be offered. */
  firstPartyAllowed: ReadonlySet<string>;
  appDefs: ToolDef[];
}): ToolDef[] {
  const reserved = new Set([...input.firstPartyDefs, ...input.appDefs].map(def => def.name));
  return enabledTools([
    ...input.firstPartyDefs.filter(def => input.firstPartyAllowed.has(def.name)),
    ...input.appDefs,
    ...forwardedMcpTools({ status: input.mcp.status(), defs: input.mcp.toolDefs(), reserved }),
  ]);
}
