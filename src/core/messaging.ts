export type AppMessagePermission = "send" | "receive";
export type AppMessageScope = "task" | "context";

export interface AppMessageGrant {
  ownerId: string;
  granteeAppId: string;
  sourceAppId: string;
  destinationAppId: string;
  permissions: AppMessagePermission[];
  scopes: AppMessageScope[];
  expiresAt?: number;
}

export interface AppMessageEnvelope<T = unknown> {
  id: string;
  taskId: string;
  ownerId: string;
  sourceAppId: string;
  destinationAppId: string;
  scope: AppMessageScope;
  payload: T;
  createdAt: number;
  expiresAt: number;
}

export interface AppMessageAccessRequest {
  ownerId: string;
  requesterAppId: string;
  sourceAppId: string;
  destinationAppId: string;
  permission: AppMessagePermission;
  scope: AppMessageScope;
}

const MAX_ID_LENGTH = 200;
const MAX_PAYLOAD_BYTES = 32_000;

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_ID_LENGTH;
}

function snapshotRecord(value: unknown, allowed: string[]): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string" || !allowed.includes(key))) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function snapshotDenseArray(value: unknown, maxLength = 16): unknown[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
        value.length > maxLength) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) return null;
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
}

/** Normalizes a persisted relay grant into an immutable, validated snapshot. */
export function validateAppMessageGrant(grant: AppMessageGrant): AppMessageGrant {
  const source = snapshotRecord(grant, [
    "ownerId", "granteeAppId", "sourceAppId", "destinationAppId",
    "permissions", "scopes", "expiresAt"
  ]);
  const permissions = source ? snapshotDenseArray(source.permissions, 2) : null;
  const scopes = source ? snapshotDenseArray(source.scopes, 2) : null;
  if (!source || !permissions || !scopes ||
      !validId(source.ownerId) || !validId(source.granteeAppId) ||
      !validId(source.sourceAppId) || !validId(source.destinationAppId) ||
      source.sourceAppId === source.destinationAppId ||
      permissions.length === 0 ||
      !permissions.every((item) => item === "send" || item === "receive") ||
      new Set(permissions).size !== permissions.length ||
      scopes.length === 0 ||
      !scopes.every((item) => item === "task" || item === "context") ||
      new Set(scopes).size !== scopes.length ||
      (source.expiresAt !== undefined && !Number.isSafeInteger(source.expiresAt))) {
    throw new Error("invalid_app_message_grant");
  }
  return Object.freeze({
    ownerId: source.ownerId as string,
    granteeAppId: source.granteeAppId as string,
    sourceAppId: source.sourceAppId as string,
    destinationAppId: source.destinationAppId as string,
    permissions: Object.freeze(permissions as AppMessagePermission[]),
    scopes: Object.freeze(scopes as AppMessageScope[]),
    ...(source.expiresAt !== undefined ? { expiresAt: source.expiresAt as number } : {})
  });
}

export function canRelayAppMessage(
  request: AppMessageAccessRequest,
  grants: AppMessageGrant[],
  now = Date.now()
): boolean {
  try {
    const safeRequest = snapshotRecord(request, [
      "ownerId", "requesterAppId", "sourceAppId", "destinationAppId", "permission", "scope"
    ]);
    const safeGrants = snapshotDenseArray(grants, 256);
    if (!safeRequest || !safeGrants ||
        !validId(safeRequest.ownerId) || !validId(safeRequest.requesterAppId) ||
        !validId(safeRequest.sourceAppId) || !validId(safeRequest.destinationAppId) ||
        safeRequest.sourceAppId === safeRequest.destinationAppId ||
        (safeRequest.permission !== "send" && safeRequest.permission !== "receive") ||
        (safeRequest.scope !== "task" && safeRequest.scope !== "context") ||
        !Number.isSafeInteger(now)) return false;

    return safeGrants.some((rawGrant) => {
      try {
        const grant = validateAppMessageGrant(rawGrant as AppMessageGrant);
        return grant.ownerId === safeRequest.ownerId &&
          grant.granteeAppId === safeRequest.requesterAppId &&
          grant.sourceAppId === safeRequest.sourceAppId &&
          grant.destinationAppId === safeRequest.destinationAppId &&
          grant.permissions.includes(safeRequest.permission as AppMessagePermission) &&
          grant.scopes.includes(safeRequest.scope as AppMessageScope) &&
          (grant.expiresAt === undefined || grant.expiresAt > now);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function cloneMessageJson(value: unknown, depth = 0): unknown {
  if (depth > 12) throw new Error("invalid_app_message_payload");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid_app_message_payload");
    return value;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new Error("invalid_app_message_payload");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_PAYLOAD_BYTES ||
        Reflect.ownKeys(descriptors).length !== length + 1) {
      throw new Error("invalid_app_message_payload");
    }
    const result: unknown[] = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error("invalid_app_message_payload");
      }
      result[index] = cloneMessageJson(descriptor.value, depth + 1);
    }
    return result;
  }
  if (typeof value !== "object") throw new Error("invalid_app_message_payload");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("invalid_app_message_payload");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || key === "__proto__" ||
        key === "constructor" || key === "prototype") {
      throw new Error("invalid_app_message_payload");
    }
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_app_message_payload");
    }
    result[key] = cloneMessageJson(descriptor.value, depth + 1);
  }
  return result;
}

/**
 * Validates the transport envelope only. Authentication, grant lookup,
 * persistence, delivery and audit logging must be performed by the gateway.
 */
export function validateAppMessageEnvelope(
  envelope: AppMessageEnvelope,
  now = Date.now(),
  maxPayloadCharacters = 8_000
): void {
  const snapshot = snapshotRecord(envelope, [
    "id", "taskId", "ownerId", "sourceAppId", "destinationAppId",
    "scope", "payload", "createdAt", "expiresAt"
  ]);
  if (!snapshot ||
      !validId(snapshot.id) || !validId(snapshot.taskId) ||
      !validId(snapshot.ownerId) || !validId(snapshot.sourceAppId) ||
      !validId(snapshot.destinationAppId) ||
      snapshot.sourceAppId === snapshot.destinationAppId) {
    throw new Error("invalid_app_message_identity");
  }

  if (snapshot.scope !== "task" && snapshot.scope !== "context") {
    throw new Error("invalid_app_message_scope");
  }

  if (!Number.isSafeInteger(now) ||
      !Number.isSafeInteger(snapshot.createdAt) ||
      !Number.isSafeInteger(snapshot.expiresAt) ||
      (snapshot.expiresAt as number) <= now ||
      (snapshot.expiresAt as number) <= (snapshot.createdAt as number)) {
    throw new Error("invalid_app_message_expiry");
  }

  if (!Number.isInteger(maxPayloadCharacters) ||
      maxPayloadCharacters < 1 || maxPayloadCharacters > MAX_PAYLOAD_BYTES) {
    throw new Error("invalid_app_message_payload");
  }

  let serialized: string;
  try {
    const payloadSnapshot = cloneMessageJson(snapshot.payload);
    serialized = JSON.stringify(payloadSnapshot);
  } catch {
    throw new Error("invalid_app_message_payload");
  }
  if (serialized === undefined ||
      serialized.length > maxPayloadCharacters ||
      new TextEncoder().encode(serialized).byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error("invalid_app_message_payload");
  }
}
