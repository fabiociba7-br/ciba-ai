import type { CibaToolDefinition } from "../tools/contracts";
import type { McpRemoteTool, McpToolCallResult } from "../mcp/client";
import { classifyComposioTool, hashComposioToolSchema } from "./policy";

export interface SavedComposioChatPolicy {
  tool_name: string;
  toolkit: string;
  risk: "read" | "write" | "external";
  requires_approval: number;
  schema_sha256: string;
  enabled: number;
}

export interface ComposioChatToolOptions {
  remoteTools: readonly McpRemoteTool[];
  enabledToolkits: readonly string[];
  savedPolicies: readonly SavedComposioChatPolicy[];
  callTool(name: string, input: Record<string, unknown>): Promise<McpToolCallResult>;
  maxTools?: number;
}

/**
 * Exposes only owner-consented, schema-stable, locally classified read tools to
 * the conversational runtime. Write/external tools remain on the explicit
 * approval endpoint and can never enter this automatic read-only adapter.
 */
export async function createComposioChatToolDefinitions(
  options: ComposioChatToolOptions,
): Promise<CibaToolDefinition[]> {
  if (!options || !Array.isArray(options.remoteTools) ||
      !Array.isArray(options.enabledToolkits) || !Array.isArray(options.savedPolicies) ||
      typeof options.callTool !== "function") {
    throw new Error("invalid_composio_chat_tool_options");
  }
  const maxTools = options.maxTools ?? 16;
  if (!Number.isInteger(maxTools) || maxTools < 1 || maxTools > 16) {
    throw new Error("invalid_composio_chat_tool_limit");
  }

  const saved = new Map<string, SavedComposioChatPolicy>();
  for (const policy of options.savedPolicies) {
    if (!policy || typeof policy.tool_name !== "string" ||
        typeof policy.toolkit !== "string" ||
        (policy.risk !== "read" && policy.risk !== "write" && policy.risk !== "external") ||
        (policy.requires_approval !== 0 && policy.requires_approval !== 1) ||
        typeof policy.schema_sha256 !== "string" ||
        (policy.enabled !== 0 && policy.enabled !== 1)) {
      throw new Error("invalid_composio_chat_tool_policy");
    }
    if (saved.has(policy.tool_name)) throw new Error("duplicate_composio_chat_tool_policy");
    saved.set(policy.tool_name, policy);
  }

  const definitions: CibaToolDefinition[] = [];
  const ids = new Set<string>();
  for (const remote of options.remoteTools) {
    if (definitions.length >= maxTools) break;
    const consent = saved.get(remote.name);
    if (!consent || consent.enabled !== 1) continue;
    let classified: ReturnType<typeof classifyComposioTool>;
    let schemaSha256: string;
    try {
      classified = classifyComposioTool(remote, options.enabledToolkits);
      if (classified.risk !== "read" || classified.requiresApproval ||
          consent.risk !== "read" || consent.requires_approval !== 0 ||
          consent.toolkit !== classified.toolkit) continue;
      schemaSha256 = await hashComposioToolSchema(remote.inputSchema);
    } catch {
      continue;
    }
    if (schemaSha256 !== consent.schema_sha256) continue;

    const id = `composio.${remote.name.toLowerCase()}`;
    if (!/^[a-z][a-z0-9._-]{0,63}$/.test(id) || ids.has(id)) {
      throw new Error("composio_chat_tool_id_collision");
    }
    ids.add(id);
    definitions.push(Object.freeze({
      id,
      description: `Consulta de leitura autorizada da integração ${classified.toolkit}, ferramenta ${remote.name}.`,
      risk: "read" as const,
      requiresApproval: false,
      inputSchema: remote.inputSchema,
      async execute(input: unknown) {
        const result = await options.callTool(remote.name, input as Record<string, unknown>);
        if (result.isError) throw new Error("composio_read_tool_failed");
        return result.structuredContent ?? result.content;
      },
    }));
  }
  return definitions;
}
