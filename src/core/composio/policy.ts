import type { McpRemoteTool } from "../mcp/client";

export type ComposioToolRisk = "read" | "write" | "external";

export interface ComposioToolPolicy {
  name: string;
  toolkit: string;
  risk: ComposioToolRisk;
  requiresApproval: boolean;
  schemaSha256: string;
  description: string;
}

const READ_ACTIONS = new Set([
  "LIST", "GET", "FETCH", "SEARCH", "FIND", "LOOKUP", "READ",
  "CHECK", "DESCRIBE", "RETRIEVE", "QUERY", "COUNT", "STATUS", "INFO",
]);
const WRITE_ACTIONS = new Set([
  "CREATE", "SEND", "UPDATE", "DELETE", "REMOVE", "POST", "PUT", "PATCH",
  "UPLOAD", "INVITE", "SHARE", "PUBLISH", "SUBMIT", "EXECUTE", "RUN",
  "TRANSFER", "PAY", "CANCEL", "ARCHIVE", "FORWARD", "REPLY",
]);

function normalizeToolkit(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function inferToolkit(toolName: string, enabledToolkits: readonly string[]): string | null {
  const normalizedName = toolName.toUpperCase();
  const candidates = enabledToolkits
    .filter((toolkit) => typeof toolkit === "string" && /^[a-z][a-z0-9_-]{0,63}$/i.test(toolkit))
    .map((toolkit) => ({ original: toolkit, prefix: normalizeToolkit(toolkit) }))
    .filter((item) => item.prefix && normalizedName.startsWith(item.prefix + "_"))
    .sort((a, b) => b.prefix.length - a.prefix.length);
  return candidates[0]?.original ?? null;
}

export function classifyComposioTool(
  tool: McpRemoteTool,
  enabledToolkits: readonly string[],
): ComposioToolPolicy {
  if (!tool || typeof tool.name !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(tool.name) ||
      !tool.inputSchema || typeof tool.inputSchema !== "object" || Array.isArray(tool.inputSchema)) {
    throw new Error("composio_tool_descriptor_invalid");
  }
  const toolkit = inferToolkit(tool.name, enabledToolkits);
  if (!toolkit) throw new Error("composio_toolkit_not_enabled");

  const tokens = tool.name.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const action = tokens.slice(1);
  const hasWriteAction = action.some((token) => WRITE_ACTIONS.has(token));
  const hasReadAction = action.some((token) => READ_ACTIONS.has(token));
  const readOnlyAnnotation = tool.annotations?.readOnlyHint === true;
  const destructiveAnnotation = tool.annotations?.destructiveHint === true;

  // Remote annotations alone are never sufficient to downgrade a tool's risk.
  const risk: ComposioToolRisk = hasWriteAction
    ? "write"
    : readOnlyAnnotation && !destructiveAnnotation && hasReadAction
      ? "read"
      : "external";

  return Object.freeze({
    name: tool.name,
    toolkit,
    risk,
    requiresApproval: risk !== "read",
    schemaSha256: "",
    description: typeof tool.description === "string" ? tool.description.slice(0, 500) : "",
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const result = JSON.stringify(value);
    if (result === undefined) throw new Error("composio_schema_invalid");
    return result;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  ).join(",")}}`;
}

export async function hashComposioToolSchema(schema: Record<string, unknown>): Promise<string> {
  const serialized = canonicalJson(schema);
  if (new TextEncoder().encode(serialized).byteLength > 32_000) {
    throw new Error("composio_schema_too_large");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
