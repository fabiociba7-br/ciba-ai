export interface McpRemoteTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface McpToolCallResult {
  content: Array<Record<string, unknown>>;
  isError: boolean;
  structuredContent?: unknown;
}

export interface McpHttpClientOptions {
  endpoint: string;
  allowedHosts: string[];
  getAccessToken?: () => Promise<string | null>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

const PROTOCOL_VERSION = "2025-11-25";
const MAX_REQUEST_BYTES = 32_000;
const MAX_TOOLS = 32;
const MAX_TOOL_NAME = 64;

function validateEndpoint(endpoint: string, allowedHosts: string[]): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("mcp_endpoint_invalid");
  }
  const host = url.hostname.toLowerCase();
  const blockedHost = host === "localhost" || host.endsWith(".localhost") ||
    host.endsWith(".local") || host.endsWith(".internal") ||
    /^(?:127\.|10\.|192\.168\.|169\.254\.)/.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) || host === "::1";
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      blockedHost || !allowedHosts.some((item) => item.toLowerCase() === host)) {
    throw new Error("mcp_endpoint_not_allowed");
  }
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

async function readBounded(response: Response, maximum: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maximum) throw new Error("mcp_response_too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximum) {
        await reader.cancel();
        throw new Error("mcp_response_too_large");
      }
      result += decoder.decode(part.value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/**
 * Outbound, stateless MCP JSON-RPC client.
 * The caller must supply an explicit HTTPS host allowlist and trusted credentials.
 * SSE responses are intentionally not accepted in this first transport version.
 */
export function createMcpHttpClient(options: McpHttpClientOptions) {
  if (!options || !Array.isArray(options.allowedHosts) || options.allowedHosts.length === 0) {
    throw new Error("mcp_host_allowlist_required");
  }
  const endpoint = validateEndpoint(options.endpoint, options.allowedHosts);
  const fetcher = options.fetcher || fetch;
  const timeoutMs = Math.min(30_000, Math.max(1_000, options.timeoutMs ?? 10_000));
  const maxResponseBytes = Math.min(256_000, Math.max(1_024, options.maxResponseBytes ?? 128_000));
  const discovered = new Set<string>();
  let initialized = false;

  const post = async (body: Record<string, unknown>): Promise<unknown> => {
    const serialized = JSON.stringify(body);
    if (new TextEncoder().encode(serialized).byteLength > MAX_REQUEST_BYTES) {
      throw new Error("mcp_request_too_large");
    }
    const headers = new Headers({
      "content-type": "application/json",
      accept: "application/json",
    });
    if (options.getAccessToken) {
      const token = await options.getAccessToken();
      if (token) {
        if (/[\r\n]/.test(token) || token.length > 8_192) throw new Error("mcp_access_token_invalid");
        headers.set("authorization", `Bearer ${token}`);
      }
    }
    const response = await fetcher(endpoint.toString(), {
      method: "POST",
      headers,
      body: serialized,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`mcp_http_error_${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new Error("mcp_response_content_type_unsupported");
    }
    const raw = await readBounded(response, maxResponseBytes);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("mcp_response_invalid_json");
    }
    if (!isRecord(parsed) || parsed.jsonrpc !== "2.0") {
      throw new Error("mcp_response_invalid_jsonrpc");
    }
    if (parsed.error !== undefined) {
      const error = isRecord(parsed.error) ? parsed.error : {};
      throw new Error(`mcp_remote_error_${String(error.code ?? "unknown")}`);
    }
    return parsed.result;
  };

  const initialize = async (): Promise<{ protocolVersion: string; serverInfo: Record<string, unknown> }> => {
    const result = await post({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "garcia-mcp-client", version: "1.0.0" },
      },
    });
    if (!isRecord(result) || typeof result.protocolVersion !== "string" || !isRecord(result.serverInfo)) {
      throw new Error("mcp_initialize_invalid_result");
    }
    await fetcher(endpoint.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(options.getAccessToken && await options.getAccessToken()
          ? { authorization: `Bearer ${await options.getAccessToken()}` }
          : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    initialized = true;
    return { protocolVersion: result.protocolVersion, serverInfo: result.serverInfo };
  };

  const listTools = async (): Promise<McpRemoteTool[]> => {
    if (!initialized) throw new Error("mcp_client_not_initialized");
    const result = await post({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/list" });
    if (!isRecord(result) || !Array.isArray(result.tools)) throw new Error("mcp_tools_list_invalid_result");
    const tools = result.tools.slice(0, MAX_TOOLS).filter((tool): tool is Record<string, unknown> =>
      isRecord(tool) && typeof tool.name === "string" &&
      tool.name.length > 0 && tool.name.length <= MAX_TOOL_NAME &&
      isRecord(tool.inputSchema)
    ).map((tool) => ({
      name: tool.name as string,
      description: typeof tool.description === "string" ? tool.description.slice(0, 2_000) : undefined,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      annotations: isRecord(tool.annotations) ? tool.annotations : undefined,
    }));
    discovered.clear();
    for (const tool of tools) discovered.add(tool.name);
    return tools;
  };

  const callTool = async (name: string, args: Record<string, unknown>): Promise<McpToolCallResult> => {
    if (!initialized) throw new Error("mcp_client_not_initialized");
    if (!discovered.has(name)) throw new Error("mcp_tool_not_discovered");
    if (!name || name.length > MAX_TOOL_NAME || !isRecord(args)) throw new Error("mcp_tool_arguments_invalid");
    const result = await post({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name, arguments: args },
    });
    if (!isRecord(result) || !Array.isArray(result.content) || typeof result.isError !== "boolean") {
      throw new Error("mcp_tool_call_invalid_result");
    }
    return {
      content: result.content.filter(isRecord).slice(0, 32),
      isError: result.isError,
      ...(result.structuredContent === undefined ? {} : { structuredContent: result.structuredContent }),
    };
  };

  return Object.freeze({ initialize, listTools, callTool });
}
