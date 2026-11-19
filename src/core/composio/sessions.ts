export interface ComposioSessionResult {
  sessionId: string;
  mcpUrl: string;
}

export interface ComposioSessionOptions {
  apiKey: string;
  userId: string;
  toolkits: string[];
  fetcher?: typeof fetch;
}

const API_BASE = "https://backend.composio.dev/api/v3.1/tool_router/session";
const MCP_HOST = "app.composio.dev";
const MAX_TOOLKITS = 10;

function normalizeToolkits(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_TOOLKITS) {
    throw new Error("composio_toolkits_invalid");
  }
  const toolkits = value.map((item) => {
    if (typeof item !== "string") throw new Error("composio_toolkits_invalid");
    const slug = item.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(slug)) {
      throw new Error("composio_toolkits_invalid");
    }
    return slug;
  });
  if (new Set(toolkits).size !== toolkits.length) {
    throw new Error("composio_toolkits_duplicate");
  }
  return toolkits.sort();
}

function validateSessionResponse(value: unknown): ComposioSessionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("composio_response_invalid");
  }
  const record = value as Record<string, unknown>;
  const sessionId = record.session_id;
  const mcp = record.mcp;
  if (typeof sessionId !== "string" || !/^trs_[A-Za-z0-9_-]{8,128}$/.test(sessionId) ||
      !mcp || typeof mcp !== "object" || Array.isArray(mcp) ||
      typeof (mcp as Record<string, unknown>).url !== "string") {
    throw new Error("composio_response_invalid");
  }
  let url: URL;
  try {
    url = new URL((mcp as Record<string, unknown>).url as string);
  } catch {
    throw new Error("composio_mcp_endpoint_invalid");
  }
  if (url.protocol !== "https:" || url.hostname !== MCP_HOST || url.port ||
      url.username || url.password || url.search || url.hash ||
      url.pathname !== `/tool_router/v3/${sessionId}/mcp`) {
    throw new Error("composio_mcp_endpoint_invalid");
  }
  return { sessionId, mcpUrl: url.toString() };
}

async function readApiResponse(response: Response): Promise<Record<string, unknown>> {
  const maximumBytes = 64_000;
  const declaredBytes = Number(response.headers.get("content-length") || 0);
  if (declaredBytes > maximumBytes) throw new Error("composio_response_too_large");
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let bytes = 0;
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maximumBytes) {
          await reader.cancel();
          throw new Error("composio_response_too_large");
        }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch {
    throw new Error("composio_response_invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("composio_response_invalid");
  }
  if (!response.ok) {
    throw new Error(`composio_api_error_${response.status}`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Creates a Composio session isolated to a stable, pseudonymous owner ID.
 * App toolkits are always an explicit allowlist; write-capable tags and
 * paid/compute features are disabled at the provider boundary.
 */
export async function createComposioOwnerSession(
  options: ComposioSessionOptions,
): Promise<ComposioSessionResult & { toolkits: string[] }> {
  if (!options || typeof options.apiKey !== "string" ||
      options.apiKey.trim().length < 16 || options.apiKey.length > 8_192 ||
      /[\r\n]/.test(options.apiKey) ||
      typeof options.userId !== "string" || !/^garcia_[a-f0-9]{32}$/.test(options.userId)) {
    throw new Error("composio_configuration_invalid");
  }
  const toolkits = normalizeToolkits(options.toolkits);
  const fetcher = options.fetcher || fetch;
  const response = await fetcher(API_BASE, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      "x-api-key": options.apiKey,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      user_id: options.userId,
      toolkits: { enable: toolkits },
      tags: { disable: ["createHint", "updateHint", "destructiveHint"] },
      instant: false,
      manage_connections: {
        enable: true,
        enable_wait_for_connections: true,
        enable_connection_removal: false,
      },
      workbench: { enable: false },
      proxy_execute: { enable: false },
      search: { enable: true },
      execute: { enable_multi_execute: false },
    }),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("composio_redirect_blocked");
  }
  const body = await readApiResponse(response);
  const session = validateSessionResponse(body);
  return { ...session, toolkits };
}

export async function deleteComposioOwnerSession(
  apiKey: string,
  sessionId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (typeof apiKey !== "string" || apiKey.trim().length < 16 ||
      apiKey.length > 8_192 || /[\r\n]/.test(apiKey) ||
      typeof sessionId !== "string" || !/^trs_[A-Za-z0-9_-]{8,128}$/.test(sessionId)) {
    throw new Error("composio_configuration_invalid");
  }
  const response = await fetcher(`${API_BASE}/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "x-api-key": apiKey,
      accept: "application/json",
    },
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("composio_redirect_blocked");
  }
  if (!response.ok && response.status !== 404) {
    throw new Error(`composio_api_error_${response.status}`);
  }
}
