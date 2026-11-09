CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  runtime TEXT NOT NULL CHECK (runtime IN ('api','acp')),
  model TEXT,
  config_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lead_bot_id TEXT REFERENCES bots(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE room_members (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  bot_id TEXT NOT NULL REFERENCES bots(id),
  PRIMARY KEY (room_id, bot_id)
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX events_room_id_id ON events (room_id, id);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  turn_id TEXT,
  tool_name TEXT NOT NULL,
  tool_class TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','edited','responded','ignored')),
  edit_json TEXT,
  response_text TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  status TEXT NOT NULL,
  state_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE tool_modes (
  bot_id TEXT NOT NULL,
  tool_class TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('auto','ask','deny')),
  PRIMARY KEY (bot_id, tool_class)
);
