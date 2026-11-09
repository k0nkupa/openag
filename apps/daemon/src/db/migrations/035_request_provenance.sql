CREATE INDEX request_prepared_turn ON events(json_extract(payload_json,'$.turnId'),id) WHERE type='request_prepared';
CREATE INDEX request_attempt_manifest ON events(json_extract(payload_json,'$.turnId'),json_extract(payload_json,'$.manifestId'),id) WHERE type='request_attempt';
CREATE INDEX conversation_history_events ON events(room_id,id) WHERE type IN ('message','bot_output');
CREATE INDEX conversation_history_participation ON turns(room_id,bot_id,CAST(json_extract(state_json,'$.messageId') AS NUMERIC))
WHERE coalesce(json_extract(state_json,'$.isolated'),0)=0 AND coalesce(json_extract(state_json,'$.noIndex'),0)=0 AND json_extract(state_json,'$.source') IS NULL;
