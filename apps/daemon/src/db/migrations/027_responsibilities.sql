CREATE TABLE responsibilities (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
 config_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE responsibility_observations (
 id TEXT PRIMARY KEY, responsibility_id TEXT NOT NULL REFERENCES responsibilities(id),
 event_key TEXT NOT NULL UNIQUE, event_json TEXT NOT NULL, disposition TEXT NOT NULL,
 observed_at INTEGER NOT NULL, conflicted_at INTEGER
);
CREATE TABLE investigations (
 id TEXT PRIMARY KEY, responsibility_id TEXT NOT NULL REFERENCES responsibilities(id), revision INTEGER NOT NULL,
 observation_id TEXT NOT NULL UNIQUE REFERENCES responsibility_observations(id), scope_json TEXT NOT NULL,
 status TEXT NOT NULL, reason TEXT, created_at INTEGER NOT NULL, ended_at INTEGER,
 turn_id TEXT REFERENCES turns(id), evidence_json TEXT NOT NULL DEFAULT '[]', result_id TEXT,
 delivery_state TEXT NOT NULL DEFAULT 'none', wake_decision_id INTEGER, report_json TEXT
);
CREATE INDEX investigations_responsibility ON investigations(responsibility_id,created_at);
CREATE TEMP TABLE secretary_result_sequence AS SELECT seq FROM sqlite_sequence WHERE name='saved_results';
CREATE TABLE saved_results_new (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 work_id TEXT REFERENCES work(id), room_id TEXT NOT NULL REFERENCES rooms(id), bot_id TEXT NOT NULL REFERENCES bots(id),
 turn_id TEXT NOT NULL REFERENCES turns(id), tool_call_id TEXT UNIQUE,
 name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('comparison','draft','code','note')),
 content TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes BETWEEN 1 AND 262144), created_at INTEGER NOT NULL,
 origin TEXT NOT NULL DEFAULT 'tool' CHECK(origin IN ('tool','investigation')),
 investigation_id TEXT UNIQUE REFERENCES investigations(id),
 CHECK((origin='tool' AND tool_call_id IS NOT NULL AND investigation_id IS NULL) OR (origin='investigation' AND tool_call_id IS NULL AND investigation_id IS NOT NULL AND work_id IS NULL)),
 UNIQUE(id,version)
);
INSERT INTO saved_results_new(seq,id,version,work_id,room_id,bot_id,turn_id,tool_call_id,name,kind,content,bytes,created_at) SELECT * FROM saved_results;
DROP TABLE saved_results;
ALTER TABLE saved_results_new RENAME TO saved_results;
CREATE INDEX saved_results_work ON saved_results(work_id,seq);
CREATE INDEX saved_results_room ON saved_results(room_id,seq);
CREATE INDEX saved_results_bot ON saved_results(bot_id,seq);
UPDATE sqlite_sequence SET seq=max(seq,coalesce((SELECT seq FROM secretary_result_sequence),seq)) WHERE name='saved_results';
INSERT INTO sqlite_sequence(name,seq) SELECT 'saved_results',seq FROM secretary_result_sequence WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='saved_results');
DROP TABLE secretary_result_sequence;
ALTER TABLE wake_decisions ADD COLUMN delivery_key TEXT;
CREATE UNIQUE INDEX wake_delivery_key ON wake_decisions(delivery_key) WHERE delivery_key IS NOT NULL;

ALTER TABLE digest_items ADD COLUMN result_id TEXT;
CREATE INDEX investigations_scope ON investigations(responsibility_id,revision,id);
