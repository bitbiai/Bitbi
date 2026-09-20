-- Reuse the existing private media dispatcher/processor. No new queue or service.
CREATE TABLE private_video_references (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source_asset_id TEXT NOT NULL,
 source_r2_key TEXT NOT NULL, source_etag TEXT NOT NULL, source_bytes INTEGER NOT NULL,
 output_r2_key TEXT NOT NULL UNIQUE, output_etag TEXT,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','ready','failed','retired')),
 processing_backend TEXT NOT NULL CHECK(processing_backend IN ('github','cloudflare')),
 processing_token TEXT, locked_until TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL, storage_reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(storage_reserved_bytes>=0),
 source_metadata_json TEXT NOT NULL CHECK(json_valid(source_metadata_json)),
 output_metadata_json TEXT, error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX private_video_reference_due ON private_video_references(processing_backend,status,next_attempt_at);
CREATE INDEX private_video_reference_owner ON private_video_references(user_id,source_asset_id);
CREATE TRIGGER private_video_reference_identity BEFORE UPDATE ON private_video_references
WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.source_asset_id<>OLD.source_asset_id
 OR NEW.source_r2_key<>OLD.source_r2_key OR NEW.source_etag<>OLD.source_etag
 OR NEW.output_r2_key<>OLD.output_r2_key OR NEW.processing_backend<>OLD.processing_backend
 OR NEW.source_metadata_json<>OLD.source_metadata_json OR NEW.source_bytes<>OLD.source_bytes
 OR (OLD.status='retired' AND NEW.status<>'retired')
BEGIN SELECT RAISE(ABORT,'reference identity is immutable'); END;
CREATE TRIGGER private_video_reference_fence BEFORE INSERT ON private_video_references
WHEN EXISTS(SELECT 1 FROM r2_object_tombstones WHERE r2_key IN (NEW.source_r2_key,NEW.output_r2_key))
BEGIN SELECT RAISE(ABORT,'r2_object_key_retired'); END;
-- Only accepted consumers can retain a deleted source. Cached derivatives are
-- retired by the existing private-media recovery before managed R2 cleanup.
CREATE VIEW private_video_reference_consumers AS
SELECT json_extract(s.value,'$.reference_id') AS id FROM member_generation_jobs j,json_each(j.source_refs_json) s
 WHERE j.status IN ('queued','processing','ingesting','outcome_unknown')
UNION ALL SELECT json_extract(s.value,'$.reference_id') FROM ai_video_jobs_v2 j,json_each(j.input_json,'$._source_snapshots') s
 WHERE j.status IN ('queued','starting','provider_pending','polling','processing','ingesting');
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
);

CREATE TRIGGER member_reference_retirement BEFORE INSERT ON member_generation_jobs
WHEN EXISTS(SELECT 1 FROM json_each(NEW.source_refs_json) s JOIN private_video_references r ON r.id=json_extract(s.value,'$.reference_id') WHERE r.status='retired')
BEGIN SELECT RAISE(ABORT,'reference retired'); END;
CREATE TRIGGER admin_reference_retirement BEFORE INSERT ON ai_video_jobs_v2
WHEN EXISTS(SELECT 1 FROM json_each(NEW.input_json,'$._source_snapshots') s JOIN private_video_references r ON r.id=json_extract(s.value,'$.reference_id') WHERE r.status='retired')
BEGIN SELECT RAISE(ABORT,'reference retired'); END;
