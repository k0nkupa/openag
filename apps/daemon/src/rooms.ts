import type { RoutingConfig } from "./router.js";
import type { Db } from "./db/index.js";

export type Runtime = "api" | "acp";

export interface Bot {
  id: string;
  name: string;
  runtime: Runtime;
  model: string | null;
  config: unknown;
}

export type RoomKind = "room" | "direct";

export interface Room {
  id: string;
  name: string;
  leadBotId: string | null;
  description?: string;
  members: string[];
  /** `room` = created by the user; `direct` = the chat with one bot. Never inferred from the member count. */
  kind: RoomKind;
  /** How a message with no @mention is routed: lead (default) | jev | openai-decision | cheap-same-model. */
  router?: "lead" | "jev" | "openai-decision" | "cheap-same-model";
  routerConfig?: RoutingConfig | null;
}

interface BotRow {
  id: string;
  name: string;
  runtime: Runtime;
  model: string | null;
  config_json: string | null;
}

const toBot = (r: BotRow): Bot => ({
  id: r.id,
  name: r.name,
  runtime: r.runtime,
  model: r.model,
  config: r.config_json ? JSON.parse(r.config_json) : {},
});

export function createBot(
  db: Db,
  bot: { id: string; name?: string; runtime: Runtime; model?: string; config?: unknown },
): Bot {
  db.prepare(
    "INSERT INTO bots (id, name, runtime, model, config_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(bot.id, bot.name ?? bot.id, bot.runtime, bot.model ?? null, JSON.stringify(bot.config ?? {}), Date.now());
  return getBot(db, bot.id)!;
}

export function getBot(db: Db, id: string): Bot | undefined {
  const row = db.prepare("SELECT * FROM bots WHERE id = ?").get(id) as BotRow | undefined;
  return row && toBot(row);
}

export function listBots(db: Db): Bot[] {
  return (db.prepare("SELECT * FROM bots ORDER BY created_at, id").all() as BotRow[]).map(toBot);
}

export function createRoom(db: Db, room: { id: string; name?: string; leadBotId?: string; kind?: RoomKind }): Room {
  db.prepare("INSERT INTO rooms (id, name, lead_bot_id, kind, created_at) VALUES (?, ?, ?, ?, ?)").run(
    room.id,
    room.name ?? room.id,
    room.leadBotId ?? null,
    room.kind ?? "room",
    Date.now(),
  );
  return getRoom(db, room.id)!;
}

/** Sets config keys that are missing on the bot. Existing values are never overwritten. */
export function mergeBotConfig(db: Db, id: string, defaults: Record<string, unknown>): void {
  const bot = getBot(db, id);
  if (!bot) return;
  const current = (bot.config ?? {}) as Record<string, unknown>;
  const missing = Object.keys(defaults).filter((k) => !(k in current));
  if (missing.length === 0) return;
  const merged = { ...defaults, ...current };
  db.prepare("UPDATE bots SET config_json = ? WHERE id = ?").run(JSON.stringify(merged), id);
}

export function addMember(db: Db, roomId: string, botId: string): void {
  db.prepare("INSERT OR IGNORE INTO room_members (room_id, bot_id) VALUES (?, ?)").run(roomId, botId);
}

export function getRoom(db: Db, id: string): Room | undefined {
  const row = db.prepare("SELECT * FROM rooms WHERE id = ?").get(id) as
    | { id: string; name: string; lead_bot_id: string | null; description: string | null; kind: RoomKind; router: Room["router"]; router_config_json: string | null }
    | undefined;
  if (!row) return undefined;
  const members = (
    db.prepare("SELECT bot_id FROM room_members WHERE room_id = ? ORDER BY bot_id").all(id) as {
      bot_id: string;
    }[]
  ).map((m) => m.bot_id);
  return { id: row.id, name: row.name, leadBotId: row.lead_bot_id, description: row.description ?? "", members, kind: row.kind ?? "room", router: row.router ?? "lead", routerConfig: row.router_config_json ? JSON.parse(row.router_config_json) : null };
}

export function listRooms(db: Db): Room[] {
  return (db.prepare("SELECT id FROM rooms ORDER BY created_at, id").all() as { id: string }[]).map(
    (r) => getRoom(db, r.id)!,
  );
}

/** Overwrites the given config keys (undefined removes one) and optionally renames the bot. */
export function updateBot(db: Db, id: string, patch: { name?: string; model?: string; runtime?: Runtime; config?: Record<string, unknown> }): void {
  const bot = getBot(db, id);
  if (!bot) return;
  const next = { ...((bot.config ?? {}) as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch.config ?? {})) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  db.prepare("UPDATE bots SET name = ?, model = ?, runtime = ?, config_json = ? WHERE id = ?").run(patch.name ?? bot.name, patch.model ?? bot.model, patch.runtime ?? bot.runtime, JSON.stringify(next), id);
}
