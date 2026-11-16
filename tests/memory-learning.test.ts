import { describe, expect, it } from "vitest";
import { classifyMemoryProposal } from "../src/core/memory-learning";

describe("owner-reviewed memory learning", () => {
  it("classifies a new fact without an existing record", () => {
    expect(classifyMemoryProposal("Gosta de jazz", null)).toEqual({
      classification: "new", existing_memory_id: null, existing_value_snapshot: null,
    });
  });
  it("recognizes an unchanged value despite accents, case and punctuation", () => {
    expect(classifyMemoryProposal("Prefere café.", {
      memory_id: "m1", value: "PREFERE cafe",
    })).toMatchObject({ classification: "unchanged", existing_memory_id: "m1" });
  });
  it("flags a changed value for owner review instead of deciding which is true", () => {
    expect(classifyMemoryProposal("Prefere respostas curtas", {
      memory_id: "m2", value: "Prefere respostas detalhadas",
    })).toMatchObject({
      classification: "possible_conflict",
      existing_memory_id: "m2",
      existing_value_snapshot: "Prefere respostas detalhadas",
    });
  });
});
