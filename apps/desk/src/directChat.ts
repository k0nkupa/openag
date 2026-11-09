import type { Api } from "./api";
import type { BotInfo } from "./types";

/** The daemon is authoritative for reuse; never derive a room id from a bot's name. */
export async function openDirectChat(api: Api, bot: BotInfo): Promise<string> {
  const { rooms } = await api.listRooms();
  const existing = rooms.find((room) => room.kind === "direct" && room.members.length === 1 && room.members[0] === bot.id && room.leadBotId === bot.id);
  if (existing) return existing.id;
  // getRandomValues also works on the desk's plain-HTTP LAN origin.
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const name = bot.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80) || "Conversation";
  const { room } = await api.createRoom({ id: `chat-${suffix}`, name, members: [bot.id], kind: "direct" });
  return room.id;
}
