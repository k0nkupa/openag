import type { Db } from "./db/index.js";
import type { Ledger } from "./ledger.js";
import { getDefaultBotId } from "./defaultbot.js";
import { ensureDirectChat } from "./roomcreation.js";
import { getBot, getRoom } from "./rooms.js";
import { getSetting } from "./settings.js";

export type DeliveryStatus =
  | { state: "ok"; roomId: string | null; via: "setting" | "default_bot" }
  | { state: "missing"; reason: string };

/**
 * Where proactive messages go. Order: the owner's `deliveryRoom` setting; otherwise the default bot's direct chat (created
 * on first use). A room that is set but gone resolves to nothing: it is never replaced silently and never recreated, so
 * the owner sees the broken setup (Readiness) and items stay pending. Hidden `_` rooms are never a destination.
 */
export function resolveDeliveryRoom(db: Db, ledger: Ledger): string | null {
  const roomId = getSetting(db, "deliveryRoom").roomId;
  if (roomId !== null) return !roomId.startsWith("_") && getRoom(db, roomId) ? roomId : null;
  const botId = getDefaultBotId(db);
  return botId === null ? null : ensureDirectChat(db, ledger, botId)?.id ?? null;
}

/** Read-only: never creates the default bot's chat. */
export function deliveryStatus(db: Db): DeliveryStatus {
  const roomId = getSetting(db, "deliveryRoom").roomId;
  if (roomId !== null) {
    return !roomId.startsWith("_") && getRoom(db, roomId)
      ? { state: "ok", roomId, via: "setting" }
      : { state: "missing", reason: `The delivery room "${roomId}" no longer exists. Pick another room or clear the setting.` };
  }
  const botId = getDefaultBotId(db);
  if (botId === null || !getBot(db, botId)) return { state: "missing", reason: "There is no default bot to deliver to." };
  return { state: "ok", roomId: null, via: "default_bot" }; // the chat is created on first delivery
}
