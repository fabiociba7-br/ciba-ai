-- Garcia is a private, single-owner assistant for Ciba.
-- Keep the device proven to be paired with Ciba's newly provisioned owner.
-- The earlier active registration belongs to a superseded owner and is revoked.
UPDATE devices
SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE app_id = 'com.ciba.garcia'
  AND device_id <> 'df47814f-de22-431e-be79-abd1eba54420'
  AND revoked_at IS NULL;

UPDATE owners
SET status = 'revoked',
    revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE owner_id <> '48d9b765-5eb0-46f7-a50b-32480912eac5'
  AND status = 'active'
  AND EXISTS (
    SELECT 1 FROM owner_pairing_invitations i
    WHERE i.owner_id = owners.owner_id AND i.app_id = 'com.ciba.garcia'
  );

-- Database-level backstop: only one active Garcia installation can exist.
CREATE UNIQUE INDEX IF NOT EXISTS idx_garcia_single_active_device
  ON devices(app_id)
  WHERE app_id = 'com.ciba.garcia' AND revoked_at IS NULL;

-- Enable curated memory and seed only the identity facts explicitly supplied
-- by the owner. No chat transcript is imported or stored.

INSERT INTO cibagenio_controls (
  resource_id, scope, scope_id, enabled, reason, updated_by, updated_at
)
VALUES (
  'persistent_memory', 'app', 'com.ciba.garcia', 1,
  'Enable Garcia private owner memory for Ciba identity.',
  'migration-0018', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(resource_id, scope, scope_id) DO UPDATE SET
  enabled = excluded.enabled,
  reason = excluded.reason,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;

INSERT INTO owner_settings(owner_id, memory_enabled, app_messaging_enabled, updated_at)
SELECT o.owner_id, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM owners o
WHERE o.status = 'active'
  AND EXISTS (
    SELECT 1 FROM owner_pairing_invitations i
    WHERE i.owner_id = o.owner_id AND i.app_id = 'com.ciba.garcia'
  )
ON CONFLICT(owner_id) DO UPDATE SET
  memory_enabled = 1,
  updated_at = excluded.updated_at;

INSERT INTO memory_records(
  memory_id, owner_id, scope, source_app_id, memory_key, value,
  consent, created_by_app_id, created_at, updated_at, expires_at
)
SELECT
  'garcia-ciba-identity-' || o.owner_id,
  o.owner_id,
  'app',
  'com.ciba.garcia',
  'personal.identity',
  'Quem sou eu: sou Ciba, também conhecido como Fábio Ciba. Sou o criador, dono e mentor da Garcia. Sou também amigo e parceiro dela. Sou a única pessoa autorizada a conversar com a Garcia; não existem outros usuários.',
  'curated',
  'com.ciba.garcia',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL
FROM owners o
WHERE o.status = 'active'
  AND EXISTS (
    SELECT 1 FROM owner_pairing_invitations i
    WHERE i.owner_id = o.owner_id AND i.app_id = 'com.ciba.garcia'
  )
  AND NOT EXISTS (
    SELECT 1 FROM memory_records m
    WHERE m.owner_id = o.owner_id
      AND m.scope = 'app'
      AND m.source_app_id = 'com.ciba.garcia'
      AND m.memory_key = 'personal.identity'
      AND m.deleted_at IS NULL
  );

INSERT INTO memory_records(
  memory_id, owner_id, scope, source_app_id, memory_key, value,
  consent, created_by_app_id, created_at, updated_at, expires_at
)
SELECT
  'garcia-ciba-relationship-' || o.owner_id,
  o.owner_id,
  'app',
  'com.ciba.garcia',
  'communication.relationship',
  'A Garcia deve reconhecer Ciba como seu criador, proprietário e mentor, e também como amigo e parceiro. A relação é exclusiva: a assistente foi criada para trabalhar e conversar somente com Ciba.',
  'curated',
  'com.ciba.garcia',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL
FROM owners o
WHERE o.status = 'active'
  AND EXISTS (
    SELECT 1 FROM owner_pairing_invitations i
    WHERE i.owner_id = o.owner_id AND i.app_id = 'com.ciba.garcia'
  )
  AND NOT EXISTS (
    SELECT 1 FROM memory_records m
    WHERE m.owner_id = o.owner_id
      AND m.scope = 'app'
      AND m.source_app_id = 'com.ciba.garcia'
      AND m.memory_key = 'communication.relationship'
      AND m.deleted_at IS NULL
  );
