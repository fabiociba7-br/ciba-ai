export type ContextItemKind = "preference" | "project" | "constraint" | "fact" | "summary";
export type ContextItemOrigin = "curated_memory" | "task_state" | "user_confirmed";

export interface ContextPackageItem {
  key: string;
  value: string;
  kind: ContextItemKind;
  origin: ContextItemOrigin;
}

export interface ContextPackage {
  protocol: "garcia.context.package";
  version: 1;
  context_id: string;
  purpose: string;
  items: ContextPackageItem[];
  conversation_history_included: false;
}

const MAX_ITEMS = 8;
const MAX_VALUE_CHARS = 500;
const MAX_PURPOSE_CHARS = 160;
export const MAX_CONTEXT_PACKAGE_CHARS = 4_000;

function snapshotPlainRecord(value: unknown, allowed: string[]): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string" || !allowed.includes(key))) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch { return null; }
}

function snapshotItems(value: unknown): Record<string, unknown>[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
        value.length < 1 || value.length > MAX_ITEMS) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) return null;
    const result: Record<string, unknown>[] = [];
    for (let i = 0; i < value.length; i += 1) {
      const descriptor = descriptors[String(i)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      const item = snapshotPlainRecord(descriptor.value, ["key", "value", "kind", "origin"]);
      if (!item) return null;
      result.push(item);
    }
    return result;
  } catch { return null; }
}

/**
 * Builds a small, structured handoff. It deliberately has no free-form
 * transcript/messages field; callers must select curated context items.
 */
export function buildContextPackage(
  contextId: string,
  purpose: string,
  items: ContextPackageItem[],
): ContextPackage {
  if (typeof contextId !== "string" || !contextId.trim() || contextId.length > 100) throw new Error("invalid_context_id");
  if (typeof purpose !== "string" || purpose.trim().length < 3 || purpose.trim().length > MAX_PURPOSE_CHARS) {
    throw new Error("invalid_context_purpose");
  }
  const safeItems = snapshotItems(items);
  if (!safeItems) throw new Error("invalid_context_items");

  const normalized = safeItems.map((item) => {
    if (typeof item.key !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,59}$/.test(item.key) ||
        /^(messages?|transcript|conversation|conversation_history|chat_history|system_prompt)$/i.test(item.key) ||
        typeof item.value !== "string" || !item.value.trim() || item.value.length > MAX_VALUE_CHARS ||
        !["preference", "project", "constraint", "fact", "summary"].includes(item.kind as string) ||
        !["curated_memory", "task_state", "user_confirmed"].includes(item.origin as string)) {
      throw new Error("invalid_context_item");
    }
    return {
      key: item.key,
      value: item.value.trim(),
      kind: item.kind as ContextItemKind,
      origin: item.origin as ContextItemOrigin
    };
  });

  const result: ContextPackage = {
    protocol: "garcia.context.package",
    version: 1,
    context_id: contextId,
    purpose: purpose.trim(),
    items: normalized,
    conversation_history_included: false,
  };
  if (JSON.stringify(result).length > MAX_CONTEXT_PACKAGE_CHARS) {
    throw new Error("context_package_too_large");
  }
  return result;
}
