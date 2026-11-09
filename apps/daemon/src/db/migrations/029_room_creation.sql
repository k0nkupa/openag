CREATE TABLE room_creations (
  request_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL UNIQUE REFERENCES rooms(id),
  payload_hash TEXT NOT NULL
);
