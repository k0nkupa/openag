import type { Auth } from "./auth.js";
import type { Backups } from "./backup.js";
import { defaultBotStatus } from "./defaultbot.js";
import { deliveryStatus } from "./delivery.js";
import type { Db } from "./db/index.js";
import type { Ledger } from "./ledger.js";
import type { Ops } from "./ops.js";
import { listBots } from "./rooms.js";
import { getSetting, setSetting } from "./settings.js";

/**
 * What makes the agent really always-on, computed from live state. `apply` enables the heartbeat, reflection and brief.
 * Reflection uses an isolated turn followed by daemon-managed memory saves; skills require approval. It never enables push,
 * Slack, WebRTC or anything that needs a secret or an outside account.
 */

const BACKUP_FRESH_MS = 36 * 3_600_000;

export interface ReadinessItem {
  id: string;
  title: string;
  done: boolean;
  /** Required for "always on"; optional items are listed but never block. */
  required: boolean;
  /** One line on the current state (never a secret). */
  detail: string;
  /** What to do when it is not done. */
  how: string;
}

export interface Readiness {
  ready: boolean;
  items: ReadinessItem[];
}

export interface ReadinessDeps {
  db: Db;
  ledger: Ledger;
  auth: Pick<Auth, "listDevices">;
  backups?: Pick<Backups, "status">;
  ops?: Pick<Ops, "status">;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

export function createReadiness(deps: ReadinessDeps) {
  const { db } = deps;
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());

  function check(): Readiness {
    const defaultBot = defaultBotStatus(db, env);
    const delivery = deliveryStatus(db);
    const hb = getSetting(db, "heartbeat");
    const refl = getSetting(db, "reflection");
    const brief = getSetting(db, "brief");
    const push = getSetting(db, "push");
    const bk = deps.backups?.status();
    const lastBackupOk = bk?.last?.ok === true && now() - bk.last.at < BACKUP_FRESH_MS;
    const hc = deps.ops?.status().healthcheck;
    const devices = deps.auth.listDevices().filter((d) => d.revokedAt === null).length;
    const bots = listBots(db).length;
    const slack = getSetting(db, "slack");
    const rtc = getSetting(db, "rtc");

    const items: ReadinessItem[] = [
      { id: "heartbeat", title: "Heartbeat", required: true, done: hb.enabled, detail: hb.enabled ? `every ${hb.everyMinutes} min` : "off", how: "Enable the heartbeat (the 'Enable recommended' button does it)." },
      { id: "reflection", title: "Nightly reflection", required: true, done: refl.enabled, detail: refl.enabled ? `at ${refl.time}` : "off", how: "Enable reflection (the 'Enable recommended' button does it)." },
      { id: "brief", title: "Morning brief", required: true, done: brief.enabled, detail: brief.enabled ? `at ${brief.time}` : "off", how: "Enable the brief (the 'Enable recommended' button does it)." },
      { id: "push", title: "Push notifications", required: true, done: push.enabled && !!push.topic, detail: push.enabled ? (push.topic ? "on" : "enabled but no topic") : "off", how: "Settings, Proactive: generate a topic, subscribe to it in the ntfy app, enable." },
      { id: "backup", title: "Recent backup", required: true, done: lastBackupOk, detail: bk?.last ? (bk.last.ok ? `last ok ${new Date(bk.last.at).toISOString()}` : "last attempt failed") : bk?.enabled === false ? "disabled" : "none yet", how: "Settings, Server, Operations: keep backups enabled, or press 'Back up now'." },
      { id: "liveness", title: "Liveness ping", required: true, done: hc?.configured === true, detail: hc?.configured ? (hc.lastOkAt ? "pinging" : "configured, no ping yet") : "not configured", how: "Set OPENAG_HEALTHCHECK_URL (an https ping URL from healthchecks.io or Uptime Kuma) in the service environment and reinstall." },
      { id: "device", title: "A paired device", required: true, done: devices > 0, detail: `${devices} active`, how: "Pair your phone or browser (Settings, Devices)." },
      { id: "defaultBot", title: "Default bot", required: true, done: defaultBot.state === "ok", detail: defaultBot.state === "ok" ? defaultBot.botId : defaultBot.reason, how: "The default bot runs the heartbeat and reflection when no bot is chosen. The service creates it on start; an administrator installs its adapter or sets its provider key." },
      { id: "delivery", title: "Where pings and the brief go", required: true, done: delivery.state === "ok", detail: delivery.state === "ok" ? (delivery.via === "setting" ? `room ${delivery.roomId}` : "the default bot's chat") : delivery.reason, how: "By default pings and the brief go to the default bot's chat. The owner can pick a room instead (setting deliveryRoom); a room that was set but no longer exists must be fixed." },
      { id: "bots", title: "At least two bots", required: true, done: bots >= 2, detail: `${bots} configured`, how: "Add a specialist next to the lead (see scripts/seed)." },
      { id: "keepawake", title: "Keeps the Mac awake", required: false, done: env.OPENAG_KEEP_AWAKE === "1", detail: env.OPENAG_KEEP_AWAKE === "1" ? "on" : "not set for this process", how: "Reinstall with OPENAG_KEEP_AWAKE=1 if the Mac idle-sleeps." },
      { id: "slack", title: "Slack channel", required: false, done: slack.enabled, detail: slack.enabled ? "on" : "off", how: "Optional: docs/notes/slack.md." },
      { id: "webrtc", title: "WebRTC join without VPN", required: false, done: rtc.enabled, detail: rtc.enabled ? "on" : "off", how: "Optional: Tailscale already covers this." },
    ];
    return { ready: items.filter((i) => i.required).every((i) => i.done), items };
  }

  return {
    check,
    /** Enables heartbeat, reflection and the brief. Idempotent. Returns which ones changed. */
    apply(): { changed: string[]; readiness: Readiness } {
      const changed: string[] = [];
      const hb = getSetting(db, "heartbeat");
      if (!hb.enabled) {
        setSetting(db, "heartbeat", { ...hb, enabled: true });
        changed.push("heartbeat");
      }
      const refl = getSetting(db, "reflection");
      if (!refl.enabled) {
        setSetting(db, "reflection", { ...refl, enabled: true });
        changed.push("reflection");
      }
      const brief = getSetting(db, "brief");
      if (!brief.enabled) {
        setSetting(db, "brief", { ...brief, enabled: true });
        changed.push("brief");
      }
      if (changed.length > 0) deps.ledger.append("_system", "user", "config", { action: "readiness_applied", changed });
      return { changed, readiness: check() };
    },
  };
}
export type ReadinessService = ReturnType<typeof createReadiness>;
