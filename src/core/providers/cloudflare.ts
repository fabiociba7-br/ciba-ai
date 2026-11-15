import type { ModelProvider, InferenceRequest, InferenceResult } from "../types";

export interface CloudflareAI {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export class CloudflareWorkersAIProvider implements ModelProvider {
  readonly id = "cloudflare-workers-ai";
  readonly enabled = true;

  constructor(private readonly binding: CloudflareAI) {}

  async generate(request: InferenceRequest): Promise<InferenceResult> {
    const raw = await this.binding.run(request.model, {
      messages: request.messages,
      max_completion_tokens: request.maxOutputTokens
    });
    const result = raw as { response?: unknown };
    const text = typeof result?.response === "string"
      ? result.response
      : (JSON.stringify(raw) ?? "");
    return { text, raw, provider: this.id, model: request.model };
  }
}
