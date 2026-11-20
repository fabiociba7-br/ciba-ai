import { ZERO_COST_MODELS } from "../policy";
import { CloudflareWorkersAIProvider, type CloudflareAI } from "./providers/cloudflare";
import { createProviderRegistry } from "./providers/registry";

export const createRuntimeProviderRegistry = (
  env: { AI: CloudflareAI },
  model: string | null,
  maxOutputTokens: number,
) => {
  const implementation = new CloudflareWorkersAIProvider(env.AI);
  // Adapt the class instance to a plain own-property record accepted by the registry.
  const provider = {
    id: implementation.id,
    enabled: implementation.enabled,
    generate: (request: Parameters<typeof implementation.generate>[0]) =>
      implementation.generate(request),
  };
  const roles = ["general", "reasoning", "research", "coding", "creative", "verification"] as const;
  return createProviderRegistry([provider], model ? [{
    providerId: provider.id,
    modelId: model,
    roles: [...roles],
    maxOutputTokens,
    zeroCostApproved: ZERO_COST_MODELS.has(model),
  }] : []);
};
