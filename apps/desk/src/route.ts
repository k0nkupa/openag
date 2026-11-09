import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { confirmLeave, hasUnsavedChanges, resolveLeave, warnBeforeUnload } from "./unsaved-changes";

/** Sub-pages of Settings that have their own address; the default page is Server. */
export type SettingsSection = "profile" | "models" | "proactive" | "memory" | "devices";
const SETTINGS_SECTIONS: readonly string[] = ["profile", "models", "proactive", "memory", "devices"];

export const PROACTIVE_TABS = ["schedule", "reflection", "notifications", "history"] as const;
export type ProactiveTab = typeof PROACTIVE_TABS[number];
export const AUTOMATION_TABS = ["automations", "responsibilities", "history"] as const;
export type AutomationTab = typeof AUTOMATION_TABS[number];
export const ROOM_PANEL_TABS = ["work", "files", "computer", "activity", "settings"] as const;
export type RoomPanelTab = typeof ROOM_PANEL_TABS[number];
export const BOT_SETTING_SECTIONS = ["model", "instructions", "memories", "skills", "permissions"] as const;
export type BotSettingSection = typeof BOT_SETTING_SECTIONS[number];

export type Route =
  | { kind: "home" }
  | {kind:"approval";approvalId:string}
  | { kind: "room"; roomId: string; workId?: string; panelTab?: RoomPanelTab; setting?: BotSettingSection }
  | { kind: "work"; workId?: string }
  | { kind: "settings"; section?: SettingsSection; tab?: ProactiveTab }
  | { kind: "computer" }
  | { kind: "automations"; tab?: AutomationTab; automationId?: string; runId?: string; editId?: string }
  | { kind: "connectors"; integrationId?: string }
  | { kind: "app-library"; integrationId?: string }
  | { kind: "bots"; botId?: string }
  | { kind: "ledger" };

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#/, "").split("/").filter((p) => p !== "").map(safeDecode);
  switch (parts[0]) {
    case "approvals":return {kind:"approval",approvalId:parts[1]??""};
    case "room": {
      if (!parts[1]) return {kind: "home"};
      const workId = parts[2] === "work" ? parts[3] : undefined, offset = workId ? 4 : 2;
      const panelTab = parts[offset] === "panel" && ROOM_PANEL_TABS.includes(parts[offset + 1] as RoomPanelTab) ? parts[offset + 1] as RoomPanelTab : undefined;
      const setting = panelTab === "settings" && BOT_SETTING_SECTIONS.includes(parts[offset + 2] as BotSettingSection) ? parts[offset + 2] as BotSettingSection : undefined;
      return {kind: "room", roomId: parts[1], ...(workId ? {workId} : {}), ...(panelTab ? {panelTab} : {}), ...(setting ? {setting} : {})};
    }
    case "work":
      return { kind: "work", ...(parts[1] ? { workId: parts[1] } : {}) };
    case "inbox":
      return { kind: "home" };
    case "settings":
      if (parts[1] === "memory") return { kind: "bots" };
      return parts[1] && SETTINGS_SECTIONS.includes(parts[1]) ? { kind: "settings", section: parts[1] as SettingsSection, ...(parts[1] === "proactive" && PROACTIVE_TABS.includes(parts[2] as ProactiveTab) ? {tab: parts[2] as ProactiveTab} : {}) } : { kind: "settings" };
    case "computer":
      return { kind: "computer" };
    case "automations":
      return {kind: "automations", ...(parts[1] === "edit" && parts[2] ? {editId: parts[2]} : AUTOMATION_TABS.includes(parts[1] as AutomationTab) ? {tab: parts[1] as AutomationTab, ...(parts[1] === "history" && parts[2] && parts[2] !== "run" ? {automationId: parts[2], ...(parts[3] === "run" && parts[4] ? {runId: parts[4]} : {})} : parts[1] === "history" && parts[2] === "run" && parts[3] ? {runId: parts[3]} : {})} : {})};
    case "app-library":
      return { kind: "app-library", ...(parts[1] ? {integrationId: parts[1]} : {}) };
    case "connectors":
      return { kind: "connectors", ...(parts[1] ? {integrationId: parts[1]} : {}) };
    case "bots":
      return parts[1] ? { kind: "bots", botId: parts[1] } : { kind: "bots" };
    case "ledger":
      return { kind: "ledger" };
    default:
      return { kind: "home" };
  }
}

export function hrefFor(route: Route): string {
  switch (route.kind) {
    case "home":
      return "#/";
    case "approval":return `#/approvals/${encodeURIComponent(route.approvalId)}`;
    case "room":
      return `#/room/${encodeURIComponent(route.roomId)}${route.workId?`/work/${encodeURIComponent(route.workId)}`:""}${route.panelTab ? `/panel/${route.panelTab}${route.panelTab === "settings" && route.setting ? "/" + route.setting : ""}` : ""}`;
    case "settings":
      return route.section ? `#/settings/${route.section}${route.section === "proactive" && route.tab ? "/" + route.tab : ""}` : "#/settings";
    case "work":
      return route.workId ? `#/work/${encodeURIComponent(route.workId)}` : "#/work";
    case "app-library":
    case "connectors":
      return `#/${route.kind}${route.integrationId ? `/${encodeURIComponent(route.integrationId)}` : ""}`;
    case "automations":
      return "#/automations" + (route.editId ? "/edit/" + encodeURIComponent(route.editId) : route.tab && route.tab !== "automations" ? "/" + route.tab + (route.tab === "history" ? (route.automationId ? "/" + encodeURIComponent(route.automationId) : "") + (route.runId ? "/run/" + encodeURIComponent(route.runId) : "") : "") : "");
    case "computer":
    case "ledger":
      return `#/${route.kind}`;
    case "bots":
      return route.botId ? `#/bots/${encodeURIComponent(route.botId)}` : "#/bots";
  }
}

/** These context changes keep every editable child mounted; destination changes still use the leave guard. */
function retainsEditors(from: Route, to: Route) {
  return from.kind === "settings" && to.kind === "settings" && from.section === "proactive" && to.section === "proactive"
    || from.kind === "room" && to.kind === "room" && from.roomId === to.roomId && from.workId === to.workId
    || from.kind === "automations" && to.kind === "automations" && from.editId === to.editId;
}

let interactionRevision = 0;
let confirmedHash: { hash: string; revision: number; replace?: boolean } | null = null;
export const navigationRevision = () => interactionRevision;

/** Same-document replacement keeps the current history position, including Home/bookmark redirects. */
export async function replaceRoute(hash: string) {
  const origin = window.location.hash;
  if (origin === hash || !await confirmLeave() || window.location.hash !== origin) return;
  confirmedHash = { hash, revision: interactionRevision, replace: true };
  window.history.replaceState(window.history.state, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** Used only after the leave choice, before creating an agent's direct chat. */
export function navigateConfirmed(hash: string, revision: number) {
  if (window.location.hash === hash) return;
  confirmedHash = { hash, revision };
  window.location.hash = hash;
}

export function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  const accepted = useRef({ hash: window.location.hash, position: Number.isInteger(window.history.state?.openagRoutePosition) ? window.history.state.openagRoutePosition : 0 });
  useLayoutEffect(() => {
    const stamp = () => window.history.replaceState({ ...window.history.state, openagRoutePosition: accepted.current.position }, "");
    stamp();
    let alive = true;
    let navigating = false;
    let replayTarget: { hash: string; position: number } | null = null;
    let restoring: { promise: Promise<boolean>; done: (ok: boolean) => void } | null = null;
    const restore = (delta: number) => {
      if (!restoring) {
        let done!: (ok: boolean) => void;
        const promise = new Promise<boolean>(resolve => { done = resolve; });
        restoring = { promise, done };
      }
      window.history.go(-delta);
      return restoring.promise;
    };
    const onChange = async () => {
      let next = window.location.hash;
      if (next === accepted.current.hash) {
        restoring?.done(true); restoring = null;
        return;
      }
      if (replayTarget) {
        // A second hash push can replace the forward entry while the first leave choice is open.
        if (next !== replayTarget.hash) {
          window.history.replaceState({ ...window.history.state, openagRoutePosition: replayTarget.position }, "", replayTarget.hash);
          next = replayTarget.hash;
        }
        replayTarget = null;
      }
      const recordedPosition = window.history.state?.openagRoutePosition;
      const confirmed = next === confirmedHash?.hash && interactionRevision === confirmedHash.revision;
      // Some hash pushes inherit state. Equal positions only represent our explicit replacement.
      const position = recordedPosition !== accepted.current.position || confirmed && confirmedHash?.replace ? recordedPosition : undefined;
      confirmedHash = null;
      if (!confirmed && hasUnsavedChanges() && !retainsEditors(parseHash(accepted.current.hash), parseHash(next))) {
        const delta = Number.isInteger(position) ? position - accepted.current.position : 1;
        const restored = restore(delta);
        if (navigating) return;
        navigating = true;
        try {
          if (!await restored || !alive) return;
          const leave = await confirmLeave();
          if (restoring && !await restoring.promise) return;
          if (leave && alive) {
            confirmedHash = { hash: next, revision: interactionRevision };
            replayTarget = { hash: next, position: accepted.current.position + delta };
            window.history.go(delta);
          }
        } finally { navigating = false; }
        return;
      }
      accepted.current = { hash: next, position: Number.isInteger(position) ? position : accepted.current.position + 1 };
      stamp();
      setHash(next);
    };
    window.addEventListener("hashchange", onChange);
    window.addEventListener("beforeunload", warnBeforeUnload);
    // Count interactions, including custom controls and portals, without retaining draft values.
    const interacted = () => { interactionRevision++; };
    const events = ["input", "change", "click", "keydown"];
    events.forEach(event => document.addEventListener(event, interacted, true));
    return () => {
      alive = false; restoring?.done(false); resolveLeave();
      window.removeEventListener("hashchange", onChange); window.removeEventListener("beforeunload", warnBeforeUnload);
      events.forEach(event => document.removeEventListener(event, interacted, true));
    };
  }, []);
  return useMemo(() => parseHash(hash), [hash]);
}
