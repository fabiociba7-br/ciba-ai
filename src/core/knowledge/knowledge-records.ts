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

export const MAX_KNOWLEDGE_TEXT = 4_000;
export const MAX_KNOWLEDGE_EVIDENCE = 20;
export const TRUSTED_KINDS = new Set<KnowledgeEvidenceKind>(["official", "primary", "tested", "secondary"]);

export function isValidKnowledgeDate(value: unknown): value is string {
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
      typeof input.summary !== "string" || !input.summary.trim() || input.summary.length > MAX_KNOWLEDGE_TEXT ||
      !(input.procedure === undefined || input.procedure === null ||
        (typeof input.procedure === "string" && input.procedure.length <= MAX_KNOWLEDGE_TEXT)) ||
      typeof input.tested !== "boolean" || !isValidKnowledgeDate(now) ||
      !Array.isArray(input.evidence) || input.evidence.length > MAX_KNOWLEDGE_EVIDENCE) {
    return { status: "candidate", confidence: 0, reusable: false, reason: "invalid_record" };
  }

  const seen = new Set<string>();
  const evidence = input.evidence.filter((item) => {
    if (!item || typeof item !== "object" || !TRUSTED_KINDS.has(item.kind) ||
        typeof item.reference !== "string" || !item.reference.trim() ||
        item.reference.length > 2_000 || !isValidKnowledgeDate(item.checkedAt)) return false;
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
    isValidKnowledgeDate(record.validatedAt) &&
    isValidKnowledgeDate(now) &&
    (record.expiresAt === null || (isValidKnowledgeDate(record.expiresAt) && Date.parse(record.expiresAt) > Date.parse(now)));
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

export const isTrustedEvidenceKind = (kind: KnowledgeEvidenceKind) => TRUSTED_KINDS.has(kind);
