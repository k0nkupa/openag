CREATE TABLE wake_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  source TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  turn_id TEXT,
  verdict TEXT NOT NULL,
  urgency TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  decision TEXT NOT NULL,
  suppressed_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX wake_decisions_ts ON wake_decisions (ts);
CREATE TABLE digest_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  bot_id TEXT NOT NULL,
  text TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  decision_id INTEGER NOT NULL,
  delivered_at INTEGER
);
