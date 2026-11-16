export type CibaRole = "general" | "reasoning" | "research" | "coding" | "creative" | "verification";
export type ChatTurn = { role: "user" | "assistant"; content: string };

export interface InferenceRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxOutputTokens: number;
}

export interface InferenceResult {
  text: string;
  raw: unknown;
  provider: string;
  model: string;
}

export interface ModelProvider {
  readonly id: string;
  readonly enabled: boolean;
  generate(request: InferenceRequest): Promise<InferenceResult>;
}

export interface AgentProfile {
  id: CibaRole;
  description: string;
  instructions: string;
}

import type { CibaToolInvocationPlan } from "./tools/registry";
export interface OrchestrationResult extends InferenceResult {
  toolProposal?: CibaToolInvocationPlan;
  toolApproval?: {
    status: "not_required" | "approval_required" | "approved";
    approvalId?: string;
  };
  toolExecution?: {
    toolId: string;
    output: unknown;
  };
  toolExecutionError?: "tool_execution_failed";
  toolProposalError?: "tool_proposal_rejected";
  selectedAgent: CibaRole;
  strategy: "single-pass" | "tool-assisted";
  usedInferenceCalls: 1 | 2;
}
