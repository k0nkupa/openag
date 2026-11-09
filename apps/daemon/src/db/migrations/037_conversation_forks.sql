CREATE TABLE conversation_forks (
  room_id TEXT PRIMARY KEY REFERENCES rooms(id),
  source_room_id TEXT NOT NULL REFERENCES rooms(id),
  through_id INTEGER NOT NULL REFERENCES events(id),
  transcript_json TEXT NOT NULL
);
