export interface MemoryInsightRecord {
  memory_id: string;
  scope: "app" | "owner";
  source_app_id: string | null;
  memory_key: string;
  value: string;
  updated_at: string;
  expires_at: string | null;
}

export interface MemoryInsightPair {
  first: MemoryInsightRecord;
  second: MemoryInsightRecord;
  shared_terms: string[];
  similarity: number;
  reason: "same_key_different_value" | "related_content";
}

const MAX_INSIGHT_RECORDS = 200;

function snapshotInsightRecords(value: unknown): MemoryInsightRecord[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
        value.length > 10_000) return null;
    const arrayDescriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(arrayDescriptors).length !== value.length + 1) return null;
    const result: MemoryInsightRecord[] = [];
    const seenIds = new Set<string>();
    for (let index = 0; index < Math.min(value.length, MAX_INSIGHT_RECORDS); index += 1) {
      const itemDescriptor = arrayDescriptors[String(index)];
      if (!itemDescriptor || !("value" in itemDescriptor) || !itemDescriptor.enumerable) return null;
      const item = itemDescriptor.value;
      if (item === null || typeof item !== "object" || Array.isArray(item) ||
          Object.getPrototypeOf(item) !== Object.prototype) return null;
      const descriptors = Object.getOwnPropertyDescriptors(item);
      const allowed = new Set(["memory_id", "scope", "source_app_id", "memory_key", "value", "updated_at", "expires_at"]);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.length !== allowed.size || keys.some((key) => typeof key !== "string" || !allowed.has(key))) return null;
      const fields: Record<string, unknown> = Object.create(null);
      for (const key of keys as string[]) {
        const descriptor = descriptors[key];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
        fields[key] = descriptor.value;
      }
      if (typeof fields.memory_id !== "string" || !fields.memory_id.trim() || fields.memory_id.length > 200 ||
          (fields.scope !== "app" && fields.scope !== "owner") ||
          (fields.scope === "app"
            ? typeof fields.source_app_id !== "string" || !fields.source_app_id.trim() || fields.source_app_id.length > 128
            : fields.source_app_id !== null) ||
          typeof fields.memory_key !== "string" || !fields.memory_key.trim() || fields.memory_key.length > 80 ||
          typeof fields.value !== "string" || !fields.value.trim() || fields.value.length > 500 ||
          typeof fields.updated_at !== "string" || !fields.updated_at || fields.updated_at.length > 64 ||
          !Number.isFinite(Date.parse(fields.updated_at)) ||
          !(fields.expires_at === null || (typeof fields.expires_at === "string" &&
            fields.expires_at.length > 0 && fields.expires_at.length <= 64 &&
            Number.isFinite(Date.parse(fields.expires_at))))) return null;
      if (seenIds.has(fields.memory_id)) return null;
      seenIds.add(fields.memory_id);
      result.push(Object.freeze({
        memory_id: fields.memory_id,
        scope: fields.scope,
        source_app_id: fields.source_app_id,
        memory_key: fields.memory_key,
        value: fields.value,
        updated_at: fields.updated_at,
        expires_at: fields.expires_at,
      }) as MemoryInsightRecord);
    }
    return result;
  } catch {
    return null;
  }
}

const STOP = new Set(["a","as","o","os","de","da","do","das","dos","e","em","no","na","nos","nas","para","por","com","que","um","uma","the","and","of","to"]);

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim();
}
function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(/\s+/).filter((word) => word.length > 2 && !STOP.has(word)));
}

/** Deterministic hints only: never decides truth, merges records, or mutates memory. */
export function analyzeMemoryRelationships(
  records: MemoryInsightRecord[],
  now = new Date(),
  staleAfterDays = 180,
  maxPairs = 30,
): {
  possible_conflicts: MemoryInsightPair[];
  related: MemoryInsightPair[];
  outdated: Array<MemoryInsightRecord & { reason: "expired" | "not_reviewed_recently"; age_days: number }>;
  analyzed_records: number;
  inference_calls: 0;
} {
  const empty = {
    possible_conflicts: [],
    related: [],
    outdated: [],
    analyzed_records: 0,
    inference_calls: 0 as const,
  };
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) ||
      !Number.isFinite(staleAfterDays) || !Number.isSafeInteger(staleAfterDays) ||
      staleAfterDays < 1 || staleAfterDays > 3_650 ||
      !Number.isFinite(maxPairs) || !Number.isSafeInteger(maxPairs)) return empty;
  const bounded = snapshotInsightRecords(records);
  if (!bounded) return empty;
  const pairLimit = Math.min(Math.max(maxPairs, 0), 30);
  if (pairLimit === 0) {
    return { ...empty, analyzed_records: bounded.length };
  }
  const conflicts: MemoryInsightPair[] = [];
  const related: MemoryInsightPair[] = [];
  const staleMs = staleAfterDays * 86400000;
  const outdated = bounded.flatMap((record) => {
    const updated = Date.parse(record.updated_at);
    if (!Number.isFinite(updated)) return [];
    const age = Math.max(0, Math.floor((now.getTime() - updated) / 86400000));
    const expired = !!record.expires_at && Date.parse(record.expires_at) <= now.getTime();
    if (!expired && now.getTime() - updated < staleMs) return [];
    return [{ ...record, reason: expired ? "expired" as const : "not_reviewed_recently" as const, age_days: age }];
  });
  for (let i = 0; i < bounded.length; i += 1) {
    for (let j = i + 1; j < bounded.length; j += 1) {
      const first = bounded[i], second = bounded[j];
      const sameKey = normalize(first.memory_key) === normalize(second.memory_key);
      const firstValue = normalize(first.value), secondValue = normalize(second.value);
      if (sameKey && firstValue !== secondValue) {
        conflicts.push({ first, second, shared_terms: [], similarity: 1, reason: "same_key_different_value" });
        continue;
      }
      const a = tokens(first.memory_key + " " + first.value);
      const b = tokens(second.memory_key + " " + second.value);
      const shared = [...a].filter((word) => b.has(word)).sort();
      const union = new Set([...a, ...b]).size;
      const similarity = union ? shared.length / union : 0;
      if (shared.length >= 2 && similarity >= 0.3) {
        related.push({ first, second, shared_terms: shared.slice(0, 8), similarity, reason: "related_content" });
      }
    }
  }
  const sortPairs = (a: MemoryInsightPair, b: MemoryInsightPair) => b.similarity - a.similarity;
  return {
    possible_conflicts: conflicts.sort(sortPairs).slice(0, pairLimit),
    related: related.sort(sortPairs).slice(0, pairLimit),
    outdated: outdated.sort((a, b) => b.age_days - a.age_days).slice(0, 50),
    analyzed_records: bounded.length,
    inference_calls: 0,
  };
}
