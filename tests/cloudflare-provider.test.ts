import { describe, expect, it } from "vitest";
import { CloudflareWorkersAIProvider } from "../src/core/providers/cloudflare";
import type { InferenceRequest } from "../src/core/types";

const request: InferenceRequest = {
  model: "@cf/google/gemma-4-26b-a4b-it",
  maxOutputTokens: 512,
  messages: [{ role: "user", content: "Oi" }]
};

describe("Cloudflare Workers AI response extraction", () => {
  it("returns only choices[0].message.content and never serializes reasoning or metadata", async () => {
    const provider = new CloudflareWorkersAIProvider({
      run: async () => ({
        id: "chatcmpl-test",
        object: "chat.completion",
        model: "@cf/google/gemma-4-26b-a4b-it",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: "Olá! Como posso ajudar você hoje?",
            reasoning: "INTERNAL_REASONING_MUST_NOT_REACH_USER"
          },
          finish_reason: "stop"
        }],
        usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 }
      })
    });

    const result = await provider.generate(request);
    expect(result.text).toBe("Olá! Como posso ajudar você hoje?");
    expect(result.text).not.toContain("reasoning");
    expect(result.text).not.toContain("usage");
    expect(result.text).not.toContain("chat.completion");
  });

  it("extracts typed text parts from Gemma content arrays", async () => {
    const provider = new CloudflareWorkersAIProvider({
      run: async () => ({
        choices: [{
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Olá, " },
              { type: "text", text: "Fábio!" }
            ],
            reasoning: "INTERNAL_REASONING_MUST_NOT_REACH_USER"
          },
          finish_reason: "stop"
        }]
      })
    });
    const result = await provider.generate(request);
    expect(result.text).toBe("Olá, Fábio!");
    expect(result.text).not.toContain("INTERNAL_REASONING");
  });

  it("returns a provider refusal as user-facing text without exposing the envelope", async () => {
    const provider = new CloudflareWorkersAIProvider({
      run: async () => ({
        choices: [{
          message: { role: "assistant", content: null, refusal: "Não posso ajudar com isso." }
        }]
      })
    });
    const result = await provider.generate(request);
    expect(result.text).toBe("Não posso ajudar com isso.");
  });

  it("continues supporting the native Workers AI response field", async () => {
    const provider = new CloudflareWorkersAIProvider({
      run: async () => ({ response: "Resposta nativa." })
    });
    const result = await provider.generate(request);
    expect(result.text).toBe("Resposta nativa.");
  });

  it("rejects unknown response envelopes instead of exposing serialized JSON", async () => {
    const provider = new CloudflareWorkersAIProvider({
      run: async () => ({ id: "x", usage: { total_tokens: 1 }, reasoning: "secret" })
    });
    await expect(provider.generate(request)).rejects.toThrow("provider_invalid_response");
  });

  it("disables Gemma 4 thinking for the user-facing text-chat request", async () => {
    let captured: Record<string, unknown> | undefined;
    const provider = new CloudflareWorkersAIProvider({
      run: async (_model, input) => {
        captured = input;
        return { choices: [{ message: { content: "Pronto." } }] };
      }
    });
    await provider.generate(request);
    expect(captured?.chat_template_kwargs).toEqual({ enable_thinking: false });
  });
});
