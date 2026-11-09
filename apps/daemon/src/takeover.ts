import { createHash, randomBytes } from "node:crypto";
import { ComputerError, type Computer, type ComputerViewLink } from "./computer.js";
import type { Ledger } from "./ledger.js";
import type { Principal } from "./auth.js";

/**
 * Human takeover of the sandbox desktop. While a human holds control, the agent's input tools are paused (screenshots
 * still work). State is in memory on purpose: a daemon restart hands control back.
 */

export const TAKEOVER_PAUSED_MESSAGE = "human has control";
export type ReleaseReason = "user" | "idle" | "revoked" | "shutdown";

export interface Holder {
  kind: "owner" | "device";
  /** Device id, or "owner". Compared to tell holders apart; never shown. */
  id: string;
  name: string;
}

export interface TakeoverState {
  active: boolean;
  by?: { kind: "owner" | "device"; name: string };
  since?: number;
  idleExpiresAt?: number;
}

/** A live-view link must be https on a named host, with no embedded credentials: it is opened by the user's browser. */
export function isSafeExternalUrl(raw: string): boolean {
  if (raw.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const host = u.hostname.replace(/\.$/, "").toLowerCase(); // a trailing dot names the same host
  // A named public-looking host only: no IP literals, no localhost, no single-label or internal-looking names.
  if (!host.includes(".") || /^[0-9.]+$/.test(host) || host.startsWith("[")) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|corp|intranet|localdomain)$/.test(host);
}

export class TakeoverError extends Error {
  constructor(
    readonly code: "held" | "not_running" | "failed",
    message: string,
  ) {
    super(message);
  }
}

export interface Takeover {
  state(): TakeoverState;
  /** Takes (or, for the current holder, refreshes) control. `sessionId` is the secret for the view cookie. */
  take(principal: Principal): Promise<{ sessionId: string; link: ComputerViewLink }>;
  release(reason: ReleaseReason): boolean;
  /** A device was revoked: releases if it holds control, and refuses any take of its that is still in flight. */
  releaseIfHeldBy(deviceId: string, reason: ReleaseReason): void;
  /** Hand-back by a client: only the holder or the owner may end control. False when refused. */
  releaseBy(principal: Principal): boolean;
  /** Bumps the idle timer. */
  touch(): void;
  checkSession(sessionId: string | undefined | null): boolean;
  /**
   * True when `authorization` is `Bearer <ticket>` for the ticket of the CURRENT takeover's viewer link. The viewer's
   * RPC calls are fetches with credentials omitted, so they cannot carry the view cookie; they carry this instead.
   */
  checkTicket(authorization: string | undefined | null): boolean;
  /** A fresh viewer link for the current holder's proxy (re-resolved when the old one is about to expire). */
  viewLink(): Promise<ComputerViewLink>;
  /** Called with each release so open view sockets can be closed. `external` = the holder was using an external live view. */
  onRelease(cb: (reason: ReleaseReason, external: boolean) => void): () => void;
  dispose(): void;
}

export interface TakeoverDeps {
  computer: Computer;
  ledger: Ledger;
  now?: () => number;
  idleMs?: number;
  checkEveryMs?: number;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const holderOf = (p: Principal): Holder =>
  p.kind === "owner" ? { kind: "owner", id: "owner", name: "owner" } : { kind: "device", id: p.deviceId, name: p.name };
const LINK_REFRESH_MARGIN_MS = 5 * 60_000;

export function createTakeover(deps: TakeoverDeps): Takeover {
  const now = deps.now ?? Date.now;
  const idleMs = deps.idleMs ?? 30 * 60_000;
  let holder: Holder | undefined;
  let since = 0;
  let lastActivity = 0;
  const sessions = new Set<string>(); // sha256 of live session ids
  const releaseListeners = new Set<(reason: ReleaseReason, external: boolean) => void>();
  let heldExternal = false;
  let link: ComputerViewLink | undefined;
  let inflight: Promise<ComputerViewLink> | undefined;
  // Tickets handed to the holder this takeover (sha256). The viewer's cookie-less RPCs carry the ticket it was given,
  // so a later link refresh (for the origin) must not invalidate it.
  const tickets = new Set<string>();
  const revoked = new Set<string>();

  const log = (payload: Record<string, unknown>) => {
    try {
      deps.ledger.append("_system", "daemon", "takeover", payload);
    } catch {
      // The ledger must never decide whether control is handed back.
    }
  };

  function release(reason: ReleaseReason): boolean {
    if (!holder) return false;
    const was = holder;
    const wasExternal = heldExternal;
    heldExternal = false;
    holder = undefined;
    sessions.clear();
    tickets.clear();
    link = undefined;
    log({ action: "release", reason, by: { kind: was.kind, name: was.name } });
    for (const cb of [...releaseListeners]) {
      try {
        cb(reason, wasExternal);
      } catch {
        // one listener failing must not keep the others from closing their sockets
      }
    }
    return true;
  }

  // One guard for the daemon's lifetime; it reads the state, so release needs no further wiring.
  deps.computer.setInputGuard(() => (holder ? TAKEOVER_PAUSED_MESSAGE : null));

  const timer = setInterval(() => {
    if (!holder) return;
    // An external live view reports no activity to us, so it is bounded by the link's own expiry instead of idleness.
    if (heldExternal) {
      if (link && link.kind === "external" && now() >= link.expiresAt) release("idle");
      return;
    }
    if (now() - lastActivity >= idleMs) release("idle");
  }, deps.checkEveryMs ?? 15_000);
  timer.unref();

  /** Single flight: concurrent callers share one `cua sandbox view` (it queues on the computer mutex). */
  function resolveLink(force = false): Promise<ComputerViewLink> {
    if (!force && link && link.expiresAt - now() > LINK_REFRESH_MARGIN_MS) return Promise.resolve(link);
    inflight ??= (async () => {
      try {
        const fresh = await deps.computer.viewLink();
        link = fresh;
        return fresh;
      } catch (err) {
        if (err instanceof ComputerError && err.message === "computer is not running") throw new TakeoverError("not_running", err.message);
        throw new TakeoverError("failed", err instanceof ComputerError ? err.message : "viewer link failed");
      } finally {
        inflight = undefined;
      }
    })();
    return inflight;
  }

  return {
    state() {
      if (!holder) return { active: false };
      return { active: true, by: { kind: holder.kind, name: holder.name }, since, idleExpiresAt: lastActivity + idleMs };
    },

    async take(principal) {
      const who = holderOf(principal);
      if (revoked.has(who.id)) throw new TakeoverError("held", "device revoked");
      if (holder && holder.id !== who.id) throw new TakeoverError("held", `${holder.name} already has control`);
      const fresh = await resolveLink(true);
      if (fresh.kind === "external" && !isSafeExternalUrl(fresh.url)) throw new TakeoverError("failed", "unsafe live-view link");
      // Re-check after the await: another caller may have taken control, or the device been revoked, meanwhile.
      if (revoked.has(who.id)) throw new TakeoverError("held", "device revoked");
      if (holder && holder.id !== who.id) throw new TakeoverError("held", `${holder.name} already has control`);
      const first = !holder;
      holder = who;
      if (first) {
        since = now();
        log({ action: "take", by: { kind: who.kind, name: who.name } });
      }
      lastActivity = now();
      heldExternal = fresh.kind === "external";
      if (fresh.kind !== "external") {
        const ticket = new URLSearchParams(fresh.fragment).get("ticket");
        if (ticket) tickets.add(sha(ticket));
      }
      const sessionId = randomBytes(32).toString("base64url");
      sessions.add(sha(sessionId));
      return { sessionId, link: fresh };
    },

    release,

    releaseBy(principal) {
      if (!holder) return true;
      if (principal.kind !== "owner" && holder.id !== holderOf(principal).id) return false;
      release("user");
      return true;
    },

    releaseIfHeldBy(deviceId, reason) {
      revoked.add(deviceId);
      if (holder?.kind === "device" && holder.id === deviceId) release(reason);
    },

    touch() {
      if (holder) lastActivity = now();
    },

    checkSession(sessionId) {
      if (!holder || typeof sessionId !== "string" || sessionId.length < 20 || sessionId.length > 128) return false;
      return sessions.has(sha(sessionId));
    },

    checkTicket(authorization) {
      if (!holder || tickets.size === 0 || typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
      const given = authorization.slice(7);
      if (given.length > 4096) return false;
      return tickets.has(sha(given));
    },

    viewLink: resolveLink,

    onRelease(cb) {
      releaseListeners.add(cb);
      return () => void releaseListeners.delete(cb);
    },

    dispose() {
      clearInterval(timer);
      release("shutdown");
    },
  };
}
