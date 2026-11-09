ALTER TABLE approvals ADD COLUMN review_version TEXT NOT NULL DEFAULT '';
ALTER TABLE approvals ADD COLUMN tool_call_id TEXT;
ALTER TABLE approvals ADD COLUMN inspection_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE approvals ADD COLUMN review_json TEXT;
UPDATE approvals SET review_version=lower(hex(randomblob(16)));
CREATE TABLE action_receipts (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_id TEXT NOT NULL UNIQUE REFERENCES approvals(id),
  review_version TEXT NOT NULL,
  room_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  work_id TEXT REFERENCES work(id),
  turn_id TEXT,
  tool_call_id TEXT,
  tool_name TEXT NOT NULL,
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
CREATE INDEX receipts_work_seq ON action_receipts(work_id,seq);
CREATE INDEX receipts_action_outcome ON action_receipts(action_key,outcome);
CREATE INDEX receipts_inspection ON action_receipts(inspected_at) WHERE inspected_at IS NOT NULL;
