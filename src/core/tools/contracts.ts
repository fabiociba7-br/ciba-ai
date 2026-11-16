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
 * Tool definition contract. Definitions are inert until passed to the registry
 * with an explicit allowlist and a trusted application authorization callback.
 * The registry validates input/output and applies execution time limits.
 */
export interface CibaToolRegistry {
  get(toolId: string): CibaToolDefinition | undefined;
  list(): Array<Pick<CibaToolDefinition, "id" | "description" | "risk" | "requiresApproval">>;
}
