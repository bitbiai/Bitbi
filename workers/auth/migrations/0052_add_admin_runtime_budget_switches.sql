-- Phase 4.15.1: admin AI runtime budget switch control plane.
-- Additive only. Cloudflare Worker variables remain hard master switches;
-- this table stores the app-level D1 switch state that must also be enabled
-- before already budget-classified admin/platform AI provider-cost work runs.

CREATE TABLE IF NOT EXISTS admin_runtime_budget_switches (
  switch_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_user_id TEXT,
  updated_by_email TEXT,
  CHECK (enabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS admin_runtime_budget_switch_events (
  id TEXT PRIMARY KEY,
  switch_key TEXT NOT NULL,
  old_enabled INTEGER,
  new_enabled INTEGER NOT NULL,
  reason TEXT,
  changed_by_user_id TEXT,
  changed_by_email TEXT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (switch_key) REFERENCES admin_runtime_budget_switches(switch_key),
  CHECK (old_enabled IN (0, 1) OR old_enabled IS NULL),
  CHECK (new_enabled IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_runtime_budget_switch_events_idempotency
  ON admin_runtime_budget_switch_events (switch_key, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_admin_runtime_budget_switch_events_switch_created
  ON admin_runtime_budget_switch_events (switch_key, created_at DESC, id DESC);
