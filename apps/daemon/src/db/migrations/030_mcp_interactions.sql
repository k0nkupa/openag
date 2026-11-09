CREATE TABLE mcp_interactions (
 id TEXT PRIMARY KEY,
 revision TEXT NOT NULL,
 server_id TEXT NOT NULL,
 room_id TEXT NOT NULL REFERENCES rooms(id),
 bot_id TEXT NOT NULL REFERENCES bots(id),
 turn_id TEXT NOT NULL REFERENCES turns(id),
 tool_call_id TEXT NOT NULL,
 work_id TEXT REFERENCES work(id),
 tool_name TEXT NOT NULL,
 request_json TEXT NOT NULL,
 response_json TEXT,
 status TEXT NOT NULL CHECK(status IN ('open','accepted','declined','cancelled','expired','interrupted')),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 decided_at INTEGER
);
CREATE INDEX mcp_interactions_open ON mcp_interactions(status,turn_id);
CREATE INDEX mcp_interactions_invocation ON mcp_interactions(turn_id,tool_call_id);
