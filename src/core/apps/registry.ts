export const APP_TYPES = ["assistant", "utility", "productivity", "creative", "mobility", "other"] as const;
export type AppType = typeof APP_TYPES[number];

export const APP_CAPABILITIES = [
  "assistant", "automation", "calendar", "contacts", "documents",
  "finance", "media", "mobility", "notes", "productivity",
  "research", "smart_home"
] as const;
export type AppCapability = typeof APP_CAPABILITIES[number];

export const APP_TASK_TYPES = [
  "analyze", "classify", "draft", "extract", "organize",
  "plan", "research", "summarize", "transcribe", "translate"
] as const;
export type AppTaskType = typeof APP_TASK_TYPES[number];

export interface AppIdentityProfile {
  app_id: string;
  display_name: string;
  description: string;
  app_type: AppType;
  capabilities: AppCapability[];
  task_types: AppTaskType[];
  contract_version: string;
}

export interface AppProfileInput {
  description?: unknown;
  app_type?: unknown;
  capabilities?: unknown;
  task_types?: unknown;
  contract_version?: unknown;
}

function snapshotAppProfileInput(input: unknown): Record<string, unknown> | null {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const result: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string" || key === "__proto__" ||
          key === "constructor" || key === "prototype") return null;
      const descriptor = descriptors[key];
      if (!("value" in descriptor) || !descriptor.enumerable) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

export function validateAppProfile(input: AppProfileInput): {
  valid: true;
  profile: Pick<AppIdentityProfile, "description" | "app_type" | "capabilities" | "task_types" | "contract_version">;
} | { valid: false; error: string } {
  const snapshot = snapshotAppProfileInput(input);
  if (!snapshot) return { valid: false, error: "invalid_app_profile" };
  const description = snapshot.description === undefined ? "" : snapshot.description;
  const appType = snapshot.app_type === undefined ? "other" : snapshot.app_type;
  const capabilities = snapshot.capabilities === undefined ? [] : snapshot.capabilities;
  const taskTypes = snapshot.task_types === undefined ? [] : snapshot.task_types;
  const contractVersion = snapshot.contract_version === undefined ? "1.0.0" : snapshot.contract_version;

  if (typeof description !== "string" || description.trim().length > 280) {
    return { valid: false, error: "invalid_app_description" };
  }
  if (typeof appType !== "string" || !(APP_TYPES as readonly string[]).includes(appType)) {
    return { valid: false, error: "invalid_app_type" };
  }
  if (!Array.isArray(capabilities) || capabilities.length > 12 ||
      capabilities.some((item) => typeof item !== "string" ||
        !(APP_CAPABILITIES as readonly string[]).includes(item)) ||
      new Set(capabilities).size !== capabilities.length) {
    return { valid: false, error: "invalid_app_capabilities" };
  }
  if (!Array.isArray(taskTypes) || taskTypes.length > 10 ||
      taskTypes.some((item) => typeof item !== "string" ||
        !(APP_TASK_TYPES as readonly string[]).includes(item)) ||
      new Set(taskTypes).size !== taskTypes.length) {
    return { valid: false, error: "invalid_app_task_types" };
  }
  if (typeof contractVersion !== "string" ||
      !/^[0-9]+[.][0-9]+[.][0-9]+$/.test(contractVersion)) {
    return { valid: false, error: "invalid_app_contract_version" };
  }

  return {
    valid: true,
    profile: Object.freeze({
      description: description.trim(),
      app_type: appType as AppType,
      capabilities: Object.freeze([...capabilities]) as unknown as AppCapability[],
      task_types: Object.freeze([...taskTypes]) as unknown as AppTaskType[],
      contract_version: contractVersion,
    }),
  };
}

export function parseStoredAppTaskTypes(value: string): AppTaskType[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is AppTaskType =>
      typeof item === "string" && (APP_TASK_TYPES as readonly string[]).includes(item)
    );
  } catch {
    return [];
  }
}

export function parseStoredAppCapabilities(value: string): AppCapability[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is AppCapability =>
      typeof item === "string" && (APP_CAPABILITIES as readonly string[]).includes(item)
    );
  } catch {
    return [];
  }
}
