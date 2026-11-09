CREATE TABLE agent_requests (
  id TEXT PRIMARY KEY,
  invocation_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  origin_room_id TEXT NOT NULL REFERENCES rooms(id),
  origin_message_id INTEGER NOT NULL REFERENCES events(id),
  initiator_bot_id TEXT NOT NULL REFERENCES bots(id),
  initiator_turn_id TEXT,
  initiator_work_id TEXT,
  recipient_id TEXT NOT NULL REFERENCES bots(id),
  execution_room_id TEXT NOT NULL UNIQUE REFERENCES rooms(id),
  kind TEXT NOT NULL CHECK(kind IN ('consultation','mention')),
  question TEXT NOT NULL,
  context TEXT NOT NULL,
  parents_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('accepted','running','completed','incomplete','failed','cancelled','interrupted','expired')),
  result TEXT,
  delivery TEXT NOT NULL DEFAULT 'pending' CHECK(delivery IN ('pending','delivered','failed')),
  revision INTEGER NOT NULL DEFAULT 1,
  delivery_started_at INTEGER,
  created_at INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL
);
CREATE INDEX agent_requests_origin ON agent_requests(origin_room_id,origin_message_id);
CREATE INDEX agent_requests_parent ON agent_requests(initiator_turn_id,status);
