import {
  createMcpHttpClient,
  type McpRemoteTool,
} from "../mcp/client";

export interface ComposioMcpDiscoveryOptions {
  apiKey: string;
  sessionId: string;
  mcpUrl?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  allowedToolNames?: string[];
  approvedToolNames?: string[];
}

/**
 * Guarded MCP adapter for an owner-scoped Composio session.
 * Execution is limited to an explicit tool allowlist and one-shot approval names.
 */
export function createComposioMcpDiscoveryClient(options: ComposioMcpDiscoveryOptions): {
  initialize: ReturnType<typeof createMcpHttpClient>["initialize"];
  listTools: () => Promise<McpRemoteTool[]>;
  callTool: ReturnType<typeof createMcpHttpClient>["callTool"];
} {
  if (!options || typeof options.apiKey !== "string" ||
      options.apiKey.trim().length < 16 || options.apiKey.length > 8_192 ||
      /[\r\n]/.test(options.apiKey) ||
      typeof options.sessionId !== "string" ||
      !/^trs_[A-Za-z0-9_-]{8,128}$/.test(options.sessionId)) {
    throw new Error("composio_configuration_invalid");
  }

  const expectedEndpoint = `https://app.composio.dev/tool_router/v3/${options.sessionId}/mcp`;
  const endpoint = options.mcpUrl ?? expectedEndpoint;
  if (endpoint !== expectedEndpoint) throw new Error("composio_mcp_endpoint_invalid");

  const client = createMcpHttpClient({
    endpoint,
    allowedHosts: ["app.composio.dev"],
    getAccessToken: async () => options.apiKey,
    accessTokenHeader: "x-api-key",
    allowedToolNames: options.allowedToolNames ?? [],
    approvedToolNames: options.approvedToolNames ?? [],
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxResponseBytes === undefined ? {} : { maxResponseBytes: options.maxResponseBytes }),
  });

  return Object.freeze({
    initialize: client.initialize,
    listTools: client.listTools,
    callTool: client.callTool,
  });
}
