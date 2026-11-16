import type { CibaRole, ModelProvider } from "../types";

const VALID_ROLES = new Set<CibaRole>([
  "general", "reasoning", "research", "coding", "creative", "verification"
]);
const MAX_PROVIDERS = 64;
const MAX_MODELS = 256;
const MAX_MODEL_ROLES = 6;
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

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

function snapshotProvider(value: unknown): ModelProvider {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid_or_duplicate_provider");
    }
    const source = value as Record<string, unknown>;
    const id = source.id;
    const enabled = source.enabled;
    const generate = source.generate;
    if (typeof id !== "string" || !PROVIDER_ID_PATTERN.test(id) ||
        typeof enabled !== "boolean" || typeof generate !== "function") {
      throw new Error("invalid_or_duplicate_provider");
    }
    // Capture the implementation once; later mutation of the source object
    // cannot swap the provider method after registry validation.
    const provider: ModelProvider = Object.freeze({
      id,
      enabled,
      generate: (request) => generate.call(value, request) as ReturnType<ModelProvider["generate"]>
    });
    return provider;
  } catch {
    throw new Error("invalid_or_duplicate_provider");
  }
}

function snapshotModel(value: unknown, providerMap: Map<string, ModelProvider>): RegisteredModel {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid_model_registration");
    }
    const source = value as Record<string, unknown>;
    const providerId = source.providerId;
    const modelId = source.modelId;
    const rolesValue = source.roles;
    const maxOutputTokens = source.maxOutputTokens;
    const zeroCostApproved = source.zeroCostApproved;
    if (typeof providerId !== "string" || !providerMap.has(providerId) ||
        typeof modelId !== "string" || modelId.trim().length === 0 || modelId.length > 200 ||
        !Array.isArray(rolesValue) || rolesValue.length === 0 ||
        rolesValue.length > MAX_MODEL_ROLES ||
        !Number.isInteger(maxOutputTokens) || (maxOutputTokens as number) < 1 ||
        (maxOutputTokens as number) > 512 || typeof zeroCostApproved !== "boolean") {
      throw new Error("invalid_model_registration");
    }

    const roles: CibaRole[] = [];
    const seen = new Set<CibaRole>();
    const roleCount = rolesValue.length;
    for (let index = 0; index < roleCount; index += 1) {
      const role: unknown = rolesValue[index];
      if (typeof role !== "string" || !VALID_ROLES.has(role as CibaRole)) {
        throw new Error("invalid_model_registration");
      }
      if (!seen.has(role as CibaRole)) {
        seen.add(role as CibaRole);
        roles.push(role as CibaRole);
      }
    }
    if (roles.length === 0) throw new Error("invalid_model_registration");
    return Object.freeze({
      providerId,
      modelId,
      roles: Object.freeze(roles) as unknown as CibaRole[],
      maxOutputTokens: maxOutputTokens as number,
      zeroCostApproved
    });
  } catch {
    throw new Error("invalid_model_registration");
  }
}

/**
 * In-memory registry built only from trusted server-side configuration.
 * Models are selectable only when explicitly approved for the zero-cost path.
 * Inputs are detached into bounded snapshots and malformed values fail closed.
 */
export function createProviderRegistry(
  providers: ModelProvider[],
  models: RegisteredModel[] = []
): ProviderRegistry {
  try {
    if (!Array.isArray(providers) || providers.length > MAX_PROVIDERS ||
        !Array.isArray(models) || models.length > MAX_MODELS) {
      throw new Error("invalid_provider_registry_configuration");
    }

    const providerMap = new Map<string, ModelProvider>();
    const providerCount = providers.length;
    for (let index = 0; index < providerCount; index += 1) {
      const provider = snapshotProvider(providers[index]);
      if (providerMap.has(provider.id)) throw new Error("invalid_or_duplicate_provider");
      providerMap.set(provider.id, provider);
    }

    const modelMap = new Map<string, RegisteredModel>();
    const modelCount = models.length;
    for (let index = 0; index < modelCount; index += 1) {
      const model = snapshotModel(models[index], providerMap);
      const key = `${model.providerId}:${model.modelId}`;
      if (modelMap.has(key)) throw new Error("invalid_model_registration");
      modelMap.set(key, model);
    }

    return Object.freeze({
      get: (providerId: string) => providerMap.get(providerId),
      getModel: (providerId: string, modelId: string) => modelMap.get(`${providerId}:${modelId}`),
      list: () => [...providerMap.values()].map(({ id, enabled }) => ({ id, enabled })),
      listModels: () => [...modelMap.values()].map((model) => ({
        ...model,
        roles: [...model.roles]
      })),
      select: (role: CibaRole, preferredProviderId?: string) => {
        if (!VALID_ROLES.has(role)) return undefined;
        for (const model of modelMap.values()) {
          const provider = providerMap.get(model.providerId);
          if (provider?.enabled && model.zeroCostApproved && model.roles.includes(role) &&
              (!preferredProviderId || model.providerId === preferredProviderId)) {
            return { ...model, roles: [...model.roles] };
          }
        }
        return undefined;
      }
    });
  } catch (error) {
    if (error instanceof Error && [
      "invalid_provider_registry_configuration",
      "invalid_or_duplicate_provider",
      "invalid_model_registration"
    ].includes(error.message)) throw error;
    throw new Error("invalid_provider_registry_configuration");
  }
}
