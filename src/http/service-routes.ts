export type ServiceRoute =
  | "config" | "status" | "models" | "ai-capabilities"
  | "mcp" | "ai-chat" | "usage";

export function resolveServiceRoute(path: string, method: string): ServiceRoute | null {
  if (path === "/v1/config" && method === "GET") return "config";
  if (path === "/v1/status" && method === "GET") return "status";
  if (path === "/v1/models" && method === "GET") return "models";
  if (path === "/v1/ai/capabilities" && method === "GET") return "ai-capabilities";
  if (path === "/v1/mcp") return "mcp";
  if (path === "/v1/ai/chat" && method === "POST") return "ai-chat";
  if (path === "/v1/usage" && method === "GET") return "usage";
  return null;
}
