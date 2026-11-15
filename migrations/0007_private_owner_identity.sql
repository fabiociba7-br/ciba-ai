-- Private owner identity foundation. Existing devices remain unlinked until
-- an explicit, authenticated pairing flow is implemented in a later stage.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS owners (
  owner_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS owner_pairing_invitations (
  code_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(owner_id),
  app_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumed_device_id TEXT REFERENCES devices(device_id),
  CHECK (
    (consumed_at IS NULL AND consumed_device_id IS NULL) OR
    (consumed_at IS NOT NULL AND consumed_device_id IS NOT NULL)
  )
);

ALTER TABLE devices ADD COLUMN owner_id TEXT REFERENCES owners(owner_id);

CREATE INDEX IF NOT EXISTS idx_devices_owner
  ON devices(owner_id);

CREATE INDEX IF NOT EXISTS idx_owner_pairing_owner_app_expiry
  ON owner_pairing_invitations(owner_id, app_id, expires_at);
