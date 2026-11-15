-- Per-owner feature controls. All optional capabilities default to disabled.
CREATE TABLE IF NOT EXISTS owner_settings (
  owner_id TEXT PRIMARY KEY REFERENCES owners(owner_id) ON DELETE CASCADE,
  memory_enabled INTEGER NOT NULL DEFAULT 0 CHECK (memory_enabled IN (0, 1)),
  app_messaging_enabled INTEGER NOT NULL DEFAULT 0 CHECK (app_messaging_enabled IN (0, 1)),
  updated_at TEXT NOT NULL
);
