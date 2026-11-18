import { describe, expect, it, vi } from "vitest";
import { createD1ResearchKnowledgeRepository } from "../src/core/research-repository";
import type { ResearchLearningEntry } from "../src/core/knowledge-learning";

function fakeD1() {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const values: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) { values.push(...args); return statement; },
        async first() { calls.push({ sql, values: [...values] }); return null; },
        async all() { calls.push({ sql, values: [...values] }); return { results: [] }; },
      };
      return statement;
    },
    async batch(statements: Array<{ sql?: string }>) {
      calls.push(...statements.map((statement) => ({ sql: statement.sql || "batch-statement", values: [] })));
      return [];
    },
  };
  return { db: db as unknown as D1Database, calls };
}

const entry: ResearchLearningEntry = {
  id: "research-1",
  query: "Como funciona uma API?",
  topic: "APIs",
  discoveredAt: "2026-11-18T12:00:00.000Z",
  sources: [{
    reference: "https://example.com/docs",
    title: "Documentação",
    publisher: "Example",
    publishedAt: null,
    accessedAt: "2026-11-18T12:00:00.000Z",
    evidenceKind: "official",
  }],
  findings: ["A API recebe requisições."],
  newInsights: ["O contrato define entradas e saídas."],
  uncertainties: [],
  reusableProcedure: null,
  status: "new",
  confidence: 0.85,
};

describe("D1 research repository", () => {
  it("persists a research event and its source records in one batch", async () => {
    const { db, calls } = fakeD1();
    const repository = createD1ResearchKnowledgeRepository(db);
    await repository.save(entry, "api-fingerprint");
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toBe("batch-statement");
    expect(calls[0].values).toEqual([]);
  });

  it("returns null when a fingerprint is not yet known", async () => {
    const { db } = fakeD1();
    const repository = createD1ResearchKnowledgeRepository(db);
    await expect(repository.findByFingerprint("unknown")).resolves.toBeNull();
  });

  it("rejects empty or oversized fingerprints", async () => {
    const { db } = fakeD1();
    const repository = createD1ResearchKnowledgeRepository(db);
    await expect(repository.save(entry, "")).rejects.toThrow("invalid_research_repository_record");
    await expect(repository.findByFingerprint("x".repeat(8_001))).resolves.toBeNull();
  });
});
