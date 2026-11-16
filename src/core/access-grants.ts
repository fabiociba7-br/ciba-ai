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

const VALID_PERMISSIONS: AppAccessPermission[] = [
  "send", "receive", "memory_read", "memory_write"
];
const VALID_SCOPES: AppAccessScope[] = [
  "task", "context", "app_memory", "owner_memory"
];

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200;
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
  if (!request || !validId(request.ownerId) || !validId(request.requesterAppId) ||
      !VALID_PERMISSIONS.includes(request.permission) ||
      !VALID_SCOPES.includes(request.scope) ||
      !Array.isArray(grants) || !Number.isSafeInteger(now)) {
    return false;
  }

  const sourceAppId = request.sourceAppId ?? null;
  const destinationAppId = request.destinationAppId ?? null;

  if ((sourceAppId !== null && !validId(sourceAppId)) ||
      (destinationAppId !== null && !validId(destinationAppId))) {
    return false;
  }

  if (request.permission === "send" || request.permission === "receive") {
    if (!sourceAppId || !destinationAppId ||
        sourceAppId === destinationAppId ||
        (request.scope !== "task" && request.scope !== "context")) return false;
  } else if (request.scope === "app_memory") {
    if (!sourceAppId || destinationAppId !== null) return false;
  } else if (request.scope === "owner_memory") {
    if (sourceAppId !== null || destinationAppId !== null) return false;
  } else {
    return false;
  }

  return grants.some((grant) => {
    if (!grant || typeof grant !== "object" ||
        !validId(grant.ownerId) || !validId(grant.granteeAppId) ||
        !VALID_PERMISSIONS.includes(grant.permission) ||
        !VALID_SCOPES.includes(grant.scope) ||
        (grant.sourceAppId !== null && !validId(grant.sourceAppId)) ||
        (grant.destinationAppId !== null && !validId(grant.destinationAppId)) ||
        (grant.expiresAt !== undefined && grant.expiresAt !== null &&
          !Number.isSafeInteger(grant.expiresAt)) ||
        (grant.revokedAt !== undefined && grant.revokedAt !== null &&
          !Number.isSafeInteger(grant.revokedAt))) {
      return false;
    }

    if (grant.ownerId !== request.ownerId ||
        grant.granteeAppId !== request.requesterAppId ||
        grant.permission !== request.permission ||
        grant.scope !== request.scope ||
        (grant.expiresAt !== undefined && grant.expiresAt !== null && grant.expiresAt <= now) ||
        (grant.revokedAt !== undefined && grant.revokedAt !== null)) {
      return false;
    }

    return grant.sourceAppId === sourceAppId &&
      grant.destinationAppId === destinationAppId;
  });
}
