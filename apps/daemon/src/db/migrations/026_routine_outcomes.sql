-- Keep history and its paging high-water mark, including when the newest rows were deleted.
CREATE TEMP TABLE routine_sequence AS SELECT seq FROM sqlite_sequence WHERE name='automation_runs';
CREATE TABLE automation_runs_new (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 automation_id TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,
 trigger TEXT NOT NULL,
 event TEXT,
 started_at INTEGER,
 ended_at INTEGER,
 outcome TEXT NOT NULL CHECK(outcome IN ('running','quiet','completed','incomplete','cancelled','failed','interrupted','missed','skipped','start_failed','coverage_gap')),
 summary TEXT NOT NULL DEFAULT '',
 execution_room_id TEXT,
 message_id INTEGER,
 turn_id TEXT,
 work_id TEXT,
 wake_decision_id INTEGER,
 delivery_json TEXT NOT NULL DEFAULT '{"kind":"none"}',
 record_kind TEXT NOT NULL DEFAULT 'run',
 observed_at INTEGER,
 scheduled_at INTEGER,
 gap_until INTEGER,
 reason TEXT,
 phase TEXT,
 occurrence_key TEXT UNIQUE
);
INSERT INTO automation_runs_new(seq,id,automation_id,snapshot_json,trigger,event,started_at,ended_at,outcome,summary,execution_room_id,message_id,turn_id,work_id,wake_decision_id,delivery_json)
 SELECT * FROM automation_runs;
DROP TABLE automation_runs;
ALTER TABLE automation_runs_new RENAME TO automation_runs;
CREATE INDEX automation_runs_automation_seq ON automation_runs(automation_id,seq);
UPDATE sqlite_sequence SET seq=max(seq,coalesce((SELECT seq FROM routine_sequence),seq)) WHERE name='automation_runs';
INSERT INTO sqlite_sequence(name,seq) SELECT 'automation_runs',seq FROM routine_sequence WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='automation_runs');
DROP TABLE routine_sequence;
CREATE TABLE automation_schedule_state (
 automation_id TEXT PRIMARY KEY REFERENCES automations(id) ON DELETE CASCADE,
 revision TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,
 cron TEXT NOT NULL,
 tz TEXT NOT NULL,
 next_due INTEGER NOT NULL
);
