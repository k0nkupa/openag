import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { validateAvatar, type AvatarDefinition } from 'open-bot-avatar';
import { messageOf, type Api } from './api';
import { useStream } from './stream';
export interface LibraryAvatar { id: `custom:${string}`; definition: AvatarDefinition }
const empty = { avatars: [] as LibraryAvatar[], loading: false, error: null as string | null };
const Context = createContext(empty);
export const useAvatarLibrary = () => useContext(Context);
export function AvatarLibraryProvider({ api, children }: { api: Api; children: ReactNode }) {
  const { subscribe } = useStream();
  const [state, setState] = useState({ ...empty, loading: true });
  useEffect(() => {
    let active = true, queued = false, flight = false;
    setState({ ...empty, loading: true });
    async function load() {
      if (flight) { queued = true; return; }
      flight = true;
      do {
        queued = false;
        try {
          const result = await api.getAvatarLibrary();
          const avatars = result.avatars.map(item => {
            const valid = validateAvatar(item.definition);
            if (!/^custom:[0-9a-f-]{36}$/.test(item.id) || !valid.ok) throw Error('Avatar library returned an invalid character.');
            return { id: item.id, definition: valid.value };
          });
          if (active) setState({ avatars, loading: false, error: null });
        } catch (error) { if (active) setState(current => ({ ...current, loading: false, error: messageOf(error) })); }
      } while (active && queued);
      flight = false;
    }
    void load();
    const off = subscribe({ onOpen: () => void load(), onEvent: event => { if (event.type === 'avatar_library_updated') void load(); } });
    return () => { active = false; off(); };
  }, [api, subscribe]);
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
