import { useCallback, useEffect, useRef, useState } from "react";
import { messageOf, type Api } from "./api";
import { mergeApprovals } from "./approvals-state";
import { mergeEvents } from "./ledger";
import type { Route } from "./route";
import { useStream } from "./stream";
import type {  Approval, BotInfo, Decision, LedgerEvent, Room } from "./types";

/** Initial load plus live events for one room. Reconnects trigger a backfill after the last seen id. */
export function useLedger(api: Api, roomId: string) {
  const { subscribe } = useStream();
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const retryRef = useRef<() => void>(() => {});
  const retry = useCallback(() => retryRef.current(), []);

  useEffect(() => {
    let cancelled = false;
    let cursor = 0;
    let fetching = false;
    let queued = false;
    setEvents([]);
    setError(null);
    setLoading(true);
    const apply = (incoming: LedgerEvent[]) => setEvents((prev) => mergeEvents(prev, incoming));
    const backfill = async () => {
      if (fetching) { queued = true; return; }
      fetching = true;
      try {
        do {
          queued = false;
          let more: boolean;
          do {
            const res = await api.listEvents(roomId, cursor);
            if (cancelled) return;
            apply(res.events);
            // Live events cannot advance this cursor past a missing history page.
            for (const event of res.events) cursor = Math.max(cursor, event.id);
            more = res.events.length === 500;
          } while (more);
        } while (queued && !cancelled);
        if (!cancelled) setError(null);
      } catch (err) {
        if (!cancelled) setError(messageOf(err));
      } finally {
        fetching = false;
        if (!cancelled) setLoading(false);
        if (queued && !cancelled) void backfill();
      }
    };
    retryRef.current = () => void backfill();
    const off = subscribe({
      onEvent: (event) => { if (!cancelled && event.roomId === roomId) apply([event]); },
      onOpen: () => void backfill(),
    });
    void backfill();
    return () => { cancelled = true; retryRef.current = () => {}; off(); };
  }, [api, roomId, subscribe]);
  return { events, error, loading, retry };
}

export function useRoom(api: Api, roomId: string | null) {
  const { subscribe } = useStream();
  const retryRef = useRef<() => void>(() => {});
  const retry = useCallback(() => retryRef.current(), []);
  const [state, setState] = useState<{ requestedRoomId: string | null; room: Room | null; bots: BotInfo[]; error: string | null; loading: boolean }>({
    requestedRoomId: roomId, room: null, bots: [], error: null, loading: roomId !== null,
  });
  useEffect(() => {
    let cancelled = false;
    let version = 0;
    setState({ requestedRoomId: roomId, room: null, bots: [], error: null, loading: roomId !== null });
    if (roomId === null) return;
    const load = async () => {
      const request = ++version;
      try {
        const res = await api.getRoom(roomId);
        if (!cancelled && request === version) setState({ requestedRoomId: roomId, room: res.room, bots: res.bots, error: null, loading: false });
      } catch (err) {
        if (!cancelled && request === version) setState((prev) => ({ ...prev, error: messageOf(err), loading: false }));
      }
    };
    retryRef.current = () => void load();
    void load();
    const off = subscribe({ onOpen: () => void load(), onEvent: event => { if (event.type === "config" && event.payload && typeof event.payload === "object" && "action" in event.payload && (event.payload.action === "bot_settings" || event.payload.action === "bot_model" || event.payload.action === "room_updated" || event.payload.action === "room_router_changed")) void load(); } });
    return () => { cancelled = true; retryRef.current = () => {}; off(); };
  }, [api, roomId, subscribe]);
  if (state.requestedRoomId !== roomId) return { room: null, bots: [], error: null, loading: roomId !== null, retry };
  const { requestedRoomId: _requested, ...result } = state;
  return { ...result, retry };
}

export function useRooms(api: Api, route?: Route): Room[] {
  const [rooms, setRooms] = useState<Room[]>([]);
  const { subscribe } = useStream();
  useEffect(() => {
    let cancelled = false;
    const load = () => api.listRooms().then(
      (res) => { if (!cancelled) setRooms(res.rooms); },
      () => { /* The active room reports load failures. Keep the last known navigation. */ },
    );
    void load();
    const off = subscribe({
      onOpen: () => void load(),
      onEvent: (event) => { if (event.type === "config") void load(); },
    });
    return () => { cancelled = true; off(); };
  }, [api, route, subscribe]);
  return rooms;
}

export const APPROVAL_EVENTS = new Set<LedgerEvent['type']>(['approval_requested','approval_decided']);

export function useApprovals(api: Api) {
  const { subscribe } = useStream();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const version = useRef(0);
  const active = useRef(true);
  const deciding = useRef(new Set<string>());
  const refresh = useCallback(async () => {
    if (!active.current) return;
    const request = ++version.current;
    try {
      const res = await api.listPending();
      if (request !== version.current) return;
      setApprovals((prev) => mergeApprovals(prev, res.approvals));
      setError(null);
    } catch (err) {
      if (request === version.current) setError(messageOf(err));
    } finally {
      if (request === version.current) setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    active.current = true;
    setLoading(true);
    void refresh();
    let timer:ReturnType<typeof setTimeout>|undefined;
    const schedule=()=>{if(timer===undefined)timer=setTimeout(()=>{timer=undefined;void refresh();},300);};
    const off=subscribe({onOpen:schedule,onEvent:event=>{if(APPROVAL_EVENTS.has(event.type))schedule();}});
    return () => { active.current = false; clearTimeout(timer); ++version.current; off(); };
  }, [refresh, subscribe]);
  const decide = useCallback(async (id: string, decision: Decision) => {
    if (deciding.current.has(id)) throw new Error("This decision is already being submitted. Please wait.");
    deciding.current.add(id);
    try { await api.decide(id, decision); }
    finally { await refresh(); deciding.current.delete(id); }
  }, [api, refresh]);
  return { approvals,  error, loading, refresh, decide };
}

/** Keep the agent list available outside a room; reuse the shared stream on reconnect. */
export function useBots(api: Api, route: Route): BotInfo[] {
  const [bots, setBots] = useState<BotInfo[]>([]);
  const { subscribe } = useStream();
  useEffect(() => {
    let cancelled = false;
    let version = 0;
    const load = () => { const request = ++version; return api.listBots().then((res) => { if (!cancelled && request === version) setBots(res.bots); }, () => {}); };
    void load();
    const off = subscribe({ onOpen: () => void load(), onEvent: event => { if (event.type === "config" && event.payload && typeof event.payload === "object" && "action" in event.payload && (["bot_settings", "bot_model", "bot_created"].includes(String(event.payload.action)))) void load(); } });
    return () => { cancelled = true; off(); };
  }, [api, route, subscribe]);
  return bots;
}
