CREATE TABLE IF NOT EXISTS minute_usage (
  minute TEXT NOT NULL,
  device_id TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(minute, device_id),
  FOREIGN KEY(device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_minute_usage_updated
  ON minute_usage(minute);

CREATE TRIGGER IF NOT EXISTS enforce_minute_usage_limit
BEFORE UPDATE OF requests ON minute_usage
WHEN NEW.requests > 12
BEGIN
  SELECT RAISE(ABORT, 'request_rate_exceeded');
END;
