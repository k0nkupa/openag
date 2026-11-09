import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LedgerEvent } from "./types";
import type { RtcTransport } from "./rtc/transport";

export type StreamStatus = "connecting" | "live" | "reconnecting";

export interface StreamListener {
  onEvent?: (e: LedgerEvent) => void;
  onOpen?: () => void;
}

interface StreamContextValue {
  status: StreamStatus;
  subscribe: (listener: StreamListener) => () => void;
  /** Ephemeral live completions, shared even with Work cards mounted after the event. */
  completedWork: ReadonlyMap<string, { at: number; revision: number; celebrating: boolean }>;
}

const StreamContext = createContext<StreamContextValue | null>(null);

export const MAX_BACKOFF_MS = 15_000;
/** Close code the daemon uses when this device's token is revoked. */
export const REVOKED_CLOSE_CODE = 4001;

export function backoffDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

export function streamUrl(token: string, loc: Location = window.location): string {
  const proto = loc.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${loc.host}/stream?token=${encodeURIComponent(token)}`;
}

/**
 * One shared WebSocket for the whole app. Reconnects with backoff. The browser cannot read a 401 on a WebSocket
 * upgrade, so after a failed attempt that never opened, a plain authed GET checks whether the token was rejected.
 */
export function StreamProvider({
  token,
  onAuthFailure,
  rtcTransport = null,
  children,
}: {
  token: string;
  onAuthFailure: () => void;
  /** When set, events arrive over the WebRTC transport instead of the WebSocket. */
  rtcTransport?: RtcTransport | null;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const listeners = useRef(new Set<StreamListener>());
  const authFailureRef = useRef(onAuthFailure);
  authFailureRef.current = onAuthFailure;

  const subscribe = useCallback((listener: StreamListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const [completedWork, setCompletedWork] = useState(new Map<string, { at: number; revision: number; celebrating: boolean }>());
  const notifyOpen = useCallback(() => {
    setCompletedWork(new Map());
    for (const listener of [...listeners.current]) listener.onOpen?.();
  }, []);
  const publish = useCallback((event: LedgerEvent) => {
    const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
    if (event.type === "work_updated" && typeof payload.workId === "string" && typeof payload.status === "string") {
      const id = payload.workId;
      if (payload.status === "completed" && typeof payload.previousStatus === "string" && payload.previousStatus !== "completed" && typeof payload.revision === "number") {
        const marker = { at: Date.now(), revision: payload.revision, celebrating: true };
        setCompletedWork(current => {
          const updated = new Map(current); updated.delete(id); updated.set(id, marker);
          // Keep bounded live settlement evidence while slower Work views catch up.
          if (updated.size > 1000) updated.delete(updated.keys().next().value!);
          return updated;
        });
      } else if (payload.status !== "completed") {
        setCompletedWork(current => { if (!current.has(id)) return current; const updated = new Map(current); updated.delete(id); return updated; });
      }
    }
    for (const listener of [...listeners.current]) listener.onEvent?.(event);
  }, []);
  useEffect(() => {
    const active = [...completedWork.values()].filter(marker => marker.celebrating);
    if (!active.length) return;
    const expires = Math.min(...active.map(marker => marker.at)) + 3000;
    const timer = setTimeout(() => setCompletedWork(current => new Map([...current].map(([id, marker]) => [id, marker.celebrating && marker.at + 3000 <= Date.now() ? { ...marker, celebrating: false } : marker]))), Math.max(0, expires - Date.now()));
    return () => clearTimeout(timer);
  }, [completedWork]);

  useEffect(() => {
    if (rtcTransport) return;
    const state: { ws: WebSocket | null; timer?: ReturnType<typeof setTimeout> } = { ws: null };
    let attempt = 0;
    let closed = false;

    const probeToken = async () => {
      try {
        const res = await fetch("/approvals?status=pending", { headers: { authorization: `Bearer ${token}` } });
        if (!closed && res.status === 401) authFailureRef.current();
      } catch {
        /* daemon unreachable: keep retrying */
      }
    };

    const connect = () => {
      let opened = false;
      const ws = new WebSocket(streamUrl(token));
      state.ws = ws;
      ws.onopen = () => {
        opened = true;
        attempt = 0;
        setStatus("live");
        notifyOpen();
      };
      ws.onmessage = (m) => {
        let event: unknown;
        try {
          event = JSON.parse(String(m.data));
        } catch {
          return;
        }
        if (!event || typeof event !== "object") return;
        publish(event as LedgerEvent);
      };
      ws.onclose = (ev: CloseEvent) => {
        state.ws = null;
        if (closed) return;
        if (ev.code === REVOKED_CLOSE_CODE) {
          closed = true;
          authFailureRef.current();
          return;
        }
        setStatus("reconnecting");
        if (!opened) void probeToken();
        state.timer = setTimeout(connect, backoffDelay(attempt++));
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(state.timer);
      state.ws?.close();
    };
  }, [token, rtcTransport, notifyOpen, publish]);

  // WebRTC path: the same status states and listeners, over a subscription on the data channel.
  useEffect(() => {
    if (!rtcTransport) return;
    const transport = rtcTransport;
    let attempt = 0;
    let closed = false;
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The transport dropped: show reconnecting; the app re-resolves and passes a new transport.
    const offClose = transport.onClose(() => {
      if (!closed) setStatus("reconnecting");
    });

    const run = async () => {
      try {
        const unsub = await transport.subscribe({ authorization: `Bearer ${token}` }, (event) => {
          if (!event || typeof event !== "object") return;
          publish(event as LedgerEvent);
        });
        if (closed) {
          unsub();
          return;
        }
        unsubscribe = unsub;
        attempt = 0;
        setStatus("live");
        notifyOpen();
      } catch (err) {
        if (closed) return;
        if (err instanceof Error && err.message === "subscribe failed: http 401") {
          closed = true;
          authFailureRef.current();
          return;
        }
        setStatus("reconnecting");
        if (transport.state === "closed") return; // a dead transport is replaced, not retried
        timer = setTimeout(() => void run(), backoffDelay(attempt++));
      }
    };

    void run();
    return () => {
      closed = true;
      offClose();
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [token, rtcTransport, notifyOpen, publish]);

  const value = useMemo(() => ({ status, subscribe, completedWork }), [status, subscribe, completedWork]);
  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>;
}

export function useStream(): StreamContextValue {
  const ctx = useContext(StreamContext);
  if (!ctx) throw new Error("useStream must be used inside StreamProvider");
  return ctx;
}
