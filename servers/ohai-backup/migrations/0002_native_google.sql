ALTER TABLE oauth_flows ADD COLUMN native_challenge TEXT;

CREATE TABLE native_oauth_handoffs (
  code_hash TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX native_oauth_handoffs_expiry ON native_oauth_handoffs(expires_at);
