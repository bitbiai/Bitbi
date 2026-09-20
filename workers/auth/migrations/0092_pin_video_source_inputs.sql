-- Existing originals are retained only for accepted jobs; no provider URLs or credentials.
ALTER TABLE member_generation_jobs ADD COLUMN source_refs_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(source_refs_json));
CREATE TRIGGER member_generation_source_identity BEFORE UPDATE OF source_refs_json ON member_generation_jobs
WHEN NEW.source_refs_json<>OLD.source_refs_json
BEGIN SELECT RAISE(ABORT,'generation source identity is immutable'); END;
CREATE TRIGGER member_generation_source_fence BEFORE INSERT ON member_generation_jobs
WHEN EXISTS(SELECT 1 FROM json_each(NEW.source_refs_json) s JOIN r2_object_tombstones t ON t.r2_key=json_extract(s.value,'$.r2_key'))
BEGIN SELECT RAISE(ABORT,'r2_object_key_retired'); END;
CREATE TRIGGER admin_video_source_fence BEFORE INSERT ON ai_video_jobs_v2
WHEN EXISTS(SELECT 1 FROM json_each(NEW.input_json,'$._source_snapshots') s JOIN r2_object_tombstones t ON t.r2_key=json_extract(s.value,'$.r2_key'))
BEGIN SELECT RAISE(ABORT,'r2_object_key_retired'); END;
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
UNION ALL SELECT json_extract(s.value,'$.r2_key') FROM member_generation_jobs j,json_each(j.source_refs_json) s
 WHERE j.status IN ('queued','processing','ingesting','outcome_unknown')
UNION ALL SELECT json_extract(s.value,'$.r2_key') FROM ai_video_jobs_v2 j,json_each(j.input_json,'$._source_snapshots') s
 WHERE j.status IN ('queued','starting','provider_pending','polling','processing','ingesting')
);
