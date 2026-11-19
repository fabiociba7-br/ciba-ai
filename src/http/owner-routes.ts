export type OwnerRoute =
  | "composio-policy" | "composio-invoke" | "composio-tools" | "composio-session"
  | "facebook-status" | "facebook-link" | "facebook-data"
  | "available-apps" | "apps-connect" | "app-identity"
  | "tool-approvals" | "tool-approval-decision" | "tool-approval-cancel"
  | "observability" | "dashboard" | "settings" | "access-grants"
  | "memory-history" | "profile" | "memory-insights" | "memory-reviews"
  | "memory-candidates" | "memory-retrieve" | "memory"
  | "devices-revoke" | "access-grants-revoke"
  | "agent-jobs-create" | "agent-job-cancel" | "agent-job-status";

export type OwnerRouteMatch = { route: OwnerRoute; id?: string };

const ID = "[A-Za-z0-9_-]{16,128}";

export function resolveOwnerRoute(path: string, method: string): OwnerRouteMatch | null {
  if (path === "/v1/owner/composio/policy" && (method === "GET" || method === "POST")) return { route: "composio-policy" };
  if (path === "/v1/owner/composio/invoke" && method === "POST") return { route: "composio-invoke" };
  if (path === "/v1/owner/composio/tools" && method === "GET") return { route: "composio-tools" };
  if (path === "/v1/owner/composio/session" && ["GET", "POST", "DELETE"].includes(method)) return { route: "composio-session" };
  if (path === "/v1/owner/facebook" && method === "GET") return { route: "facebook-status" };
  if (path === "/v1/owner/facebook/link" && method === "POST") return { route: "facebook-link" };
  if (path.startsWith("/v1/owner/facebook/") && method === "GET") return { route: "facebook-data" };
  if (path === "/v1/owner/available-apps" && method === "GET") return { route: "available-apps" };
  if (path === "/v1/owner/apps/connect" && method === "POST") return { route: "apps-connect" };
  if (path === "/v1/apps/identity" && method === "GET") return { route: "app-identity" };
  if (path === "/v1/owner/tool-approvals" && method === "GET") return { route: "tool-approvals" };
  const decision = path.match(new RegExp("^/v1/owner/tool-approvals/(" + ID + ")/decision$"));
  if (decision && method === "POST") return { route: "tool-approval-decision", id: decision[1] };
  const cancelApproval = path.match(new RegExp("^/v1/owner/tool-approvals/(" + ID + ")/cancel$"));
  if (cancelApproval && method === "POST") return { route: "tool-approval-cancel", id: cancelApproval[1] };
  if (path === "/v1/owner/observability" && method === "GET") return { route: "observability" };
  if (path === "/v1/owner/dashboard" && method === "GET") return { route: "dashboard" };
  if (path === "/v1/owner/settings" && ["GET", "POST"].includes(method)) return { route: "settings" };
  if (path === "/v1/owner/access-grants" && ["GET", "POST"].includes(method)) return { route: "access-grants" };
  if (path === "/v1/owner/memory/history" && method === "GET") return { route: "memory-history" };
  if (path === "/v1/owner/profile" && method === "GET") return { route: "profile" };
  if (path === "/v1/owner/memory/insights" && method === "GET") return { route: "memory-insights" };
  if (path === "/v1/owner/memory/reviews" && ["GET", "POST", "PATCH"].includes(method)) return { route: "memory-reviews" };
  if (path === "/v1/owner/memory/candidates" && method === "POST") return { route: "memory-candidates" };
  if (path === "/v1/owner/memory/retrieve" && method === "POST") return { route: "memory-retrieve" };
  if (path === "/v1/owner/memory" && ["GET", "POST", "PATCH", "DELETE"].includes(method)) return { route: "memory" };
  if (path === "/v1/owner/devices/revoke" && method === "POST") return { route: "devices-revoke" };
  if (path === "/v1/owner/access-grants/revoke" && method === "POST") return { route: "access-grants-revoke" };
  if (path === "/v1/owner/agent-jobs" && method === "POST") return { route: "agent-jobs-create" };
  const cancelJob = path.match(new RegExp("^/v1/owner/agent-jobs/(" + ID + ")/cancel$"));
  if (cancelJob && method === "POST") return { route: "agent-job-cancel", id: cancelJob[1] };
  const jobStatus = path.match(new RegExp("^/v1/owner/agent-jobs/(" + ID + ")$"));
  if (jobStatus && method === "GET") return { route: "agent-job-status", id: jobStatus[1] };
  return null;
}
