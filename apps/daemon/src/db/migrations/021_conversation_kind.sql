-- OA-344: a conversation is either a user-created `room` or a `direct` chat with one bot. Until now "direct" was guessed
-- from the member count. Existing rows are backfilled conservatively: only the desk's own direct chats (id
-- `chat-<32 hex>`, exactly one member, and that member is the lead) become `direct`; everything else stays `room`.
ALTER TABLE rooms ADD COLUMN kind TEXT NOT NULL DEFAULT 'room' CHECK (kind IN ('room', 'direct'));

UPDATE rooms SET kind = 'direct'
WHERE id GLOB 'chat-[0-9a-f]*' AND length(id) = 37
  AND (SELECT COUNT(*) FROM room_members m WHERE m.room_id = rooms.id) = 1
  AND lead_bot_id = (SELECT m.bot_id FROM room_members m WHERE m.room_id = rooms.id);

-- Proactive messages used to go to room `main`. Keep that on installs that have it; new installs use the default bot's chat.
INSERT OR IGNORE INTO settings (key, value_json, updated_at)
SELECT 'deliveryRoom', '{"roomId":"main"}', CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE EXISTS (SELECT 1 FROM rooms WHERE id = 'main');
