CREATE TABLE bot_creations (
  request_id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL UNIQUE REFERENCES bots(id),
  payload_hash TEXT NOT NULL
);
