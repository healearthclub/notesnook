CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  deleted_at INTEGER
);

CREATE TABLE identities (
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  PRIMARY KEY (issuer, subject)
);
CREATE INDEX identities_account ON identities(account_id);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  created_at INTEGER NOT NULL,
  backup_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (backup_opt_in IN (0, 1)),
  revoked_at INTEGER
);
CREATE INDEX devices_account ON devices(account_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  authenticated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_device ON sessions(device_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE oauth_flows (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  return_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX oauth_flows_expiry ON oauth_flows(expires_at);

CREATE TABLE entitlements (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  provider TEXT NOT NULL,
  upload_until INTEGER NOT NULL,
  download_until INTEGER NOT NULL CHECK (download_until >= upload_until),
  purge_confirmed_at INTEGER,
  purge_started_at INTEGER
);

CREATE TABLE key_envelopes (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  key_version INTEGER NOT NULL CHECK (key_version >= 1),
  format_version INTEGER NOT NULL,
  envelope TEXT NOT NULL,
  PRIMARY KEY (account_id, key_version)
);

CREATE TABLE backups (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  idempotency_key TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL,
  format_version INTEGER NOT NULL,
  key_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved','uploaded','committed','deleting','deleted')),
  reserved_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  upload_token TEXT,
  upload_deadline INTEGER,
  committed_at INTEGER,
  UNIQUE (account_id, idempotency_key)
);
CREATE UNIQUE INDEX backups_one_staged ON backups(account_id) WHERE status IN ('reserved','uploaded');
CREATE INDEX backups_account_status ON backups(account_id, status, committed_at);
CREATE INDEX backups_cleanup ON backups(status, expires_at);

CREATE TABLE service_state (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
