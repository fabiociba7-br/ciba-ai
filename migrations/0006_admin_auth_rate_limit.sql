CREATE TABLE IF NOT EXISTS admin_auth_usage (
  minute TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  attempt_limit INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(minute, ip_hash)
);

CREATE INDEX IF NOT EXISTS idx_admin_auth_usage_minute
  ON admin_auth_usage(minute);

CREATE TRIGGER IF NOT EXISTS enforce_admin_auth_attempt_limit
BEFORE UPDATE OF attempts ON admin_auth_usage
WHEN NEW.attempts > NEW.attempt_limit
BEGIN
  SELECT RAISE(ABORT, 'admin_auth_rate_exceeded');
END;
