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
  accessTokenHeader?: "authorization" | "x-api-key";
  /** Allowlisted auth headers for MCP providers such as Composio (x-api-key). */
  getAuthHeaders?: () => Promise<Record<string, string>>;
  /** Local policy allowlist. Empty or omitted means discovery-only, with no executable tools. */
  allowedToolNames?: string[];
  /** Exact tool names whose one-shot approval was consumed by the trusted caller. */
  approvedToolNames?: string[];
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

const PROTOCOL_VERSION = "2025-11-25";
const MAX_REQUEST_BYTES = 32_000;
const MAX_TOOLS = 32;
const MAX_TOOL_NAME = 64;
const ALLOWED_AUTH_HEADERS = new Set(["authorization", "x-api-key", "x-user-api-key", "x-org-id", "x-project-id"]);

function validateEndpoint(endpoint: string, allowedHosts: string[]): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("mcp_endpoint_invalid");
  }
  const host = url.hostname.toLowerCase();
  const allowedPort = !url.port || url.port === "443";
  const blockedHost = host.startsWith("[") || host === "localhost" || host.endsWith(".localhost") ||
    host.endsWith(".local") || host.endsWith(".internal") ||
    /^(?:127\.|10\.|192\.168\.|169\.254\.)/.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) || host === "::1";
  if (url.protocol !== "https:" || !allowedPort || url.username || url.password || url.hash || url.search ||
      blockedHost || !allowedHosts.some((item) => item.toLowerCase() === host)) {
    throw new Error("mcp_endpoint_not_allowed");
  }
  return url;
}

function parseSseMessages(raw: string): unknown[] {
  const messages: unknown[] = [];
  for (const event of raw.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") continue;
    try {
      messages.push(JSON.parse(data));
    } catch {
      throw new Error("mcp_response_invalid_sse_json");
    }
  }
  return messages;
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
 * JSON and SSE responses are supported; authentication headers are strictly allowlisted.
 */
export function createMcpHttpClient(options: McpHttpClientOptions) {
  if (!options || !Array.isArray(options.allowedHosts) || options.allowedHosts.length === 0) {
    throw new Error("mcp_host_allowlist_required");
  }
  const endpoint = validateEndpoint(options.endpoint, options.allowedHosts);
  const fetcher = options.fetcher || fetch;
  const timeoutMs = Math.min(30_000, Math.max(1_000, options.timeoutMs ?? 10_000));
  const maxResponseBytes = Math.min(256_000, Math.max(1_024, options.maxResponseBytes ?? 128_000));
  const discovered = new Map<string, McpRemoteTool>();
  const allowedToolNames = new Set(options.allowedToolNames ?? []);
  const approvedToolNames = new Set(options.approvedToolNames ?? []);
  if ([...allowedToolNames, ...approvedToolNames].some((name) =>
      typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name))) {
    throw new Error("mcp_tool_allowlist_invalid");
  }
  if ([...approvedToolNames].some((name) => !allowedToolNames.has(name))) {
    throw new Error("mcp_approved_tool_not_allowlisted");
  }
  let initialized = false;
  let negotiatedProtocolVersion = PROTOCOL_VERSION;

  const requestHeaders = async (includeProtocolVersion = initialized): Promise<Headers> => {
    const headers = new Headers({
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    });
    if (includeProtocolVersion) headers.set("MCP-Protocol-Version", negotiatedProtocolVersion);
    if (options.getAuthHeaders) {
      const authHeaders = await options.getAuthHeaders();
      for (const [name, value] of Object.entries(authHeaders)) {
        const normalized = name.toLowerCase();
        if (!ALLOWED_AUTH_HEADERS.has(normalized)) throw new Error("mcp_auth_header_not_allowed");
        if (typeof value !== "string" || !value || value.length > 8_192 || /[\r\n]/.test(value)) {
          throw new Error("mcp_auth_header_invalid");
        }
        if (headers.has(normalized)) throw new Error("mcp_auth_header_conflict");
        headers.set(normalized, value);
      }
    }
    if (options.getAccessToken) {
      const token = await options.getAccessToken();
      if (token) {
        if (/[\r\n]/.test(token) || token.length > 8_192) throw new Error("mcp_access_token_invalid");
        if (headers.has("authorization")) throw new Error("mcp_auth_header_conflict");
        if (options.accessTokenHeader === "x-api-key") headers.set("x-api-key", token);
        else headers.set("authorization", `Bearer ${token}`);
      }
    }
    return headers;
  };

  const post = async (body: Record<string, unknown>): Promise<unknown> => {
    const serialized = JSON.stringify(body);
    if (new TextEncoder().encode(serialized).byteLength > MAX_REQUEST_BYTES) {
      throw new Error("mcp_request_too_large");
    }
    const response = await fetcher(endpoint.toString(), {
      method: "POST",
      redirect: "manual",
      headers: await requestHeaders(),
      body: serialized,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) throw new Error("mcp_redirect_blocked");
    if (!response.ok) throw new Error(`mcp_http_error_${response.status}`);
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const raw = await readBounded(response, maxResponseBytes);
    let parsed: unknown;
    if (contentType.includes("application/json")) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("mcp_response_invalid_json");
      }
    } else if (contentType.includes("text/event-stream")) {
      const messages = parseSseMessages(raw).filter(isRecord);
      const expectedId = body.id;
      parsed = messages.find((message) => message.id === expectedId) ?? messages[messages.length - 1];
    } else {
      throw new Error("mcp_response_content_type_unsupported");
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
    negotiatedProtocolVersion = result.protocolVersion;
    const notification = await fetcher(endpoint.toString(), {
      method: "POST",
      redirect: "manual",
      headers: await requestHeaders(true),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (notification.status >= 300 && notification.status < 400) throw new Error("mcp_redirect_blocked");
    if (!notification.ok) throw new Error(`mcp_http_error_${notification.status}`);
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
    for (const tool of tools) discovered.set(tool.name, tool);
    return tools;
  };

  const callTool = async (name: string, args: Record<string, unknown>): Promise<McpToolCallResult> => {
    if (!initialized) throw new Error("mcp_client_not_initialized");
    if (!discovered.has(name)) throw new Error("mcp_tool_not_discovered");
    if (!allowedToolNames.has(name)) throw new Error("mcp_tool_not_allowlisted");
    const descriptor = discovered.get(name);
    const readOnly = descriptor?.annotations?.readOnlyHint === true &&
      descriptor.annotations.destructiveHint !== true;
    if (!readOnly && !approvedToolNames.has(name)) {
      throw new Error("mcp_tool_not_read_only_or_approved");
    }
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
