import { getRtcIdentity, setRtcIdentity, type RtcIdentity } from "./auth";
import { createRtcFetch } from "./rtc/rtcFetch";
import { createRtcTransport, type RtcTransport, type RtcTransportOptions } from "./rtc/transport";

/**
 * Picks how the desk reaches the daemon. Direct (same-origin HTTP/WebSocket) is the default and is used whenever no
 * RTC identity is stored or the daemon answers a direct probe. Otherwise the desk joins over WebRTC; if that fails
 * the result is direct again, with the error for display.
 */
export type Connectivity =
  | { mode: "direct"; error?: string }
  | { mode: "rtc"; transport: RtcTransport; fetch: typeof fetch };

export type Probe = (ms: number) => Promise<boolean>;

export interface ResolveOptions {
  token: string;
  identity: RtcIdentity | null;
  probe?: Probe;
  createTransport?: (opts: RtcTransportOptions) => Promise<RtcTransport>;
}

export const PROBE_TIMEOUT_MS = 3000;
export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_MAX_MS = 30_000;

/** Exponential reconnect delay: 1 s, 2 s, 4 s ... capped at 30 s. `attempt` counts from 0. */
export function reconnectDelay(attempt: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** Math.max(0, attempt), RECONNECT_MAX_MS);
}

/** GET /health (unauthenticated) with a short timeout. Any failure counts as unreachable. */
export const defaultProbe: Probe = async (ms) => {
  try {
    const res = await fetch("/health", { signal: AbortSignal.timeout(ms) });
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * Fetches fresh TURN credentials over a connected device transport in the background and stores them in the identity
 * for the next connect. Failures are ignored. Credentials are never logged.
 */
export function refreshTurnInBackground(transport: RtcTransport, token: string, identity: RtcIdentity): void {
  void Promise.resolve()
    .then(() => transport.turnCredentials({ authorization: `Bearer ${token}` }))
    .then((turn) => {
      // Only persist for the same device still stored (sign-out or re-pairing may have replaced it).
      if (turn && getRtcIdentity()?.deviceId === identity.deviceId) setRtcIdentity({ ...identity, turn });
    })
    .catch(() => undefined);
}

export async function resolveTransport(opts: ResolveOptions): Promise<Connectivity> {
  const { identity } = opts;
  if (identity === null) return { mode: "direct" };
  const probe = opts.probe ?? defaultProbe;
  if (await probe(PROBE_TIMEOUT_MS)) return { mode: "direct" };

  const create = opts.createTransport ?? createRtcTransport;
  try {
    const transport = await create({
      invite: {
        server: identity.server,
        topic: identity.topic,
        stun: identity.stun,
        ...(identity.turn ? { turn: identity.turn } : {}),
      },
      auth: { kind: "device", deviceId: identity.deviceId, token: opts.token },
    });
    refreshTurnInBackground(transport, opts.token, identity);
    return { mode: "rtc", transport, fetch: createRtcFetch(transport) };
  } catch (err) {
    return { mode: "direct", error: err instanceof Error ? err.message : "WebRTC connect failed" };
  }
}
