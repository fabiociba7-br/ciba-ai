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
 * Exposes only owner-consented, schema-stable tools to Garcia's runtime.
 * Read tools may execute under the normal read authorization path. Write and
 * external tools are proposal-only and are gated by durable owner approval.
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
      if (consent.toolkit !== classified.toolkit ||
          consent.risk !== classified.risk ||
          consent.requires_approval !== (classified.requiresApproval ? 1 : 0) ||
          (classified.risk === "read" && classified.requiresApproval) ||
          (classified.risk !== "read" && !classified.requiresApproval)) continue;
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
      risk: classified.risk,
      requiresApproval: classified.requiresApproval,
      inputSchema: remote.inputSchema,
      async execute(input: unknown) {
        const result = await options.callTool(remote.name, input as Record<string, unknown>);
        if (result.isError) throw new Error("composio_tool_call_failed");
        return result.structuredContent ?? result.content;
      },
    }));
  }
  return definitions;
}
