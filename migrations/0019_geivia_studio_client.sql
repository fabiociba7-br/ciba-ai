-- Register GEIVIA as a private Ciba AI client application.
-- The app can authenticate only with one-time invitations issued by the owner.
-- Keep the integration limited to chat; no task tools or cross-app messaging are enabled.
INSERT INTO app_registry (
  app_id, display_name, enabled, description, app_type,
  capabilities_json, task_types_json, contract_version, created_at, updated_at
) VALUES (
  'com.geivia.app',
  'GEIVIA Studio',
  1,
  'GEIVIA Studio client for owner-authorized Garcia AI project assistance.',
  'other',
  '[]',
  '[]',
  '1.0.0',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(app_id) DO UPDATE SET
  display_name = excluded.display_name,
  enabled = excluded.enabled,
  description = excluded.description,
  app_type = excluded.app_type,
  capabilities_json = excluded.capabilities_json,
  task_types_json = excluded.task_types_json,
  contract_version = excluded.contract_version,
  updated_at = excluded.updated_at;

INSERT INTO cibagenio_controls (
  resource_id, scope, scope_id, enabled, reason, updated_by, updated_at
) VALUES (
  'chat',
  'app',
  'com.geivia.app',
  1,
  'Allow GEIVIA Studio to use Garcia chat after private device registration and owner pairing.',
  'migration-0019',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(resource_id, scope, scope_id) DO UPDATE SET
  enabled = excluded.enabled,
  reason = excluded.reason,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;

INSERT INTO cibagenio_audit_events (
  event_id, resource_id, scope, scope_id, enabled, reason, actor, occurred_at
) VALUES (
  'migration-0019-geivia-chat',
  'chat',
  'app',
  'com.geivia.app',
  1,
  'Allow GEIVIA Studio to use Garcia chat after private device registration and owner pairing.',
  'migration-0019',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
