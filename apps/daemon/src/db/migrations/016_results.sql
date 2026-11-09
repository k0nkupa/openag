CREATE TABLE saved_results (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  work_id TEXT NOT NULL REFERENCES work(id),
  room_id TEXT NOT NULL REFERENCES rooms(id),
  bot_id TEXT NOT NULL REFERENCES bots(id),
  turn_id TEXT NOT NULL REFERENCES turns(id),
  tool_call_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('comparison','draft','code','note')),
  content TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 262144),
  created_at INTEGER NOT NULL,
  UNIQUE(id,version)
);
CREATE INDEX saved_results_work ON saved_results(work_id,seq);
CREATE INDEX saved_results_room ON saved_results(room_id,seq);
CREATE INDEX saved_results_bot ON saved_results(bot_id,seq);
