-- Phase 2-A: organization / membership / basic RBAC foundation.
-- Additive only. Existing user-owned tables remain user-centric until a later
-- controlled tenant backfill/migration phase.

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_user_id TEXT NOT NULL,
  create_idempotency_key TEXT,
  create_request_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_creator_idempotency
  ON organizations (created_by_user_id, create_idempotency_key)
  WHERE create_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_created
  ON organizations (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_organizations_status_created
  ON organizations (status, created_at DESC);

CREATE TABLE IF NOT EXISTS organization_memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by_user_id TEXT,
  create_idempotency_key TEXT,
  create_request_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  UNIQUE (organization_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_memberships_creator_idempotency
  ON organization_memberships (organization_id, created_by_user_id, create_idempotency_key)
  WHERE create_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_org_memberships_user_status
  ON organization_memberships (user_id, status, organization_id);

CREATE INDEX IF NOT EXISTS idx_org_memberships_org_role
  ON organization_memberships (organization_id, role, status, user_id);
