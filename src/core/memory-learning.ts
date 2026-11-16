export type MemoryProposalClassification = "new" | "unchanged" | "possible_conflict";

export interface ExistingMemoryValue {
  memory_id: string;
  value: string;
}

export function classifyMemoryProposal(
  proposedValue: string,
  existing: ExistingMemoryValue | null,
): { classification: MemoryProposalClassification; existing_memory_id: string | null; existing_value_snapshot: string | null } {
  if (typeof proposedValue !== "string" || !proposedValue.trim() || proposedValue.length > 500) {
    throw new Error("invalid_memory_proposal");
  }

  let safeExisting: ExistingMemoryValue | null = null;
  if (existing !== null) {
    try {
      if (existing === undefined || typeof existing !== "object" || Array.isArray(existing) ||
          Object.getPrototypeOf(existing) !== Object.prototype) {
        throw new Error("invalid_memory_proposal");
      }
      const descriptors = Object.getOwnPropertyDescriptors(existing);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.length !== 2 || keys.some((key) => key !== "memory_id" && key !== "value")) {
        throw new Error("invalid_memory_proposal");
      }
      const idDescriptor = descriptors.memory_id;
      const valueDescriptor = descriptors.value;
      if (!idDescriptor || !("value" in idDescriptor) || !idDescriptor.enumerable ||
          !valueDescriptor || !("value" in valueDescriptor) || !valueDescriptor.enumerable ||
          typeof idDescriptor.value !== "string" || !idDescriptor.value.trim() ||
          idDescriptor.value.length > 200 || typeof valueDescriptor.value !== "string" ||
          !valueDescriptor.value.trim() || valueDescriptor.value.length > 500) {
        throw new Error("invalid_memory_proposal");
      }
      safeExisting = Object.freeze({
        memory_id: idDescriptor.value,
        value: valueDescriptor.value,
      });
    } catch {
      throw new Error("invalid_memory_proposal");
    }
  }
  if (!safeExisting) return { classification: "new", existing_memory_id: null, existing_value_snapshot: null };
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "");
  const same = normalize(proposedValue) === normalize(safeExisting.value);
  return {
    classification: same ? "unchanged" : "possible_conflict",
    existing_memory_id: safeExisting.memory_id,
    existing_value_snapshot: safeExisting.value,
  };
}

/** This helper only classifies proposals; it never decides or writes memory. */
