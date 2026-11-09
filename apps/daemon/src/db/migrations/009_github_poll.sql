-- Rebuild (same pattern as 008): the trigger_kind CHECK must allow 'github_poll', and polling keeps its own columns.
-- poll_token is the raw read-only token (outbound API auth; never returned by any API). poll_etag / poll_cursor are
-- the poller state; poll_next_at is when the scheduler may poll again (NULL = due now).
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
  trigger_kind TEXT NOT NULL DEFAULT 'cron' CHECK (trigger_kind IN ('cron', 'webhook', 'github', 'slack', 'github_poll')),
  hook_slug TEXT UNIQUE,
  hook_secret_hash TEXT,
  hook_secret TEXT,
  hook_events_json TEXT,
  output_mode TEXT NOT NULL DEFAULT 'room' CHECK (output_mode IN ('room', 'wake')),
  allow_tools INTEGER NOT NULL DEFAULT 0,
  last_verdict TEXT,
  poll_repo TEXT,
  poll_every_minutes INTEGER,
  poll_token TEXT,
  poll_etag TEXT,
  poll_cursor TEXT,
  poll_next_at INTEGER,
  poll_backoff_until INTEGER,
  last_polled_at INTEGER,
  last_poll_new INTEGER
);
INSERT INTO automations_new (id, name, schedule_cron, tz, bot_id, room_id, prompt, enabled, allow_approvals,
  created_at, updated_at, last_run_at, last_status, last_turn_id, trigger_kind, hook_slug, hook_secret_hash,
  hook_secret, hook_events_json, output_mode, allow_tools, last_verdict)
  SELECT id, name, schedule_cron, tz, bot_id, room_id, prompt, enabled, allow_approvals,
    created_at, updated_at, last_run_at, last_status, last_turn_id, trigger_kind, hook_slug, hook_secret_hash,
    hook_secret, hook_events_json, output_mode, allow_tools, last_verdict FROM automations;
DROP TABLE automations;
ALTER TABLE automations_new RENAME TO automations;
