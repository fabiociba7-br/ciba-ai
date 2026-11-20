PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tool_approval_results (
  approval_id TEXT PRIMARY KEY REFERENCES tool_approvals(approval_id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES owners(owner_id),
  app_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  output_json TEXT NOT NULL CHECK (json_valid(output_json)),
  output_sha256 TEXT NOT NULL CHECK (length(output_sha256) = 64),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_approval_results_owner_created
  ON tool_approval_results(owner_id, created_at DESC);
