CREATE TABLE permission_defaults (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  preset TEXT NOT NULL CHECK(preset IN ('read-only','workspace-write','full-access')),
  revision INTEGER NOT NULL,
  actor TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO permission_defaults VALUES(1,'workspace-write',1,'installation',0);
CREATE TABLE permission_sessions (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  preset TEXT NOT NULL CHECK(preset IN ('read-only','workspace-write','full-access')),
  workspace TEXT NOT NULL,
  write_roots_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  actor TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('default','owner')),
  updated_at INTEGER NOT NULL,
  UNIQUE(bot_id,room_id)
);
CREATE TABLE operation_receipts (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  approval_id TEXT UNIQUE REFERENCES approvals(id),
  review_version TEXT NOT NULL,
  room_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  work_id TEXT REFERENCES work(id),
  turn_id TEXT,
  tool_call_id TEXT,
  tool_name TEXT NOT NULL,
  tool_class TEXT NOT NULL,
  inspection_epoch INTEGER NOT NULL,
  permission_session_id TEXT,
  permission_revision INTEGER,
  permission_json TEXT,
  action_key TEXT NOT NULL,
  decision TEXT NOT NULL,
  proposal_json TEXT NOT NULL,
  effective_json TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('pending','completed','failed','unknown','not-run')),
  evidence_json TEXT NOT NULL,
  decided_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  inspected_at INTEGER,
  inspection_json TEXT
);
INSERT INTO operation_receipts
SELECT r.seq,r.approval_id,r.approval_id,r.review_version,r.room_id,r.bot_id,r.work_id,r.turn_id,r.tool_call_id,r.tool_name,a.tool_class,a.inspection_epoch,NULL,NULL,NULL,r.action_key,r.decision,r.proposal_json,r.effective_json,r.outcome,r.evidence_json,r.decided_at,r.started_at,r.finished_at,r.inspected_at,r.inspection_json
FROM action_receipts r LEFT JOIN approvals a ON a.id=r.approval_id;
DROP TABLE action_receipts;
ALTER TABLE operation_receipts RENAME TO action_receipts;
CREATE INDEX receipts_work_seq ON action_receipts(work_id,seq);
CREATE INDEX receipts_action_outcome ON action_receipts(action_key,outcome);
CREATE INDEX receipts_inspection ON action_receipts(inspected_at) WHERE inspected_at IS NOT NULL;
