-- Durable member requests use the existing AI video queue. Provider receipts
-- are private R2 objects; no credentials are retained in the request record.
CREATE TABLE member_generation_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_attempt_id TEXT NOT NULL UNIQUE REFERENCES member_ai_usage_attempts_v2(id),
  media_type TEXT NOT NULL CHECK(media_type IN ('image','video','music')),
  request_key TEXT NOT NULL,
  input_r2_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN
    ('queued','processing','ingesting','preview_pending','succeeded','failed','outcome_unknown')),
  processing_token TEXT,
  locked_until TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  provider_receipts_json TEXT NOT NULL DEFAULT '{}',
  result_r2_key TEXT,
  asset_id TEXT,
  storage_reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(storage_reserved_bytes >= 0),
  poster_reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(poster_reserved_bytes >= 0),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(user_id, media_type, request_key)
);
CREATE INDEX member_generation_jobs_due ON member_generation_jobs(status,next_attempt_at);
CREATE INDEX member_generation_jobs_owner ON member_generation_jobs(user_id,created_at);
CREATE TRIGGER member_generation_job_identity_immutable BEFORE UPDATE ON member_generation_jobs
WHEN NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id OR NEW.usage_attempt_id <> OLD.usage_attempt_id
  OR NEW.media_type <> OLD.media_type OR NEW.request_key <> OLD.request_key OR NEW.input_r2_key <> OLD.input_r2_key
BEGIN SELECT RAISE(ABORT, 'generation identity is immutable'); END;

ALTER TABLE ai_text_assets ADD COLUMN generation_token TEXT;
ALTER TABLE ai_images ADD COLUMN generation_token TEXT;
CREATE TRIGGER member_generation_text_asset_claim BEFORE INSERT ON ai_text_assets
WHEN NEW.generation_token IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM member_generation_jobs WHERE id=NEW.id AND user_id=NEW.user_id
 AND processing_token=NEW.generation_token AND locked_until > strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND status IN ('processing','ingesting'))
BEGIN SELECT RAISE(ABORT, 'generation asset claim lost'); END;
CREATE TRIGGER member_generation_image_asset_claim BEFORE INSERT ON ai_images
WHEN NEW.generation_token IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM member_generation_jobs WHERE id=NEW.id AND user_id=NEW.user_id
 AND processing_token=NEW.generation_token AND locked_until > strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND status IN ('processing','ingesting'))
BEGIN SELECT RAISE(ABORT, 'generation asset claim lost'); END;

-- Retain private request/result/provider receipts under the existing retirement fence.
DROP VIEW r2_cleanup_live_references;
CREATE VIEW r2_cleanup_live_references AS
SELECT r2_key FROM (
SELECT r2_key AS r2_key FROM ai_images WHERE r2_key IS NOT NULL AND (1)
UNION ALL
SELECT thumb_key AS r2_key FROM ai_images WHERE thumb_key IS NOT NULL AND (1)
UNION ALL
SELECT medium_key AS r2_key FROM ai_images WHERE medium_key IS NOT NULL AND (1)
UNION ALL
SELECT r2_key AS r2_key FROM ai_text_assets WHERE r2_key IS NOT NULL AND (1)
)
UNION ALL
SELECT r2_key FROM (
SELECT poster_r2_key AS r2_key FROM ai_text_assets WHERE poster_r2_key IS NOT NULL AND (1)
UNION ALL
SELECT output_r2_key AS r2_key FROM ai_video_jobs_v2 WHERE output_r2_key IS NOT NULL AND (1)
UNION ALL
SELECT poster_r2_key AS r2_key FROM ai_video_jobs_v2 WHERE poster_r2_key IS NOT NULL AND (1)
UNION ALL
SELECT r2_key AS r2_key FROM homepage_hero_video_uploads WHERE r2_key IS NOT NULL AND (1)
)
UNION ALL
SELECT r2_key FROM (
SELECT file_r2_key AS r2_key FROM homepage_hero_video_derivatives WHERE file_r2_key IS NOT NULL AND (1)
UNION ALL
SELECT poster_r2_key AS r2_key FROM homepage_hero_video_derivatives WHERE poster_r2_key IS NOT NULL AND (1)
UNION ALL
SELECT source_r2_key AS r2_key FROM homepage_hero_video_derivatives WHERE source_r2_key IS NOT NULL AND (status IN ('queued', 'processing'))
UNION ALL
SELECT source_r2_key AS r2_key FROM memvid_stream_previews WHERE source_r2_key IS NOT NULL AND (1)
)
UNION ALL
SELECT r2_key FROM (
SELECT r2_key AS r2_key FROM fable_chat_attachments WHERE r2_key IS NOT NULL AND (deleted_at IS NULL AND state IN ('pending', 'attached'))
UNION ALL
SELECT visual_object_key AS r2_key FROM news_pulse_items WHERE visual_object_key IS NOT NULL AND (1)
UNION ALL
SELECT r2_key AS r2_key FROM data_export_archives WHERE r2_key IS NOT NULL AND (r2_bucket = 'USER_IMAGES')
UNION ALL
SELECT storage_key AS r2_key FROM platform_budget_evidence_archives WHERE storage_key IS NOT NULL AND (storage_bucket = 'USER_IMAGES' AND deleted_at IS NULL)
)
UNION ALL SELECT r2_key FROM (
SELECT input_r2_key AS r2_key FROM member_generation_jobs
UNION ALL SELECT result_r2_key FROM member_generation_jobs WHERE result_r2_key IS NOT NULL
UNION ALL SELECT json_extract(receipt.value,'$.key') FROM member_generation_jobs, json_each(provider_receipts_json) receipt
);
CREATE TRIGGER member_generation_r2_insert BEFORE INSERT ON member_generation_jobs
WHEN EXISTS(SELECT 1 FROM r2_object_tombstones WHERE r2_key=NEW.input_r2_key OR r2_key=NEW.result_r2_key)
BEGIN SELECT RAISE(ABORT,'r2_object_key_retired'); END;
CREATE TRIGGER member_generation_r2_update BEFORE UPDATE ON member_generation_jobs
WHEN EXISTS(SELECT 1 FROM r2_object_tombstones WHERE r2_key=NEW.input_r2_key OR r2_key=NEW.result_r2_key
 OR r2_key IN (SELECT json_extract(value,'$.key') FROM json_each(NEW.provider_receipts_json)))
BEGIN SELECT RAISE(ABORT,'r2_object_key_retired'); END;

-- Bytes committed before a ledger response are recoverable, but are not yet a
-- deliverable. Existing (non-job) assets are unaffected.
CREATE VIEW member_generation_unready_assets AS
SELECT jobs.id FROM member_generation_jobs jobs JOIN member_ai_usage_attempts_v2 usage ON usage.id=jobs.usage_attempt_id
WHERE usage.billing_status <> 'finalized';
CREATE TRIGGER member_generation_ai_images_publication BEFORE UPDATE OF visibility ON ai_images
WHEN NEW.visibility='public' AND EXISTS(SELECT 1 FROM member_generation_unready_assets WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'generation_not_finalized'); END;
CREATE TRIGGER member_generation_ai_images_removed AFTER DELETE ON ai_images
BEGIN UPDATE member_generation_jobs SET status='failed',error_code='generation_asset_removed',locked_until=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=OLD.id AND user_id=OLD.user_id; END;
CREATE TRIGGER member_generation_ai_text_assets_publication BEFORE UPDATE OF visibility ON ai_text_assets
WHEN NEW.visibility='public' AND EXISTS(SELECT 1 FROM member_generation_unready_assets WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'generation_not_finalized'); END;
CREATE TRIGGER member_generation_ai_text_assets_removed AFTER DELETE ON ai_text_assets
BEGIN UPDATE member_generation_jobs SET status='failed',error_code='generation_asset_removed',locked_until=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=OLD.id AND user_id=OLD.user_id; END;
