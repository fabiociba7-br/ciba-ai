-- Private, owner-scoped queue for explicit app-to-app messages.
-- Messages are retained only until acknowledgement or expiry.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_messages (
  message_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(owner_id),
  source_app_id TEXT NOT NULL,
  destination_app_id TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('task', 'context')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  acknowledged_at TEXT,
  CHECK (source_app_id <> destination_app_id),
  CHECK (length(client_message_id) BETWEEN 1 AND 100),
  CHECK (length(task_id) BETWEEN 1 AND 100),
  CHECK (length(payload_json) <= 8000),
  CHECK (expires_at > created_at),
  CHECK (acknowledged_at IS NULL OR acknowledged_at >= created_at),
  UNIQUE(owner_id, source_app_id, client_message_id)
);

CREATE INDEX IF NOT EXISTS idx_app_messages_inbox
  ON app_messages(owner_id, destination_app_id, acknowledged_at, expires_at, created_at);

CREATE INDEX IF NOT EXISTS idx_app_messages_expiry
  ON app_messages(expires_at, acknowledged_at);
