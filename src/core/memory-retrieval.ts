export interface MemorySearchRecord {
  memory_id: string;
  scope: "app" | "owner";
  source_app_id: string | null;
  memory_key: string;
  value: string;
  created_by_app_id: string;
  updated_at: string;
  expires_at: string | null;
}

export interface RankedMemory extends MemorySearchRecord {
  relevance: number;
}

const STOP_WORDS = new Set([
  "a", "ao", "aos", "as", "com", "da", "das", "de", "do", "dos", "e",
  "em", "na", "nas", "no", "nos", "o", "os", "ou", "para", "por",
  "que", "se", "um", "uma", "uns", "umas", "the", "and", "of", "to",
]);

function terms(value: string): string[] {
  return [...new Set(
    value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
      .match(/[a-z0-9]{2,}/g) || []
  )].filter((term) => !STOP_WORDS.has(term)).slice(0, 30);
}

/**
 * Deterministic lexical retrieval. It does not infer meaning or call a model;
 * it only ranks curated records by shared terms and returns matching records.
 */
export function rankRelevantMemories(
  query: string,
  records: MemorySearchRecord[],
  limit = 10,
): RankedMemory[] {
  const queryTerms = terms(query);
  if (queryTerms.length === 0) return [];
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 20);

  return records.map((record) => {
    const keyTerms = new Set(terms(record.memory_key.replace(/[._-]/g, " ")));
    const valueTerms = new Set(terms(record.value));
    let score = 0;
    for (const term of queryTerms) {
      if (keyTerms.has(term)) score += 3;
      if (valueTerms.has(term)) score += 2;
    }
    return { ...record, relevance: score };
  })
    .filter((record) => record.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || b.updated_at.localeCompare(a.updated_at))
    .slice(0, safeLimit);
}
