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
  it("denies accessor-backed requests without invoking getters", () => {
    let invoked = false;
    const hostile = {
      requesterAppId: "app-a",
      permission: "read",
      target: { type: "app", ownerId: "owner-1", appId: "app-b" }
    };
    Object.defineProperty(hostile, "ownerId", {
      enumerable: true,
      get() { invoked = true; return "owner-1"; }
    });
    expect(canAccessMemory(hostile as never, [])).toBe(false);
    expect(invoked).toBe(false);
  });

  it("denies sparse grant collections and malformed permission arrays", () => {
    const sparse = new Array(1) as MemoryGrant[];
    expect(canAccessMemory({
      ...baseRequest,
      target: { type: "owner", ownerId: "owner-1" }
    }, sparse)).toBe(false);

    const grant: MemoryGrant = {
      ownerId: "owner-1",
      granteeAppId: "app-a",
      scope: "owner",
      permissions: ["read"]
    };
    const malformed = { ...grant, permissions: new Array(1) } as MemoryGrant;
    expect(canAccessMemory({
      ...baseRequest,
      target: { type: "owner", ownerId: "owner-1" }
    }, [malformed])).toBe(false);
  });

  it("ignores accessor-backed grants while allowing a separate valid grant", () => {
    let invoked = false;
    const hostile = {
      granteeAppId: "app-a",
      scope: "owner",
      permissions: ["read"]
    };
    Object.defineProperty(hostile, "ownerId", {
      enumerable: true,
      get() { invoked = true; return "owner-1"; }
    });
    const valid: MemoryGrant = {
      ownerId: "owner-1",
      granteeAppId: "app-a",
      scope: "owner",
      permissions: ["read"]
    };
    const request = {
      ...baseRequest,
      target: { type: "owner" as const, ownerId: "owner-1" }
    };
    expect(canAccessMemory(request, [hostile as unknown as MemoryGrant])).toBe(false);
    expect(canAccessMemory(request, [hostile as unknown as MemoryGrant, valid])).toBe(true);
    expect(invoked).toBe(false);
  });

  it("rejects unexpected request and grant properties", () => {
    const request = {
      ...baseRequest,
      target: { type: "owner" as const, ownerId: "owner-1" },
      elevated: true
    };
    const grant: MemoryGrant = {
      ownerId: "owner-1",
      granteeAppId: "app-a",
      scope: "owner",
      permissions: ["read"]
    };
    expect(canAccessMemory(request as never, [grant])).toBe(false);
    expect(canAccessMemory({
      ...baseRequest,
      target: { type: "owner", ownerId: "owner-1" }
    }, [{ ...grant, elevated: true } as MemoryGrant])).toBe(false);
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
