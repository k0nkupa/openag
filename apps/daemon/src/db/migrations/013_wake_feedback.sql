-- The owner can say a held-back ping should have been delivered. Recorded for review; it does not change the filter.
ALTER TABLE wake_decisions ADD COLUMN feedback TEXT CHECK (feedback IN ('should_have_pinged'));
