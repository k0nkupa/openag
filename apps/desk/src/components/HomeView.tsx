import { Alert, AlertDescription } from "./ui/alert";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "../api";
import { messageOf } from "../api";
import { hrefFor } from "../route";
import type { BotInfo } from "../types";
import { NewBotTrigger } from "./NewBotSheet";
import { Button } from "./ui/button";

/**
 * The address-less landing page: open the default bot's direct chat (the daemon creates it on first use).
 * With no default bot there is nothing to open, so it says what is missing instead of guessing a room.
 */
export function HomeView({ api, onOpenChat }: { api: Api; onOpenChat: (bot: BotInfo) => Promise<void> }) {
  const [state, setState] = useState<"loading" | "opening" | "empty" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const opening = useRef(false);
  const open = useCallback(async () => {
    if (opening.current) return;
    opening.current = true;
    setState("loading");
    setError(null);
    try {
      const { bots } = await api.listBots();
      const bot = bots.find((b) => b.isDefault);
      if (!bot) { setState("empty"); return; }
      setState("opening");
      await onOpenChat(bot);
    } catch (err) {
      setError(messageOf(err));
      setState("error");
    } finally {
      opening.current = false;
    }
  }, [api, onOpenChat]);
  useEffect(() => { void open(); }, [open, attempt]);

  if (state === "empty") {
    return <section aria-labelledby="home-title" className="max-w-lg px-4 py-6">
      <h1 id="home-title">Nothing to open yet</h1>
      <p className="-mt-1 mb-4 text-[13px] leading-5 text-muted-foreground">There is no default bot, so there is no chat to open. Rooms are optional: add or review your bots first.</p>
      <p><NewBotTrigger />{" "}<Button variant="outline" nativeButton={false} render={<a href={hrefFor({ kind: "settings" })} />}>Open Settings</Button></p>
    </section>;
  }
  if (state === "error") {
    return <section aria-labelledby="home-title" className="max-w-lg px-4 py-6">
      <h1 id="home-title">Could not open your chat</h1>
      <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
      <p><Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button></p>
    </section>;
  }
  return <p className="-mt-1 mb-4 text-[13px] leading-5 text-muted-foreground" role="status">Opening your chat…</p>;
}
