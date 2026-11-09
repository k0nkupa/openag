CREATE TABLE work (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  bot_id TEXT NOT NULL REFERENCES bots(id),
  request_id INTEGER NOT NULL REFERENCES events(id),
  parent_id TEXT REFERENCES work(id),
  delegation_id TEXT,
  title TEXT NOT NULL,
  request TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('working','needs_input','needs_approval','completed','failed','interrupted','cancelled')),
  next_step TEXT NOT NULL,
  plan_json TEXT NOT NULL DEFAULT '[]',
  needs_input INTEGER NOT NULL DEFAULT 0 CHECK(needs_input IN (0,1)),
  progress_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  cancel_requested_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(room_id,bot_id,request_id)
);
CREATE INDEX work_room_seq ON work(room_id,seq);
CREATE INDEX work_bot_seq ON work(bot_id,seq);
CREATE INDEX work_status_seq ON work(status,seq);
CREATE INDEX work_parent ON work(parent_id);
CREATE TABLE work_runs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  work_id TEXT NOT NULL REFERENCES work(id),
  message_id INTEGER NOT NULL REFERENCES events(id),
  turn_id TEXT UNIQUE REFERENCES turns(id),
  status TEXT NOT NULL CHECK(status IN ('queued','running','draining','completed','failed','interrupted','cancelled')),
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX work_runs_work_seq ON work_runs(work_id,seq);
CREATE INDEX events_turn_id ON events(json_extract(payload_json,'$.turnId'));
CREATE TABLE work_tool_links (
  turn_id TEXT NOT NULL REFERENCES turns(id),
  call_id TEXT NOT NULL,
  canonical_id TEXT NOT NULL,
  PRIMARY KEY(turn_id,call_id)
);
CREATE INDEX events_approval_id ON events(json_extract(payload_json,'$.approvalId'));
