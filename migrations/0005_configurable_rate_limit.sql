ALTER TABLE minute_usage
  ADD COLUMN request_limit INTEGER NOT NULL DEFAULT 12;

DROP TRIGGER IF EXISTS enforce_minute_usage_limit;

CREATE TRIGGER enforce_minute_usage_limit
BEFORE UPDATE OF requests ON minute_usage
WHEN NEW.requests > NEW.request_limit
BEGIN
  SELECT RAISE(ABORT, 'request_rate_exceeded');
END;
