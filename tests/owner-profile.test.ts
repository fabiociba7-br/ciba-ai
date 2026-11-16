import { describe, expect, it } from "vitest";
import { buildOwnerProfile } from "../src/core/owner-profile";
import type { MemoryInsightRecord } from "../src/core/memory-insights";

const record = (memory_id: string, memory_key: string, value: string, updated_at = "2026-10-01T00:00:00.000Z", expires_at: string | null = null): MemoryInsightRecord => ({
  memory_id, memory_key, value, updated_at, expires_at, scope: "app", source_app_id: "com.example.app",
});

describe("deterministic owner profile", () => {
  it("groups authorized memories into useful profile categories", () => {
    const result = buildOwnerProfile([
      record("a", "response_style", "Prefere respostas diretas"),
      record("b", "music_preference", "Gosta de jazz"),
      record("c", "work_project", "Projeto de mobilidade"),
    ], new Date("2026-11-01T00:00:00.000Z"));
    expect(result.profile.communication).toHaveLength(1);
    expect(result.profile.interests).toHaveLength(1);
    expect(result.profile.work).toHaveLength(1);
    expect(result.automatic_changes).toBe(false);
  });

  it("finds recurring terms only when supported by distinct memories", () => {
    const result = buildOwnerProfile([
      record("a", "response_style", "Prefere respostas diretas e objetivas"),
      record("b", "work_style", "Prefere respostas diretas e objetivas"),
      record("c", "other", "Uma anotação isolada"),
    ], new Date("2026-11-01T00:00:00.000Z"));
    const terms = result.recurring_preferences.map((item) => item.term);
    expect(terms).toContain("diretas");
    expect(terms).toContain("objetivas");
    expect(result.recurring_preferences.every((item) => item.memory_ids.length >= 2)).toBe(true);
  });

  it("suggests owner review for conflicts and old entries without changing memory", () => {
    const result = buildOwnerProfile([
      record("a", "food_preference", "Prefere café"),
      record("b", "food_preference", "Prefere chá"),
      record("c", "old_note", "Confirmar informação antiga", "2025-01-01T00:00:00.000Z"),
      record("d", "expired_note", "Registro expirado", "2026-10-01T00:00:00.000Z", "2026-10-15T00:00:00.000Z"),
    ], new Date("2026-11-01T00:00:00.000Z"));
    expect(result.review_suggestions.some((item) => item.type === "possible_conflict")).toBe(true);
    expect(result.review_suggestions.filter((item) => item.type === "stale_memory")).toHaveLength(2);
    expect(result.review_suggestions.every((item) => item.requires_owner_confirmation)).toBe(true);
    expect(result.inference_calls).toBe(0);
    expect(result.automatic_changes).toBe(false);
  });

  it("excludes expired values from the current profile but keeps review suggestions", () => {
    const result = buildOwnerProfile([
      record("expired", "response_style", "Valor antigo", "2026-10-01T00:00:00.000Z", "2026-10-15T00:00:00.000Z"),
    ], new Date("2026-11-01T00:00:00.000Z"));
    expect(result.profile.communication).toHaveLength(0);
    expect(result.review_suggestions).toHaveLength(1);
  });
});
