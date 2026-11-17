-- Bind one verified Facebook identity to one existing active owner.
-- Access tokens are never stored; only the Meta-verified numeric user ID is retained.
CREATE TABLE IF NOT EXISTS owner_facebook_links (
  owner_id TEXT NOT NULL PRIMARY KEY,
  facebook_user_id TEXT NOT NULL UNIQUE,
  linked_at TEXT NOT NULL,
  FOREIGN KEY(owner_id) REFERENCES owners(owner_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_owner_facebook_links_linked_at
  ON owner_facebook_links(linked_at);
