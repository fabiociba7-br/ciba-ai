import type { MemoryInsightRecord } from "./memory-insights";

export type OwnerProfileCategory =
  | "preferences" | "communication" | "work" | "interests"
  | "routines" | "personal_context" | "other";

export interface OwnerProfileEntry extends MemoryInsightRecord {
  category: OwnerProfileCategory;
}

const CATEGORY_RULES: Array<[OwnerProfileCategory, string[]]> = [
  ["communication", ["communication", "response", "style", "language", "tone", "resposta", "idioma", "tom", "comunicacao"]],
  ["interests", ["interest", "music", "sport", "hobby", "interesse", "musica", "esporte", "hobby"]],
  ["work", ["work", "job", "business", "project", "trabalho", "profissao", "empresa", "projeto"]],
  ["preferences", ["preference", "prefer", "gosto", "prefiro", "favorit", "preferencia"]],
  ["routines", ["routine", "schedule", "habit", "rotina", "horario", "habito"]],
  ["personal_context", ["personal", "family", "location", "family", "pessoal", "familia", "local", "cidade"]],
];

const STOP = new Set([
  "a","as","o","os","de","da","do","das","dos","e","em","no","na","nos","nas",
  "para","por","com","que","um","uma","uns","umas","the","and","of","to","is",
  "meu","minha","seu","sua","sobre","mais","muito","muita","ser","ter","são","prefere","preferem",
]);

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, " ").trim();
}

function categoryFor(key: string): OwnerProfileCategory {
  const normalized = normalize(key);
  for (const [category, markers] of CATEGORY_RULES) {
    if (markers.some((marker) => normalized.includes(normalize(marker)))) return category;
  }
  return "other";
}

function preferenceTerms(value: string): string[] {
  return [...new Set(normalize(value).split(/\s+/).filter((word) => word.length >= 4 && !STOP.has(word)))];
}

/**
 * Builds a private, deterministic owner profile from already-authorized curated
 * memories. It never infers sensitive traits, writes records, or calls a model.
 */
export function buildOwnerProfile(
  records: MemoryInsightRecord[],
  now = new Date(),
): {
  profile: Record<OwnerProfileCategory, OwnerProfileEntry[]>;
  recurring_preferences: Array<{ term: string; occurrences: number; memory_ids: string[]; memory_keys: string[] }>;
  review_suggestions: Array<{
    type: "possible_conflict" | "stale_memory";
    memory_ids: string[];
    memory_keys: string[];
    reason: string;
    requires_owner_confirmation: true;
  }>;
  analyzed_records: number;
  inference_calls: 0;
  automatic_changes: false;
} {
  const active = records.slice(0, 200).filter((record) =>
    !record.expires_at || !Number.isFinite(Date.parse(record.expires_at)) || Date.parse(record.expires_at) > now.getTime()
  );
  const profile = {
    preferences: [], communication: [], work: [], interests: [],
    routines: [], personal_context: [], other: [],
  } as Record<OwnerProfileCategory, OwnerProfileEntry[]>;
  for (const record of active) profile[categoryFor(record.memory_key)].push({
    ...record, category: categoryFor(record.memory_key),
  });
  for (const entries of Object.values(profile)) entries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  const termMap = new Map<string, Map<string, { memory_id: string; memory_key: string }>>();
  for (const record of active) {
    for (const term of preferenceTerms(record.value)) {
      if (!termMap.has(term)) termMap.set(term, new Map());
      termMap.get(term)!.set(record.memory_id, { memory_id: record.memory_id, memory_key: record.memory_key });
    }
  }
  const recurring_preferences = [...termMap.entries()]
    .filter(([, sources]) => sources.size >= 2)
    .map(([term, sources]) => ({
      term, occurrences: sources.size,
      memory_ids: [...sources.values()].map((source) => source.memory_id).sort(),
      memory_keys: [...sources.values()].map((source) => source.memory_key).sort(),
    }))
    .sort((a, b) => b.occurrences - a.occurrences || a.term.localeCompare(b.term))
    .slice(0, 30);

  const review_suggestions: Array<{
    type: "possible_conflict" | "stale_memory";
    memory_ids: string[];
    memory_keys: string[];
    reason: string;
    requires_owner_confirmation: true;
  }> = [];
  const byKey = new Map<string, MemoryInsightRecord[]>();
  for (const record of active) {
    const key = normalize(record.memory_key);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(record);
  }
  for (const matches of byKey.values()) {
    const distinctValues = new Set(matches.map((item) => normalize(item.value)));
    if (matches.length > 1 && distinctValues.size > 1) {
      review_suggestions.push({
        type: "possible_conflict",
        memory_ids: matches.map((item) => item.memory_id),
        memory_keys: matches.map((item) => item.memory_key),
        reason: "Há registros autorizados com a mesma chave e valores diferentes. Compare as fontes e decida qual informação manter.",
        requires_owner_confirmation: true,
      });
    }
  }
  for (const record of records.slice(0, 200)) {
    const updated = Date.parse(record.updated_at);
    const expired = !!record.expires_at && Date.parse(record.expires_at) <= now.getTime();
    const stale = Number.isFinite(updated) && now.getTime() - updated >= 180 * 86400000;
    if (expired || stale) review_suggestions.push({
      type: "stale_memory",
      memory_ids: [record.memory_id],
      memory_keys: [record.memory_key],
      reason: expired ? "Esta memória expirou. Confirme se ainda deve ser considerada." : "Esta memória não é revisada há pelo menos 180 dias. Confirme se continua válida.",
      requires_owner_confirmation: true,
    });
  }
  return {
    profile,
    recurring_preferences,
    review_suggestions: review_suggestions.slice(0, 50),
    analyzed_records: records.slice(0, 200).length,
    inference_calls: 0,
    automatic_changes: false,
  };
}
