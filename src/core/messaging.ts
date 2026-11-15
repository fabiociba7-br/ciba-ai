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

export function canRelayAppMessage(
  request: AppMessageAccessRequest,
  grants: AppMessageGrant[],
  now = Date.now()
): boolean {
  if (
    !request.ownerId ||
    !request.requesterAppId ||
    !request.sourceAppId ||
    !request.destinationAppId ||
    request.sourceAppId === request.destinationAppId
  ) return false;

  return grants.some((grant) =>
    grant.ownerId === request.ownerId &&
    grant.granteeAppId === request.requesterAppId &&
    grant.sourceAppId === request.sourceAppId &&
    grant.destinationAppId === request.destinationAppId &&
    grant.permissions.includes(request.permission) &&
    grant.scopes.includes(request.scope) &&
    (grant.expiresAt === undefined || grant.expiresAt > now)
  );
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
  if (
    !envelope.id ||
    !envelope.taskId ||
    !envelope.ownerId ||
    !envelope.sourceAppId ||
    !envelope.destinationAppId ||
    envelope.sourceAppId === envelope.destinationAppId
  ) throw new Error("invalid_app_message_identity");

  if (envelope.scope !== "task" && envelope.scope !== "context") {
    throw new Error("invalid_app_message_scope");
  }

  if (!Number.isSafeInteger(envelope.createdAt) ||
      !Number.isSafeInteger(envelope.expiresAt) ||
      envelope.expiresAt <= now ||
      envelope.expiresAt <= envelope.createdAt) {
    throw new Error("invalid_app_message_expiry");
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(envelope.payload);
  } catch {
    throw new Error("invalid_app_message_payload");
  }
  if (serialized === undefined || serialized.length > maxPayloadCharacters) {
    throw new Error("invalid_app_message_payload");
  }
}
