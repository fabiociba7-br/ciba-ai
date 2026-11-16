-- Pending owner-reviewed learning proposals. Source conversations are never stored.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS memory_review_proposals (
  proposal_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('app', 'owner')),
  source_app_id TEXT,
  proposed_by_app_id TEXT NOT NULL,
  memory_key TEXT NOT NULL CHECK (length(memory_key) BETWEEN 1 AND 80),
  proposed_value TEXT NOT NULL CHECK (length(proposed_value) BETWEEN 1 AND 500),
  evidence_excerpt TEXT NOT NULL CHECK (length(evidence_excerpt) BETWEEN 1 AND 500),
  existing_memory_id TEXT,
  existing_value_snapshot TEXT,
  classification TEXT NOT NULL CHECK (classification IN ('new', 'unchanged', 'possible_conflict')),
  valid_hours INTEGER CHECK (valid_hours IS NULL OR valid_hours BETWEEN 1 AND 8760),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'stale')),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  CHECK ((scope = 'app' AND source_app_id IS NOT NULL) OR (scope = 'owner' AND source_app_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_memory_review_owner_status
  ON memory_review_proposals(owner_id, status, created_at);
