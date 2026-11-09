CREATE TABLE model_catalogue (
  target TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  generation TEXT NOT NULL,
  choices_json TEXT NOT NULL,
  refreshed_at INTEGER NOT NULL,
  attempted_at INTEGER NOT NULL,
  error TEXT
);
