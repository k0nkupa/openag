import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { messageOf, type Api } from "./api";
import { useStream } from "./stream";
import type { UserProfile } from "./types";

const fallback: UserProfile = { name: "You", avatar: null };
const Context = createContext({ profile: fallback, loading: false, error: null as string | null, save: async (_profile: UserProfile): Promise<void> => { throw Error("Profile unavailable"); } });
export const useProfile = () => useContext(Context);

export function ProfileProvider({ api, children }: { api: Api; children: ReactNode }) {
  const { subscribe } = useStream();
  const [profile, setProfile] = useState(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    async function load() {
      const request = ++revision.current;
      try {
        const result = await api.getSettings();
        if (active && request === revision.current) { setProfile(result.settings.profile ?? fallback); setError(null); }
      } catch (err) { if (active && request === revision.current) setError(messageOf(err)); }
      finally { if (active && request === revision.current) setLoading(false); }
    }
    void load();
    const off = subscribe({ onOpen: () => void load(), onEvent: event => {
      const payload = event.payload as { action?: string; key?: string } | null;
      if (event.type === "config" && payload?.action === "setting_changed" && payload.key === "profile") void load();
    } });
    return () => { active = false; off(); };
  }, [api, subscribe]);
  async function save(next: UserProfile) {
    const result = await api.putSetting("profile", next);
    ++revision.current;
    setProfile(result.value as UserProfile);
    setError(null);
  }
  return <Context.Provider value={{ profile, loading, error, save }}>{children}</Context.Provider>;
}
