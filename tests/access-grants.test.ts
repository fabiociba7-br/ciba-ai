import { describe, expect, it } from "vitest";
import {
  canUseAppAccessGrant,
  type AppAccessGrant,
  type AppAccessRequest
} from "../src/core/access-grants";

const messagingGrant: AppAccessGrant = {
  ownerId: "owner-1",
  granteeAppId: "app-a",
  sourceAppId: "app-a",
  destinationAppId: "app-b",
  permission: "send",
  scope: "task"
};

const sendRequest: AppAccessRequest = {
  ownerId: "owner-1",
  requesterAppId: "app-a",
  sourceAppId: "app-a",
  destinationAppId: "app-b",
  permission: "send",
  scope: "task"
};

describe("explicit app access grants", () => {
  it("matches owner, grantee, app pair, permission and scope exactly", () => {
    expect(canUseAppAccessGrant(sendRequest, [messagingGrant], 2_000)).toBe(true);
    expect(canUseAppAccessGrant(sendRequest, [], 2_000)).toBe(false);
    expect(canUseAppAccessGrant({ ...sendRequest, ownerId: "other-owner" }, [messagingGrant], 2_000)).toBe(false);
    expect(canUseAppAccessGrant({ ...sendRequest, requesterAppId: "app-b" }, [messagingGrant], 2_000)).toBe(false);
    expect(canUseAppAccessGrant({ ...sendRequest, destinationAppId: "app-c" }, [messagingGrant], 2_000)).toBe(false);
    expect(canUseAppAccessGrant({ ...sendRequest, permission: "receive" }, [messagingGrant], 2_000)).toBe(false);
    expect(canUseAppAccessGrant({ ...sendRequest, scope: "context" }, [messagingGrant], 2_000)).toBe(false);
  });

  it("denies expired, revoked and malformed grant dates", () => {
    expect(canUseAppAccessGrant(sendRequest, [{ ...messagingGrant, expiresAt: 2_000 }], 2_000)).toBe(false);
    expect(canUseAppAccessGrant(sendRequest, [{ ...messagingGrant, revokedAt: 1_500 }], 2_000)).toBe(false);
    expect(canUseAppAccessGrant(sendRequest, [{ ...messagingGrant, expiresAt: Number.NaN }], 2_000)).toBe(false);
    expect(canUseAppAccessGrant(sendRequest, [{ ...messagingGrant, revokedAt: Number.NaN }], 2_000)).toBe(false);
  });

  it("supports an independently granted receive permission", () => {
    const receiveGrant = { ...messagingGrant, granteeAppId: "app-b", permission: "receive" as const };
    const receiveRequest = { ...sendRequest, requesterAppId: "app-b", permission: "receive" as const };
    expect(canUseAppAccessGrant(receiveRequest, [receiveGrant], 2_000)).toBe(true);
  });

  it("requires a source app for app-memory grants and no app pair for owner memory", () => {
    const appMemoryGrant: AppAccessGrant = {
      ownerId: "owner-1",
      granteeAppId: "app-b",
      sourceAppId: "app-a",
      destinationAppId: null,
      permission: "memory_read",
      scope: "app_memory"
    };
    const appMemoryRequest: AppAccessRequest = {
      ownerId: "owner-1",
      requesterAppId: "app-b",
      sourceAppId: "app-a",
      permission: "memory_read",
      scope: "app_memory"
    };
    expect(canUseAppAccessGrant(appMemoryRequest, [appMemoryGrant], 2_000)).toBe(true);
    expect(canUseAppAccessGrant({ ...appMemoryRequest, sourceAppId: null }, [appMemoryGrant], 2_000)).toBe(false);

    const ownerMemoryGrant: AppAccessGrant = {
      ownerId: "owner-1",
      granteeAppId: "app-b",
      sourceAppId: null,
      destinationAppId: null,
      permission: "memory_write",
      scope: "owner_memory"
    };
    const ownerMemoryRequest: AppAccessRequest = {
      ownerId: "owner-1",
      requesterAppId: "app-b",
      permission: "memory_write",
      scope: "owner_memory"
    };
    expect(canUseAppAccessGrant(ownerMemoryRequest, [ownerMemoryGrant], 2_000)).toBe(true);
    expect(canUseAppAccessGrant({ ...ownerMemoryRequest, sourceAppId: "app-a" }, [ownerMemoryGrant], 2_000)).toBe(false);
  });

  it("rejects self-routing and invalid request identity", () => {
    expect(canUseAppAccessGrant({ ...sendRequest, destinationAppId: "app-a" }, [messagingGrant], 2_000)).toBe(false);
    expect(canUseAppAccessGrant({ ...sendRequest, requesterAppId: "" }, [messagingGrant], 2_000)).toBe(false);
    expect(canUseAppAccessGrant({ ...sendRequest, ownerId: "" }, [messagingGrant], 2_000)).toBe(false);
  });
});
