export type AdminRoute =
  | "cibagenio"
  | "devices"
  | "invitations"
  | "apps"
  | "observability"
  | "ai-overview"
  | "settings";

export const resolveAdminRoute = (path: string, method: string): AdminRoute | null => {
  if (path === "/v1/admin/cibagenio" && (method === "GET" || method === "POST")) return "cibagenio";
  if (path === "/v1/admin/devices" && method === "GET") return "devices";
  if (path === "/v1/admin/invitations" && method === "GET") return "invitations";
  if (path === "/v1/admin/apps" && (method === "GET" || method === "POST")) return "apps";
  if (path === "/v1/admin/observability" && method === "GET") return "observability";
  if (path === "/v1/admin/ai/overview" && method === "GET") return "ai-overview";
  if (path === "/v1/admin/settings" && (method === "GET" || method === "POST")) return "settings";
  return null;
};
