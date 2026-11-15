import { describe, expect, it } from "vitest";
import { prepareMemoryCandidate } from "../src/core/memory-candidates";

describe("explicit memory candidate preparation", () => {
  it("prepares a quote-backed candidate without persisting it", () => {
    const result = prepareMemoryCandidate({
      sourceRole: "user",
      sourceText: "Prefiro respostas diretas e sem rodeios.",
      key: "response_style",
      value: "Prefiro respostas diretas",
    });
    expect(result).toEqual({
      key: "response_style",
      value: "Prefiro respostas diretas",
      evidence_excerpt: "Prefiro respostas diretas",
      source_role: "user",
      requires_confirmation: true,
      persisted: false,
    });
  });

  it("normalizes accents and whitespace when checking the quote", () => {
    expect(() => prepareMemoryCandidate({
      sourceRole: "user",
      sourceText: "Gosto de música ao vivo.",
      key: "music",
      value: "gosto  de musica",
    })).not.toThrow();
  });

  it("rejects assistant content and unsupported paraphrases", () => {
    expect(() => prepareMemoryCandidate({
      sourceRole: "assistant", sourceText: "Prefiro rock.", key: "music", value: "Prefiro rock.",
    })).toThrow("memory_candidate_user_source_required");
    expect(() => prepareMemoryCandidate({
      sourceRole: "user", sourceText: "Gosto de rock.", key: "music", value: "Prefiro jazz.",
    })).toThrow("memory_candidate_not_supported_by_user_quote");
  });

  it("rejects credentials, invalid keys and oversized source text", () => {
    expect(() => prepareMemoryCandidate({
      sourceRole: "user", sourceText: "api_key=secret", key: "credential", value: "api_key=secret",
    })).toThrow("memory_secret_rejected");
    expect(() => prepareMemoryCandidate({
      sourceRole: "user", sourceText: "Sou fã de rock.", key: "../memory", value: "Sou fã de rock.",
    })).toThrow("invalid_memory_key");
    expect(() => prepareMemoryCandidate({
      sourceRole: "user", sourceText: "x".repeat(2_001), key: "fact", value: "x",
    })).toThrow("invalid_memory_candidate_source");
  });
});
