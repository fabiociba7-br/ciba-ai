import type { InferenceRequest, InferenceResult, ModelProvider } from "../types";

/** Optional adapter for trusted self-hosted OpenAI-compatible runtimes. */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly id = "openai-compatible";
  readonly enabled: boolean;
  constructor(private readonly baseUrl: string, private readonly apiKey?: string, private readonly fetcher: typeof fetch = fetch) {
    let parsed: URL | null = null;
    try { parsed = new URL(baseUrl); } catch { /* invalid URL stays disabled */ }
    this.enabled = Boolean(parsed && parsed.protocol === "https:" && parsed.hostname && !parsed.username && !parsed.password);
  }
  async generate(request: InferenceRequest): Promise<InferenceResult> {
    if (!this.enabled) throw new Error("provider_not_configured");
    const endpoint = new URL("/v1/chat/completions", this.baseUrl);
    const headers = new Headers({ "content-type": "application/json" });
    if (this.apiKey) headers.set("authorization", "Bearer " + this.apiKey);
    const response = await this.fetcher(endpoint, { method: "POST", headers, body: JSON.stringify({ model: request.model, messages: request.messages, max_tokens: request.maxOutputTokens, stream: false }) });
    if (!response.ok) throw new Error("provider_request_failed");
    const raw: unknown = await response.json();
    const payload = raw as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("provider_invalid_response");
    return { text: content, raw, provider: this.id, model: request.model };
  }
}
