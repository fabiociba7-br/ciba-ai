PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS visual_sessions (
  session_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(owner_id),
  app_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  topic TEXT NOT NULL CHECK (length(topic) BETWEEN 3 AND 300),
  mode TEXT NOT NULL DEFAULT 'generate' CHECK (mode IN ('generate', 'search')),
  current_iteration INTEGER NOT NULL DEFAULT 0 CHECK (current_iteration >= 0),
  latest_image_r2_key TEXT,
  prompt_history TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(prompt_history)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visual_sessions_owner_updated ON visual_sessions(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS visual_assets (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES visual_sessions(session_id) ON DELETE CASCADE,
  iteration INTEGER NOT NULL CHECK (iteration >= 0),
  r2_key TEXT NOT NULL UNIQUE,
  image_url TEXT NOT NULL,
  prompt_used TEXT NOT NULL,
  vision_analysis TEXT NOT NULL,
  user_feedback TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('generated', 'reference_search', 'edited')),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  created_at TEXT NOT NULL,
  UNIQUE(session_id, iteration)
);
CREATE INDEX IF NOT EXISTS idx_visual_assets_session_created ON visual_assets(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research_artifacts (
  artifact_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES owners(owner_id),
  app_id TEXT NOT NULL,
  report_json_r2_key TEXT NOT NULL,
  report_md_r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_artifacts_owner_created ON research_artifacts(owner_id, created_at DESC);
