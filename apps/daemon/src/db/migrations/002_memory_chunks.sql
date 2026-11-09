CREATE TABLE memory_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('memory','thread')),
  source_ref TEXT NOT NULL,
  text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  embedding_model TEXT,
  dim INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (bot_id, source, source_ref, content_hash)
);
CREATE INDEX memory_chunks_bot ON memory_chunks (bot_id);
