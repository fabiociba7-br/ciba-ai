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

export interface OrchestrationResult extends InferenceResult {
  selectedAgent: CibaRole;
  strategy: "single-pass";
  usedInferenceCalls: 1;
}
