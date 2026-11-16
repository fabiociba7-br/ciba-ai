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

/** Normalizes a persisted relay grant into an immutable, validated snapshot. */
export function validateAppMessageGrant(grant: AppMessageGrant): AppMessageGrant {
  try {
    if (!grant || typeof grant !== "object") throw new Error("invalid_app_message_grant");
    const descriptors = Object.getOwnPropertyDescriptors(grant);
    const read = (key: string): unknown => {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error("invalid_app_message_grant");
      }
      return descriptor.value;
    };
    const ownerId = read("ownerId");
    const granteeAppId = read("granteeAppId");
    const sourceAppId = read("sourceAppId");
    const destinationAppId = read("destinationAppId");
    const permissions = read("permissions");
    const scopes = read("scopes");
    const expiresAt = read("expiresAt");

    if (!validId(ownerId) || !validId(granteeAppId) ||
        !validId(sourceAppId) || !validId(destinationAppId) ||
        sourceAppId === destinationAppId ||
        !Array.isArray(permissions) || permissions.length === 0 ||
        !permissions.every((item) => item === "send" || item === "receive") ||
        new Set(permissions).size !== permissions.length ||
        !Array.isArray(scopes) || scopes.length === 0 ||
        !scopes.every((item) => item === "task" || item === "context") ||
        new Set(scopes).size !== scopes.length ||
        (expiresAt !== undefined && !Number.isSafeInteger(expiresAt))) {
      throw new Error("invalid_app_message_grant");
    }
    return Object.freeze({
      ownerId,
      granteeAppId,
      sourceAppId,
      destinationAppId,
      permissions: Object.freeze([...permissions]) as AppMessagePermission[],
      scopes: Object.freeze([...scopes]) as AppMessageScope[],
      ...(expiresAt !== undefined ? { expiresAt: expiresAt as number } : {})
    });
  } catch {
    throw new Error("invalid_app_message_grant");
  }
}

export function canRelayAppMessage(
  request: AppMessageAccessRequest,
  grants: AppMessageGrant[],
  now = Date.now()
): boolean {
  if (!request || !validId(request.ownerId) || !validId(request.requesterAppId) ||
      !validId(request.sourceAppId) || !validId(request.destinationAppId) ||
      request.sourceAppId === request.destinationAppId ||
      (request.permission !== "send" && request.permission !== "receive") ||
      (request.scope !== "task" && request.scope !== "context") ||
      !Array.isArray(grants) || !Number.isSafeInteger(now)) {
    return false;
  }

  return grants.some((grant) => {
    if (!grant || typeof grant !== "object" ||
        !validId(grant.ownerId) || !validId(grant.granteeAppId) ||
        !validId(grant.sourceAppId) || !validId(grant.destinationAppId) ||
        !Array.isArray(grant.permissions) ||
        !grant.permissions.every((permission) => permission === "send" || permission === "receive") ||
        !Array.isArray(grant.scopes) ||
        !grant.scopes.every((scope) => scope === "task" || scope === "context") ||
        (grant.expiresAt !== undefined && !Number.isSafeInteger(grant.expiresAt))) {
      return false;
    }

    return grant.ownerId === request.ownerId &&
      grant.granteeAppId === request.requesterAppId &&
      grant.sourceAppId === request.sourceAppId &&
      grant.destinationAppId === request.destinationAppId &&
      grant.permissions.includes(request.permission) &&
      grant.scopes.includes(request.scope) &&
      (grant.expiresAt === undefined || grant.expiresAt > now);
  });
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
  if (!envelope || typeof envelope !== "object" ||
      !validId(envelope.id) || !validId(envelope.taskId) ||
      !validId(envelope.ownerId) || !validId(envelope.sourceAppId) ||
      !validId(envelope.destinationAppId) ||
      envelope.sourceAppId === envelope.destinationAppId) {
    throw new Error("invalid_app_message_identity");
  }

  if (envelope.scope !== "task" && envelope.scope !== "context") {
    throw new Error("invalid_app_message_scope");
  }

  if (!Number.isSafeInteger(now) ||
      !Number.isSafeInteger(envelope.createdAt) ||
      !Number.isSafeInteger(envelope.expiresAt) ||
      envelope.expiresAt <= now ||
      envelope.expiresAt <= envelope.createdAt) {
    throw new Error("invalid_app_message_expiry");
  }

  if (!Number.isInteger(maxPayloadCharacters) ||
      maxPayloadCharacters < 1 || maxPayloadCharacters > MAX_PAYLOAD_BYTES) {
    throw new Error("invalid_app_message_payload");
  }

  let serialized: string;
  try {
    const snapshot = cloneMessageJson(envelope.payload);
    serialized = JSON.stringify(snapshot);
  } catch {
    throw new Error("invalid_app_message_payload");
  }
  if (serialized === undefined ||
      serialized.length > maxPayloadCharacters ||
      new TextEncoder().encode(serialized).byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error("invalid_app_message_payload");
  }
}
