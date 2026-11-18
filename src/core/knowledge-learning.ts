export type KnowledgeEvidenceKind = "official" | "primary" | "tested" | "secondary";
export type KnowledgeStatus = "candidate" | "verified" | "stale";

export interface KnowledgeEvidence {
  kind: KnowledgeEvidenceKind;
  reference: string;
  checkedAt: string;
}

export interface KnowledgeRecord {
  id: string;
  topic: string;
  summary: string;
  procedure: string | null;
  evidence: KnowledgeEvidence[];
  status: KnowledgeStatus;
  confidence: number;
  tested: boolean;
  validatedAt: string;
  expiresAt: string | null;
  successCount: number;
  failureCount: number;
}

export interface KnowledgeDecision {
  status: KnowledgeStatus;
  confidence: number;
  reusable: boolean;
  reason: "verified_by_primary_evidence" | "verified_by_test" | "secondary_evidence_only" | "insufficient_evidence" | "invalid_record";
}

const MAX_TEXT = 4_000;
const MAX_EVIDENCE = 20;
const TRUSTED_KINDS = new Set<KnowledgeEvidenceKind>(["official", "primary", "tested", "secondary"]);

function validDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

/**
 * Evaluates whether newly learned information is safe to reuse.
 * Search snippets and model assertions alone are never enough to verify knowledge.
 */
export function evaluateKnowledge(input: {
  topic: string;
  summary: string;
  procedure?: string | null;
  evidence: KnowledgeEvidence[];
  tested: boolean;
  now?: string;
}): KnowledgeDecision {
  const now = input && typeof input === "object" ? input.now ?? new Date().toISOString() : "";
  if (!input || typeof input !== "object" ||
      typeof input.topic !== "string" || !input.topic.trim() || input.topic.length > 200 ||
      typeof input.summary !== "string" || !input.summary.trim() || input.summary.length > MAX_TEXT ||
      !(input.procedure === undefined || input.procedure === null ||
        (typeof input.procedure === "string" && input.procedure.length <= MAX_TEXT)) ||
      typeof input.tested !== "boolean" || !validDate(now) ||
      !Array.isArray(input.evidence) || input.evidence.length > MAX_EVIDENCE) {
    return { status: "candidate", confidence: 0, reusable: false, reason: "invalid_record" };
  }

  const seen = new Set<string>();
  const evidence = input.evidence.filter((item) => {
    if (!item || typeof item !== "object" || !TRUSTED_KINDS.has(item.kind) ||
        typeof item.reference !== "string" || !item.reference.trim() ||
        item.reference.length > 2_000 || !validDate(item.checkedAt)) return false;
    const key = item.kind + "|" + item.reference;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const hasPrimary = evidence.some((item) => item.kind === "official" || item.kind === "primary");
  const hasTestEvidence = input.tested && evidence.some((item) => item.kind === "tested");
  if (hasTestEvidence) {
    return { status: "verified", confidence: 0.98, reusable: true, reason: "verified_by_test" };
  }
  if (hasPrimary) {
    return {
      status: "verified",
      confidence: evidence.some((item) => item.kind === "official") ? 0.95 : 0.9,
      reusable: input.procedure == null,
      reason: "verified_by_primary_evidence",
    };
  }
  if (evidence.some((item) => item.kind === "secondary")) {
    return { status: "candidate", confidence: 0.45, reusable: false, reason: "secondary_evidence_only" };
  }
  return { status: "candidate", confidence: 0, reusable: false, reason: "insufficient_evidence" };
}

/** Returns whether a verified item is still current; expired knowledge must be researched again. */
export function isKnowledgeCurrent(record: KnowledgeRecord, now = new Date().toISOString()): boolean {
  return record.status === "verified" &&
    validDate(record.validatedAt) &&
    validDate(now) &&
    (record.expiresAt === null || (validDate(record.expiresAt) && Date.parse(record.expiresAt) > Date.parse(now)));
}

/** Successful reuse strengthens a procedure; a failed reuse removes its automatic-execution eligibility. */
export function recordKnowledgeOutcome(
  record: KnowledgeRecord,
  outcome: "success" | "failure",
): KnowledgeRecord {
  if (!record || !Number.isSafeInteger(record.successCount) || record.successCount < 0 ||
      !Number.isSafeInteger(record.failureCount) || record.failureCount < 0) {
    throw new Error("invalid_knowledge_record");
  }
  return {
    ...record,
    successCount: record.successCount + (outcome === "success" ? 1 : 0),
    failureCount: record.failureCount + (outcome === "failure" ? 1 : 0),
    ...(outcome === "failure" ? { status: "stale" as const } : {}),
  };
}

export interface ResearchSource {
  reference: string;
  title: string;
  publisher: string;
  publishedAt: string | null;
  accessedAt: string;
  evidenceKind: KnowledgeEvidenceKind;
}

export interface ResearchLearningEntry {
  id: string;
  query: string;
  topic: string;
  discoveredAt: string;
  sources: ResearchSource[];
  findings: string[];
  newInsights: string[];
  uncertainties: string[];
  reusableProcedure: string | null;
  status: "new" | "duplicate" | "needs_verification";
  confidence: number;
}

export interface ResearchKnowledgeRepository {
  findByFingerprint(fingerprint: string): Promise<ResearchLearningEntry | null>;
  save(entry: ResearchLearningEntry, fingerprint: string): Promise<void>;
}

export interface ResearchLearningInput {
  id: string;
  query: string;
  topic: string;
  sources: ResearchSource[];
  findings: string[];
  newInsights: string[];
  uncertainties?: string[];
  reusableProcedure?: string | null;
  now?: string;
}

/** Every completed research operation becomes a durable learning candidate, even when evidence is not yet sufficient. */
export async function learnFromResearch(
  input: ResearchLearningInput,
  repository: ResearchKnowledgeRepository,
): Promise<ResearchLearningEntry> {
  const now = input?.now ?? new Date().toISOString();
  const clean = (values: unknown, max: number): string[] =>
    Array.isArray(values) ? values.filter((v): v is string => typeof v === "string" && !!v.trim() && v.length <= 4_000).slice(0, max) : [];
  if (!input || !repository || typeof repository.findByFingerprint !== "function" ||
      typeof repository.save !== "function" || !input.id?.trim() ||
      !input.query?.trim() || !input.topic?.trim() || !validDate(now)) {
    throw new Error("invalid_research_learning_input");
  }
  const sources = Array.isArray(input.sources) ? input.sources.filter((source) =>
    !!source && typeof source.reference === "string" && !!source.reference.trim() &&
    typeof source.title === "string" && typeof source.publisher === "string" &&
    validDate(source.accessedAt) &&
    (source.publishedAt === null || validDate(source.publishedAt)) &&
    TRUSTED_KINDS.has(source.evidenceKind)).slice(0, MAX_EVIDENCE) : [];
  const findings = clean(input.findings, 50);
  const newInsights = clean(input.newInsights, 50);
  const uncertainties = clean(input.uncertainties ?? [], 50);
  if (findings.length === 0 && newInsights.length === 0) throw new Error("research_without_findings");
  const normalized = [input.topic, ...findings, ...newInsights].join("|").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  // Stable deterministic fingerprint avoids learning the exact same finding repeatedly.
  const fingerprint = normalized;
  const existing = await repository.findByFingerprint(fingerprint);
  const hasStrongEvidence = sources.some((source) => source.evidenceKind === "official" || source.evidenceKind === "primary");
  const entry: ResearchLearningEntry = {
    id: input.id,
    query: input.query.slice(0, 500),
    topic: input.topic.slice(0, 200),
    discoveredAt: now,
    sources,
    findings,
    newInsights,
    uncertainties,
    reusableProcedure: typeof input.reusableProcedure === "string" ? input.reusableProcedure.slice(0, MAX_TEXT) : null,
    status: existing ? "duplicate" : hasStrongEvidence && uncertainties.length === 0 ? "new" : "needs_verification",
    confidence: existing ? existing.confidence : hasStrongEvidence && uncertainties.length === 0 ? 0.85 : sources.length ? 0.45 : 0.1,
  };
  if (!existing) await repository.save(entry, fingerprint);
  return entry;
}
