-- Durable, owner-bound approval records for future tool execution.
-- This migration only creates storage. No Worker route or tool executor is
-- connected by this change; runtime adoption requires async CAS operations.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tool_approvals (
  approval_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(owner_id),
  app_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  conversation_id TEXT NOT NULL,
  invocation_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('write', 'external')),
  input_json TEXT NOT NULL,
  input_sha256 TEXT NOT NULL CHECK (length(input_sha256) = 64),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'denied', 'consumed', 'cancelled', 'expired')
  ),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  approved_by_device_id TEXT REFERENCES devices(device_id),
  consumed_at TEXT,
  closed_at TEXT,
  UNIQUE (owner_id, device_id, invocation_id),
  CHECK (length(approval_id) BETWEEN 16 AND 128),
  CHECK (length(owner_id) BETWEEN 1 AND 128),
  CHECK (length(app_id) BETWEEN 3 AND 150),
  CHECK (length(device_id) BETWEEN 1 AND 128),
  CHECK (length(conversation_id) BETWEEN 1 AND 128),
  CHECK (length(invocation_id) BETWEEN 1 AND 128),
  CHECK (length(tool_id) BETWEEN 1 AND 128),
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'pending' AND decided_at IS NULL AND approved_by_device_id IS NULL
      AND consumed_at IS NULL AND closed_at IS NULL)
    OR
    (status = 'approved' AND decided_at IS NOT NULL AND approved_by_device_id IS NOT NULL
      AND consumed_at IS NULL AND closed_at IS NULL)
    OR
    (status = 'denied' AND decided_at IS NOT NULL AND approved_by_device_id IS NOT NULL
      AND consumed_at IS NULL AND closed_at IS NOT NULL)
    OR
    (status = 'consumed' AND decided_at IS NOT NULL AND approved_by_device_id IS NOT NULL
      AND consumed_at IS NOT NULL AND closed_at IS NOT NULL)
    OR
    (status IN ('cancelled', 'expired') AND closed_at IS NOT NULL
      AND consumed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_tool_approvals_owner_status_expiry
  ON tool_approvals(owner_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_tool_approvals_device_invocation
  ON tool_approvals(device_id, invocation_id);

CREATE INDEX IF NOT EXISTS idx_tool_approvals_expiry
  ON tool_approvals(status, expires_at);
