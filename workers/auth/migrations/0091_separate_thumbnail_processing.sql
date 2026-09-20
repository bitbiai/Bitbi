-- Existing work keeps its accepted processor; the new selection affects new jobs only.
-- Existing installations retain their selection until the protected release verifies
-- both processors. This includes installations with no explicit setting yet.
-- Cloudflare becomes the new thumbnail default only after the verified activation.
INSERT INTO app_settings(key,value_json,updated_at,reason)
VALUES('private_media_service','{"backend":"github","thumbnailBackend":"github"}',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'Preserve the pre-migration processor until verified thumbnail activation')
ON CONFLICT(key) DO NOTHING;
UPDATE app_settings SET value_json=json_set(value_json,'$.thumbnailBackend',COALESCE(json_extract(value_json,'$.backend'),'github'))
WHERE key='private_media_service' AND json_extract(value_json,'$.thumbnailBackend') IS NULL;
ALTER TABLE canvas_video_processing ADD COLUMN thumbnail_backend TEXT NOT NULL DEFAULT 'github' CHECK(thumbnail_backend IN ('github','cloudflare'));
UPDATE canvas_video_processing SET thumbnail_backend=processing_backend;
CREATE TRIGGER canvas_thumbnail_backend_immutable BEFORE UPDATE OF thumbnail_backend ON canvas_video_processing
WHEN NEW.thumbnail_backend<>OLD.thumbnail_backend BEGIN SELECT RAISE(ABORT,'media_backend_immutable'); END;
ALTER TABLE memvid_stream_previews ADD COLUMN processing_backend TEXT NOT NULL DEFAULT 'github' CHECK(processing_backend IN ('github','cloudflare'));
CREATE TRIGGER stream_media_backend_immutable BEFORE UPDATE OF processing_backend ON memvid_stream_previews
WHEN NEW.processing_backend<>OLD.processing_backend BEGIN SELECT RAISE(ABORT,'media_backend_immutable'); END;
CREATE INDEX stream_media_backend_due ON memvid_stream_previews(processing_backend,status,created_at);
ALTER TABLE homepage_hero_video_derivatives ADD COLUMN processing_backend TEXT NOT NULL DEFAULT 'github' CHECK(processing_backend IN ('github','cloudflare'));
ALTER TABLE homepage_hero_video_derivatives ADD COLUMN processing_token TEXT;
ALTER TABLE homepage_hero_video_derivatives ADD COLUMN locked_until TEXT;
ALTER TABLE homepage_hero_video_derivatives ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER hero_media_backend_immutable BEFORE UPDATE OF processing_backend ON homepage_hero_video_derivatives
WHEN NEW.processing_backend<>OLD.processing_backend BEGIN SELECT RAISE(ABORT,'media_backend_immutable'); END;
CREATE INDEX hero_media_backend_due ON homepage_hero_video_derivatives(processing_backend,status,locked_until);
ALTER TABLE homepage_hero_video_uploads ADD COLUMN processing_backend TEXT NOT NULL DEFAULT 'github' CHECK(processing_backend IN ('github','cloudflare'));
ALTER TABLE homepage_hero_video_uploads ADD COLUMN poster_processing_token TEXT;
ALTER TABLE homepage_hero_video_uploads ADD COLUMN poster_locked_until TEXT;
ALTER TABLE homepage_hero_video_uploads ADD COLUMN poster_attempt_count INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER upload_media_backend_immutable BEFORE UPDATE OF processing_backend ON homepage_hero_video_uploads
WHEN NEW.processing_backend<>OLD.processing_backend BEGIN SELECT RAISE(ABORT,'media_backend_immutable'); END;
CREATE INDEX upload_media_backend_due ON homepage_hero_video_uploads(processing_backend,poster_locked_until);

-- Permit already claimed legacy GitHub callbacks during one bounded drain window.
UPDATE homepage_hero_video_derivatives SET locked_until=strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 minutes') WHERE status='processing';
UPDATE homepage_hero_video_uploads SET poster_locked_until=strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 minutes') WHERE EXISTS(SELECT 1 FROM ai_text_assets a WHERE a.id=homepage_hero_video_uploads.asset_id AND a.user_id=homepage_hero_video_uploads.user_id AND a.poster_r2_key IS NULL AND json_extract(a.metadata_json,'$.homepage_hero_source.poster_status')='processing');

-- Receipts survive source deletion and must retain processor ownership too.
ALTER TABLE memvid_stream_upload_receipts ADD COLUMN processing_backend TEXT NOT NULL DEFAULT 'github' CHECK(processing_backend IN ('github','cloudflare'));
CREATE TRIGGER stream_receipt_backend_immutable BEFORE UPDATE OF processing_backend ON memvid_stream_upload_receipts
WHEN NEW.processing_backend<>OLD.processing_backend BEGIN SELECT RAISE(ABORT,'media_backend_immutable'); END;
