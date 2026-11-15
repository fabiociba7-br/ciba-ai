export type AppAccessPermission =
  | "send"
  | "receive"
  | "memory_read"
  | "memory_write";

export type AppAccessScope = "task" | "context" | "app_memory" | "owner_memory";

export interface AppAccessGrant {
  ownerId: string;
  granteeAppId: string;
  sourceAppId: string | null;
  destinationAppId: string | null;
  permission: AppAccessPermission;
  scope: AppAccessScope;
  expiresAt?: number | null;
  revokedAt?: number | null;
}

export interface AppAccessRequest {
  ownerId: string;
  requesterAppId: string;
  sourceAppId?: string | null;
  destinationAppId?: string | null;
  permission: AppAccessPermission;
  scope: AppAccessScope;
}

/**
 * Fail-closed policy for one explicit grant. The caller must derive ownerId
 * and requesterAppId from the authenticated device, not from request JSON.
 */
export function canUseAppAccessGrant(
  request: AppAccessRequest,
  grants: AppAccessGrant[],
  now = Date.now()
): boolean {
  if (
    !request.ownerId ||
    !request.requesterAppId ||
    !Number.isSafeInteger(now)
  ) return false;

  const sourceAppId = request.sourceAppId ?? null;
  const destinationAppId = request.destinationAppId ?? null;

  if (request.permission === "send" || request.permission === "receive") {
    if (
      !sourceAppId ||
      !destinationAppId ||
      sourceAppId === destinationAppId ||
      (request.scope !== "task" && request.scope !== "context")
    ) return false;
  } else if (request.scope === "app_memory") {
    if (!sourceAppId || destinationAppId !== null) return false;
  } else if (request.scope === "owner_memory") {
    if (sourceAppId !== null || destinationAppId !== null) return false;
  } else {
    return false;
  }

  return grants.some((grant) => {
    if (
      grant.ownerId !== request.ownerId ||
      grant.granteeAppId !== request.requesterAppId ||
      grant.permission !== request.permission ||
      grant.scope !== request.scope ||
      (grant.expiresAt !== undefined && grant.expiresAt !== null &&
        (!Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= now)) ||
      (grant.revokedAt !== undefined && grant.revokedAt !== null)
    ) return false;

    return grant.sourceAppId === sourceAppId &&
      grant.destinationAppId === destinationAppId;
  });
}
