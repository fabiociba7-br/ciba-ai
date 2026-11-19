-- Pin durable approvals to the external tool schema used when consent was requested.
ALTER TABLE tool_approvals ADD COLUMN binding_sha256 TEXT
  CHECK (binding_sha256 IS NULL OR length(binding_sha256) = 64);
