import { describe, expect, it } from "vitest";
import {
  canDeviceActForOwner,
  canUseOwnerPairingInvitation,
  type OwnerBoundDevice,
  type OwnerIdentity,
  type OwnerPairingInvitation
} from "../src/core/owner";

const owner: OwnerIdentity = { ownerId: "owner-private-1", status: "active" };
const invitation: OwnerPairingInvitation = {
  ownerId: "owner-private-1",
  appId: "ciba-notes",
  expiresAt: 10_000
};
const device: OwnerBoundDevice = {
  deviceId: "device-1",
  appId: "ciba-notes",
  ownerId: "owner-private-1"
};

describe("private owner pairing policy", () => {
  it("accepts only an active owner's unconsumed invitation for its app", () => {
    expect(canUseOwnerPairingInvitation(invitation, owner, "ciba-notes", 5_000)).toBe(true);
    expect(canUseOwnerPairingInvitation(invitation, owner, "another-app", 5_000)).toBe(false);
    expect(canUseOwnerPairingInvitation(invitation, { ...owner, status: "revoked" }, "ciba-notes", 5_000)).toBe(false);
    expect(canUseOwnerPairingInvitation(invitation, null, "ciba-notes", 5_000)).toBe(false);
  });

  it("rejects expired, consumed or mismatched invitations", () => {
    expect(canUseOwnerPairingInvitation(invitation, owner, "ciba-notes", 10_000)).toBe(false);
    expect(canUseOwnerPairingInvitation({ ...invitation, consumedAt: 9_000, consumedDeviceId: "device-1" }, owner, "ciba-notes", 5_000)).toBe(false);
    expect(canUseOwnerPairingInvitation({ ...invitation, ownerId: "other-owner" }, owner, "ciba-notes", 5_000)).toBe(false);
  });
});

describe("owner access through authenticated devices", () => {
  it("allows only a non-revoked device already bound to the active owner", () => {
    expect(canDeviceActForOwner(device, owner, "owner-private-1")).toBe(true);
    expect(canDeviceActForOwner({ ...device, ownerId: null }, owner, "owner-private-1")).toBe(false);
    expect(canDeviceActForOwner({ ...device, ownerId: "other-owner" }, owner, "owner-private-1")).toBe(false);
    expect(canDeviceActForOwner({ ...device, revokedAt: 1_000 }, owner, "owner-private-1")).toBe(false);
    expect(canDeviceActForOwner(device, { ...owner, status: "revoked" }, "owner-private-1")).toBe(false);
    expect(canDeviceActForOwner(device, owner, "other-owner")).toBe(false);
    expect(canDeviceActForOwner(null, owner, "owner-private-1")).toBe(false);
  });
});
