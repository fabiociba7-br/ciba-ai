import { describe, expect, it, vi } from "vitest";
import { createRuntimeProviderRegistry } from "../src/core/runtime-provider-registry";

describe("runtime provider registry", () => {
  const env = {
    AI: { run: vi.fn().mockResolvedValue({ response: "ok" }) },
  };

  it("registers the approved Workers AI model for every supported role", () => {
    const registry = createRuntimeProviderRegistry(
      env,
      "@cf/google/gemma-4-26b-a4b-it",
      256,
    );

    expect(registry.list()).toEqual([
      { id: "cloudflare-workers-ai", enabled: true },
    ]);
    expect(registry.select("general", "cloudflare-workers-ai")).toMatchObject({
      providerId: "cloudflare-workers-ai",
      modelId: "@cf/google/gemma-4-26b-a4b-it",
      roles: ["general", "reasoning", "research", "coding", "creative", "verification"],
      maxOutputTokens: 256,
      zeroCostApproved: true,
    });
    expect(registry.select("verification")).toBeDefined();
  });

  it("does not register a model when no model is configured", () => {
    const registry = createRuntimeProviderRegistry(env, null, 256);

    expect(registry.list()).toEqual([
      { id: "cloudflare-workers-ai", enabled: true },
    ]);
    expect(registry.listModels()).toEqual([]);
    expect(registry.select("general")).toBeUndefined();
  });

  it("keeps unapproved models out of the selectable registry", () => {
    const registry = createRuntimeProviderRegistry(env, "unapproved-model", 256);

    expect(registry.listModels()).toMatchObject([
      { modelId: "unapproved-model", zeroCostApproved: false },
    ]);
    expect(registry.select("general")).toBeUndefined();
  });
});
