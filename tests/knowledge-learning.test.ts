import { describe, expect, it } from "vitest";
import { evaluateKnowledge, isKnowledgeCurrent, recordKnowledgeOutcome, type KnowledgeRecord } from "../src/core/knowledge-learning";

describe("cumulative knowledge validation", () => {
  it("does not learn a model assertion without evidence", () => {
    expect(evaluateKnowledge({ topic: "X", summary: "Y", evidence: [], tested: false }))
      .toMatchObject({ status: "candidate", reusable: false, reason: "insufficient_evidence" });
  });

  it("keeps secondary-only findings as candidates", () => {
    expect(evaluateKnowledge({
      topic: "Setup", summary: "Use option A",
      evidence: [{ kind: "secondary", reference: "https://example.test", checkedAt: "2026-11-18T00:00:00Z" }],
      tested: false,
    })).toMatchObject({ status: "candidate", confidence: 0.45, reusable: false });
  });

  it("verifies facts supported by official sources", () => {
    expect(evaluateKnowledge({
      topic: "API", summary: "Endpoint contract",
      evidence: [{ kind: "official", reference: "https://docs.example.test", checkedAt: "2026-11-18T00:00:00Z" }],
      tested: false,
    })).toMatchObject({ status: "verified", reusable: true, confidence: 0.95 });
  });

  it("only makes a procedure reusable after an actual successful test", () => {
    const base = {
      topic: "Build", summary: "Build procedure", procedure: "Run test command",
      evidence: [{ kind: "official" as const, reference: "https://docs.example.test", checkedAt: "2026-11-18T00:00:00Z" }],
    };
    expect(evaluateKnowledge({ ...base, tested: false }).reusable).toBe(false);
    expect(evaluateKnowledge({
      ...base, tested: true,
      evidence: [...base.evidence, { kind: "tested", reference: "test-run:123", checkedAt: "2026-11-18T00:00:00Z" }],
    })).toMatchObject({ status: "verified", reusable: true, confidence: 0.98 });
  });

  it("expires old knowledge and invalidates a procedure after failure", () => {
    const record: KnowledgeRecord = {
      id: "k1", topic: "Build", summary: "Build", procedure: "Build command",
      evidence: [{ kind: "tested", reference: "run:1", checkedAt: "2026-11-17T00:00:00Z" }],
      status: "verified", confidence: 0.98, tested: true,
      validatedAt: "2026-11-17T00:00:00Z", expiresAt: "2026-11-19T00:00:00Z",
      successCount: 0, failureCount: 0,
    };
    expect(isKnowledgeCurrent(record, "2026-11-18T00:00:00Z")).toBe(true);
    expect(isKnowledgeCurrent(record, "2026-11-20T00:00:00Z")).toBe(false);
    expect(recordKnowledgeOutcome(record, "failure")).toMatchObject({ status: "stale", failureCount: 1 });
  });
});
