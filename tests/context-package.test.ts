import { describe, expect, it } from "vitest";
import { buildContextPackage } from "../src/core/context-package";

describe("Garcia structured context packages", () => {
  it("builds a compact package with explicit provenance and no transcript field", () => {
    const result = buildContextPackage("ctx-1", "Preparar planejamento do projeto", [
      { key: "preferred_style", value: "Respostas diretas", kind: "preference", origin: "curated_memory" },
      { key: "current_phase", value: "Revisão de arquitetura", kind: "project", origin: "task_state" },
    ]);
    expect(result).toMatchObject({
      protocol: "garcia.context.package",
      version: 1,
      conversation_history_included: false,
      items: [{ origin: "curated_memory" }, { origin: "task_state" }],
    });
    expect(result).not.toHaveProperty("messages");
    expect(result).not.toHaveProperty("transcript");
  });

  it("rejects empty or oversized packages and invalid item metadata", () => {
    expect(() => buildContextPackage("ctx", "Valid purpose", [])).toThrow("invalid_context_items");
    expect(() => buildContextPackage("ctx", "Valid purpose", Array.from({ length: 9 }, (_, i) => ({
      key: `k${i}`, value: "v", kind: "fact" as const, origin: "task_state" as const,
    })))).toThrow("invalid_context_items");
    expect(() => buildContextPackage("ctx", "Valid purpose", [
      { key: "bad key", value: "v", kind: "fact", origin: "task_state" },
    ])).toThrow("invalid_context_item");
    expect(() => buildContextPackage("ctx", "Valid purpose", [
      { key: "k", value: "v", kind: "fact", origin: "unverified" as never },
    ])).toThrow("invalid_context_item");
  });

  it("rejects keys that imply a raw conversation or prompt dump", () => {
    expect(() => buildContextPackage("ctx", "Contexto de trabalho", [
      { key: "transcript", value: "texto", kind: "summary", origin: "task_state" },
    ])).toThrow("invalid_context_item");
  });

  it("caps individual values and rejects invalid purpose", () => {
    expect(() => buildContextPackage("ctx", "Valid purpose", [
      { key: "k", value: "x".repeat(501), kind: "fact", origin: "task_state" },
    ])).toThrow("invalid_context_item");
    expect(() => buildContextPackage("ctx", "x", [
      { key: "k", value: "v", kind: "fact", origin: "task_state" },
    ])).toThrow("invalid_context_purpose");
  });
});
