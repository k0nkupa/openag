CREATE TABLE automation_runs (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 automation_id TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,
 trigger TEXT NOT NULL,
 event TEXT,
 started_at INTEGER NOT NULL,
 ended_at INTEGER,
 outcome TEXT NOT NULL CHECK(outcome IN ('running','quiet','completed','failed','interrupted')),
 summary TEXT NOT NULL DEFAULT '',
 execution_room_id TEXT,
 message_id INTEGER,
 turn_id TEXT,
 work_id TEXT,
 wake_decision_id INTEGER,
 delivery_json TEXT NOT NULL DEFAULT '{"kind":"none"}'
);
CREATE INDEX automation_runs_automation_seq ON automation_runs(automation_id,seq);
