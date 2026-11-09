import { COMPOSIO_SERVER_ID, type ComposioConnect } from "./composio-connect.js";
import type { GoogleConnectors } from "./google-connectors.js";
import { setupPackages, connectorDirectory } from "./integration-packages.js";
import { existsSync, lstatSync } from "node:fs";
import { dirname } from "node:path";
import { managedPath, packageContents } from "./package-files.js";
import { hostname } from "node:os";
import type { AppInfo, AppsManager } from "./apps.js";
import type { McpManager, ServerStatus } from "./mcp.js";
import type { ToolClass } from "./policy.js";

export type LibraryState = "available" | "setup" | "ready" | "paused" | "unavailable" | "failed";
export interface LibraryEntry {
  id: string;
  runtimeId: string;
  kind: "app" | "mcp" | "connector";
  name: string;
  description: string;
  category: string;
  brand?: "composio";
  setupId?: string;
  digest?: string;
  installed: boolean;
  state: LibraryState;
  reason: string;
  source: string;
  version: string | null;
  requirements: string[];
  tools: { name: string; description: string; class: ToolClass }[];
  toolEvidence: "declared" | "discovered";
  accessState?: "setup" | "needs_access" | "connected" | "paused" | "failed";
  verifiedAt?: number | null;
}

// Reviewed repository examples only. A catalogue entry never enables code or proves an account is connected.
const catalogue = [
  { runtimeId: "hello", name: "Hello (example app)", description: "A local example that reads the time and keeps a note in its own data folder.", category: "Local utilities", requirements: ["Node.js", "Owner-installed examples/apps/hello folder", "Whole-folder review before enabling"] },
  { runtimeId: "composio", name: "Composio bridge (optional)", description: "An optional bridge to Composio’s hosted tools. Connected accounts are managed outside OpenAg.", category: "Connections", brand: "composio" as const, requirements: ["Node.js", "Owner-installed examples/apps/composio folder", "COMPOSIO_API_KEY on the daemon", "Whole-folder review before enabling"] },
];

function appEntry(app: AppInfo): LibraryEntry {
  const known = catalogue.find(c => c.runtimeId === app.id);
  let state: LibraryState = "setup", reason = "Review the current folder before enabling.";
  if (app.state === "invalid") { state = "failed"; reason = app.error ?? "The installed app is invalid."; }
  else if (app.paused) { state = "paused"; reason = "Disabled by the owner. Review the folder to enable again.";
    if (app.missingRuntime?.length) reason += ` Missing runtime: ${app.missingRuntime.join(", ")}.`;
    if (app.missingEnv.length) reason += ` Missing environment: ${app.missingEnv.join(", ")}.`;
  }
  else if (app.missingRuntime?.length) { state = "unavailable"; reason = `Missing runtime: ${app.missingRuntime.join(", ")}`; }
  else if (app.missingEnv.length) { reason = `Missing environment: ${app.missingEnv.join(", ")}`; }
  else if (app.state === "enabled") { state = "ready"; reason = "Reviewed folder and required environment are available. Account access is not verified."; }
  return {
    ...(app.id === "hello" ? { setupId: "hello" } : {}),
    digest: app.hash,
    id: `app:${app.id}`, runtimeId: app.id, kind: "app", name: app.id === "composio" ? "Composio bridge (legacy API key)" : app.name, description: app.description,
    category: known?.category ?? "Local utilities", ...(known?.brand ? { brand: known.brand } : {}), installed: true,
    state, reason, source: "Owner-installed local folder; publisher not verified", version: app.version || null,
    requirements: [...new Set([...(known?.requirements ?? ["Owner-installed app folder", "Whole-folder review before enabling"]), ...(app.requirements ?? []).map(name => `${name} on the daemon`)])],
    tools: app.tools.map(({ name, description, class: cls }) => ({ name, description, class: cls })), toolEvidence: "declared",
  };
}

function mcpEntry(server: ServerStatus, duplicateIndex?: number): LibraryEntry {
  const state: LibraryState = server.state === "connected" ? server.toolCount===0&&server.unavailable?.length ? "unavailable" : "ready" : server.state === "skipped" ? server.detail === "disabled" ? "paused" : "setup" : "failed";
  return {
    // Invalid duplicate config entries must remain visible rather than overwrite a valid server.
    id: `mcp:${server.id}${duplicateIndex === undefined ? "" : `:duplicate-${duplicateIndex}`}`, runtimeId: server.id, kind: "mcp", name: server.package?.id === "apple-apps" ? "Apple apps" : server.package?.id === "local-reference" ? "Local reference MCP" : server.id,
    description: `${server.transport === "stdio" ? "Local process" : "HTTP"} MCP connector`, category: "Connections", installed: true,
    state, reason: server.detail ?? (server.unavailable?.length?`${server.unavailable.length} unavailable tool(s): ${server.unavailable.slice(0,3).map(tool=>`${tool.name}: ${tool.reason}`).join("; ")}`:state === "ready" ? "MCP handshake and tool discovery completed." : "The connector is not connected."),
    ...(["local-reference", "apple-apps"].includes(server.package?.id ?? "") ? { setupId: server.package!.id, digest: server.package!.digest } : {}),
    source: "Administrator-managed mcp.json; publisher not verified", version: server.version ?? server.package?.version ?? null,
    requirements: ["Administrator-managed MCP configuration", ...(server.requirements ?? []).map(name => `${name} on the daemon`)],
    tools: server.tools ?? [], toolEvidence: "discovered",
  };
}

/** A status projection only: never starts processes or contacts providers. Known-folder reads may revoke obsolete code approvals. */
export function appLibrary(apps?: AppsManager, mcp?: McpManager, google?: GoogleConnectors, composio?: ComposioConnect) {
  const installedApps = apps?.list() ?? [], servers = mcp?.status() ?? [];
  const entries: LibraryEntry[] = installedApps.map(appEntry);
  const packages = setupPackages(), setupAvailability = new Map<string, boolean>();
  for (const result of packages) {
    const pkg = result.package;
    const kind = result.id === "hello" ? "app" : "mcp";
    let canSetup = !!pkg && !!apps && !(result.id === "apple-apps" && process.platform !== "darwin"), destination: string | null = null;
    if (pkg && apps) try {
      const root = dirname(apps.appsDir);
      destination = kind === "app" ? managedPath(root, `apps/${result.id}`) : connectorDirectory(root, pkg.digest, pkg.id);
      if (existsSync(destination) && !lstatSync(destination).isDirectory()) canSetup = false;
    } catch { canSetup = false; }
    setupAvailability.set(result.id, canSetup);
    if ((kind === "app" ? installedApps : servers).some(item => item.id === result.id)) continue;
    let detected = false, problem: string | null = null;
    if (kind === "mcp" && pkg && canSetup && destination && existsSync(destination)) {
      detected = true;
      try { if (packageContents(destination).hash !== pkg.digest) problem = "Detected connector package differs from the reviewed digest"; }
      catch { problem = "Detected connector package is unsafe"; }
    }
    entries.push({ id: `${kind}:${result.id}`, runtimeId: result.id, kind, name: pkg?.name ?? (kind === "app" ? "Hello (example app)" : "Local reference MCP"),
      description: pkg?.description ?? "Bundled local setup package", category: pkg?.category ?? "Local utilities", installed: detected,
      state: problem ? "failed" : !pkg || !apps || !canSetup ? "unavailable" : detected ? "setup" : "available",
      reason: problem ?? result.error ?? (result.id === "apple-apps" && process.platform !== "darwin" ? "Apple apps require macOS on the daemon machine." : !canSetup ? "Local setup requires an owned target directory that is not writable by others. Existing manual integrations remain available." : detected ? "Package detected. Check installation to load the administrator configuration." : "Review this package, run its setup command locally, then check installation."),
      source: pkg?.source ?? "OpenAg repository example", version: pkg?.version ?? null, requirements: pkg?.requirements ?? [],
      tools: pkg?.tools.map(tool => ({ description: tool.description, class: tool.class as ToolClass, name: kind === "app" ? `app_${result.id}_${tool.name}` : `mcp.${result.id}.${tool.name}` })) ?? [],
      toolEvidence: "declared", setupId: pkg && canSetup ? result.id : undefined, digest: pkg?.digest });
  }
  const composioStatus = composio?.status(), composioServer = servers.find(s => s.id === COMPOSIO_SERVER_ID && s.state !== "invalid");
  entries.push({ id: "connector:composio", runtimeId: COMPOSIO_SERVER_ID, kind: "connector", name: "Composio", brand: "composio", category: "Connections",
    description: "Connect Composio in your browser, then authorize the services you want to use.", installed: !!composioStatus?.hasAccount,
    state: composioStatus?.state === "failed" ? "failed" : composioStatus?.state === "connected" ? composioServer?.state === "connected" ? "ready" : "failed" : composioStatus?.configured ? "available" : "setup",
    accessState: composioStatus?.state ?? "setup", reason: composioStatus?.reason ?? (composioStatus?.state === "connected" ? composioServer?.state === "connected" ? "Composio tools are connected." : "Account access is saved, but tools are unavailable. Reconnect Composio." : "Connect from a Full access device. No Composio API key is required."),
    source: "Composio hosted MCP", version: composioServer?.version ?? null,
    requirements: ["Full access device for sign-in", "Reachable installation app address for remote sign-in", "Separate consent for services connected through Composio"],
    tools: composioServer?.tools ?? [], toolEvidence: "discovered" });
  entries.push(...servers.filter(s => s.id !== COMPOSIO_SERVER_ID || s.state === "invalid").map((server, index) => mcpEntry(server, servers.slice(0, index).some(previous => previous.id === server.id) ? index : undefined)));
  const googleStatus = google?.status();
  for (const id of ["gmail", "drive"] as const) {
    const status = googleStatus?.services.find(s => s.id === id);
    const name = id === "gmail" ? "Gmail" : "Google Drive";
    entries.push({ id: `connector:${id}`, runtimeId: id, kind: "connector", name, description: id === "gmail" ? "Search and read messages and threads. Sending and mailbox changes are unavailable." : "Search Drive files and read supported text and Google documents. Editing and sharing are unavailable.", category: "Productivity", installed: !!googleStatus?.configured,
      state: status?.state === "connected" ? "ready" : status?.state === "paused" ? "paused" : status?.state === "failed" ? "failed" : "setup",
      accessState: status?.state ?? "setup", verifiedAt: status?.verifiedAt ?? null,
      reason: status?.state === "connected" ? "Google account access is connected. Run Check read access to verify this service." : status?.state === "paused" ? "This service is paused. The Google account stays connected." : "An owner must configure and connect Google access on this daemon.",
      source: "OpenAg Google API adapter", version: "1.0.0", requirements: ["Administrator-configured Google sign-in", "Owner consent for read-only access", "A registered return URL reachable from this browser", "Read results may be sent to the bot's model provider"],
      tools: (google?.tools ?? []).filter(t => t.name.startsWith(id + "_")).map(t => ({ name: t.name, class: t.class, description: t.description })), toolEvidence: "declared" });
  }
  for (const entry of entries) if (entry.setupId && !setupAvailability.get(entry.setupId)) delete entry.setupId;
  return { machine: hostname(), appsDir: apps?.appsDir ?? null, configPath: mcp?.configPath ?? null,
    apps: installedApps.map(app => appListing(app)), servers, entries, counts: { installed: entries.filter(e => e.installed).length, ready: entries.filter(e => e.state === "ready").length } };
}

/** Command arguments can contain unrecognised literal secrets. They belong only in an owner-authorised review. */
export function appListing(app: AppInfo, review = false): AppInfo {
  return { ...app, tools: app.tools.map(tool => ({ ...tool, argv: review ? tool.argv : [] })) };
}
