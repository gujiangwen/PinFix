-- When a strategy card is chosen for a loop's retrieve step.
ALTER TABLE knowledge ADD COLUMN last_used_at INTEGER;
ALTER TABLE knowledge ADD COLUMN last_used_session_id TEXT;
