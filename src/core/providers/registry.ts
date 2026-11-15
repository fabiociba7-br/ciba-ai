import type { ModelProvider } from "../types";

export interface RegisteredModel {
  providerId: string;
  modelId: string;
  roles: string[];
  maxOutputTokens: number;
  zeroCostApproved: boolean;
}

export interface ProviderRegistry {
  get(providerId: string): ModelProvider | undefined;
  list(): Array<{ id: string; enabled: boolean }>;
}

/**
 * In-memory registry builder. Populate only from trusted server-side
 * configuration; never accept provider URLs, model IDs or credentials from
 * an end-user request.
 */
export function createProviderRegistry(providers: ModelProvider[]): ProviderRegistry {
  const map = new Map<string, ModelProvider>();
  for (const provider of providers) {
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(provider.id) || map.has(provider.id)) {
      throw new Error("invalid_or_duplicate_provider");
    }
    map.set(provider.id, provider);
  }
  return {
    get: (providerId) => map.get(providerId),
    list: () => [...map.values()].map(({ id, enabled }) => ({ id, enabled }))
  };
}
