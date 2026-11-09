-- rebuild-with-foreign-keys-off
CREATE TEMP TABLE outcome_sequences AS SELECT * FROM sqlite_sequence WHERE name IN ('work','work_runs','automation_runs');
CREATE TABLE work_new (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  bot_id TEXT NOT NULL REFERENCES bots(id),
  request_id INTEGER NOT NULL REFERENCES events(id),
  parent_id TEXT REFERENCES work(id),
  delegation_id TEXT,
  title TEXT NOT NULL,
  request TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('working','needs_input','needs_approval','completed','incomplete','failed','interrupted','cancelled')),
  next_step TEXT NOT NULL,
  plan_json TEXT NOT NULL DEFAULT '[]',
  needs_input INTEGER NOT NULL DEFAULT 0 CHECK(needs_input IN (0,1)),
  progress_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  cancel_requested_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  continued_from TEXT REFERENCES work(id),
  creation_key TEXT,
  origin_message_id INTEGER REFERENCES events(id),
  origin_turn_id TEXT REFERENCES turns(id),
  UNIQUE(room_id,bot_id,request_id)
);
INSERT INTO work_new SELECT * FROM work;
DROP TABLE work;
ALTER TABLE work_new RENAME TO work;
CREATE INDEX work_room_seq ON work(room_id,seq);
CREATE INDEX work_bot_seq ON work(bot_id,seq);
CREATE INDEX work_status_seq ON work(status,seq);
CREATE INDEX work_parent ON work(parent_id);
CREATE UNIQUE INDEX work_creation_key ON work(creation_key) WHERE creation_key IS NOT NULL;
CREATE TABLE work_runs_new (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  work_id TEXT NOT NULL REFERENCES work(id),
  message_id INTEGER NOT NULL REFERENCES events(id),
  turn_id TEXT UNIQUE REFERENCES turns(id),
  status TEXT NOT NULL CHECK(status IN ('queued','running','draining','completed','incomplete','failed','interrupted','cancelled')),
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  dispatch_claimed INTEGER NOT NULL DEFAULT 0
);
INSERT INTO work_runs_new SELECT * FROM work_runs;
DROP TABLE work_runs;
ALTER TABLE work_runs_new RENAME TO work_runs;
CREATE INDEX work_runs_work_seq ON work_runs(work_id,seq);
CREATE TABLE automation_runs_new (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 automation_id TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,
 trigger TEXT NOT NULL,
 event TEXT,
 started_at INTEGER NOT NULL,
 ended_at INTEGER,
 outcome TEXT NOT NULL CHECK(outcome IN ('running','quiet','completed','incomplete','cancelled','failed','interrupted')),
 summary TEXT NOT NULL DEFAULT '',
 execution_room_id TEXT,
 message_id INTEGER,
 turn_id TEXT,
 work_id TEXT,
 wake_decision_id INTEGER,
 delivery_json TEXT NOT NULL DEFAULT '{"kind":"none"}'
);
INSERT INTO automation_runs_new SELECT * FROM automation_runs;
DROP TABLE automation_runs;
ALTER TABLE automation_runs_new RENAME TO automation_runs;
CREATE INDEX automation_runs_automation_seq ON automation_runs(automation_id,seq);
UPDATE sqlite_sequence SET seq=max(seq,coalesce((SELECT seq FROM outcome_sequences WHERE name=sqlite_sequence.name),seq));
INSERT INTO sqlite_sequence(name,seq) SELECT name,seq FROM outcome_sequences s WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name=s.name);
DROP TABLE outcome_sequences;
