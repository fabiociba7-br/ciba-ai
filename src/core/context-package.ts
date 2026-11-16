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

/**
 * Builds a small, structured handoff. It deliberately has no free-form
 * transcript/messages field; callers must select curated context items.
 */
export function buildContextPackage(
  contextId: string,
  purpose: string,
  items: ContextPackageItem[],
): ContextPackage {
  if (!contextId || contextId.length > 100) throw new Error("invalid_context_id");
  if (typeof purpose !== "string" || purpose.trim().length < 3 || purpose.trim().length > MAX_PURPOSE_CHARS) {
    throw new Error("invalid_context_purpose");
  }
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS) {
    throw new Error("invalid_context_items");
  }

  const normalized = items.map((item) => {
    if (!item || typeof item !== "object" ||
        typeof item.key !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,59}$/.test(item.key) ||
        /^(messages?|transcript|conversation|conversation_history|chat_history|system_prompt)$/i.test(item.key) ||
        typeof item.value !== "string" || !item.value.trim() || item.value.length > MAX_VALUE_CHARS ||
        !["preference", "project", "constraint", "fact", "summary"].includes(item.kind) ||
        !["curated_memory", "task_state", "user_confirmed"].includes(item.origin)) {
      throw new Error("invalid_context_item");
    }
    return { key: item.key, value: item.value.trim(), kind: item.kind, origin: item.origin };
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
