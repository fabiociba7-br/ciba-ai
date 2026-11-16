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

/** Returns a normalized immutable grant or rejects malformed persisted data. */
export function validateAppAccessGrant(grant: AppAccessGrant): AppAccessGrant {
  try {
    if (!grant || typeof grant !== "object") throw new Error("invalid_app_access_grant");
    const descriptors = Object.getOwnPropertyDescriptors(grant);
    const read = (key: string): unknown => {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error("invalid_app_access_grant");
      }
      return descriptor.value;
    };
    const ownerId = read("ownerId");
    const granteeAppId = read("granteeAppId");
    const sourceAppId = read("sourceAppId");
    const destinationAppId = read("destinationAppId");
    const permission = read("permission");
    const scope = read("scope");
    const expiresAt = read("expiresAt");
    const revokedAt = read("revokedAt");

    if (!validId(ownerId) || !validId(granteeAppId) ||
        (sourceAppId !== null && !validId(sourceAppId)) ||
        (destinationAppId !== null && !validId(destinationAppId)) ||
        !VALID_PERMISSIONS.includes(permission as AppAccessPermission) ||
        !VALID_SCOPES.includes(scope as AppAccessScope) ||
        (expiresAt !== undefined && expiresAt !== null && !Number.isSafeInteger(expiresAt)) ||
        (revokedAt !== undefined && revokedAt !== null && !Number.isSafeInteger(revokedAt))) {
      throw new Error("invalid_app_access_grant");
    }
    if (permission === "send" || permission === "receive") {
      if (!validId(sourceAppId) || !validId(destinationAppId) ||
          sourceAppId === destinationAppId || (scope !== "task" && scope !== "context")) {
        throw new Error("invalid_app_access_grant");
      }
    } else if (scope === "app_memory") {
      if (!validId(sourceAppId) || destinationAppId !== null) {
        throw new Error("invalid_app_access_grant");
      }
    } else if (scope === "owner_memory") {
      if (sourceAppId !== null || destinationAppId !== null) {
        throw new Error("invalid_app_access_grant");
      }
    } else {
      throw new Error("invalid_app_access_grant");
    }

    return Object.freeze({
      ownerId,
      granteeAppId,
      sourceAppId: sourceAppId as string | null,
      destinationAppId: destinationAppId as string | null,
      permission: permission as AppAccessPermission,
      scope: scope as AppAccessScope,
      ...(expiresAt !== undefined ? { expiresAt: expiresAt as number | null } : {}),
      ...(revokedAt !== undefined ? { revokedAt: revokedAt as number | null } : {})
    });
  } catch {
    throw new Error("invalid_app_access_grant");
  }
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
