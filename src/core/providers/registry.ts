import type { CibaRole, ModelProvider } from "../types";

const VALID_ROLES = new Set<CibaRole>([
  "general", "reasoning", "research", "coding", "creative", "verification"
]);

export interface RegisteredModel {
  providerId: string;
  modelId: string;
  roles: CibaRole[];
  maxOutputTokens: number;
  zeroCostApproved: boolean;
}

export interface ProviderRegistry {
  get(providerId: string): ModelProvider | undefined;
  getModel(providerId: string, modelId: string): RegisteredModel | undefined;
  list(): Array<{ id: string; enabled: boolean }>;
  listModels(): RegisteredModel[];
  select(role: CibaRole, preferredProviderId?: string): RegisteredModel | undefined;
}

/**
 * In-memory registry built only from trusted server-side configuration.
 * Models are selectable only when explicitly approved for the zero-cost path.
 */
export function createProviderRegistry(
  providers: ModelProvider[],
  models: RegisteredModel[] = []
): ProviderRegistry {
  const providerMap = new Map<string, ModelProvider>();
  for (const provider of providers) {
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(provider.id) || providerMap.has(provider.id)) {
      throw new Error("invalid_or_duplicate_provider");
    }
    providerMap.set(provider.id, provider);
  }

  const modelMap = new Map<string, RegisteredModel>();
  for (const model of models) {
    const key = `${model.providerId}:${model.modelId}`;
    if (!providerMap.has(model.providerId) || !model.modelId || model.modelId.length > 200 ||
        modelMap.has(key) || !Array.isArray(model.roles) || model.roles.length === 0 ||
        model.roles.some((role) => !VALID_ROLES.has(role)) ||
        !Number.isInteger(model.maxOutputTokens) || model.maxOutputTokens < 1 ||
        model.maxOutputTokens > 512 || typeof model.zeroCostApproved !== "boolean") {
      throw new Error("invalid_model_registration");
    }
    modelMap.set(key, { ...model, roles: [...new Set(model.roles)] });
  }

  return {
    get: (providerId) => providerMap.get(providerId),
    getModel: (providerId, modelId) => modelMap.get(`${providerId}:${modelId}`),
    list: () => [...providerMap.values()].map(({ id, enabled }) => ({ id, enabled })),
    listModels: () => [...modelMap.values()].map((model) => ({ ...model, roles: [...model.roles] })),
    select: (role, preferredProviderId) => {
      for (const model of modelMap.values()) {
        const provider = providerMap.get(model.providerId);
        if (provider?.enabled && model.zeroCostApproved && model.roles.includes(role) &&
            (!preferredProviderId || model.providerId === preferredProviderId)) {
          return { ...model, roles: [...model.roles] };
        }
      }
      return undefined;
    }
  };
}
