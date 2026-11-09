CREATE TABLE avatar_designs (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id),
  room_id TEXT NOT NULL REFERENCES rooms(id),
  turn_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  added_at INTEGER,
  UNIQUE(turn_id, tool_call_id)
);
