-- Wallet linking + Sign-In With Ethereum
-- Migration 0020

CREATE TABLE IF NOT EXISTS linked_wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  address_normalized TEXT NOT NULL UNIQUE,
  address_display TEXT NOT NULL,
  chain_id INTEGER NOT NULL DEFAULT 1 CHECK (chain_id = 1),
  is_primary INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0, 1)),
  linked_at TEXT NOT NULL,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_linked_wallets_user_id
  ON linked_wallets(user_id);

CREATE INDEX IF NOT EXISTS idx_linked_wallets_address_normalized
  ON linked_wallets(address_normalized);

CREATE TABLE IF NOT EXISTS siwe_challenges (
  id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL UNIQUE,
  intent TEXT NOT NULL CHECK (intent IN ('link', 'login')),
  user_id TEXT,
  address_normalized TEXT,
  domain TEXT NOT NULL,
  uri TEXT NOT NULL,
  chain_id INTEGER NOT NULL DEFAULT 1 CHECK (chain_id = 1),
  statement TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  requested_ip TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_siwe_challenges_nonce
  ON siwe_challenges(nonce);

CREATE INDEX IF NOT EXISTS idx_siwe_challenges_expires_at
  ON siwe_challenges(expires_at);

CREATE INDEX IF NOT EXISTS idx_siwe_challenges_user_id_intent
  ON siwe_challenges(user_id, intent);
