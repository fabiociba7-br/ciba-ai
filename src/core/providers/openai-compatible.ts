import type { InferenceRequest, InferenceResult, ModelProvider } from "../types";

const MAX_PROVIDER_RESPONSE_BYTES = 1_000_000;

/** Optional adapter for trusted self-hosted OpenAI-compatible runtimes. */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly id = "openai-compatible";
  readonly enabled: boolean;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
    private readonly fetcher: typeof fetch = fetch
  ) {
    let parsed: URL | null = null;
    try { parsed = new URL(baseUrl); } catch { /* invalid URL stays disabled */ }
    this.enabled = Boolean(
      parsed && parsed.protocol === "https:" && parsed.hostname &&
      !parsed.username && !parsed.password
    );
  }

  async generate(request: InferenceRequest): Promise<InferenceResult> {
    if (!this.enabled) throw new Error("provider_not_configured");
    const endpoint = new URL("/v1/chat/completions", this.baseUrl);
    const headers = new Headers({ "content-type": "application/json" });
    if (this.apiKey) headers.set("authorization", "Bearer " + this.apiKey);

    const response = await this.fetcher(endpoint, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        max_tokens: request.maxOutputTokens,
        stream: false
      })
    });
    if (!response.ok) throw new Error("provider_request_failed");

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new Error("provider_response_too_large");
    }
    const rawText = await response.text();
    if (new TextEncoder().encode(rawText).byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new Error("provider_response_too_large");
    }

    let raw: unknown;
    try { raw = JSON.parse(rawText); } catch { throw new Error("provider_invalid_response"); }
    const payload = raw as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("provider_invalid_response");
    return { text: content, raw, provider: this.id, model: request.model };
  }
}
