export const MESSAGE_MAX_PAYLOAD_CHARS = 8_000;
export const MESSAGE_MAX_PENDING_PER_DESTINATION = 100;
export const MESSAGE_DEFAULT_TTL_HOURS = 24;
export const MESSAGE_MAX_TTL_HOURS = 72;

export const hasMessageGrant = async (
  db: D1Database,
  ownerId: string,
  granteeAppId: string,
  sourceAppId: string,
  destinationAppId: string,
  permission: "send" | "receive",
  scope: "task" | "context",
  timestamp: string
): Promise<boolean> => {
  const row = await db.prepare(`
    SELECT grant_id FROM app_access_grants
    WHERE owner_id = ? AND grantee_app_id = ?
      AND source_app_id = ? AND destination_app_id = ?
      AND permission = ? AND scope = ?
      AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
    LIMIT 1
  `).bind(ownerId, granteeAppId, sourceAppId, destinationAppId, permission, scope, timestamp)
    .first<{ grant_id: string }>();
  return Boolean(row);
};
