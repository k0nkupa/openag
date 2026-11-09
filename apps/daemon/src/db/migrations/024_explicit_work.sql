ALTER TABLE work_questions RENAME TO work_questions_legacy;
CREATE TABLE work_questions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  work_id TEXT REFERENCES work(id),
  room_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  source_turn_id TEXT,
  source_tool_call_id TEXT,
  prompt TEXT,
  context TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('question','work-report')),
  status TEXT NOT NULL CHECK(status IN ('open','answered','cancelled')),
  revision INTEGER NOT NULL DEFAULT 1,
  answer TEXT,
  answer_message_id INTEGER UNIQUE REFERENCES events(id),
  continuation_state TEXT CHECK(continuation_state IN ('queued','started','finished','cancelled')),
  created_at INTEGER NOT NULL,
  answered_at INTEGER
);
INSERT INTO work_questions SELECT * FROM work_questions_legacy;
DROP TABLE work_questions_legacy;

ALTER TABLE saved_results RENAME TO saved_results_legacy;
CREATE TABLE saved_results (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  work_id TEXT REFERENCES work(id),
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
INSERT INTO saved_results SELECT * FROM saved_results_legacy;
DROP TABLE saved_results_legacy;

CREATE UNIQUE INDEX questions_open_work ON work_questions(work_id) WHERE status='open';

CREATE UNIQUE INDEX questions_open_chat_turn ON work_questions(source_turn_id) WHERE work_id IS NULL AND status='open';

CREATE INDEX questions_status_seq ON work_questions(status,seq);

CREATE INDEX saved_results_work ON saved_results(work_id,seq);

CREATE INDEX saved_results_room ON saved_results(room_id,seq);

CREATE INDEX saved_results_bot ON saved_results(bot_id,seq);

ALTER TABLE work ADD COLUMN creation_key TEXT;

ALTER TABLE work ADD COLUMN origin_message_id INTEGER REFERENCES events(id);

ALTER TABLE work ADD COLUMN origin_turn_id TEXT REFERENCES turns(id);

CREATE UNIQUE INDEX work_creation_key ON work(creation_key) WHERE creation_key IS NOT NULL;

CREATE TABLE chat_dispatches (room_id TEXT NOT NULL REFERENCES rooms(id), bot_id TEXT NOT NULL REFERENCES bots(id), message_id INTEGER NOT NULL REFERENCES events(id), turn_id TEXT REFERENCES turns(id), context_json TEXT NOT NULL DEFAULT '{}', settled_at INTEGER, PRIMARY KEY(room_id,bot_id,message_id));
