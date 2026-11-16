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

function snapshotCandidateInput(input: unknown): Record<string, unknown> | null {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input) ||
        Object.getPrototypeOf(input) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    const allowed = new Set(["sourceRole", "sourceText", "key", "value"]);
    if (keys.length !== allowed.size ||
        keys.some((key) => typeof key !== "string" || !allowed.has(key))) return null;
    const result: Record<string, unknown> = Object.create(null);
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

/** Prepare a quote-backed candidate only; this function never writes storage. */
export function prepareMemoryCandidate(input: MemoryCandidateInput): PreparedMemoryCandidate {
  const safeInput = snapshotCandidateInput(input);
  if (!safeInput) throw new Error("invalid_memory_candidate_input");
  if (safeInput.sourceRole !== "user") throw new Error("memory_candidate_user_source_required");
  if (typeof safeInput.sourceText !== "string" ||
      safeInput.sourceText.trim().length < 2 || safeInput.sourceText.length > 2_000) {
    throw new Error("invalid_memory_candidate_source");
  }
  const key = typeof safeInput.key === "string" ? safeInput.key.trim() : "";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(key)) {
    throw new Error("invalid_memory_key");
  }
  const value = validateCuratedMemory({
    consent: "curated",
    value: typeof safeInput.value === "string" ? safeInput.value : "",
    maxCharacters: 500,
  });
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
  if (!normalize(safeInput.sourceText).includes(normalize(value))) {
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
