-- Per-owner Composio sessions. Session identifiers are server-side only.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS owner_composio_sessions (
  owner_id TEXT PRIMARY KEY REFERENCES owners(owner_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL UNIQUE,
  toolkits_json TEXT NOT NULL CHECK (length(toolkits_json) <= 2000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_owner_composio_sessions_status
  ON owner_composio_sessions(status, updated_at);
