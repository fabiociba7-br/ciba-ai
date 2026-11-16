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
    serialized = JSON.stringify(envelope.payload);
  } catch {
    throw new Error("invalid_app_message_payload");
  }
  if (serialized === undefined ||
      serialized.length > maxPayloadCharacters ||
      new TextEncoder().encode(serialized).byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error("invalid_app_message_payload");
  }
}
