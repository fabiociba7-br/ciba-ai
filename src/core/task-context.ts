import {
  buildContextPackage,
  type ContextPackage,
  type ContextPackageItem,
} from "./context-package";
import {
  deduplicateAuthorizedMemories,
  rankRelevantMemories,
  type MemorySearchRecord,
} from "./memory-retrieval";

export const MAX_TASK_CONTEXT_ITEMS = 5;

/** Selects a small task-relevant handoff from records already authorized for the source app. */
export function buildTaskContextPackage(
  taskId: string,
  taskType: string,
  instruction: string,
  authorizedRecords: MemorySearchRecord[],
): ContextPackage | null {
  const unique = deduplicateAuthorizedMemories(authorizedRecords);
  const ranked = rankRelevantMemories(`${taskType} ${instruction}`, unique, 20);
  const items: ContextPackageItem[] = ranked.slice(0, MAX_TASK_CONTEXT_ITEMS).map((record) => {
    const key = record.memory_key.slice(0, 60);
    const keyLower = key.toLocaleLowerCase("pt-BR");
    const kind: ContextPackageItem["kind"] =
      /(prefer|style|communication|response)/.test(keyLower) ? "preference" :
      /(project|phase|status|roadmap|milestone)/.test(keyLower) ? "project" :
      /(constraint|limit|avoid|restriction|deadline|budget)/.test(keyLower) ? "constraint" : "fact";
    return {
      key,
      value: record.value,
      kind,
      origin: "curated_memory",
    };
  });

  if (items.length === 0) return null;
  return buildContextPackage(
    taskId,
    `${taskType}: ${instruction}`.slice(0, 160),
    items,
  );
}
