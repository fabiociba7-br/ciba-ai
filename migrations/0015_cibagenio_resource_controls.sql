-- CibaGenio stores centrally managed resource switches and an append-only control audit.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cibagenio_controls (
  resource_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'app')),
  scope_id TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  reason TEXT,
  updated_by TEXT NOT NULL DEFAULT 'admin',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (resource_id, scope, scope_id),
  CHECK ((scope = 'global' AND scope_id = '') OR (scope = 'app' AND length(scope_id) BETWEEN 3 AND 150))
);

CREATE TABLE IF NOT EXISTS cibagenio_audit_events (
  event_id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global', 'app')),
  scope_id TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  reason TEXT,
  actor TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cibagenio_audit_time
  ON cibagenio_audit_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cibagenio_audit_resource
  ON cibagenio_audit_events(resource_id, scope, scope_id, occurred_at DESC);
