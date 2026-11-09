CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK(bytes>=0),
  message_id INTEGER REFERENCES events(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX uploads_room_message ON uploads(room_id,message_id);
