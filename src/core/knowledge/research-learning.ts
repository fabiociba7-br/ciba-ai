import { isTrustedEvidenceKind, isValidKnowledgeDate, MAX_KNOWLEDGE_TEXT, MAX_KNOWLEDGE_EVIDENCE } from "./knowledge-records";
import type { KnowledgeEvidenceKind } from "./knowledge-records";

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
      !input.query?.trim() || !input.topic?.trim() || !isValidKnowledgeDate(now)) {
    throw new Error("invalid_research_learning_input");
  }
  const sources = Array.isArray(input.sources) ? input.sources.filter((source) =>
    !!source && typeof source.reference === "string" && !!source.reference.trim() &&
    typeof source.title === "string" && typeof source.publisher === "string" &&
    validDate(source.accessedAt) &&
    (source.publishedAt === null || validDate(source.publishedAt)) &&
    isTrustedEvidenceKind(source.evidenceKind)).slice(0, MAX_KNOWLEDGE_EVIDENCE) : [];
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
    reusableProcedure: typeof input.reusableProcedure === "string" ? input.reusableProcedure.slice(0, MAX_KNOWLEDGE_TEXT) : null,
    status: existing ? "duplicate" : hasStrongEvidence && uncertainties.length === 0 ? "new" : "needs_verification",
    confidence: existing ? existing.confidence : hasStrongEvidence && uncertainties.length === 0 ? 0.85 : sources.length ? 0.45 : 0.1,
  };
  // Persist every research event, including repeats, so later research can refine or challenge prior knowledge.
  await repository.save(entry, fingerprint);
  return entry;
}
