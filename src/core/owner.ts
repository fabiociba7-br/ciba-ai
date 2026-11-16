export type OwnerStatus = "active" | "revoked";

export interface OwnerIdentity {
  ownerId: string;
  status: OwnerStatus;
}

export interface OwnerPairingInvitation {
  ownerId: string;
  appId: string;
  expiresAt: number;
  consumedAt?: number | null;
  consumedDeviceId?: string | null;
}

export interface OwnerBoundDevice {
  deviceId: string;
  appId: string;
  ownerId: string | null;
  revokedAt?: number | null;
}

function validOwnerId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200;
}

/** Validates and freezes pairing state loaded from persistence. */
export function validateOwnerPairingInvitation(
  invitation: OwnerPairingInvitation
): OwnerPairingInvitation {
  try {
    if (!invitation || typeof invitation !== "object") throw new Error("invalid_pairing_invitation");
    const descriptors = Object.getOwnPropertyDescriptors(invitation);
    const read = (key: string): unknown => {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error("invalid_pairing_invitation");
      }
      return descriptor.value;
    };
    const ownerId = read("ownerId");
    const appId = read("appId");
    const expiresAt = read("expiresAt");
    const consumedAt = read("consumedAt");
    const consumedDeviceId = read("consumedDeviceId");
    if (!validOwnerId(ownerId) || !validOwnerId(appId) ||
        !Number.isSafeInteger(expiresAt) ||
        (consumedAt !== undefined && consumedAt !== null &&
          !Number.isSafeInteger(consumedAt)) ||
        (consumedDeviceId !== undefined && consumedDeviceId !== null &&
          !validOwnerId(consumedDeviceId)) ||
        ((consumedAt === undefined || consumedAt === null) !==
          (consumedDeviceId === undefined || consumedDeviceId === null))) {
      throw new Error("invalid_pairing_invitation");
    }
    return Object.freeze({
      ownerId,
      appId,
      expiresAt: expiresAt as number,
      ...(consumedAt !== undefined ? { consumedAt: consumedAt as number | null } : {}),
      ...(consumedDeviceId !== undefined
        ? { consumedDeviceId: consumedDeviceId as string | null }
        : {})
    });
  } catch {
    throw new Error("invalid_pairing_invitation");
  }
}

/**
 * Pure policy check for a pairing invitation after its hash has been looked
 * up by the gateway. It does not authenticate the caller or consume the code.
 */
export function canUseOwnerPairingInvitation(
  invitation: OwnerPairingInvitation,
  owner: OwnerIdentity | null,
  requestedAppId: string,
  now = Date.now()
): boolean {
  return Boolean(
    owner &&
    owner.status === "active" &&
    invitation.ownerId === owner.ownerId &&
    invitation.appId === requestedAppId &&
    validOwnerId(invitation.ownerId) &&
    validOwnerId(invitation.appId) &&
    Number.isSafeInteger(now) &&
    Number.isSafeInteger(invitation.expiresAt) &&
    invitation.expiresAt > now &&
    (invitation.consumedAt === undefined || invitation.consumedAt === null) &&
    (invitation.consumedDeviceId === undefined || invitation.consumedDeviceId === null)
  );
}

/**
 * Owner identity is derived from the authenticated device record, never from
 * a caller-supplied ownerId. Unlinked or revoked devices fail closed.
 */
export function canDeviceActForOwner(
  device: OwnerBoundDevice | null,
  owner: OwnerIdentity | null,
  expectedOwnerId: string
): boolean {
  return Boolean(
    device &&
    owner &&
    device.ownerId &&
    device.ownerId === owner.ownerId &&
    validOwnerId(expectedOwnerId) &&
    device.ownerId === expectedOwnerId &&
    owner.status === "active" &&
    (device.revokedAt === undefined || device.revokedAt === null)
  );
}

/** Pairing requires an authenticated, active, unlinked device for the invited app. */
export function canPairDevice(
  device: OwnerBoundDevice | null,
  invitation: OwnerPairingInvitation,
  owner: OwnerIdentity | null,
  now = Date.now()
): boolean {
  return Boolean(
    device &&
    device.ownerId === null &&
    (device.revokedAt === undefined || device.revokedAt === null) &&
    device.appId === invitation.appId &&
    canUseOwnerPairingInvitation(invitation, owner, device.appId, now)
  );
}
