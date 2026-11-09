-- Rebuild: SQLite cannot drop NOT NULL, and cron-less hook automations need schedule_cron and room_id nullable.
CREATE TABLE automations_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schedule_cron TEXT,
  tz TEXT,
  bot_id TEXT NOT NULL,
  room_id TEXT,
  prompt TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  allow_approvals INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_status TEXT,
  last_turn_id TEXT,
  trigger_kind TEXT NOT NULL DEFAULT 'cron' CHECK (trigger_kind IN ('cron', 'webhook', 'github', 'slack')),
  hook_slug TEXT UNIQUE,
  hook_secret_hash TEXT,
  hook_secret TEXT,
  hook_events_json TEXT,
  output_mode TEXT NOT NULL DEFAULT 'room' CHECK (output_mode IN ('room', 'wake')),
  allow_tools INTEGER NOT NULL DEFAULT 0,
  last_verdict TEXT
);
INSERT INTO automations_new (id, name, schedule_cron, tz, bot_id, room_id, prompt, enabled, allow_approvals,
  created_at, updated_at, last_run_at, last_status, last_turn_id)
  SELECT id, name, schedule_cron, tz, bot_id, room_id, prompt, enabled, allow_approvals,
    created_at, updated_at, last_run_at, last_status, last_turn_id FROM automations;
DROP TABLE automations;
ALTER TABLE automations_new RENAME TO automations;
