-- Explicit, owner-scoped grants for app messaging and curated memory access.
-- Grants are inert until the migration is applied and a trusted owner-control
-- endpoint creates them. Each row authorizes exactly one permission and scope.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_access_grants (
  grant_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(owner_id),
  grantee_app_id TEXT NOT NULL,
  source_app_id TEXT,
  destination_app_id TEXT,
  permission TEXT NOT NULL CHECK (
    permission IN ('send', 'receive', 'memory_read', 'memory_write')
  ),
  scope TEXT NOT NULL CHECK (
    scope IN ('task', 'context', 'app_memory', 'owner_memory')
  ),
  created_by_device_id TEXT NOT NULL REFERENCES devices(device_id),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  CHECK (
    (permission IN ('send', 'receive')
      AND scope IN ('task', 'context')
      AND source_app_id IS NOT NULL
      AND destination_app_id IS NOT NULL
      AND source_app_id <> destination_app_id)
    OR
    (permission IN ('memory_read', 'memory_write')
      AND scope = 'app_memory'
      AND source_app_id IS NOT NULL
      AND destination_app_id IS NULL)
    OR
    (permission IN ('memory_read', 'memory_write')
      AND scope = 'owner_memory'
      AND source_app_id IS NULL
      AND destination_app_id IS NULL)
  ),
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX IF NOT EXISTS idx_app_access_grants_lookup
  ON app_access_grants(
    owner_id, grantee_app_id, permission, scope,
    source_app_id, destination_app_id, revoked_at, expires_at
  );

CREATE INDEX IF NOT EXISTS idx_app_access_grants_owner
  ON app_access_grants(owner_id, created_at);
