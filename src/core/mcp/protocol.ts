import type { CibaToolInvocationContext, ExecutableCibaToolRegistry } from "../tools/registry";

const MAX_REQUEST_BYTES = 32_000;
const SUPPORTED_PROTOCOLS = new Set([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
]);
const SERVER_PROTOCOL = "2025-11-25";

type RpcId = string | number | null;
type RpcRecord = Record<string, unknown>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
});

const isRecord = (value: unknown): value is RpcRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

const rpcError = (id: RpcId, code: number, message: string) =>
  json({ jsonrpc: "2.0", id, error: { code, message } });

async function readBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let result = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error("request_too_large");
      }
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function safeToolText(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 64_000);
  try {
    const serialized = JSON.stringify(value);
    return (serialized ?? "null").slice(0, 64_000);
  } catch {
    return "Resultado indisponível para serialização.";
  }
}

/**
 * Stateless MCP Streamable HTTP JSON-RPC endpoint.
 * Only read-only, no-approval tools are discoverable and executable here.
 * Authentication and owner/resource authorization are enforced by the caller.
 */
export async function handleMcpRequest(
  request: Request,
  registry: ExecutableCibaToolRegistry,
  context: CibaToolInvocationContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed", allowed: ["POST"] }, 405);
  }
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return json({ error: "content_type_must_be_application_json" }, 415);
  }

  let raw: string;
  try {
    raw = await readBody(request);
  } catch (error) {
    if (error instanceof Error && error.message === "request_too_large") {
      return json({ error: "request_too_large", maximum_bytes: MAX_REQUEST_BYTES }, 413);
    }
    return rpcError(null, -32700, "Parse error");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return rpcError(null, -32700, "Parse error");
  }
  if (!isRecord(parsed) || parsed.jsonrpc !== "2.0" ||
      typeof parsed.method !== "string" || parsed.method.length < 1 || parsed.method.length > 128) {
    return rpcError(null, -32600, "Invalid Request");
  }

  const hasId = Object.prototype.hasOwnProperty.call(parsed, "id");
  const idValue = parsed.id;
  const validId = idValue === null || typeof idValue === "string" ||
    (typeof idValue === "number" && Number.isFinite(idValue));
  if (hasId && !validId) return rpcError(null, -32600, "Invalid Request");

  // MCP notifications do not receive JSON-RPC response bodies.
  if (!hasId) return new Response(null, { status: 202 });

  const id = idValue as RpcId;
  const params = parsed.params === undefined ? {} : parsed.params;
  if (!isRecord(params)) return rpcError(id, -32602, "Invalid params");

  if (parsed.method === "ping") {
    return json({ jsonrpc: "2.0", id, result: {} });
  }

  if (parsed.method === "initialize") {
    const requested = params.protocolVersion;
    const protocolVersion = typeof requested === "string" && SUPPORTED_PROTOCOLS.has(requested)
      ? requested
      : SERVER_PROTOCOL;
    return json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "garcia-mcp", version: "1.0.0" },
        instructions: "Garcia MCP expõe somente ferramentas de leitura autorizadas. A autenticação e as permissões são verificadas pelo servidor.",
      },
    });
  }

  if (parsed.method === "tools/list") {
    const tools = registry.describe()
      .filter((tool) => tool.risk === "read" && !tool.requiresApproval)
      .slice(0, 32)
      .map((tool) => ({
        name: tool.id,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      }));
    return json({ jsonrpc: "2.0", id, result: { tools } });
  }

  if (parsed.method === "tools/call") {
    const name = params.name;
    const args = params.arguments === undefined ? {} : params.arguments;
    if (typeof name !== "string" || name.length < 1 || name.length > 64 || !isRecord(args)) {
      return rpcError(id, -32602, "Invalid params");
    }
    const descriptor = registry.describe().find((tool) =>
      tool.id === name && tool.risk === "read" && !tool.requiresApproval
    );
    if (!descriptor) {
      return json({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: "Ferramenta inexistente ou não autorizada." }], isError: true },
      });
    }
    try {
      const plan = registry.prepare(name, args, context);
      if (plan.risk !== "read" || plan.requiresApproval) {
        return json({
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: "A política MCP permite somente ferramentas de leitura." }], isError: true },
        });
      }
      const output = await registry.execute(name, plan.input, context);
      return json({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: safeToolText(output) }], isError: false },
      });
    } catch {
      return json({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: "A ferramenta foi bloqueada pela política de autorização da Garcia." }], isError: true },
      });
    }
  }

  return rpcError(id, -32601, "Method not found");
}
