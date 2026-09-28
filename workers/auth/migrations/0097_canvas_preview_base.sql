-- Private clean derivatives belong to an explicit existing export, never a preview job.
ALTER TABLE canvas_video_processing ADD COLUMN preview_base_key TEXT;
ALTER TABLE canvas_video_processing ADD COLUMN preview_base_etag TEXT;
ALTER TABLE canvas_video_processing ADD COLUMN preview_base_bytes INTEGER NOT NULL DEFAULT 0 CHECK(preview_base_bytes>=0);
CREATE TRIGGER canvas_preview_base_fence BEFORE UPDATE OF preview_base_key ON canvas_video_processing
WHEN NEW.preview_base_key IS NOT NULL AND EXISTS(SELECT 1 FROM r2_object_tombstones WHERE r2_key=NEW.preview_base_key)
BEGIN SELECT RAISE(ABORT,'r2_object_key_retired'); END;
-- Original/aggregate deletion already obeys saved-version and consumer guards.
-- Release the associated derivative in the same transaction, never a saved sibling.
CREATE TRIGGER canvas_preview_base_asset_deleted AFTER DELETE ON ai_text_assets
BEGIN
 UPDATE user_asset_storage_usage SET used_bytes=MAX(0,used_bytes-COALESCE(
   (SELECT SUM(preview_base_bytes) FROM canvas_video_processing WHERE asset_id=OLD.id AND user_id=OLD.user_id),0))
 WHERE user_id=OLD.user_id;
 UPDATE canvas_video_processing SET preview_base_key=NULL,preview_base_etag=NULL,preview_base_bytes=0
 WHERE asset_id=OLD.id AND user_id=OLD.user_id;
END;
CREATE TRIGGER canvas_preview_base_job_deleted AFTER DELETE ON canvas_video_processing
BEGIN
 UPDATE user_asset_storage_usage SET used_bytes=MAX(0,used_bytes-OLD.preview_base_bytes) WHERE user_id=OLD.user_id;
END;
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
SELECT r2_key FROM (
SELECT input_r2_key AS r2_key FROM member_generation_jobs
UNION ALL SELECT result_r2_key FROM member_generation_jobs WHERE result_r2_key IS NOT NULL
UNION ALL SELECT json_extract(receipt.value,'$.key') FROM member_generation_jobs, json_each(provider_receipts_json) receipt
UNION ALL SELECT json_extract(s.value,'$.r2_key') FROM member_generation_jobs j,json_each(j.source_refs_json) s
 WHERE j.status IN ('queued','processing','ingesting','outcome_unknown')
UNION ALL SELECT json_extract(s.value,'$.r2_key') FROM ai_video_jobs_v2 j,json_each(j.input_json,'$._source_snapshots') s
 WHERE j.status IN ('queued','starting','provider_pending','polling','processing','ingesting')
)
UNION ALL SELECT source_r2_key FROM private_video_references WHERE status IN ('queued','processing')
UNION ALL SELECT output_r2_key FROM private_video_references WHERE status<>'retired'
UNION ALL SELECT preview_base_key FROM canvas_video_processing WHERE preview_base_key IS NOT NULL
);
