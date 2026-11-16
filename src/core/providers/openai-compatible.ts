import type { InferenceRequest, InferenceResult, ModelProvider } from "../types";

const MAX_PROVIDER_RESPONSE_BYTES = 1_000_000;
const MAX_REQUEST_BYTES = 256_000;
const MAX_MESSAGES = 100;
const MAX_MESSAGE_CHARS = 32_000;
const MAX_MODEL_ID_CHARS = 200;
const MAX_OUTPUT_TOKENS = 16_384;

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVIDER_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("provider_response_too_large");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("provider_response_too_large");
      }
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    return output;
  } catch (error) {
    try { await reader.cancel(); } catch { /* stream already closed */ }
    if (error instanceof Error && error.message === "provider_response_too_large") throw error;
    throw new Error("provider_invalid_response");
  } finally {
    reader.releaseLock();
  }
}

function validateInferenceRequest(request: InferenceRequest): void {
  if (!request || typeof request !== "object" ||
      typeof request.model !== "string" || request.model.trim().length === 0 ||
      request.model.length > MAX_MODEL_ID_CHARS ||
      !Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 ||
      request.maxOutputTokens > MAX_OUTPUT_TOKENS ||
      !Array.isArray(request.messages) || request.messages.length === 0 ||
      request.messages.length > MAX_MESSAGES) {
    throw new Error("invalid_provider_request");
  }
  for (const message of request.messages) {
    if (!message || typeof message !== "object" ||
        !["system", "user", "assistant"].includes(message.role) ||
        typeof message.content !== "string" ||
        message.content.length > MAX_MESSAGE_CHARS) {
      throw new Error("invalid_provider_request");
    }
  }
  const body = JSON.stringify({
    model: request.model,
    messages: request.messages,
    max_tokens: request.maxOutputTokens,
    stream: false
  });
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
    throw new Error("provider_request_too_large");
  }
}

/** Optional adapter for trusted self-hosted OpenAI-compatible runtimes. */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly id = "openai-compatible";
  readonly enabled: boolean;
  private readonly endpoint: URL | null;

  constructor(
    baseUrl: string,
    private readonly apiKey?: string,
    private readonly fetcher: typeof fetch = fetch
  ) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(baseUrl);
      if (parsed.protocol !== "https:" || !parsed.hostname ||
          parsed.username || parsed.password || parsed.search || parsed.hash) {
        parsed = null;
      } else {
        parsed.pathname = parsed.pathname.replace(/\/+$/, "");
      }
    } catch { /* invalid URL stays disabled */ }
    this.endpoint = parsed ? new URL("/v1/chat/completions", parsed.origin) : null;
    this.enabled = this.endpoint !== null;
  }

  async generate(request: InferenceRequest): Promise<InferenceResult> {
    if (!this.enabled || !this.endpoint) throw new Error("provider_not_configured");
    validateInferenceRequest(request);
    if (this.apiKey !== undefined &&
        (typeof this.apiKey !== "string" || this.apiKey.length === 0 || this.apiKey.length > 4096)) {
      throw new Error("provider_not_configured");
    }

    const headers = new Headers({ "content-type": "application/json", "accept": "application/json" });
    if (this.apiKey) headers.set("authorization", "Bearer " + this.apiKey);

    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        max_tokens: request.maxOutputTokens,
        stream: false
      })
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("provider_request_failed");
    }

    const rawText = await readBoundedResponse(response);
    let raw: unknown;
    try { raw = JSON.parse(rawText); } catch { throw new Error("provider_invalid_response"); }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("provider_invalid_response");
    }
    const choices = (raw as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0 ||
        choices[0] === null || typeof choices[0] !== "object") {
      throw new Error("provider_invalid_response");
    }
    const message = (choices[0] as { message?: unknown }).message;
    if (message === null || typeof message !== "object" || Array.isArray(message)) {
      throw new Error("provider_invalid_response");
    }
    const content = (message as { content?: unknown }).content;
    if (typeof content !== "string" || content.length > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new Error("provider_invalid_response");
    }
    return { text: content, raw, provider: this.id, model: request.model };
  }
}
