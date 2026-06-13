-- Operator-only billing archive/reset support.
-- Additive only: keeps reversible archive state, cleanup run audit summaries,
-- per-run item plans, and purge tombstones so provider replay cannot recreate
-- payment side effects after an approved operator reset. Raw provider payloads,
-- webhook signatures, card data, cookies, and secrets are intentionally not
-- stored here.

CREATE TABLE IF NOT EXISTS billing_operator_item_states (
  id TEXT PRIMARY KEY,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('archived')),
  reason TEXT,
  archived_by_user_id TEXT,
  archived_at TEXT NOT NULL,
  restored_by_user_id TEXT,
  restored_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(item_type, item_id),
  FOREIGN KEY (archived_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (restored_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_operator_item_states_state
  ON billing_operator_item_states(state, archived_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_operator_item_states_type_item
  ON billing_operator_item_states(item_type, item_id);

CREATE INDEX IF NOT EXISTS idx_billing_operator_item_states_archived
  ON billing_operator_item_states(archived_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS billing_operator_cleanup_runs (
  id TEXT PRIMARY KEY,
  run_type TEXT NOT NULL CHECK (run_type IN ('archive', 'restore', 'purge_preview', 'purge_apply')),
  selection_scope TEXT NOT NULL,
  requested_by_user_id TEXT,
  reason TEXT,
  dry_run INTEGER NOT NULL DEFAULT 1 CHECK (dry_run IN (0, 1)),
  confirmation TEXT,
  idempotency_key_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned', 'applied', 'blocked', 'failed')),
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_operator_cleanup_runs_user_idempotency
  ON billing_operator_cleanup_runs(requested_by_user_id, idempotency_key_hash)
  WHERE idempotency_key_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_operator_cleanup_runs_type_created
  ON billing_operator_cleanup_runs(run_type, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_operator_cleanup_runs_status_created
  ON billing_operator_cleanup_runs(status, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS billing_operator_cleanup_run_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('archive', 'restore', 'delete', 'tombstone', 'ledger_adjust', 'blocked')),
  status TEXT NOT NULL CHECK (status IN ('planned', 'applied', 'blocked', 'failed')),
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES billing_operator_cleanup_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_billing_operator_cleanup_run_items_run
  ON billing_operator_cleanup_run_items(run_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_billing_operator_cleanup_run_items_type_item
  ON billing_operator_cleanup_run_items(item_type, item_id);

CREATE TABLE IF NOT EXISTS billing_operator_purge_tombstones (
  id TEXT PRIMARY KEY,
  tombstone_type TEXT NOT NULL CHECK (tombstone_type IN ('provider_event', 'checkout_session', 'payment_intent', 'subscription', 'billing_review')),
  provider TEXT,
  provider_mode TEXT,
  provider_event_id TEXT,
  provider_checkout_session_id TEXT,
  provider_payment_intent_id TEXT,
  provider_subscription_id TEXT,
  original_item_type TEXT,
  original_item_id TEXT,
  payload_hash TEXT,
  reason TEXT,
  purged_by_user_id TEXT,
  purged_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (purged_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_operator_purge_tombstones_provider_event
  ON billing_operator_purge_tombstones(provider, provider_event_id)
  WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_operator_purge_tombstones_checkout_session
  ON billing_operator_purge_tombstones(provider, provider_mode, provider_checkout_session_id)
  WHERE provider IS NOT NULL AND provider_mode IS NOT NULL AND provider_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_operator_purge_tombstones_payment_intent
  ON billing_operator_purge_tombstones(provider, provider_mode, provider_payment_intent_id)
  WHERE provider IS NOT NULL AND provider_mode IS NOT NULL AND provider_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_operator_purge_tombstones_subscription
  ON billing_operator_purge_tombstones(provider, provider_mode, provider_subscription_id)
  WHERE provider IS NOT NULL AND provider_mode IS NOT NULL AND provider_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_operator_purge_tombstones_type_purged
  ON billing_operator_purge_tombstones(tombstone_type, purged_at DESC, id DESC);
