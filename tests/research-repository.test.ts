import { describe, expect, it } from "vitest";
import { createD1ResearchKnowledgeRepository } from "../src/core/research-repository";
import type { ResearchLearningEntry } from "../src/core/knowledge-learning";

function fakeD1() {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  let batchSize = 0;
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
      batchSize = statements.length;
      return [];
    },
  };
  return { db: db as unknown as D1Database, calls, getBatchSize: () => batchSize };
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
  reusableProcedure: "Validar entrada e responder conforme o contrato.",
  status: "new",
  confidence: 0.85,
};

describe("D1 research repository", () => {
  it("persists a research event and its source records in one batch", async () => {
    const { db, getBatchSize } = fakeD1();
    const repository = createD1ResearchKnowledgeRepository(db);
    await repository.save(entry, "api-fingerprint");
    expect(getBatchSize()).toBe(2);
  });

  it("scopes fingerprint lookup to the configured knowledge namespace", async () => {
    const { db, calls } = fakeD1();
    const repository = createD1ResearchKnowledgeRepository(db, { namespace: "garcia:apis" });
    await repository.findByFingerprint("api-fingerprint");
    expect(calls[0].values).toEqual(["garcia:apis", "api-fingerprint"]);
    expect(calls[0].sql).toContain("namespace = ? AND fingerprint = ?");
  });

  it("rejects invalid namespaces and research records", async () => {
    const { db } = fakeD1();
    expect(() => createD1ResearchKnowledgeRepository(db, { namespace: " " })).toThrow("invalid_research_repository_namespace");
    const repository = createD1ResearchKnowledgeRepository(db);
    await expect(repository.save(entry, "")).rejects.toThrow("invalid_research_repository_record");
    await expect(repository.save({ ...entry, confidence: 1.5 }, "api-fingerprint")).rejects.toThrow("invalid_research_repository_record");
    await expect(repository.findByFingerprint("x".repeat(8_001))).resolves.toBeNull();
  });
});
