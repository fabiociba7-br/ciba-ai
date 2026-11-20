import type { ResearchKnowledgeRepository, ResearchLearningEntry } from "./knowledge-learning";

type D1ResearchRow = {
  id: string;
  query_text: string;
  topic: string;
  outcome: ResearchLearningEntry["status"];
  confidence: number;
  findings_json: string;
  insights_json: string;
  uncertainties_json: string;
  reusable_procedure: string | null;
  created_at: string;
};

type D1SourceRow = {
  reference: string;
  title: string;
  publisher: string;
  published_at: string | null;
  accessed_at: string;
  evidence_kind: ResearchLearningEntry["sources"][number]["evidenceKind"];
};

export interface D1ResearchRepositoryOptions {
  namespace?: string;
}

const parseArray = (value: unknown): string[] => {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

const validText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

function validateEntry(entry: ResearchLearningEntry): void {
  if (!entry || !validText(entry.id, 200) || !validText(entry.query, 500) ||
      !validText(entry.topic, 200) || !Number.isFinite(Date.parse(entry.discoveredAt)) ||
      !Array.isArray(entry.sources) || entry.sources.length > 20 ||
      !Array.isArray(entry.findings) || !Array.isArray(entry.newInsights) ||
      !Array.isArray(entry.uncertainties) ||
      !["new", "duplicate", "needs_verification"].includes(entry.status) ||
      !Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1 ||
      !(entry.reusableProcedure === null || validText(entry.reusableProcedure, 4_000))) {
    throw new Error("invalid_research_repository_record");
  }
  for (const source of entry.sources) {
    if (!validText(source.reference, 2_000) || !validText(source.title, 500) ||
        !validText(source.publisher, 300) ||
        !(source.publishedAt === null || Number.isFinite(Date.parse(source.publishedAt))) ||
        !Number.isFinite(Date.parse(source.accessedAt)) ||
        !["official", "primary", "tested", "secondary"].includes(source.evidenceKind)) {
      throw new Error("invalid_research_repository_source");
    }
  }
}

/** D1-backed research journal. Each event and its evidence are committed atomically. */
export function createD1ResearchKnowledgeRepository(
  db: D1Database,
  options: D1ResearchRepositoryOptions = {},
): ResearchKnowledgeRepository {
  const namespace = options.namespace ?? "garcia:technical";
  if (!validText(namespace, 120)) throw new Error("invalid_research_repository_namespace");

  return {
    async findByFingerprint(fingerprint) {
      if (!validText(fingerprint, 8_000)) return null;
      const row = await db.prepare(`
        SELECT id, query_text, topic, outcome, confidence, findings_json,
          insights_json, uncertainties_json, reusable_procedure, created_at
        FROM garcia_research_events
        WHERE namespace = ? AND fingerprint = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).bind(namespace, fingerprint).first<D1ResearchRow>();
      if (!row) return null;
      const sourceRows = await db.prepare(`
        SELECT s.reference, s.title, s.publisher, s.published_at, s.accessed_at, s.evidence_kind
        FROM garcia_research_sources s
        WHERE s.research_event_id = ?
        ORDER BY s.accessed_at ASC
      `).bind(row.id).all<D1SourceRow>();
      return {
        id: row.id,
        query: row.query_text,
        topic: row.topic,
        discoveredAt: row.created_at,
        sources: (sourceRows.results || []).map((source) => ({
          reference: source.reference,
          title: source.title,
          publisher: source.publisher,
          publishedAt: source.published_at,
          accessedAt: source.accessed_at,
          evidenceKind: source.evidence_kind,
        })),
        findings: parseArray(row.findings_json),
        newInsights: parseArray(row.insights_json),
        uncertainties: parseArray(row.uncertainties_json),
        reusableProcedure: row.reusable_procedure,
        status: row.outcome,
        confidence: Number(row.confidence),
      };
    },

    async save(entry, fingerprint) {
      if (!validText(fingerprint, 8_000)) throw new Error("invalid_research_repository_record");
      validateEntry(entry);
      const statements = [
        db.prepare(`
          INSERT INTO garcia_research_events (
            id, namespace, query_text, topic, fingerprint, outcome, confidence,
            findings_json, insights_json, uncertainties_json, reusable_procedure, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          entry.id, namespace, entry.query, entry.topic, fingerprint, entry.status,
          entry.confidence, JSON.stringify(entry.findings), JSON.stringify(entry.newInsights),
          JSON.stringify(entry.uncertainties), entry.reusableProcedure, entry.discoveredAt,
        ),
        ...entry.sources.map((source, index) => db.prepare(`
          INSERT INTO garcia_research_sources (
            id, research_event_id, reference, title, publisher, published_at,
            accessed_at, evidence_kind
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          `${entry.id}:source:${index}`, entry.id, source.reference,
          source.title, source.publisher, source.publishedAt,
          source.accessedAt, source.evidenceKind,
        )),
      ];
      await db.batch(statements);
    },
  };
}
