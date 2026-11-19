import {
  createMcpHttpClient,
  type McpRemoteTool,
} from "../mcp/client";

export interface ComposioMcpDiscoveryOptions {
  apiKey: string;
  sessionId: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

/**
 * Read-only discovery adapter for an owner-scoped Composio session.
 * Tool execution is deliberately not exposed in this stage.
 */
export function createComposioMcpDiscoveryClient(options: ComposioMcpDiscoveryOptions): {
  initialize: ReturnType<typeof createMcpHttpClient>["initialize"];
  listTools: () => Promise<McpRemoteTool[]>;
} {
  if (!options || typeof options.apiKey !== "string" ||
      options.apiKey.trim().length < 16 || options.apiKey.length > 8_192 ||
      /[\r\n]/.test(options.apiKey) ||
      typeof options.sessionId !== "string" ||
      !/^trs_[A-Za-z0-9_-]{8,128}$/.test(options.sessionId)) {
    throw new Error("composio_configuration_invalid");
  }

  const client = createMcpHttpClient({
    endpoint: `https://app.composio.dev/tool_router/v3/${options.sessionId}/mcp`,
    allowedHosts: ["app.composio.dev"],
    getAccessToken: async () => options.apiKey,
    accessTokenHeader: "x-api-key",
    allowedToolNames: [],
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxResponseBytes === undefined ? {} : { maxResponseBytes: options.maxResponseBytes }),
  });

  return Object.freeze({
    initialize: client.initialize,
    listTools: client.listTools,
  });
}
