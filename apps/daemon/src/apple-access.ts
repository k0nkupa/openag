import { APPLE_BUNDLES, applePrerequisites, requestApplePermission, type AppleApp } from "./apple-permissions.js";
import type { ToolDef } from "./tools/registry.js";
import type { McpManager } from "./mcp.js";
import { managedPath } from "./package-files.js";
import { readFileSync, renameSync, writeFileSync } from "node:fs";

const probes: Record<AppleApp, { tool: string; args: Record<string, unknown> }> = {
  mail: { tool: "list-emails", args: { count: 1 } }, calendar: { tool: "list-events", args: { count: 1, daysAhead: 1 } },
  contacts: { tool: "list-contacts", args: { count: 1 } }, reminders: { tool: "list-reminders", args: { count: 1 } },
  notes: { tool: "list-notes", args: { count: 1 } }, messages: { tool: "list-chats", args: { limit: 1 } },
  safari: { tool: "list-safari-tabs", args: {} },
};

const RESULTS = new Set(["granted", "denied", "failed"]);
/** Last owner-run macOS permission result per app, so a daemon restart does not forget it. Read verification stays in memory: it is bound to the live connector's tools. */
function permissionStore(dataDir: string) {
  const file = () => managedPath(dataDir, "apple-permissions.json");
  return {
    load() {
      const map = new Map<string, "granted" | "denied" | "failed">();
      try {
        const saved = JSON.parse(readFileSync(file(), "utf8")) as Record<string, unknown>;
        for (const app of Object.keys(APPLE_BUNDLES)) { const value = Object.hasOwn(saved, app) ? saved[app] : undefined; if (typeof value === "string" && RESULTS.has(value)) map.set(app, value as "granted" | "denied" | "failed"); }
      } catch { /* missing or unreadable: start unchecked */ }
      return map;
    },
    save(map: Map<string, string>) {
      try { const path = file(), stage = `${path}.tmp`; writeFileSync(stage, JSON.stringify(Object.fromEntries(map)), { mode: 0o600 }); renameSync(stage, path); } catch { /* status stays correct for this run */ }
    },
  };
}

export function createAppleAccess(opts: { dataDir: string; mcp?: McpManager; permission?: typeof requestApplePermission; now?: () => number; audit?: (action: string, app: string) => void }) {
  const store = permissionStore(opts.dataDir), permissions = store.load();
  const verified = new Map<string, { at: number; tool: ToolDef }>();
  let busy = false;
  const appKey = (value: unknown): AppleApp => {
    if (typeof value !== "string" || !Object.hasOwn(APPLE_BUNDLES, value)) throw Error("Unknown Apple app");
    return value as AppleApp;
  };
  function server() { return opts.mcp?.status().find(s => s.id === "apple-apps" && s.package?.id === "apple-apps"); }
  return {
    status() {
      const runtime = server(), currentTools = new Set(opts.mcp?.ownerToolDefs() ?? []);
      return { connected: runtime?.state === "connected", busy, apps: applePrerequisites().map(item => ({ ...item, permission: permissions.get(item.app) ?? "unknown", verifiedAt: runtime?.state === "connected" && !!verified.get(item.app) && currentTools.has(verified.get(item.app)!.tool) ? verified.get(item.app)?.at ?? null : null })) };
    },
    async permission(value: unknown) {
      const app = appKey(value); if (busy) throw Error("Apple access check is already running");
      busy = true; verified.delete(app);
      try { const result = await (opts.permission ?? requestApplePermission)(app); permissions.set(app, result); store.save(permissions); opts.audit?.("apple_permission_checked", app); return { permission: result }; }
      finally { busy = false; }
    },
    async verify(value: unknown) {
      const app = appKey(value), runtime = server();
      if (busy || !runtime || runtime.state !== "connected") throw Error("Apple connector is unavailable or busy");
      busy = true; verified.delete(app);
      try {
        // An explicit owner health check, never a model-supplied tool name or arguments. Discard personal content.
        const probe = probes[app], name = `mcp.apple-apps.${probe.tool}`, tool = opts.mcp!.ownerToolDefs().find(t => t.name === name), executor = opts.mcp!.ownerExecutors()[name];
        if (!executor || !tool) throw Error("Apple read probe unavailable");
        await executor({ botId: "owner-check", dataDir: opts.dataDir }, probe.args);
        const current = server(); if (current?.state !== "connected" || !opts.mcp!.ownerToolDefs().includes(tool)) throw Error("Apple connector changed during check");
        const at = (opts.now ?? Date.now)(); verified.set(app, { at, tool }); opts.audit?.("apple_read_verified", app);
        return { verifiedAt: at };
      } finally { busy = false; }
    },
  };
}
export type AppleAccess = ReturnType<typeof createAppleAccess>;
