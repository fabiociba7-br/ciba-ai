import type { ModelProvider, InferenceRequest, InferenceResult } from "../types";

const MAX_REQUEST_BYTES = 256_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_MESSAGES = 100;
const MAX_MESSAGE_CHARS = 32_000;
const MAX_MODEL_ID_CHARS = 200;
const MAX_OUTPUT_TOKENS = 16_384;

function serializeWithinLimit(value: unknown, limit: number, errorCode: string): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "";
  } catch {
    throw new Error(errorCode);
  }
  if (new TextEncoder().encode(serialized).byteLength > limit) {
    throw new Error(errorCode);
  }
  return serialized;
}

function extractContentText(content: unknown): string | null {
  if (typeof content === "string") return content.trim().length > 0 ? content : null;
  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const part of content) {
    if (part === null || typeof part !== "object" || Array.isArray(part)) continue;
    const item = part as { type?: unknown; text?: unknown };
    if (item.type === "text" && typeof item.text === "string" && item.text.length > 0) {
      parts.push(item.text);
    }
  }
  const combined = parts.join("");
  return combined.trim().length > 0 ? combined : null;
}

function extractAssistantText(raw: unknown): string {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("provider_invalid_response");
  }

  const result = raw as {
    response?: unknown;
    choices?: unknown;
  };

  // Native Workers AI text-generation response.
  if (typeof result.response === "string") {
    if (result.response.trim().length === 0) throw new Error("provider_empty_response");
    return result.response;
  }

  // OpenAI-compatible Chat Completions response. Gemma may return text content
  // either as a string or as an array of typed text parts.
  if (Array.isArray(result.choices) && result.choices.length > 0) {
    const first = result.choices[0];
    if (first !== null && typeof first === "object" && !Array.isArray(first)) {
      const choice = first as { message?: unknown };
      if (choice.message !== null && typeof choice.message === "object" &&
          !Array.isArray(choice.message)) {
        const message = choice.message as { content?: unknown; refusal?: unknown };
        const contentText = extractContentText(message.content);
        if (contentText !== null) return contentText;
        if (typeof message.refusal === "string" && message.refusal.trim().length > 0) {
          return message.refusal;
        }
      }
    }
  }

  // Never serialize the provider envelope: it may contain reasoning, token IDs,
  // usage metadata, routing information, or tool-call arguments.
  throw new Error("provider_invalid_response");
}

function validateRequest(request: InferenceRequest): void {
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

  serializeWithinLimit({
    model: request.model,
    messages: request.messages,
    max_completion_tokens: request.maxOutputTokens
  }, MAX_REQUEST_BYTES, "provider_request_too_large");
}

export interface CloudflareAI {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export class CloudflareWorkersAIProvider implements ModelProvider {
  readonly id = "cloudflare-workers-ai";
  readonly enabled = true;

  constructor(private readonly binding: CloudflareAI) {}

  async generate(request: InferenceRequest): Promise<InferenceResult> {
    validateRequest(request);
    const raw = await this.binding.run(request.model, {
      messages: request.messages,
      max_completion_tokens: request.maxOutputTokens,
      // Gemma 4 enables thinking by default. Disable it for the text-chat
      // experience; internal reasoning must never be mistaken for the answer.
      chat_template_kwargs: { enable_thinking: false }
    });

    const text = extractAssistantText(raw);
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("provider_response_too_large");
    }

    return { text, raw, provider: this.id, model: request.model };
  }
}
