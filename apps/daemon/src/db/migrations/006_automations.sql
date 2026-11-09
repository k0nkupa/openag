CREATE TABLE automations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schedule_cron TEXT NOT NULL,
  tz TEXT,
  bot_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  allow_approvals INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_status TEXT,
  last_turn_id TEXT
);
