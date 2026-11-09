-- Per-room routing strategy for messages with no @mention: lead (default) | jev | openai-decision | cheap-same-model.
ALTER TABLE rooms ADD COLUMN router TEXT NOT NULL DEFAULT 'lead' CHECK (router IN ('lead', 'jev', 'openai-decision', 'cheap-same-model'));
