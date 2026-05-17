-- Phase 6.4: Additive ownership metadata schema for AI folders/images.
-- Schema foundation only. This migration intentionally does not backfill
-- existing rows, rewrite user ownership, change access checks, or touch R2.

ALTER TABLE ai_folders ADD COLUMN asset_owner_type TEXT;
ALTER TABLE ai_folders ADD COLUMN owning_user_id TEXT;
ALTER TABLE ai_folders ADD COLUMN owning_organization_id TEXT;
ALTER TABLE ai_folders ADD COLUMN created_by_user_id TEXT;
ALTER TABLE ai_folders ADD COLUMN ownership_status TEXT;
ALTER TABLE ai_folders ADD COLUMN ownership_source TEXT;
ALTER TABLE ai_folders ADD COLUMN ownership_confidence TEXT;
ALTER TABLE ai_folders ADD COLUMN ownership_metadata_json TEXT;
ALTER TABLE ai_folders ADD COLUMN ownership_assigned_at TEXT;

ALTER TABLE ai_images ADD COLUMN asset_owner_type TEXT;
ALTER TABLE ai_images ADD COLUMN owning_user_id TEXT;
ALTER TABLE ai_images ADD COLUMN owning_organization_id TEXT;
ALTER TABLE ai_images ADD COLUMN created_by_user_id TEXT;
ALTER TABLE ai_images ADD COLUMN ownership_status TEXT;
ALTER TABLE ai_images ADD COLUMN ownership_source TEXT;
ALTER TABLE ai_images ADD COLUMN ownership_confidence TEXT;
ALTER TABLE ai_images ADD COLUMN ownership_metadata_json TEXT;
ALTER TABLE ai_images ADD COLUMN ownership_assigned_at TEXT;

CREATE INDEX idx_ai_folders_owning_user_id
  ON ai_folders(owning_user_id);

CREATE INDEX idx_ai_folders_owning_organization_id
  ON ai_folders(owning_organization_id);

CREATE INDEX idx_ai_folders_asset_owner_type
  ON ai_folders(asset_owner_type);

CREATE INDEX idx_ai_folders_ownership_status
  ON ai_folders(ownership_status);

CREATE INDEX idx_ai_images_owning_user_id
  ON ai_images(owning_user_id);

CREATE INDEX idx_ai_images_owning_organization_id
  ON ai_images(owning_organization_id);

CREATE INDEX idx_ai_images_asset_owner_type
  ON ai_images(asset_owner_type);

CREATE INDEX idx_ai_images_ownership_status
  ON ai_images(ownership_status);
