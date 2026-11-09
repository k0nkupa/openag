CREATE TABLE reflection_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_date TEXT NOT NULL UNIQUE,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  memory_proposals INTEGER NOT NULL DEFAULT 0,
  skill_proposals INTEGER NOT NULL DEFAULT 0
);
