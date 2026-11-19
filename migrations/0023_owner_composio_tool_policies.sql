-- Explicit per-owner Composio tool allowlist and server-classified risk.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS owner_composio_tool_policies (
  owner_id TEXT NOT NULL REFERENCES owners(owner_id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL CHECK (length(tool_name) BETWEEN 1 AND 64),
  toolkit TEXT NOT NULL CHECK (length(toolkit) BETWEEN 1 AND 64),
  risk TEXT NOT NULL CHECK (risk IN ('read', 'write', 'external')),
  requires_approval INTEGER NOT NULL CHECK (requires_approval IN (0, 1)),
  schema_sha256 TEXT NOT NULL CHECK (length(schema_sha256) = 64),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  consented_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, tool_name),
  CHECK (
    (risk = 'read' AND requires_approval = 0) OR
    (risk IN ('write', 'external') AND requires_approval = 1)
  )
);

CREATE INDEX IF NOT EXISTS idx_owner_composio_tool_policies_enabled
  ON owner_composio_tool_policies(owner_id, enabled, toolkit);
