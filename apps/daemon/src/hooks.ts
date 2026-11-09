import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createRateLimiter } from "./auth.js";

/**
 * Public ingress for automations: `POST /hooks/:slug`. UNAUTHENTICATED by design (the caller is GitHub, Slack or a
 * script), so everything here is defensive: the body is capped before it is read, the signature is verified over the
 * RAW bytes before anything is parsed, unknown slugs and bad signatures look identical, failures are rate limited per
 * client and globally, successes per hook and globally, and neither the secret nor the body is ever logged.
 */

export type HookKind = "webhook" | "github" | "slack";

export interface HookTarget {
  id: string;
  kind: HookKind;
  /** webhook: sha256 hex of the shared secret. */
  secretHash: string | null;
  /** github/slack: the signing secret (HMAC needs the raw value). */
  secret: string | null;
  /** Allowed event names (github `X-GitHub-Event`, slack event type). Empty = none allowed (webhook ignores it). */
  events: string[];
  enabled: boolean;
}

export interface HookFire {
  event: string;
  /** Parsed JSON body. Untrusted. */
  payload: unknown;
  /** Delivery id when the sender provides one (used only for de-duplication). */
  deliveryId: string | null;
}

export interface HookDeps {
  lookup(slug: string): HookTarget | undefined;
  /** Starts the run in the background. Must not throw. `accepted:false` carries a short reason (e.g. "busy"). */
  fire(target: HookTarget, input: HookFire): { accepted: boolean; reason?: string };
  now?: () => number;
  /** Called (throttled by the caller if needed) with a SHORT reason, never the secret or the body. */
  onRejected?: (reason: string, clientKey: string) => void;
}

export const HOOK_MAX_BODY_BYTES = 256 * 1024;
const SLACK_MAX_SKEW_S = 5 * 60;
const FAIL_PER_CLIENT = { max: 20, windowMs: 60_000 };
// Probes of slugs that do not exist share one small budget. It can only ever throttle OTHER unknown-slug requests:
// requests for a real hook never touch it, so an attacker spraying bad slugs cannot lock out GitHub or Slack.
const PROBE_GLOBAL = { max: 120, windowMs: 60_000 };
const OK_PER_HOOK = { max: 30, windowMs: 60_000 };
const OK_GLOBAL = { max: 120, windowMs: 60_000 };
const DEDUPE_TTL_MS = 10 * 60_000;
const DEDUPE_MAX = 2_000;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

function safeEqualHex(a: string, b: string): boolean {
  // Compare fixed-length digests so neither length nor content leaks through timing.
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db) && a.length === b.length;
}

const hmacHex = (secret: string, data: string | Buffer) => createHmac("sha256", secret).update(data).digest("hex");

/** Reads at most `max` bytes. Returns null when the body is larger (the rest is not read). */
async function readCapped(req: Request, max: number): Promise<Buffer | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export interface HookHandler {
  handle(req: Request, slug: string, clientKey: string): Promise<Response>;
}

export function createHookHandler(deps: HookDeps): HookHandler {
  const now = deps.now ?? Date.now;
  const failClient = createRateLimiter({ ...FAIL_PER_CLIENT, now });
  const probeGlobal = createRateLimiter({ ...PROBE_GLOBAL, now });
  const okHook = createRateLimiter({ ...OK_PER_HOOK, now });
  const okGlobal = createRateLimiter({ ...OK_GLOBAL, now });
  const seen = new Map<string, number>(); // `${hookId}:${deliveryId}` -> ts, only for deliveries that were ACCEPTED

  const isDuplicate = (key: string): boolean => {
    const t = now();
    for (const [k, ts] of seen) {
      if (t - ts > DEDUPE_TTL_MS) seen.delete(k);
      else break; // insertion order = age order
    }
    return seen.has(key);
  };
  const remember = (key: string) => {
    seen.set(key, now());
    while (seen.size > DEDUPE_MAX) seen.delete(seen.keys().next().value as string);
  };

  // Identical answer for an unknown slug, a disabled hook and a bad signature: a probe learns nothing.
  const unauthorized = (client: string, reason: string) => {
    failClient.record(client);
    deps.onRejected?.(reason, client);
    return json(401, { error: "unauthorized" });
  };

  function verify(target: HookTarget, req: Request, raw: Buffer): { ok: true; event: string; deliveryId: string | null } | { ok: false; reason: string } {
    const h = (n: string) => req.headers.get(n) ?? "";
    if (target.kind === "webhook") {
      const bearer = h("authorization").startsWith("Bearer ") ? h("authorization").slice(7) : "";
      const given = h("x-openag-secret") || bearer;
      if (!given || given.length > 512 || !target.secretHash) return { ok: false, reason: "missing secret" };
      return safeEqualHex(sha256Hex(given), target.secretHash)
        ? { ok: true, event: "webhook", deliveryId: null }
        : { ok: false, reason: "bad secret" };
    }
    if (!target.secret) return { ok: false, reason: "no secret configured" };
    if (target.kind === "github") {
      const sig = h("x-hub-signature-256");
      if (!sig.startsWith("sha256=")) return { ok: false, reason: "missing signature" };
      if (!safeEqualHex(sig.slice(7), hmacHex(target.secret, raw))) return { ok: false, reason: "bad signature" };
      return { ok: true, event: h("x-github-event") || "unknown", deliveryId: h("x-github-delivery") || null };
    }
    // slack
    const ts = h("x-slack-request-timestamp");
    const sig = h("x-slack-signature");
    const tsNum = Number(ts);
    if (!sig.startsWith("v0=") || !/^\d{9,12}$/.test(ts)) return { ok: false, reason: "missing signature" };
    if (Math.abs(Math.floor(now() / 1000) - tsNum) > SLACK_MAX_SKEW_S) return { ok: false, reason: "stale timestamp" };
    const base = Buffer.concat([Buffer.from(`v0:${ts}:`), raw]);
    if (!safeEqualHex(sig.slice(3), hmacHex(target.secret, base))) return { ok: false, reason: "bad signature" };
    return { ok: true, event: "slack", deliveryId: null };
  }

  return {
    async handle(req, slug, client) {
      if (req.method !== "POST") return json(405, { error: "method not allowed" }, { allow: "POST" });
      // A client that keeps failing is refused before any work is done (keyed per client, so many sources cannot
      // lock each other out).
      const fc = failClient.check(client);
      if (!fc.ok) return json(429, { error: "too many attempts" }, { "retry-after": String(fc.retryAfterSec) });

      const target = SLUG_RE.test(slug) ? deps.lookup(slug) : undefined;
      if (!target || !target.enabled) {
        const probe = probeGlobal.allow("global");
        if (!probe.ok) return json(429, { error: "too many attempts" }, { "retry-after": String(probe.retryAfterSec) });
      }
      const raw = await readCapped(req, HOOK_MAX_BODY_BYTES);
      if (raw === null) {
        // Oversized bodies are charged like any other failure, so they cannot be used to make the daemon read for free.
        failClient.record(client);
        return json(413, { error: "payload too large" });
      }
      if (!target || !target.enabled) return unauthorized(client, "unknown or disabled hook");

      const v = verify(target, req, raw);
      if (!v.ok) return unauthorized(client, v.reason);

      let payload: unknown;
      try {
        payload = raw.length === 0 ? {} : JSON.parse(raw.toString("utf8"));
      } catch {
        return json(415, { error: "body must be JSON (configure the sender to use application/json)" });
      }
      let event = v.event;
      let deliveryId = v.deliveryId;

      if (target.kind === "slack") {
        const p = (payload ?? {}) as { type?: unknown; challenge?: unknown; event?: { type?: unknown }; event_id?: unknown };
        if (p.type === "url_verification" && typeof p.challenge === "string") return json(200, { challenge: p.challenge });
        event = typeof p.event?.type === "string" ? p.event.type : typeof p.type === "string" ? p.type : "unknown";
        deliveryId = typeof p.event_id === "string" ? p.event_id : null;
      }
      if (target.kind === "github" && event === "ping") return json(200, { status: "pong" });

      if (target.kind !== "webhook" && !target.events.includes(event)) {
        return json(202, { status: "ignored", reason: "event not allowed" });
      }
      // Only an ACCEPTED delivery is remembered: a delivery that was rate limited or skipped (busy) must still be
      // processed when the sender retries it (Slack retries, GitHub redelivery keeps the delivery id).
      const dedupeKey = deliveryId ? `${target.id}:${deliveryId}` : null;
      if (dedupeKey && isDuplicate(dedupeKey)) return json(200, { status: "duplicate" });

      const hook = okHook.check(target.id);
      const global = okGlobal.check("global");
      if (!hook.ok || !global.ok) {
        return json(429, { error: "rate limited" }, { "retry-after": String(Math.max(hook.retryAfterSec, global.retryAfterSec)) });
      }
      okHook.record(target.id);
      okGlobal.record("global");

      let res: { accepted: boolean; reason?: string };
      try {
        res = deps.fire(target, { event, payload, deliveryId });
      } catch {
        res = { accepted: false, reason: "error" };
      }
      if (res.accepted && dedupeKey) remember(dedupeKey);
      return json(202, res.accepted ? { status: "accepted" } : { status: "skipped", reason: res.reason ?? "skipped" });
    },
  };
}

export { sha256Hex as hashHookSecret };
