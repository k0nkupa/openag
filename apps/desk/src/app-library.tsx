import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { messageOf, type Api } from "./api";
import { useStream } from "./stream";
import type { LibraryInventory } from "./types";

type Inventory = { data: LibraryInventory | null; error: string | null; loading: boolean; refresh(): Promise<LibraryInventory | null> };
const Context = createContext<Inventory | null>(null);

/** One reader for navigation, library, settings and open details. Reuse the existing desk stream. */
export function AppLibraryProvider({ api, children }: { api: Api; children: ReactNode }) {
  const { subscribe } = useStream();
  const [data, setData] = useState<LibraryInventory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useRef<() => Promise<LibraryInventory | null>>(async () => null);
  useEffect(() => {
    let active = true, queued = false;
    let flight: Promise<LibraryInventory | null> | null = null;
    const load = (): Promise<LibraryInventory | null> => {
      if (flight) { queued = true; return flight; }
      flight = (async () => {
        let result: LibraryInventory | null = null;
        do {
          queued = false;
          try { const next = await api.getAppLibrary(); if (active) { result = next; setData(next); setError(null); } }
          catch (err) { result = null; if (active) setError(messageOf(err)); }
        } while (active && queued);
        return active ? result : null;
      })().finally(() => { flight = null; if (active) setLoading(false); });
      return flight;
    };
    refresh.current = load;
    setData(null); setError(null); setLoading(true);
    void load();
    const off = subscribe({ onOpen: () => void load(), onEvent: e => {
      const payload = e.payload as { action?: string; key?: string };
      if (e.type === "config" && payload?.action && (/^(app_|apps_|mcp_|google_|apple_|composio_)/.test(payload.action) || payload.action === "setting_changed" && payload.key === "apps")) void load();
    } });
    return () => { active = false; off(); };
  }, [api, subscribe]);
  return <Context.Provider value={{ data, error, loading, refresh: () => refresh.current() }}>{children}</Context.Provider>;
}

export function useAppLibrary() {
  const value = useContext(Context);
  if (!value) throw new Error("App library provider is required");
  return value;
}
