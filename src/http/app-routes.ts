export type AppRoute =
  | "task-dispatch" | "task-status" | "task-results" | "task-results-submit"
  | "task-synthesize" | "context-share"
  | "messages-send" | "messages-inbox" | "messages-ack";

export function resolveAppRoute(path: string, method: string): AppRoute | null {
  if (path === "/v1/apps/tasks/dispatch" && method === "POST") return "task-dispatch";
  if (path === "/v1/apps/tasks/status" && method === "GET") return "task-status";
  if (path === "/v1/apps/tasks/results" && method === "GET") return "task-results";
  if (path === "/v1/apps/tasks/results" && method === "POST") return "task-results-submit";
  if (path === "/v1/apps/tasks/synthesize" && method === "POST") return "task-synthesize";
  if (path === "/v1/apps/context/share" && method === "POST") return "context-share";
  if (path === "/v1/apps/messages" && method === "POST") return "messages-send";
  if (path === "/v1/apps/messages/inbox" && method === "GET") return "messages-inbox";
  if (path === "/v1/apps/messages/ack" && method === "POST") return "messages-ack";
  return null;
}
