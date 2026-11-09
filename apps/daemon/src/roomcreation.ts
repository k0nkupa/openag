import { canonical } from "./action-receipts.js";
import { z } from "zod";
import type { Db } from "./db/index.js";
import { createHash, randomBytes } from "node:crypto";
import type { Ledger } from "./ledger.js";
import { addMember, createRoom, getBot, getRoom, listRooms, type Room, type RoomKind } from "./rooms.js";
import { getDefaultRedactor } from "./redact.js";

export class RoomCreationError extends Error {
  constructor(message: string, readonly status: 400 | 409 = 400) { super(message); }
}

const requestIdSchema = z.string().uuid();

export function readRoomCreation(db: Db, requestId: string): Room | undefined {
  if (!requestIdSchema.safeParse(requestId).success) throw new RoomCreationError("Invalid creation request id");
  const receipt = db.prepare("SELECT room_id FROM room_creations WHERE request_id = ?").get(requestId) as { room_id: string } | undefined;
  return receipt ? getRoom(db, receipt.room_id) : undefined;
}

/** The existing direct chat with `botId`, by kind (never by member count). */
export function findDirectChat(db: Db, botId: string): Room | undefined {
  return listRooms(db).find((room) => room.kind === "direct" && room.members.length === 1 && room.members[0] === botId && room.leadBotId === botId);
}

/** The direct chat with a bot, created on first use. Safe to call repeatedly. */
export function ensureDirectChat(db: Db, ledger: Ledger, botId: string): Room | undefined {
  const bot = getBot(db, botId);
  if (!bot) return undefined;
  return db
    .transaction(() => {
      const existing = findDirectChat(db, botId);
      if (existing) return existing;
      const id = `chat-${randomBytes(16).toString("hex")}`;
      createRoom(db, { id, name: bot.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80) || "Conversation", leadBotId: bot.id, kind: "direct" });
      addMember(db, id, bot.id);
      ledger.append("_system", "owner", "config", { kind: "room_created", roomId: id, members: [bot.id], roomKind: "direct" });
      return getRoom(db, id)!;
    })
    .immediate();
}

/**
 * Creation and direct-chat reuse are decided together by the daemon, including concurrent requests. `kind` is explicit:
 * a `direct` chat has exactly one member and reuses that bot's existing direct chat; a `room` is always created (a named
 * one-bot room is a room, never mistaken for a direct chat).
 */
export function createDeskRoom(db: Db, ledger: Ledger, body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RoomCreationError("body must be an object");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["id", "name", "members", "kind", "lead", "requestId"].includes(key))) throw new RoomCreationError("unknown room field");
  if (input.kind !== undefined && input.kind !== "room" && input.kind !== "direct") throw new RoomCreationError("kind must be room or direct");
  const kind: RoomKind = input.kind === "direct" ? "direct" : "room";
  if (typeof input.id !== "string" || !/^[a-z0-9-]{1,64}$/.test(input.id)) throw new RoomCreationError("id must be a public room slug (1–64 lowercase letters, digits or hyphens)");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(input.name)) throw new RoomCreationError("name must contain 1–80 characters without control characters");
  const members = input.members === undefined ? [] : input.members;
  if (!Array.isArray(members) || members.length < 1 || members.length > 50 || members.some((id) => typeof id !== "string" || !getBot(db, id))) throw new RoomCreationError("members must contain 1–50 known bot ids");
  if (new Set(members).size !== members.length) throw new RoomCreationError("duplicate member");
  if (kind === "direct" && members.length !== 1) throw new RoomCreationError("a direct chat has exactly one bot");
  const lead = input.lead === undefined ? members[0] : input.lead;
  if (typeof lead !== "string" || !members.includes(lead)) throw new RoomCreationError("the lead must be a member of the room");
  if (input.requestId !== undefined && (!requestIdSchema.safeParse(input.requestId).success || kind !== "room")) throw new RoomCreationError("a creation request id must be a UUID for a named room");
  const requestId = input.requestId as string | undefined;
  const id = input.id;
  const hash = createHash("sha256").update(canonical({ id, name: input.name.trim(), members: [...members].sort(), kind, lead })).digest("hex");
  const name = getDefaultRedactor().redactString(input.name.trim());
  return ledger.atomic(() => {
    if (requestId) {
      const receipt = db.prepare("SELECT room_id, payload_hash FROM room_creations WHERE request_id = ?").get(requestId) as { room_id: string; payload_hash: string } | undefined;
      if (receipt) {
        if (receipt.payload_hash !== hash) throw new RoomCreationError("This creation request already has different content. Check its room before starting another creation.", 409);
        return { room: getRoom(db, receipt.room_id)!, created: false };
      }
    }
    if (getRoom(db, id)) throw new RoomCreationError("room id already exists", 409);
    if (kind === "direct") {
      const existing = findDirectChat(db, members[0]!);
      if (existing) return { room: existing, created: false };
    }
    createRoom(db, { id, name, leadBotId: lead, kind });
    for (const bot of members) addMember(db, id, bot);
    if (requestId) db.prepare("INSERT INTO room_creations (request_id, room_id, payload_hash) VALUES (?, ?, ?)").run(requestId, id, hash);
    ledger.append("_system", "owner", "config", { kind: "room_created", roomId: id, members, lead, roomKind: kind });
    return { room: getRoom(db, id)!, created: true };
  });
}
