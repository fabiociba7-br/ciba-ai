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

/**
 * D1-backed research journal. The research event is durable even when it is
 * inconclusive or a duplicate; source records are committed in the same batch.
 */
export function createD1ResearchKnowledgeRepository(db: D1Database): ResearchKnowledgeRepository {
  return {
    async findByFingerprint(fingerprint) {
      if (typeof fingerprint !== "string" || !fingerprint.trim() || fingerprint.length > 8_000) {
        return null;
      }
      const row = await db.prepare(`
        SELECT id, query_text, topic, outcome, confidence, findings_json,
          insights_json, uncertainties_json, created_at
        FROM garcia_research_events
        WHERE fingerprint = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).bind(fingerprint).first<D1ResearchRow>();
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
        reusableProcedure: null,
        status: row.outcome,
        confidence: Number(row.confidence),
      };
    },

    async save(entry, fingerprint) {
      if (!entry || typeof fingerprint !== "string" || !fingerprint.trim() || fingerprint.length > 8_000) {
        throw new Error("invalid_research_repository_record");
      }
      const statements = [
        db.prepare(`
          INSERT INTO garcia_research_events (
            id, namespace, query_text, topic, fingerprint, outcome, confidence,
            findings_json, insights_json, uncertainties_json, created_at
          ) VALUES (?, 'garcia:technical', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          entry.id, entry.query, entry.topic, fingerprint, entry.status,
          entry.confidence, JSON.stringify(entry.findings),
          JSON.stringify(entry.newInsights), JSON.stringify(entry.uncertainties),
          entry.discoveredAt,
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
