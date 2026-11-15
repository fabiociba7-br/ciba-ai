import { describe, expect, it } from "vitest";
import {
  canAccessMemory,
  validateCuratedMemory,
  type MemoryGrant
} from "../src/core/memory";

const baseRequest = {
  ownerId: "owner-1",
  requesterAppId: "app-a",
  permission: "read" as const
};

describe("private memory access policy", () => {
  it("allows an app to access its own app-scoped memory", () => {
    expect(canAccessMemory({
      ...baseRequest,
      target: { type: "app", ownerId: "owner-1", appId: "app-a" }
    }, [])).toBe(true);
  });

  it("denies cross-app access without an explicit grant", () => {
    expect(canAccessMemory({
      ...baseRequest,
      target: { type: "app", ownerId: "owner-1", appId: "app-b" }
    }, [])).toBe(false);
  });

  it("allows cross-app access only for the granted scope and permission", () => {
    const grants: MemoryGrant[] = [{
      ownerId: "owner-1",
      granteeAppId: "app-a",
      scope: "app",
      sourceAppId: "app-b",
      permissions: ["read"]
    }];

    expect(canAccessMemory({
      ...baseRequest,
      target: { type: "app", ownerId: "owner-1", appId: "app-b" }
    }, grants)).toBe(true);

    expect(canAccessMemory({
      ...baseRequest,
      permission: "write",
      target: { type: "app", ownerId: "owner-1", appId: "app-b" }
    }, grants)).toBe(false);
  });

  it("denies expired grants and owner-wide access without owner scope", () => {
    const grants: MemoryGrant[] = [{
      ownerId: "owner-1",
      granteeAppId: "app-a",
      scope: "owner",
      permissions: ["read"],
      expiresAt: 100
    }];

    expect(canAccessMemory({
      ...baseRequest,
      target: { type: "owner", ownerId: "owner-1" }
    }, grants, 100)).toBe(false);

    expect(canAccessMemory({
      ...baseRequest,
      target: { type: "owner", ownerId: "owner-1" }
    }, [{
      ...grants[0],
      scope: "app",
      sourceAppId: "app-b",
      expiresAt: undefined
    }], 99)).toBe(false);
  });

  it("requires matching owner identity", () => {
    expect(canAccessMemory({
      ...baseRequest,
      target: { type: "app", ownerId: "someone-else", appId: "app-a" }
    }, [])).toBe(false);
  });
});

describe("curated memory validation", () => {
  it("requires explicit curated consent and trims the value", () => {
    expect(validateCuratedMemory({ consent: "curated", value: "  Prefere respostas diretas.  " }))
      .toBe("Prefere respostas diretas.");
    expect(() => validateCuratedMemory({ consent: "disabled", value: "Preferência" }))
      .toThrow("memory_consent_required");
  });

  it("rejects empty, oversized, and obvious credential-like content", () => {
    expect(() => validateCuratedMemory({ consent: "curated", value: " " }))
      .toThrow("invalid_memory_value");
    expect(() => validateCuratedMemory({ consent: "curated", value: "x".repeat(501) }))
      .toThrow("invalid_memory_value");
    expect(() => validateCuratedMemory({ consent: "curated", value: "api_key=abc123" }))
      .toThrow("memory_secret_rejected");
  });
});
