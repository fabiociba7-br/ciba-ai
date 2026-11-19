CREATE TABLE IF NOT EXISTS garcia_storage_outbox (
  id TEXT PRIMARY KEY,
  destination TEXT NOT NULL CHECK (destination IN ('turso', 'neon', 'r2')),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TEXT NOT NULL,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_garcia_storage_outbox_due
  ON garcia_storage_outbox(status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_garcia_storage_outbox_entity
  ON garcia_storage_outbox(entity_type, entity_id, destination);

CREATE TABLE IF NOT EXISTS garcia_storage_provider_usage (
  provider TEXT NOT NULL CHECK (provider IN ('cloudflare_d1', 'turso', 'neon', 'cloudflare_r2')),
  metric TEXT NOT NULL,
  period_key TEXT NOT NULL,
  used_value REAL NOT NULL CHECK (used_value >= 0),
  quota_value REAL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(provider, metric, period_key)
);
