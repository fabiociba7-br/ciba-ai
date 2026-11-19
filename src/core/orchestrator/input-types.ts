import type { ChatTurn, ModelProvider } from "../types";
import type { CibaToolInvocationContext, ExecutableCibaToolRegistry } from "../tools/registry";
import type { DurableCibaToolApprovalFlow } from "../tools/durable-approval-flow";
import type { DurableToolApprovalIdentity } from "../tools/durable-consent";

export const MAX_MESSAGES = 100;
export const MAX_MESSAGE_CHARS = 32_000;
export const MAX_TOTAL_INPUT_BYTES = 256_000;
export const MAX_MEMORY_CONTEXT_CHARS = 8_000;
export const MAX_MODEL_ID_CHARS = 200;
export const MAX_OUTPUT_TOKENS = 16_384;
export const MAX_MODEL_TOOL_COUNT = 16;
export const MAX_MODEL_TOOL_CATALOG_BYTES = 16_000;

export type OrchestratorInput = {
  messages: ChatTurn[];
  model: string;
  maxOutputTokens: number;
  provider: ModelProvider;
  memoryContext?: string;
  toolRuntime?: {
  registry: ExecutableCibaToolRegistry;
  context: CibaToolInvocationContext;
  durableApproval?: { flow: DurableCibaToolApprovalFlow; identity: DurableToolApprovalIdentity };
  executeReadOnlyProposals?: boolean;
};
};
