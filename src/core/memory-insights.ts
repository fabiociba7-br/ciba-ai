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
  const bounded = records.slice(0, 200);
  const conflicts: MemoryInsightPair[] = [];
  const related: MemoryInsightPair[] = [];
  const staleMs = Math.max(1, staleAfterDays) * 86400000;
  const outdated = bounded.flatMap((record) => {
    const updated = Date.parse(record.updated_at);
    if (!Number.isFinite(updated)) return [];
    const age = Math.max(0, Math.floor((now.getTime() - updated) / 86400000));
    const expired = !!record.expires_at && Date.parse(record.expires_at) <= now.getTime();
    if (!expired && now.getTime() - updated < staleMs) return [];
    return [{ ...record, reason: expired ? "expired" as const : "not_reviewed_recently" as const, age_days: age }];
  });
  const seen = new Set<string>();
  for (let i = 0; i < bounded.length; i += 1) {
    for (let j = i + 1; j < bounded.length; j += 1) {
      const first = bounded[i], second = bounded[j];
      const pairId = [first.memory_id, second.memory_id].sort().join(":");
      if (seen.has(pairId)) continue;
      const sameKey = normalize(first.memory_key) === normalize(second.memory_key);
      const firstValue = normalize(first.value), secondValue = normalize(second.value);
      if (sameKey && firstValue !== secondValue) {
        conflicts.push({ first, second, shared_terms: [], similarity: 1, reason: "same_key_different_value" });
        seen.add(pairId);
        continue;
      }
      const a = tokens(first.memory_key + " " + first.value);
      const b = tokens(second.memory_key + " " + second.value);
      const shared = [...a].filter((word) => b.has(word)).sort();
      const union = new Set([...a, ...b]).size;
      const similarity = union ? shared.length / union : 0;
      if (shared.length >= 2 && similarity >= 0.3) {
        related.push({ first, second, shared_terms: shared.slice(0, 8), similarity, reason: "related_content" });
        seen.add(pairId);
      }
    }
  }
  const sortPairs = (a: MemoryInsightPair, b: MemoryInsightPair) => b.similarity - a.similarity;
  return {
    possible_conflicts: conflicts.sort(sortPairs).slice(0, Math.min(maxPairs, 30)),
    related: related.sort(sortPairs).slice(0, Math.min(maxPairs, 30)),
    outdated: outdated.sort((a, b) => b.age_days - a.age_days).slice(0, 50),
    analyzed_records: bounded.length,
    inference_calls: 0,
  };
}
