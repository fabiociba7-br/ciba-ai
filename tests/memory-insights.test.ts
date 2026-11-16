import { describe, expect, it } from "vitest";
import { analyzeMemoryRelationships, type MemoryInsightRecord } from "../src/core/memory-insights";

const record = (memory_id: string, memory_key: string, value: string, updated_at = "2026-10-01T00:00:00.000Z", expires_at: string | null = null): MemoryInsightRecord => ({
  memory_id, memory_key, value, updated_at, expires_at, scope: "app", source_app_id: "com.example.one",
});

describe("deterministic memory relationship analysis", () => {
  it("flags same-key values as possible conflicts without choosing a winner", () => {
    const result = analyzeMemoryRelationships([
      record("a", "food.preference", "Prefere café"),
      { ...record("b", "food.preference", "Prefere chá"), source_app_id: "com.example.two" },
    ], new Date("2026-11-01T00:00:00.000Z"));
    expect(result.possible_conflicts).toHaveLength(1);
    expect(result.possible_conflicts[0].reason).toBe("same_key_different_value");
    expect(result.inference_calls).toBe(0);
  });

  it("finds related records by shared terms across apps", () => {
    const result = analyzeMemoryRelationships([
      record("a", "music.preference", "Gosta de jazz e blues"),
      { ...record("b", "music.events", "Shows de jazz e blues em Curitiba"), source_app_id: "com.example.two" },
    ], new Date("2026-11-01T00:00:00.000Z"));
    expect(result.related.length).toBeGreaterThan(0);
    expect(result.related[0].shared_terms).toContain("jazz");
  });

  it("marks expired and old memories for review without modifying them", () => {
    const result = analyzeMemoryRelationships([
      record("expired", "old.fact", "Valor expirado", "2026-10-01T00:00:00.000Z", "2026-10-15T00:00:00.000Z"),
      record("old", "old.note", "Informação antiga", "2025-01-01T00:00:00.000Z"),
      record("fresh", "fresh.note", "Informação recente", "2026-10-30T00:00:00.000Z"),
    ], new Date("2026-11-01T00:00:00.000Z"));
    expect(result.outdated.map((item) => item.memory_id)).toEqual(["old", "expired"]);
    expect(result.analyzed_records).toBe(3);
  });

  it("caps the number of analyzed records and never emits more than 30 pairs", () => {
    const records = Array.from({ length: 205 }, (_, i) => record(String(i), "same.key", "different value " + i));
    const result = analyzeMemoryRelationships(records, new Date("2026-11-01T00:00:00.000Z"), 180, 100);
    expect(result.analyzed_records).toBe(200);
    expect(result.possible_conflicts.length).toBeLessThanOrEqual(30);
  });
});
