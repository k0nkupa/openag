import { randomBytes } from "node:crypto";
import type { Db } from "./db/index.js";
import type { Ledger } from "./ledger.js";
import { getDefaultRedactor, type Redactor } from "./redact.js";
import { getSetting } from "./settings.js";

/**
 * ntfy push notifications. ntfy.sh is a public relay: messages carry no payloads, paths or secrets, and the
 * topic (kept secret, registered with the redactor) is the only credential.
 */

const HOUR_MS = 3_600_000;
const TIMEOUT_MS = 5_000;
const DEDUPE_MAX = 500;
const TITLE = "OpenAg";
const TITLE_MAX = 60;
const MESSAGE_MAX = 200;
const REASON_MAX = 140;
const NAME_MAX = 80;
const NOT_CONFIGURED = "push is not enabled or has no topic";

export type PingUrgency = "low" | "normal" | "high";

export interface PushStatus {
  enabled: boolean;
  configured: boolean;
  sentThisHour: number;
  dropped: number;
  lastSentAt: number | null;
  lastError: string | null;
}

export interface PushResult {
  ok: boolean;
  reason?: string;
}

export interface Pusher {
  notifyApproval(e: { actor: string; payload: { toolName?: unknown; approvalId?: unknown; source?: unknown } }): Promise<void>;
  notifyInteraction(e: { actor: string; payload: { interactionId?: unknown; status?: unknown } }): Promise<void>;
  notifyPing(p: { botId: string; reason: string; urgency: PingUrgency }): Promise<void>;
  sendTest(): Promise<PushResult>;
  /** A text the bot asked to send (notify_user tool). Same gates as the others: enabled, topic, rate cap, redaction. */
  notifyUser(text: string): Promise<PushResult>;
  status(): PushStatus;
}

export interface PusherDeps {
  db: Db;
  fetch?: typeof fetch;
  now?: () => number;
  redactor?: Redactor;
}

/** "openag-" + 16 random bytes as base64url (128 bits, 29 characters in total). */
export function newPushTopic(): string {
  return `openag-${randomBytes(16).toString("base64url")}`;
}

/** Non-empty string of at most NAME_MAX characters, otherwise a generic fallback. */
function nameOr(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const t = value.trim();
  return t !== "" && t.length <= NAME_MAX ? t : fallback;
}

export function createPusher(deps: PusherDeps): Pusher {
  const { db } = deps;
  const doFetch = deps.fetch ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? (() => Date.now());
  const redactor = deps.redactor ?? getDefaultRedactor();

  const sentAt: number[] = []; // sliding one-hour window of send attempts
  const seenNotifications = new Set<string>();
  const seenOrder: string[] = [];
  let dropped = 0;
  let lastSentAt: number | null = null;
  let lastError: string | null = null;

  const prune = (t: number) => {
    while (sentAt.length > 0 && sentAt[0]! <= t - HOUR_MS) sentAt.shift();
  };

  /** The stored settings; the topic is registered with the redactor on every read. */
  const current = () => {
    const s = getSetting(db, "push");
    if (s.topic) redactor.addSecret(s.topic);
    return s;
  };

  const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

  /** Applies the rate cap. A test notification is user initiated: it is dropped only past three times the cap. */
  const admit = (isTest: boolean): boolean => {
    const t = now();
    prune(t);
    const max = current().maxPerHour;
    const limit = isTest ? max * 3 : max;
    if (sentAt.length >= limit) {
      dropped++;
      return false;
    }
    sentAt.push(t);
    return true;
  };

  async function post(body: Record<string, unknown>, server: string): Promise<PushResult> {
    const url = `${server.replace(/\/+$/, "")}/`;
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) {
        lastSentAt = now();
        lastError = null;
        return { ok: true };
      }
      lastError = `HTTP ${res.status}`;
      return { ok: false, reason: lastError };
    } catch (err) {
      // Only the error name: messages can echo the URL, and the URL is never safe to log.
      lastError = err instanceof Error ? err.name : "Error";
      return { ok: false, reason: lastError };
    }
  }

  /** Builds the request body from a settings snapshot and sends it. Never throws. */
  async function send(message: string, priority: number, s: ReturnType<typeof current>): Promise<PushResult> {
    const body: Record<string, unknown> = {
      topic: s.topic,
      title: TITLE,
      message: clip(redactor.redactString(message), MESSAGE_MAX),
      priority,
    };
    if (s.publicUrl) body.click = s.publicUrl;
    return post(body, s.server);
  }

  const configured = (s: ReturnType<typeof current>) => s.enabled && s.topic !== null;

  return {
    async notifyInteraction(e) {
      try {
        const s = current(), id = e.payload?.interactionId;
        if (!configured(s) || e.payload?.status !== "open" || typeof id !== "string" || !id) return;
        const key = `interaction:${id}`;
        if (seenNotifications.has(key)) return;
        seenNotifications.add(key);
        seenOrder.push(key);
        if (seenOrder.length > DEDUPE_MAX) seenNotifications.delete(seenOrder.shift()!);
        if (!admit(false)) return;
        await send(`Response needed: ${nameOr(e.actor, "an agent")}. Open OpenAg to answer a provider request.`, 4, s);
      } catch {
        /* a failed push never reaches the ledger or the turn */
      }
    },

    async notifyApproval(e) {
      try {
        const s = current();
        if (!configured(s)) return;
        const payload = e.payload ?? {};
        const approvalId = typeof payload.approvalId === "string" ? payload.approvalId : null;
        if (approvalId !== null) {
          if (seenNotifications.has(approvalId)) return;
          seenNotifications.add(approvalId);
          seenOrder.push(approvalId);
          if (seenOrder.length > DEDUPE_MAX) seenNotifications.delete(seenOrder.shift()!);
        }
        if (!admit(false)) return;
        const bot = nameOr(e.actor, "an agent");
        const tool = nameOr(payload.toolName, "a tool");
        const via = typeof payload.source === "string" && payload.source.startsWith("slack") ? " (from Slack)" : "";
        await send(`Approval needed: ${bot} wants ${tool}${via}. Open their conversation in OpenAg.`, 4, s);
      } catch {
        /* a failed push never reaches the ledger or the turn */
      }
    },

    async notifyPing(p) {
      try {
        const s = current();
        if (!configured(s)) return;
        if (!admit(false)) return;
        const bot = nameOr(p.botId, "an agent");
        const priority = p.urgency === "high" ? 5 : p.urgency === "low" ? 3 : 4;
        const message = s.includeDetail
          ? `Heads-up from ${bot}: ${clip(redactor.redactString(String(p.reason ?? "")), REASON_MAX)}`
          : `Heads-up from ${bot}. Open OpenAg to read it.`;
        await send(message, priority, s);
      } catch {
        /* see notifyApproval */
      }
    },

    async sendTest() {
      try {
        const s = current();
        if (!configured(s)) return { ok: false, reason: NOT_CONFIGURED };
        if (!admit(true)) return { ok: false, reason: "rate limit reached" };
        return await send("Test notification from OpenAg", 3, s);
      } catch {
        return { ok: false, reason: "Error" };
      }
    },

    async notifyUser(text) {
      try {
        const s = current();
        if (!configured(s)) return { ok: false, reason: NOT_CONFIGURED };
        if (!admit(false)) return { ok: false, reason: "rate limit reached" };
        return await send(text, 4, s);
      } catch {
        return { ok: false, reason: "Error" };
      }
    },

    status() {
      const s = current();
      prune(now());
      return {
        enabled: s.enabled,
        configured: s.topic !== null,
        sentThisHour: sentAt.length,
        dropped,
        lastSentAt,
        lastError,
      };
    },
  };
}

/** Live events only: a restart never reopens a provider request or repeats its notification. */
export function registerPushNotifications(ledger: Ledger, pusher: Pusher) {
  return ledger.subscribe("*", e => {
    if (e.type === "approval_requested" && !e.roomId.startsWith("_agent-request-"))
      void pusher.notifyApproval({ actor: e.actor, payload: (e.payload ?? {}) as { toolName?: unknown; approvalId?: unknown; source?: unknown } });
    if (e.type === "mcp_interaction_updated")
      void pusher.notifyInteraction({ actor: e.actor, payload: (e.payload ?? {}) as { interactionId?: unknown; status?: unknown } });
  });
}
