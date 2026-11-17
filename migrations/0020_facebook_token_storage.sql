-- Store Facebook credentials only as authenticated AES-GCM ciphertext.
-- The encryption key is derived from the server-only FACEBOOK_APP_SECRET using HKDF.
ALTER TABLE owner_facebook_links ADD COLUMN token_ciphertext TEXT;
ALTER TABLE owner_facebook_links ADD COLUMN token_iv TEXT;
ALTER TABLE owner_facebook_links ADD COLUMN token_salt TEXT;
ALTER TABLE owner_facebook_links ADD COLUMN token_expires_at TEXT;
ALTER TABLE owner_facebook_links ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE owner_facebook_links ADD COLUMN profile_json TEXT NOT NULL DEFAULT '{}';
