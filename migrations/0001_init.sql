PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS invitations (
  code_hash TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  consumed_device_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_invitations_app_expiry
  ON invitations(app_id, expires_at);

CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_devices_app
  ON devices(app_id);

CREATE TABLE IF NOT EXISTS daily_usage (
  day TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  request_limit INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(day, scope_key)
);

CREATE TRIGGER IF NOT EXISTS enforce_daily_usage_limit
BEFORE UPDATE OF requests ON daily_usage
WHEN NEW.requests > NEW.request_limit
BEGIN
  SELECT RAISE(ABORT, 'quota_exceeded');
END;

CREATE INDEX IF NOT EXISTS idx_daily_usage_day
  ON daily_usage(day);
