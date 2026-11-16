-- Metadata-only audit trail for curated memory changes. Never stores memory values or source conversations.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS memory_audit_events (
  event_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  memory_id TEXT,
  proposal_id TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('app', 'owner')),
  source_app_id TEXT,
  memory_key TEXT NOT NULL CHECK (length(memory_key) BETWEEN 1 AND 80),
  action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'deleted', 'review_approved', 'review_rejected')),
  actor_app_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  CHECK ((scope = 'app' AND source_app_id IS NOT NULL) OR (scope = 'owner' AND source_app_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_memory_audit_owner_time
  ON memory_audit_events(owner_id, scope, source_app_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_audit_memory
  ON memory_audit_events(owner_id, memory_id, occurred_at DESC);
