-- Curated, private memory. Chat transcripts are never inserted automatically.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS memory_records (
  memory_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(owner_id),
  scope TEXT NOT NULL CHECK (scope IN ('app', 'owner')),
  source_app_id TEXT,
  memory_key TEXT NOT NULL CHECK (length(memory_key) BETWEEN 1 AND 80),
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 500),
  consent TEXT NOT NULL CHECK (consent = 'curated'),
  created_by_app_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  deleted_at TEXT,
  CHECK (
    (scope = 'app' AND source_app_id IS NOT NULL) OR
    (scope = 'owner' AND source_app_id IS NULL)
  ),
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_app_key
  ON memory_records(owner_id, source_app_id, memory_key)
  WHERE scope = 'app' AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_owner_key
  ON memory_records(owner_id, memory_key)
  WHERE scope = 'owner' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_memory_owner_scope
  ON memory_records(owner_id, scope, source_app_id, deleted_at, updated_at);
