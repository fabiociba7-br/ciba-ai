-- Durable queue for internal Garcia agent executions.
-- This queue is separate from app_messages (app-to-app delivery).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agent_execution_jobs (
  task_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(owner_id),
  agent_role TEXT NOT NULL CHECK (agent_role IN ('general', 'reasoning', 'research', 'coding', 'creative', 'verification')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (length(payload_json) <= 32000),
  result_json TEXT CHECK (result_json IS NULL OR length(result_json) <= 16000),
  error_code TEXT,
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN -10 AND 10),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 3),
  available_at TEXT NOT NULL,
  lease_token TEXT,
  lease_expires_at TEXT,
  heartbeat_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'running' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (status <> 'running' AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    (status IN ('completed', 'failed', 'cancelled') AND completed_at IS NOT NULL)
    OR
    (status IN ('queued', 'running') AND completed_at IS NULL)
  ),
  UNIQUE(owner_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_claim
  ON agent_execution_jobs(status, available_at, priority DESC, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_lease
  ON agent_execution_jobs(status, lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_owner
  ON agent_execution_jobs(owner_id, created_at DESC);
