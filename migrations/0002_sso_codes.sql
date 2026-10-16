CREATE TABLE sso_codes (
  code_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_sso_codes_expires_at ON sso_codes(expires_at);
