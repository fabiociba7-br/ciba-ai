import { describe, expect, it } from "vitest";
import { resolveAccountRoute } from "../src/http/account-routes";

describe("account and administrative action routes", () => {
  it.each([
    ["/v1/auth/register", "POST", "auth-register"],
    ["/v1/admin/owners", "POST", "admin-create-owner"],
    ["/v1/admin/owner-invitations", "POST", "admin-create-owner-invitation"],
    ["/v1/owner/pair", "POST", "owner-pair"],
    ["/v1/admin/invitations", "POST", "admin-create-invitation"],
    ["/v1/admin/devices/revoke", "POST", "admin-revoke-device"],
  ] as const)("resolves %s %s", (path, method, route) => {
    expect(resolveAccountRoute(path, method)).toBe(route);
  });

  it("rejects unsupported methods and unknown paths", () => {
    expect(resolveAccountRoute("/v1/auth/register", "GET")).toBeNull();
    expect(resolveAccountRoute("/v1/admin/owners", "GET")).toBeNull();
    expect(resolveAccountRoute("/v1/owner/pair", "GET")).toBeNull();
    expect(resolveAccountRoute("/v1/admin/invitations", "GET")).toBeNull();
    expect(resolveAccountRoute("/v1/admin/devices/revoke", "GET")).toBeNull();
    expect(resolveAccountRoute("/v1/admin/unknown", "POST")).toBeNull();
  });
});
