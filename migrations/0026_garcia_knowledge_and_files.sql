-- Technical knowledge and file metadata are separate from private owner memory.
CREATE TABLE IF NOT EXISTS garcia_knowledge_entries (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  topic TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  summary TEXT NOT NULL,
  content_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'verified', 'stale')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  source_provider TEXT NOT NULL DEFAULT 'cloudflare_d1',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_garcia_knowledge_fingerprint
  ON garcia_knowledge_entries(namespace, fingerprint);
CREATE INDEX IF NOT EXISTS idx_garcia_knowledge_topic
  ON garcia_knowledge_entries(namespace, topic, status);

CREATE TABLE IF NOT EXISTS garcia_research_events (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  query_text TEXT NOT NULL,
  topic TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('new', 'duplicate', 'needs_verification')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  findings_json TEXT NOT NULL,
  insights_json TEXT NOT NULL,
  uncertainties_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_garcia_research_fingerprint
  ON garcia_research_events(namespace, fingerprint, created_at);
CREATE INDEX IF NOT EXISTS idx_garcia_research_topic
  ON garcia_research_events(namespace, topic, created_at);

CREATE TABLE IF NOT EXISTS garcia_research_sources (
  id TEXT PRIMARY KEY,
  research_event_id TEXT NOT NULL REFERENCES garcia_research_events(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  title TEXT NOT NULL,
  publisher TEXT NOT NULL,
  published_at TEXT,
  accessed_at TEXT NOT NULL,
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN ('official', 'primary', 'tested', 'secondary'))
);
CREATE INDEX IF NOT EXISTS idx_garcia_research_sources_event
  ON garcia_research_sources(research_event_id);

-- R2 stores bytes. D1 stores only searchable metadata and object locations.
CREATE TABLE IF NOT EXISTS garcia_file_objects (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  owner_id TEXT,
  app_id TEXT,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL,
  storage_provider TEXT NOT NULL CHECK (storage_provider IN ('cloudflare_r2', 'turso', 'neon')),
  bucket_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'available', 'failed', 'deleted')),
  source TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_garcia_file_namespace
  ON garcia_file_objects(namespace, status, created_at);
CREATE INDEX IF NOT EXISTS idx_garcia_file_owner_app
  ON garcia_file_objects(owner_id, app_id, status);
CREATE INDEX IF NOT EXISTS idx_garcia_file_hash
  ON garcia_file_objects(namespace, sha256);

CREATE TABLE IF NOT EXISTS garcia_file_relations (
  file_id TEXT NOT NULL REFERENCES garcia_file_objects(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  relation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(file_id, relation_type, relation_id)
);
CREATE INDEX IF NOT EXISTS idx_garcia_file_relations_target
  ON garcia_file_relations(relation_type, relation_id);
