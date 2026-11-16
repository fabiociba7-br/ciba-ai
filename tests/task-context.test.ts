import { describe, expect, it } from "vitest";
import { buildTaskContextPackage } from "../src/core/task-context";
import type { MemorySearchRecord } from "../src/core/memory-retrieval";

const record = (id: string, key: string, value: string, updated = "2026-11-15T10:00:00.000Z"): MemorySearchRecord => ({
  memory_id: id,
  scope: "app",
  source_app_id: "com.example.source",
  memory_key: key,
  value,
  created_by_app_id: "com.example.source",
  updated_at: updated,
  expires_at: null,
});

describe("task-aware context package", () => {
  it("selects only relevant curated items and classifies their type", () => {
    const result = buildTaskContextPackage("task-1", "plan", "Organizar projeto e orçamento", [
      record("1", "project_phase", "Projeto em revisão de arquitetura"),
      record("2", "budget_limit", "Orçamento máximo de R$ 500"),
      record("3", "favorite_music", "Gosta de rock clássico"),
    ]);
    expect(result?.items).toHaveLength(2);
    expect(result?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "project_phase", kind: "project", origin: "curated_memory" }),
      expect.objectContaining({ key: "budget_limit", kind: "constraint", origin: "curated_memory" }),
    ]));
    expect(result?.conversation_history_included).toBe(false);
  });

  it("collapses exact duplicate memories before selecting context", () => {
    const result = buildTaskContextPackage("task-2", "summarize", "Resumir preferências de resposta", [
      record("older", "response_style", "Prefere respostas diretas", "2026-11-14T10:00:00.000Z"),
      { ...record("newer", "response_style", "PREFERE respostas diretas!"), source_app_id: "com.example.other" },
    ]);
    expect(result?.items).toHaveLength(1);
  });

  it("returns no package when no authorized memory matches the task", () => {
    expect(buildTaskContextPackage("task-3", "translate", "Traduzir documento técnico", [
      record("1", "music", "Gosta de jazz"),
    ])).toBeNull();
  });

  it("keeps the package bounded to five entries", () => {
    const records = Array.from({ length: 8 }, (_, i) =>
      record(String(i), `project_${i}`, `Projeto etapa arquitetura ${i}`)
    );
    expect(buildTaskContextPackage("task-4", "plan", "Planejar projeto arquitetura", records)?.items).toHaveLength(5);
  });
});
