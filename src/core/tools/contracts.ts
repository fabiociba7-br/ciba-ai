export type CibaToolRisk = "read" | "write" | "external";

export interface CibaToolDefinition<Input = unknown, Output = unknown> {
  id: string;
  description: string;
  risk: CibaToolRisk;
  inputSchema: Record<string, unknown>;
  requiresApproval: boolean;
  execute(input: Input): Promise<Output>;
}

/**
 * Tool registration contract only. No tools are registered or executable by
 * the chat model by default. The future registry must enforce an explicit
 * allowlist, schema validation, scopes, timeouts and approval for side effects.
 */
export interface CibaToolRegistry {
  get(toolId: string): CibaToolDefinition | undefined;
  list(): Array<Pick<CibaToolDefinition, "id" | "description" | "risk" | "requiresApproval">>;
}
