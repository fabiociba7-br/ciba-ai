-- Recover abandoned outbox claims and make object deletion retryable.
ALTER TABLE garcia_storage_outbox ADD COLUMN lease_expires_at TEXT;

ALTER TABLE garcia_file_objects ADD COLUMN delete_requested_at TEXT;

CREATE INDEX IF NOT EXISTS idx_garcia_storage_outbox_expired_lease
  ON garcia_storage_outbox(status, lease_expires_at);
