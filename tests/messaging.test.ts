import { describe, expect, it } from "vitest";
import {
  canRelayAppMessage,
  validateAppMessageEnvelope,
  type AppMessageGrant,
  type AppMessageEnvelope
} from "../src/core/messaging";

const grant: AppMessageGrant = {
  ownerId: "owner-1",
  granteeAppId: "app-a",
  sourceAppId: "app-a",
  destinationAppId: "app-b",
  permissions: ["send"],
  scopes: ["task"]
};

const request = {
  ownerId: "owner-1",
  requesterAppId: "app-a",
  sourceAppId: "app-a",
  destinationAppId: "app-b",
  permission: "send" as const,
  scope: "task" as const
};

const envelope: AppMessageEnvelope = {
  id: "msg-1",
  taskId: "task-1",
  ownerId: "owner-1",
  sourceAppId: "app-a",
  destinationAppId: "app-b",
  scope: "task",
  payload: { action: "summarize", text: "Olá" },
  createdAt: 1_000,
  expiresAt: 5_000
};

describe("app-to-app message authorization", () => {
  it("requires a grant matching owner, apps, permission and scope", () => {
    expect(canRelayAppMessage(request, [grant], 2_000)).toBe(true);
    expect(canRelayAppMessage(request, [], 2_000)).toBe(false);
    expect(canRelayAppMessage({ ...request, permission: "receive" }, [grant], 2_000)).toBe(false);
    expect(canRelayAppMessage({ ...request, scope: "context" }, [grant], 2_000)).toBe(false);
    expect(canRelayAppMessage({ ...request, ownerId: "other-owner" }, [grant], 2_000)).toBe(false);
  });

  it("denies expired grants and same-app routing", () => {
    expect(canRelayAppMessage(request, [{ ...grant, expiresAt: 2_000 }], 2_000)).toBe(false);
    expect(canRelayAppMessage({ ...request, destinationAppId: "app-a" }, [grant], 1_000)).toBe(false);
  });
});

describe("app message envelope validation", () => {
  it("accepts a bounded, unexpired envelope", () => {
    expect(() => validateAppMessageEnvelope(envelope, 2_000)).not.toThrow();
  });

  it("rejects missing identity, self-routing and invalid expiry", () => {
    expect(() => validateAppMessageEnvelope({ ...envelope, ownerId: "" }, 2_000))
      .toThrow("invalid_app_message_identity");
    expect(() => validateAppMessageEnvelope({ ...envelope, destinationAppId: "app-a" }, 2_000))
      .toThrow("invalid_app_message_identity");
    expect(() => validateAppMessageEnvelope({ ...envelope, expiresAt: 2_000 }, 2_000))
      .toThrow("invalid_app_message_expiry");
  });

  it("rejects oversized and non-serializable payloads", () => {
    expect(() => validateAppMessageEnvelope({ ...envelope, payload: "x".repeat(8_001) }, 2_000))
      .toThrow("invalid_app_message_payload");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => validateAppMessageEnvelope({ ...envelope, payload: circular }, 2_000))
      .toThrow("invalid_app_message_payload");
  });
});
