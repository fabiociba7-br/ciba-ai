import { describe, expect, it } from "vitest";
import { evaluateKnowledge, isKnowledgeCurrent, recordKnowledgeOutcome, learnFromResearch, type ResearchLearningEntry, type ResearchKnowledgeRepository, type KnowledgeRecord } from "../src/core/knowledge-learning";

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

describe("research always creates a cumulative learning record", () => {
  const source = { reference: "https://docs.example.test/api", title: "Official API docs", publisher: "Example", publishedAt: "2026-11-17T00:00:00Z", accessedAt: "2026-11-18T00:00:00Z", evidenceKind: "official" as const };
  function repository() {
    const records: ResearchLearningEntry[] = [];
    const fingerprints: string[] = [];
    const store: ResearchKnowledgeRepository = {
      async findByFingerprint(fingerprint) { return records.find((_, i) => fingerprints[i] === fingerprint) ?? null; },
      async save(entry, fingerprint) { records.push(entry); fingerprints.push(fingerprint); },
    };
    return { store, records };
  }
  it("stores a new research result with sources and insights", async () => {
    const repo = repository();
    const result = await learnFromResearch({
      id: "research-1", query: "How does API X work?", topic: "API X",
      sources: [source], findings: ["Accepts JSON input"], newInsights: ["Can implement a compatible local endpoint"],
      now: "2026-11-18T12:00:00Z",
    }, repo.store);
    expect(result).toMatchObject({ status: "new", confidence: 0.85 });
    expect(repo.records).toHaveLength(1);
    expect(repo.records[0].sources[0].reference).toBe(source.reference);
    expect(repo.fingerprints[0]).toMatch(/^[a-f0-9]{64}$/);
  });
  it("retains repeated research events instead of discarding them", async () => {
    const repo = repository();
    const input = { id: "research-2", query: "API X", topic: "API X", sources: [source], findings: ["Accepts JSON input"], newInsights: ["Can implement a compatible local endpoint"], now: "2026-11-18T12:00:00Z" };
    await learnFromResearch(input, repo.store);
    const repeat = await learnFromResearch({ ...input, id: "research-3" }, repo.store);
    expect(repeat.status).toBe("duplicate");
    expect(repo.records).toHaveLength(2);
  });
  it("stores uncertain research as a candidate rather than treating it as verified", async () => {
    const repo = repository();
    const result = await learnFromResearch({
      id: "research-4", query: "Community workaround", topic: "Build issue",
      sources: [{ ...source, evidenceKind: "secondary" }], findings: ["Possible workaround"],
      newInsights: [], uncertainties: ["Not tested"],
    }, repo.store);
    expect(result).toMatchObject({ status: "needs_verification", confidence: 0.45 });
    expect(repo.records).toHaveLength(1);
  });
});
