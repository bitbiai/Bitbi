-- Q2 L01: source deletion outbox, permanent key retirement and reference fencing.
-- Forward only. Apply atomically, then use compatible Workers after draining old
-- writers/consumers. Raw USER_IMAGES writes to users/ and van-ark-chat/ require
-- the matching Worker namespace guard. This is not an old-Worker rollback gate.
-- Historical pending rows have no proven source-deletion receipt; retain them.

CREATE TABLE r2_object_tombstones (
  r2_key TEXT PRIMARY KEY NOT NULL,
  retired_at TEXT NOT NULL
);
CREATE TRIGGER r2_object_tombstones_no_update BEFORE UPDATE ON r2_object_tombstones
BEGIN SELECT RAISE(ABORT, 'r2_object_retirement_is_permanent'); END;
CREATE TRIGGER r2_object_tombstones_no_delete BEFORE DELETE ON r2_object_tombstones
BEGIN SELECT RAISE(ABORT, 'r2_object_retirement_is_permanent'); END;

UPDATE r2_cleanup_queue SET status = 'legacy_held' WHERE status = 'pending';
CREATE TRIGGER r2_cleanup_legacy_insert_hold AFTER INSERT ON r2_cleanup_queue
WHEN NEW.status = 'pending'
BEGIN UPDATE r2_cleanup_queue SET status = 'legacy_held' WHERE id = NEW.id; END;
CREATE TRIGGER r2_cleanup_legacy_update_hold AFTER UPDATE OF status ON r2_cleanup_queue
WHEN NEW.status = 'pending'
BEGIN UPDATE r2_cleanup_queue SET status = 'legacy_held' WHERE id = NEW.id; END;
CREATE INDEX idx_r2_cleanup_protocol_work ON r2_cleanup_queue(status, attempts, created_at, id);
CREATE INDEX idx_r2_cleanup_key ON r2_cleanup_queue(r2_key);

-- Live blob references, including aliases in other domains. Request-item logs
-- and metadata JSON are historical evidence, not a right to serve/revive bytes.
-- Completed/failed hero source receipts are historical; only queued/processing
-- jobs still need their source. The optimized file/poster remains protected.
CREATE VIEW r2_cleanup_live_references AS
SELECT r2_key AS r2_key FROM ai_images WHERE r2_key IS NOT NULL AND (1)
UNION ALL
SELECT thumb_key AS r2_key FROM ai_images WHERE thumb_key IS NOT NULL AND (1)
UNION ALL
SELECT medium_key AS r2_key FROM ai_images WHERE medium_key IS NOT NULL AND (1)
UNION ALL
SELECT r2_key AS r2_key FROM ai_text_assets WHERE r2_key IS NOT NULL AND (1)
UNION ALL
SELECT poster_r2_key AS r2_key FROM ai_text_assets WHERE poster_r2_key IS NOT NULL AND (1)
UNION ALL
SELECT output_r2_key AS r2_key FROM ai_video_jobs_v2 WHERE output_r2_key IS NOT NULL AND (1)
UNION ALL
SELECT poster_r2_key AS r2_key FROM ai_video_jobs_v2 WHERE poster_r2_key IS NOT NULL AND (1)
UNION ALL
SELECT r2_key AS r2_key FROM homepage_hero_video_uploads WHERE r2_key IS NOT NULL AND (1)
UNION ALL
SELECT file_r2_key AS r2_key FROM homepage_hero_video_derivatives WHERE file_r2_key IS NOT NULL AND (1)
UNION ALL
SELECT poster_r2_key AS r2_key FROM homepage_hero_video_derivatives WHERE poster_r2_key IS NOT NULL AND (1)
UNION ALL
SELECT source_r2_key AS r2_key FROM homepage_hero_video_derivatives WHERE source_r2_key IS NOT NULL AND (status IN ('queued', 'processing'))
UNION ALL
SELECT source_r2_key AS r2_key FROM memvid_stream_previews WHERE source_r2_key IS NOT NULL AND (1)
UNION ALL
SELECT r2_key AS r2_key FROM fable_chat_attachments WHERE r2_key IS NOT NULL AND (deleted_at IS NULL AND state IN ('pending', 'attached'))
UNION ALL
SELECT visual_object_key AS r2_key FROM news_pulse_items WHERE visual_object_key IS NOT NULL AND (1)
UNION ALL
SELECT r2_key AS r2_key FROM data_export_archives WHERE r2_key IS NOT NULL AND (r2_bucket = 'USER_IMAGES')
UNION ALL
SELECT storage_key AS r2_key FROM platform_budget_evidence_archives WHERE storage_key IS NOT NULL AND (storage_bucket = 'USER_IMAGES' AND deleted_at IS NULL);

CREATE INDEX idx_r2_l01_ai_images_r2_key ON ai_images(r2_key) WHERE r2_key IS NOT NULL;
CREATE INDEX idx_r2_l01_ai_images_thumb_key ON ai_images(thumb_key) WHERE thumb_key IS NOT NULL;
CREATE INDEX idx_r2_l01_ai_images_medium_key ON ai_images(medium_key) WHERE medium_key IS NOT NULL;
CREATE TRIGGER r2_l01_0_insert BEFORE INSERT ON ai_images
WHEN (1) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.r2_key) OR EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.thumb_key) OR EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.medium_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;
CREATE TRIGGER r2_l01_0_update BEFORE UPDATE ON ai_images
WHEN (1) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.r2_key) OR EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.thumb_key) OR EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.medium_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;

CREATE INDEX idx_r2_l01_ai_text_assets_r2_key ON ai_text_assets(r2_key) WHERE r2_key IS NOT NULL;
CREATE INDEX idx_r2_l01_ai_text_assets_poster_r2_key ON ai_text_assets(poster_r2_key) WHERE poster_r2_key IS NOT NULL;
CREATE TRIGGER r2_l01_1_insert BEFORE INSERT ON ai_text_assets
WHEN (1) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.r2_key) OR EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.poster_r2_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;
CREATE TRIGGER r2_l01_1_update BEFORE UPDATE ON ai_text_assets
WHEN (1) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.r2_key) OR EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.poster_r2_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;

CREATE INDEX idx_r2_l01_ai_video_jobs_v2_output_r2_key ON ai_video_jobs_v2(output_r2_key) WHERE output_r2_key IS NOT NULL;
CREATE INDEX idx_r2_l01_ai_video_jobs_v2_poster_r2_key ON ai_video_jobs_v2(poster_r2_key) WHERE poster_r2_key IS NOT NULL;
CREATE TRIGGER r2_l01_2_insert BEFORE INSERT ON ai_video_jobs_v2
WHEN (1) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.output_r2_key) OR EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.poster_r2_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;
CREATE TRIGGER r2_l01_2_update BEFORE UPDATE ON ai_video_jobs_v2
WHEN (1) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.output_r2_key) OR EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.poster_r2_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;

CREATE INDEX idx_r2_l01_homepage_hero_video_uploads_r2_key ON homepage_hero_video_uploads(r2_key) WHERE r2_key IS NOT NULL;
CREATE TRIGGER r2_l01_3_insert BEFORE INSERT ON homepage_hero_video_uploads
WHEN (1) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.r2_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;
CREATE TRIGGER r2_l01_3_update BEFORE UPDATE ON homepage_hero_video_uploads
WHEN (1) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.r2_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;

CREATE INDEX idx_r2_l01_homepage_hero_video_derivatives_file_r2_key ON homepage_hero_video_derivatives(file_r2_key) WHERE file_r2_key IS NOT NULL;
CREATE INDEX idx_r2_l01_homepage_hero_video_derivatives_poster_r2_key ON homepage_hero_video_derivatives(poster_r2_key) WHERE poster_r2_key IS NOT NULL;
CREATE TRIGGER r2_l01_4_insert BEFORE INSERT ON homepage_hero_video_derivatives
WHEN (1) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.file_r2_key) OR EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.poster_r2_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;
CREATE TRIGGER r2_l01_4_update BEFORE UPDATE ON homepage_hero_video_derivatives
WHEN (1) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.file_r2_key) OR EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.poster_r2_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;

CREATE INDEX idx_r2_l01_homepage_hero_video_derivatives_source_r2_key ON homepage_hero_video_derivatives(source_r2_key) WHERE source_r2_key IS NOT NULL;
CREATE TRIGGER r2_l01_5_insert BEFORE INSERT ON homepage_hero_video_derivatives
WHEN (NEW.status IN ('queued', 'processing')) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.source_r2_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;
CREATE TRIGGER r2_l01_5_update BEFORE UPDATE ON homepage_hero_video_derivatives
WHEN (NEW.status IN ('queued', 'processing')) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.source_r2_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;

CREATE INDEX idx_r2_l01_memvid_stream_previews_source_r2_key ON memvid_stream_previews(source_r2_key) WHERE source_r2_key IS NOT NULL;
CREATE TRIGGER r2_l01_6_insert BEFORE INSERT ON memvid_stream_previews
WHEN (1) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.source_r2_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;
CREATE TRIGGER r2_l01_6_update BEFORE UPDATE ON memvid_stream_previews
WHEN (1) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.source_r2_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;

CREATE INDEX idx_r2_l01_fable_chat_attachments_r2_key ON fable_chat_attachments(r2_key) WHERE r2_key IS NOT NULL;
CREATE TRIGGER r2_l01_7_insert BEFORE INSERT ON fable_chat_attachments
WHEN (NEW.deleted_at IS NULL AND NEW.state IN ('pending', 'attached')) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.r2_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;
CREATE TRIGGER r2_l01_7_update BEFORE UPDATE ON fable_chat_attachments
WHEN (NEW.deleted_at IS NULL AND NEW.state IN ('pending', 'attached')) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.r2_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;

CREATE INDEX idx_r2_l01_news_pulse_items_visual_object_key ON news_pulse_items(visual_object_key) WHERE visual_object_key IS NOT NULL;
CREATE TRIGGER r2_l01_8_insert BEFORE INSERT ON news_pulse_items
WHEN (1) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.visual_object_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;
CREATE TRIGGER r2_l01_8_update BEFORE UPDATE ON news_pulse_items
WHEN (1) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.visual_object_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;

CREATE INDEX idx_r2_l01_data_export_archives_r2_key ON data_export_archives(r2_key) WHERE r2_key IS NOT NULL;
CREATE TRIGGER r2_l01_9_insert BEFORE INSERT ON data_export_archives
WHEN (NEW.r2_bucket = 'USER_IMAGES') AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.r2_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;
CREATE TRIGGER r2_l01_9_update BEFORE UPDATE ON data_export_archives
WHEN (NEW.r2_bucket = 'USER_IMAGES') AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.r2_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;

CREATE INDEX idx_r2_l01_platform_budget_evidence_archives_storage_key ON platform_budget_evidence_archives(storage_key) WHERE storage_key IS NOT NULL;
CREATE TRIGGER r2_l01_10_insert BEFORE INSERT ON platform_budget_evidence_archives
WHEN (NEW.storage_bucket = 'USER_IMAGES' AND NEW.deleted_at IS NULL) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.storage_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;
CREATE TRIGGER r2_l01_10_update BEFORE UPDATE ON platform_budget_evidence_archives
WHEN (NEW.storage_bucket = 'USER_IMAGES' AND NEW.deleted_at IS NULL) AND (EXISTS (SELECT 1 FROM r2_object_tombstones WHERE r2_key = NEW.storage_key))
BEGIN SELECT RAISE(ABORT, 'r2_object_key_retired'); END;
