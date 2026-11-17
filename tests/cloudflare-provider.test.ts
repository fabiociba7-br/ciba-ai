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
});
