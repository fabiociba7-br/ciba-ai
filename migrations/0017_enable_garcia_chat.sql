-- Enable only the primary chat resource for the official Garcia Android app.
-- All other CibaGenio resources remain locked unless explicitly granted.
INSERT INTO cibagenio_controls (
  resource_id, scope, scope_id, enabled, reason, updated_by, updated_at
) VALUES (
  'chat', 'app', 'com.ciba.garcia', 1,
  'Enable Garcia primary chat; keep all other resources protected.',
  'migration-0017', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
ON CONFLICT(resource_id, scope, scope_id) DO UPDATE SET
  enabled = excluded.enabled,
  reason = excluded.reason,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;

INSERT INTO cibagenio_audit_events (
  event_id, resource_id, scope, scope_id, enabled, reason, actor, occurred_at
) VALUES (
  'migration-0017-garcia-chat-unlock', 'chat', 'app', 'com.ciba.garcia', 1,
  'Enable Garcia primary chat; keep all other resources protected.',
  'migration-0017', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
);
