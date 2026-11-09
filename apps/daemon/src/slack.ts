import WebSocket from "ws";
import type { Db } from "./db/index.js";
import type { Ingress } from "./ingress.js";
import type { Ledger, LedgerEvent } from "./ledger.js";
import { getDefaultRedactor, type Redactor } from "./redact.js";
import { getRoom } from "./rooms.js";
import { getSetting } from "./settings.js";

/**
 * Slack channel (Socket Mode): the same bots answer in one Slack channel. Outbound-only networking (no tunnel): the daemon
 * opens a WebSocket to Slack. Rules that keep it safe:
 * - OFF by default; needs BOTH tokens in env (`SLACK_APP_TOKEN` xapp-, `SLACK_BOT_TOKEN` xoxb-), never in the DB or API;
 * - only messages from the ONE configured channel by an explicitly ALLOWED Slack user id reach a room (everyone else, bots,
 *   edits and other subtypes are dropped); an empty allow-list means nobody;
 * - an inbound message is an ordinary user message in the configured room (redacted by the ledger, tagged `[Slack]`), with
 *   per-user rate limiting and de-duplication; it gets the same policy gate and approvals as any desk message;
 * - APPROVALS ARE NEVER RESOLVED FROM SLACK: Slack only gets a one-line "waiting for approval in the desk" notice;
 * - only replies to Slack-originated messages go back (the reply, a notice, a failure line), into that message's thread,
 *   escaped (`&`, `<`, `>`) so a bot cannot ping @channel or inject links; hosts are fixed, redirects refused, short fixed
 *   error strings, the socket URL must be a Slack host.
 */

const API_HOST = "https://slack.com";
const APP_TOKEN_RE = /^xapp-[A-Za-z0-9-]{10,300}$/;
const BOT_TOKEN_RE = /^xoxb-[A-Za-z0-9-]{10,300}$/;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_FRAME_BYTES = 256 * 1024;
const MAX_INBOUND_CHARS = 4000;
const MAX_OUTBOUND_CHARS = 3500;
const PER_USER_PER_MIN = 10;
const SEEN_MAX = 500;
const THREADS_MAX = 300;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;

export interface SlackStatus {
  enabled: boolean;
  /** null when ready; otherwise why the channel is inert (fixed vocabulary, never a secret). */
  inert: string | null;
  connected: boolean;
  received: number;
  sent: number;
  dropped: number;
  lastError: string | null;
  lastEventAt: number | null;
  /** Last time anything (a frame or a pong) arrived on the socket. */
  lastFrameAt: number | null;
}

/** Minimal WebSocket surface (so tests can inject a fake). */
export interface SlackSocket {
  on(event: "message", cb: (data: { toString(): string }) => void): void;
  on(event: "close" | "error" | "pong", cb: () => void): void;
  send(data: string): void;
  close(): void;
  /** Optional (ws has both): a protocol ping, and an immediate hard close for a connection that stopped answering. */
  ping?(): void;
  terminate?(): void;
}

export interface SlackDeps {
  db: Db;
  ledger: Ledger;
  ingress: Ingress;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  connect?: (url: string) => SlackSocket;
  now?: () => number;
  redactor?: Redactor;
  /** Test hook: reconnect delays. */
  backoff?: { minMs: number; maxMs: number };
  /** Half-open detection: ping every `pingMs`; nothing heard for `timeoutMs` = the connection is dead. */
  liveness?: { pingMs: number; timeoutMs: number };
}

export interface SlackChannel {
  /** (Re)reads the setting and env, then connects, reconnects or disconnects. Never throws. */
  reload(): void;
  stop(): void;
  status(): SlackStatus;
}

interface Thread {
  channel: string;
  ts: string;
  /** A delegated specialist's own turn: its output and notices stay in the desk; only the lead's answer is relayed. */
  silent?: boolean;
}

/** Slack's control characters. Escaping them is what stops `<!channel>`, `<@U..>` and `<http://..|label>` from being active. */
export const escapeSlack = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The socket URL Slack hands out must be wss on a Slack-owned host, without credentials. */
export function isSlackSocketUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 2000) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "wss:" && u.username === "" && u.password === "" && (u.hostname === "slack.com" || u.hostname.endsWith(".slack.com") || u.hostname.endsWith(".slack-msgs.com"));
  } catch {
    return false;
  }
}

/** Slack sends `&`, `<` and `>` as entities: the bot should see the real characters. */
const unescapeSlack = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function createSlackChannel(deps: SlackDeps): SlackChannel {
  const { db, ledger, ingress } = deps;
  const env = deps.env ?? process.env;
  const doFetch = deps.fetch ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? (() => Date.now());
  const redactor = deps.redactor ?? getDefaultRedactor();
  const connectSocket =
    deps.connect ??
    ((url: string): SlackSocket => new WebSocket(url, { maxPayload: MAX_FRAME_BYTES, handshakeTimeout: REQUEST_TIMEOUT_MS, followRedirects: false }) as unknown as SlackSocket);
  const backoff = deps.backoff ?? { minMs: BACKOFF_MIN_MS, maxMs: BACKOFF_MAX_MS };
  const liveness = deps.liveness ?? { pingMs: 30_000, timeoutMs: 90_000 };

  let generation = 0; // bumped by every reload/stop: stale connections and timers see a different value and stand down
  let socket: SlackSocket | null = null;
  let timer: NodeJS.Timeout | null = null;
  let connected = false;
  let delay = backoff.minMs;
  let received = 0;
  let sent = 0;
  let dropped = 0;
  let lastError: string | null = null;
  let lastEventAt: number | null = null;
  let lastFrameAt: number | null = null;

  const seen = new Set<string>();
  const seenOrder: string[] = [];
  const userHits = new Map<string, number[]>();
  const threadByMessage = new Map<number, Thread>();
  const threadByTurn = new Map<string, Thread>();
  let outbox: Promise<void> = Promise.resolve();

  const remember = <K, V>(map: Map<K, V>, key: K, value: V) => {
    map.set(key, value);
    if (map.size > THREADS_MAX) map.delete(map.keys().next().value as K);
  };

  function tokens(): { app: string; bot: string } | null {
    const app = env.SLACK_APP_TOKEN;
    const bot = env.SLACK_BOT_TOKEN;
    if (!app || !bot || !APP_TOKEN_RE.test(app) || !BOT_TOKEN_RE.test(bot)) return null;
    redactor.addSecret(app);
    redactor.addSecret(bot);
    return { app, bot };
  }

  function inertReason(): string | null {
    const cfg = getSetting(db, "slack");
    if (!cfg.enabled) return "disabled";
    if (!tokens()) return "SLACK_APP_TOKEN / SLACK_BOT_TOKEN are not set (or malformed)";
    if (!cfg.channelId) return "no channel configured";
    if (cfg.allowedUsers.length === 0) return "no allowed users configured";
    const room = cfg.roomId ? getRoom(db, cfg.roomId) : undefined;
    if (!room || room.id.startsWith("_")) return "room not found";
    return null;
  }

  function setError(message: string): void {
    lastError = message;
  }

  // ---- inbound ---------------------------------------------------------------------------------------------------

  function rateLimited(user: string): boolean {
    const t = now();
    const hits = (userHits.get(user) ?? []).filter((x) => x > t - 60_000);
    if (hits.length >= PER_USER_PER_MIN) {
      userHits.set(user, hits);
      return true;
    }
    hits.push(t);
    userHits.set(user, hits);
    return false;
  }

  function handleEvent(payload: unknown): void {
    if (!isRecord(payload) || payload.type !== "event_callback" || !isRecord(payload.event)) return;
    const ev = payload.event;
    const cfg = getSetting(db, "slack");
    if (inertReason() !== null) return;
    if (ev.type !== "message") return;
    // Edits, deletions, joins, bot messages (including our own replies): never a prompt.
    if (ev.subtype !== undefined || ev.bot_id !== undefined) return;
    const channel = str(ev.channel);
    const user = str(ev.user);
    const text = str(ev.text);
    const ts = str(ev.ts);
    if (!channel || !user || !text || !ts || text.trim() === "") return;
    if (channel !== cfg.channelId || !cfg.allowedUsers.includes(user)) {
      dropped++;
      return;
    }
    const key = `${channel}:${ts}`;
    if (seen.has(key)) return;
    seen.add(key);
    seenOrder.push(key);
    if (seenOrder.length > SEEN_MAX) seen.delete(seenOrder.shift()!);
    if (rateLimited(user)) {
      dropped++;
      return;
    }
    const room = getRoom(db, cfg.roomId!)!;
    received++;
    lastEventAt = now();
    const threadTs = str(ev.thread_ts) ?? ts;
    void ingress
      .post(room, `[Slack] ${unescapeSlack(text).slice(0, MAX_INBOUND_CHARS)}`, {
        actor: "slack",
        extra: { source: "slack", slackUser: user },
        // Before dispatch: the first turn event must already find its thread.
        onMessage: (m) => remember(threadByMessage, m.id, { channel, ts: threadTs }),
      })
      .catch(() => setError("could not post the Slack message to the room"));
  }

  // ---- outbound --------------------------------------------------------------------------------------------------

  function post(thread: Thread, text: string): void {
    if (thread.silent) return;
    const t = tokens();
    if (!t) return;
    const escaped = escapeSlack(text);
    const shown = escaped.length > MAX_OUTBOUND_CHARS ? `${escaped.slice(0, MAX_OUTBOUND_CHARS - 1)}…` : escaped;
    const body = JSON.stringify({
      channel: thread.channel,
      thread_ts: thread.ts,
      text: shown,
      parse: "none",
      link_names: false,
      unfurl_links: false,
      unfurl_media: false,
      mrkdwn: false,
    });
    outbox = outbox
      .then(async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await doFetch(`${API_HOST}/api/chat.postMessage`, {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            headers: { authorization: `Bearer ${t.bot}`, "content-type": "application/json; charset=utf-8" },
            body,
          });
          if (res.status === 429 && attempt === 0) {
            await res.arrayBuffer().catch(() => undefined);
            const wait = Math.min(30, Math.max(1, Number(res.headers.get("retry-after")) || 1));
            await new Promise((r) => setTimeout(r, wait * 1000));
            continue;
          }
          const json = (await res.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null;
          if (res.ok && json?.ok === true) {
            sent++;
          } else {
            const code = typeof json?.error === "string" && /^[a-z_]{1,40}$/.test(json.error) ? json.error : `http_${res.status}`;
            setError(`slack rejected the reply: ${code}`);
          }
          return;
        }
      })
      .catch(() => setError("could not reach Slack"));
  }

  function onLedger(e: LedgerEvent): void {
    if (e.type !== "turn_started" && e.type !== "route" && e.type !== "bot_output" && e.type !== "approval_requested" && e.type !== "turn_finished") return;
    const cfg = getSetting(db, "slack");
    if (!cfg.enabled || e.roomId !== cfg.roomId) return;
    const p = isRecord(e.payload) ? e.payload : {};
    const turnId = str(p.turnId);
    const thread = turnId ? threadByTurn.get(turnId) : undefined;
    switch (e.type) {
      case "turn_started": {
        const t = typeof p.messageId === "number" ? threadByMessage.get(p.messageId) : undefined;
        if (t && turnId) remember(threadByTurn, turnId, t);
        break;
      }
      case "route": {
        // These arrive AFTER the parent turn finished, so mappings are kept (bounded) rather than dropped on finish.
        if (!thread || typeof p.messageId !== "number") break;
        // Work handed to a specialist: its own turn is tracked but SILENT. Its result going back to the lead is
        // relayed again, so the lead's final answer lands in the same thread.
        remember(threadByMessage, p.messageId, p.delegatedBy !== undefined ? { ...thread, silent: true } : { channel: thread.channel, ts: thread.ts });
        break;
      }
      case "bot_output":
        if (thread && thread.channel === cfg.channelId && typeof p.text === "string" && p.text.trim() !== "") post(thread, p.text);
        break;
      case "approval_requested":
        // No payload, no approval id, no link: approvals are decided in the desk only.
        if (thread && thread.channel === cfg.channelId) post(thread, "Waiting for your approval in the OpenAg desk.");
        break;
      case "turn_finished":
        if (thread && p.status === "failed" && thread.channel === cfg.channelId) post(thread, "That turn failed. See the desk for details.");
        break;
      default:
        break;
    }
  }
  ledger.subscribe("*", onLedger);

  // ---- connection ------------------------------------------------------------------------------------------------

  function scheduleReconnect(gen: number): void {
    if (gen !== generation) return;
    connected = false;
    if (timer) clearTimeout(timer);
    const wait = delay;
    delay = Math.min(backoff.maxMs, delay * 2);
    timer = setTimeout(() => void open(gen), wait);
    timer.unref?.();
  }

  async function open(gen: number): Promise<void> {
    if (gen !== generation) return;
    const t = tokens();
    if (!t || inertReason() !== null) return;
    let url: string;
    try {
      const res = await doFetch(`${API_HOST}/api/apps.connections.open`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { authorization: `Bearer ${t.app}`, "content-type": "application/x-www-form-urlencoded" },
      });
      const json = (await res.json().catch(() => null)) as { ok?: unknown; url?: unknown; error?: unknown } | null;
      if (!res.ok || json?.ok !== true || !isSlackSocketUrl(json.url)) {
        const code = typeof json?.error === "string" && /^[a-z_]{1,40}$/.test(json.error) ? json.error : `http_${res.status}`;
        setError(`could not open the Slack connection: ${code}`);
        scheduleReconnect(gen);
        return;
      }
      url = json.url;
    } catch {
      setError("could not reach Slack");
      scheduleReconnect(gen);
      return;
    }
    if (gen !== generation) return;
    let ws: SlackSocket;
    try {
      ws = connectSocket(url);
    } catch {
      setError("could not open the Slack socket");
      scheduleReconnect(gen);
      return;
    }
    socket = ws;
    lastFrameAt = now();
    ws.on("pong", () => {
      if (gen === generation) lastFrameAt = now();
    });
    ws.on("message", (data) => {
      if (gen !== generation) return;
      lastFrameAt = now();
      let frame: unknown;
      try {
        const raw = data.toString();
        if (raw.length > MAX_FRAME_BYTES) return;
        frame = JSON.parse(raw);
      } catch {
        return;
      }
      if (!isRecord(frame)) return;
      const envelope = str(frame.envelope_id);
      // Acknowledge first so Slack does not redeliver; de-duplication above covers the retries that still happen.
      if (envelope && envelope.length <= 200) {
        try {
          ws.send(JSON.stringify({ envelope_id: envelope }));
        } catch {
          // the close handler reconnects
        }
      }
      switch (frame.type) {
        case "hello":
          connected = true;
          delay = backoff.minMs;
          lastError = null;
          break;
        case "disconnect":
          try {
            ws.close();
          } catch {
            // already closed
          }
          break;
        case "events_api":
          try {
            handleEvent(frame.payload);
          } catch {
            setError("could not handle a Slack event");
          }
          break;
        default:
          break;
      }
    });
    let goneOnce = false;
    const gone = () => {
      if (gen !== generation || goneOnce) return; // ws emits `error` and then `close`
      goneOnce = true;
      if (socket === ws) socket = null;
      scheduleReconnect(gen);
    };
    // A half-open connection (sleep, Wi-Fi change) never closes by itself: ping, and give up when nothing comes back.
    const watch = setInterval(() => {
      if (gen !== generation || goneOnce) {
        clearInterval(watch);
        return;
      }
      if (now() - (lastFrameAt ?? 0) > liveness.timeoutMs) {
        clearInterval(watch);
        setError("the Slack connection went silent");
        try {
          (ws.terminate ?? ws.close).call(ws);
        } catch {
          // already gone
        }
        gone();
        return;
      }
      try {
        ws.ping?.();
      } catch {
        // the close handler reconnects
      }
    }, liveness.pingMs);
    watch.unref?.();
    ws.on("close", () => {
      clearInterval(watch);
      gone();
    });
    ws.on("error", () => {
      setError("the Slack connection failed");
      clearInterval(watch);
      gone();
    });
  }

  function stop(): void {
    generation++;
    connected = false;
    if (timer) clearTimeout(timer);
    timer = null;
    const s = socket;
    socket = null;
    try {
      s?.close();
    } catch {
      // already closed
    }
  }

  return {
    reload() {
      stop();
      delay = backoff.minMs;
      lastError = null;
      if (inertReason() !== null) return;
      void open(generation).catch(() => setError("could not reach Slack"));
    },
    stop,
    status() {
      const cfg = getSetting(db, "slack");
      return { enabled: cfg.enabled, inert: inertReason(), connected, received, sent, dropped, lastError, lastEventAt, lastFrameAt };
    },
  };
}
