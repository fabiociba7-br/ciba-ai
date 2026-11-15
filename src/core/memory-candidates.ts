import { validateCuratedMemory } from "./memory";

export interface MemoryCandidateInput {
  sourceRole: unknown;
  sourceText: unknown;
  key: unknown;
  value: unknown;
}

export interface PreparedMemoryCandidate {
  key: string;
  value: string;
  evidence_excerpt: string;
  source_role: "user";
  requires_confirmation: true;
  persisted: false;
}

/** Prepare a quote-backed candidate only; this function never writes storage. */
export function prepareMemoryCandidate(input: MemoryCandidateInput): PreparedMemoryCandidate {
  if (input.sourceRole !== "user") throw new Error("memory_candidate_user_source_required");
  if (typeof input.sourceText !== "string" || input.sourceText.trim().length < 2 || input.sourceText.length > 2_000) {
    throw new Error("invalid_memory_candidate_source");
  }
  const key = typeof input.key === "string" ? input.key.trim() : "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(key)) {
    throw new Error("invalid_memory_key");
  }
  const value = validateCuratedMemory({
    consent: "curated",
    value: typeof input.value === "string" ? input.value : "",
    maxCharacters: 500,
  });
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
  if (!normalize(input.sourceText).includes(normalize(value))) {
    throw new Error("memory_candidate_not_supported_by_user_quote");
  }
  return {
    key,
    value,
    evidence_excerpt: value,
    source_role: "user",
    requires_confirmation: true,
    persisted: false,
  };
}
