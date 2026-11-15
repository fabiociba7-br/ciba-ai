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

export function validateAppProfile(input: AppProfileInput): {
  valid: true;
  profile: Pick<AppIdentityProfile, "description" | "app_type" | "capabilities" | "task_types" | "contract_version">;
} | { valid: false; error: string } {
  const description = input.description === undefined ? "" : input.description;
  const appType = input.app_type === undefined ? "other" : input.app_type;
  const capabilities = input.capabilities === undefined ? [] : input.capabilities;
  const taskTypes = input.task_types === undefined ? [] : input.task_types;
  const contractVersion = input.contract_version === undefined ? "1.0.0" : input.contract_version;

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
    profile: {
      description: description.trim(),
      app_type: appType as AppType,
      capabilities: [...capabilities] as AppCapability[],
      task_types: [...taskTypes] as AppTaskType[],
      contract_version: contractVersion,
    },
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
