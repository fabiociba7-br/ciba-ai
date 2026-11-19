export type AccountRoute =
  | "auth-register"
  | "admin-create-owner"
  | "admin-create-owner-invitation"
  | "owner-pair"
  | "admin-create-invitation"
  | "admin-revoke-device";

export function resolveAccountRoute(path: string, method: string): AccountRoute | null {
  if (path === "/v1/auth/register" && method === "POST") return "auth-register";
  if (path === "/v1/admin/owners" && method === "POST") return "admin-create-owner";
  if (path === "/v1/admin/owner-invitations" && method === "POST") return "admin-create-owner-invitation";
  if (path === "/v1/owner/pair" && method === "POST") return "owner-pair";
  if (path === "/v1/admin/invitations" && method === "POST") return "admin-create-invitation";
  if (path === "/v1/admin/devices/revoke" && method === "POST") return "admin-revoke-device";
  return null;
}
