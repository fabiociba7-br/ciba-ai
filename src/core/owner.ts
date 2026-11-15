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
    invitation.ownerId.length > 0 &&
    invitation.appId.length > 0 &&
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
    device.ownerId === expectedOwnerId &&
    owner.status === "active" &&
    (device.revokedAt === undefined || device.revokedAt === null)
  );
}
