ALTER TABLE work ADD COLUMN continued_from TEXT REFERENCES work(id);
ALTER TABLE work_runs ADD COLUMN dispatch_claimed INTEGER NOT NULL DEFAULT 0;
UPDATE work_runs SET dispatch_claimed=1;
CREATE TABLE work_questions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  work_id TEXT NOT NULL REFERENCES work(id),
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
CREATE UNIQUE INDEX questions_open_work ON work_questions(work_id) WHERE status='open';
CREATE INDEX questions_status_seq ON work_questions(status,seq);
CREATE TABLE work_recovery_actions (
  work_id TEXT NOT NULL REFERENCES work(id),
  issue_key TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  action TEXT NOT NULL CHECK(action IN ('dismiss','continue')),
  message_id INTEGER REFERENCES events(id),
  continued_work_id TEXT REFERENCES work(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(work_id,issue_key)
);
