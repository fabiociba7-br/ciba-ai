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
    const expiresAt = descriptors.expiresAt ? read("expiresAt") : undefined;
    const revokedAt = descriptors.revokedAt ? read("revokedAt") : undefined;

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

function snapshotAccessRequest(value: unknown): AppAccessRequest | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const allowed = ["ownerId", "requesterAppId", "sourceAppId", "destinationAppId", "permission", "scope"];
    if (keys.some((key) => typeof key !== "string" || !allowed.includes(key))) return null;
    for (const key of ["ownerId", "requesterAppId", "permission", "scope"]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    }
    for (const key of ["sourceAppId", "destinationAppId"]) {
      const descriptor = descriptors[key];
      if (descriptor && (!("value" in descriptor) || !descriptor.enumerable)) return null;
    }
    const read = (key: string): unknown => descriptors[key]?.value;
    const sourceAppId = read("sourceAppId") ?? null;
    const destinationAppId = read("destinationAppId") ?? null;
    const request: AppAccessRequest = {
      ownerId: read("ownerId") as string,
      requesterAppId: read("requesterAppId") as string,
      sourceAppId: sourceAppId as string | null,
      destinationAppId: destinationAppId as string | null,
      permission: read("permission") as AppAccessPermission,
      scope: read("scope") as AppAccessScope
    };
    if (!validId(request.ownerId) || !validId(request.requesterAppId) ||
        !VALID_PERMISSIONS.includes(request.permission) ||
        !VALID_SCOPES.includes(request.scope) ||
        (request.sourceAppId !== null && !validId(request.sourceAppId)) ||
        (request.destinationAppId !== null && !validId(request.destinationAppId))) return null;
    return Object.freeze(request);
  } catch {
    return null;
  }
}

function snapshotGrantList(value: unknown): AppAccessGrant[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
        value.length > 10_000) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) return null;
    const result: AppAccessGrant[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      try {
        result.push(validateAppAccessGrant(descriptor.value as AppAccessGrant));
      } catch {
        // A malformed persisted grant is ignored; it can never authorize access.
      }
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Fail-closed policy for one explicit grant. The caller must derive ownerId
 * and requesterAppId from the authenticated device, not from request JSON.
 * Accessor-backed requests and malformed grant collections never authorize.
 */
export function canUseAppAccessGrant(
  request: AppAccessRequest,
  grants: AppAccessGrant[],
  now = Date.now()
): boolean {
  try {
    if (!Number.isSafeInteger(now)) return false;
    const safeRequest = snapshotAccessRequest(request);
    const safeGrants = snapshotGrantList(grants);
    if (!safeRequest || !safeGrants) return false;

    const sourceAppId = safeRequest.sourceAppId ?? null;
    const destinationAppId = safeRequest.destinationAppId ?? null;

    if (safeRequest.permission === "send" || safeRequest.permission === "receive") {
      if (!sourceAppId || !destinationAppId ||
          sourceAppId === destinationAppId ||
          (safeRequest.scope !== "task" && safeRequest.scope !== "context")) return false;
    } else if (safeRequest.scope === "app_memory") {
      if (!sourceAppId || destinationAppId !== null) return false;
    } else if (safeRequest.scope === "owner_memory") {
      if (sourceAppId !== null || destinationAppId !== null) return false;
    } else {
      return false;
    }

    return safeGrants.some((grant) =>
      grant.ownerId === safeRequest.ownerId &&
      grant.granteeAppId === safeRequest.requesterAppId &&
      grant.permission === safeRequest.permission &&
      grant.scope === safeRequest.scope &&
      (grant.expiresAt === undefined || grant.expiresAt === null || grant.expiresAt > now) &&
      (grant.revokedAt === undefined || grant.revokedAt === null) &&
      grant.sourceAppId === sourceAppId &&
      grant.destinationAppId === destinationAppId
    );
  } catch {
    return false;
  }
}
