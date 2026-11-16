import type { CibaRole, ModelProvider } from "../types";

const VALID_ROLES = new Set<CibaRole>(["general", "reasoning", "research", "coding", "creative", "verification"]);
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

function readPlainRecord(value: unknown, expectedKeys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) throw new Error("invalid_registry_record");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== expectedKeys.length ||
      expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(descriptors, key))) {
    throw new Error("invalid_registry_record");
  }
  const record: Record<string, unknown> = Object.create(null);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_registry_record");
    }
    record[key] = descriptor.value;
  }
  return record;
}

function snapshotArray(value: unknown, maxLength: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > maxLength) throw new Error("invalid_registry_array");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) throw new Error("invalid_registry_array");
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid_registry_array");
    }
    result.push(descriptor.value);
  }
  return result;
}

function snapshotProvider(value: unknown): ModelProvider {
  try {
    const source = readPlainRecord(value, ["id", "enabled", "generate"]);
    const { id, enabled, generate } = source;
    if (typeof id !== "string" || !PROVIDER_ID_PATTERN.test(id) ||
        typeof enabled !== "boolean" || typeof generate !== "function") {
      throw new Error("invalid_or_duplicate_provider");
    }
    return Object.freeze({
      id,
      enabled,
      generate: (request: Parameters<ModelProvider["generate"]>[0]) =>
        generate.call(value, request) as ReturnType<ModelProvider["generate"]>
    });
  } catch {
    throw new Error("invalid_or_duplicate_provider");
  }
}

function snapshotModel(value: unknown, providerMap: Map<string, ModelProvider>): RegisteredModel {
  try {
    const source = readPlainRecord(value, ["providerId", "modelId", "roles", "maxOutputTokens", "zeroCostApproved"]);
    const { providerId, modelId, maxOutputTokens, zeroCostApproved } = source;
    const rolesValue = snapshotArray(source.roles, MAX_MODEL_ROLES);
    if (typeof providerId !== "string" || !providerMap.has(providerId) ||
        typeof modelId !== "string" || modelId.trim().length === 0 || modelId.length > 200 ||
        rolesValue.length === 0 || !Number.isInteger(maxOutputTokens) ||
        (maxOutputTokens as number) < 1 || (maxOutputTokens as number) > 512 ||
        typeof zeroCostApproved !== "boolean") throw new Error("invalid_model_registration");

    const roles: CibaRole[] = [];
    const seen = new Set<CibaRole>();
    for (const role of rolesValue) {
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

/** Trusted server-side configuration only; malformed and accessor-backed inputs fail closed. */
export function createProviderRegistry(
  providers: ModelProvider[],
  models: RegisteredModel[] = []
): ProviderRegistry {
  try {
    const safeProviders = snapshotArray(providers, MAX_PROVIDERS);
    const safeModels = snapshotArray(models, MAX_MODELS);
    const providerMap = new Map<string, ModelProvider>();
    for (const item of safeProviders) {
      const provider = snapshotProvider(item);
      if (providerMap.has(provider.id)) throw new Error("invalid_or_duplicate_provider");
      providerMap.set(provider.id, provider);
    }

    const modelMap = new Map<string, RegisteredModel>();
    for (const item of safeModels) {
      const model = snapshotModel(item, providerMap);
      const key = `${model.providerId}:${model.modelId}`;
      if (modelMap.has(key)) throw new Error("invalid_model_registration");
      modelMap.set(key, model);
    }

    return Object.freeze({
      get: (providerId: string) => providerMap.get(providerId),
      getModel: (providerId: string, modelId: string) => modelMap.get(`${providerId}:${modelId}`),
      list: () => [...providerMap.values()].map(({ id, enabled }) => ({ id, enabled })),
      listModels: () => [...modelMap.values()].map((model) => ({ ...model, roles: [...model.roles] })),
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
      "invalid_provider_registry_configuration", "invalid_or_duplicate_provider", "invalid_model_registration"
    ].includes(error.message)) throw error;
    throw new Error("invalid_provider_registry_configuration");
  }
}
