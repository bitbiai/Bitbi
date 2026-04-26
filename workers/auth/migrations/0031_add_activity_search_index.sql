-- Phase 1-G: indexed, redacted search projection for admin audit and user activity logs.
-- Source log tables remain the source of truth. This table is populated for new
-- rows going forward; historical rows require an explicit staging/production
-- backfill before they participate in indexed search.

CREATE TABLE IF NOT EXISTS activity_search_index (
  source_table TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  actor_user_id TEXT,
  actor_email_norm TEXT,
  target_user_id TEXT,
  target_email_norm TEXT,
  action_norm TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  summary TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_table, source_event_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_search_source_created
  ON activity_search_index (source_table, created_at DESC, source_event_id DESC);

CREATE INDEX IF NOT EXISTS idx_activity_search_source_action_created
  ON activity_search_index (source_table, action_norm, created_at DESC, source_event_id DESC);

CREATE INDEX IF NOT EXISTS idx_activity_search_source_actor_created
  ON activity_search_index (source_table, actor_email_norm, created_at DESC, source_event_id DESC);

CREATE INDEX IF NOT EXISTS idx_activity_search_source_target_created
  ON activity_search_index (source_table, target_email_norm, created_at DESC, source_event_id DESC);

CREATE INDEX IF NOT EXISTS idx_activity_search_source_entity_created
  ON activity_search_index (source_table, entity_type, entity_id, created_at DESC, source_event_id DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_action
  ON admin_audit_log (created_at DESC, action);
