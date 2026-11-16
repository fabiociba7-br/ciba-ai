export type MemoryProposalClassification = "new" | "unchanged" | "possible_conflict";

export interface ExistingMemoryValue {
  memory_id: string;
  value: string;
}

export function classifyMemoryProposal(
  proposedValue: string,
  existing: ExistingMemoryValue | null,
): { classification: MemoryProposalClassification; existing_memory_id: string | null; existing_value_snapshot: string | null } {
  if (!existing) return { classification: "new", existing_memory_id: null, existing_value_snapshot: null };
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "");
  const same = normalize(proposedValue) === normalize(existing.value);
  return {
    classification: same ? "unchanged" : "possible_conflict",
    existing_memory_id: existing.memory_id,
    existing_value_snapshot: existing.value,
  };
}

/** This helper only classifies proposals; it never decides or writes memory. */
