import { describe, expect, it } from "vitest";
import { rankRelevantMemories, type MemorySearchRecord } from "../src/core/memory-retrieval";

const records: MemorySearchRecord[] = [
  {
    memory_id: "m1", scope: "app", source_app_id: "app-a",
    memory_key: "response_style", value: "Prefere respostas diretas e objetivas.",
    created_by_app_id: "app-a", updated_at: "2026-01-02T00:00:00.000Z", expires_at: null,
  },
  {
    memory_id: "m2", scope: "owner", source_app_id: null,
    memory_key: "travel_preferences", value: "Prefere viajar de carro e evitar estradas de terra.",
    created_by_app_id: "app-a", updated_at: "2026-01-03T00:00:00.000Z", expires_at: null,
  },
  {
    memory_id: "m3", scope: "app", source_app_id: "app-a",
    memory_key: "music", value: "Gosta de rock clássico e shows ao vivo.",
    created_by_app_id: "app-a", updated_at: "2026-01-04T00:00:00.000Z", expires_at: null,
  },
];

describe("curated memory retrieval ranking", () => {
  it("ranks relevant entries by key and value matches", () => {
    const results = rankRelevantMemories("preferência de resposta direta", records);
    expect(results[0].memory_id).toBe("m1");
    expect(results.map((item) => item.memory_id)).not.toContain("m3");
  });

  it("normalizes Portuguese accents and ignores common stop words", () => {
    const results = rankRelevantMemories("viagem de carro", records);
    expect(results.map((item) => item.memory_id)).toContain("m2");
    expect(rankRelevantMemories("de e para", records)).toEqual([]);
  });

  it("returns no results for unrelated queries and respects result limits", () => {
    expect(rankRelevantMemories("culinária japonesa", records)).toEqual([]);
    expect(rankRelevantMemories("preferências respostas viagem", records, 1)).toHaveLength(1);
  });

  it("uses deterministic tie-breaking by most recently updated record", () => {
    const tied = records.slice(0, 2).map((record) => ({ ...record, memory_key: "preference", value: "favorite" }));
    expect(rankRelevantMemories("favorite", tied).map((item) => item.memory_id)).toEqual(["m2", "m1"]);
  });
});
