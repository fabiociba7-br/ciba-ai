export type CibaToolRisk = "read" | "write" | "external";

export interface CibaToolDefinition<Input = unknown, Output = unknown> {
  id: string;
  description: string;
  risk: CibaToolRisk;
  inputSchema: Record<string, unknown>;
  requiresApproval: boolean;
  execute(input: Input): Promise<Output>;
}

export type CibaToolMetadata = Pick<
  CibaToolDefinition,
  "id" | "description" | "risk" | "requiresApproval"
>;

/**
 * Public registry surface exposes metadata only. Implementations remain private
 * to the registry and can run only through its authorized execute method.
 */
export interface CibaToolRegistry {
  get(toolId: string): CibaToolMetadata | undefined;
  list(): CibaToolMetadata[];
}
