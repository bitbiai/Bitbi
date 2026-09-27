-- Only recipe-based exports created after this migration are disposable.
-- Historical concatenations remain permanent and are never backfilled.
ALTER TABLE canvas_video_processing ADD COLUMN recipe_json TEXT;
CREATE TRIGGER canvas_export_recipe_immutable BEFORE UPDATE OF recipe_json ON canvas_video_processing
WHEN NEW.recipe_json IS NOT OLD.recipe_json
BEGIN SELECT RAISE(ABORT,'canvas_export_recipe_immutable'); END;
CREATE TABLE canvas_export_versions (
 id TEXT PRIMARY KEY REFERENCES canvas_video_processing(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
 run_id TEXT NOT NULL REFERENCES canvas_runs(id) ON DELETE CASCADE,
 state TEXT NOT NULL DEFAULT 'canvas' CHECK(state IN ('canvas','saved','deleted')),
 retired INTEGER NOT NULL DEFAULT 0 CHECK(retired IN (0,1)),
 created_at TEXT NOT NULL,
 saved_at TEXT
);
CREATE TABLE canvas_export_heads (
 run_id TEXT PRIMARY KEY REFERENCES canvas_runs(id) ON DELETE CASCADE,
 latest_id TEXT NOT NULL REFERENCES canvas_export_versions(id),
 current_id TEXT REFERENCES canvas_export_versions(id)
);
CREATE TRIGGER canvas_export_register AFTER INSERT ON canvas_video_processing
WHEN NEW.kind='concat' AND NEW.recipe_json IS NOT NULL
BEGIN
 INSERT INTO canvas_export_versions(id,user_id,project_id,run_id,created_at)
 VALUES(NEW.id,NEW.user_id,NEW.project_id,NEW.run_id,NEW.created_at);
 INSERT INTO canvas_export_heads(run_id,latest_id) VALUES(NEW.run_id,NEW.id)
 ON CONFLICT(run_id) DO UPDATE SET latest_id=NEW.id;
END;
-- In the same transaction as durable-result attachment: latest intent wins.
CREATE TRIGGER canvas_export_activate AFTER UPDATE OF asset_id ON canvas_video_processing
WHEN NEW.asset_id=NEW.id AND NEW.recipe_json IS NOT NULL
BEGIN
 UPDATE canvas_export_heads SET current_id=NEW.id WHERE run_id=NEW.run_id AND latest_id=NEW.id;
 UPDATE canvas_export_versions SET retired=1 WHERE run_id=NEW.run_id AND state='canvas'
 AND id<>COALESCE((SELECT current_id FROM canvas_export_heads WHERE run_id=NEW.run_id),'')
 AND EXISTS(SELECT 1 FROM canvas_video_processing p WHERE p.id=canvas_export_versions.id AND p.asset_id IS NOT NULL);
END;
CREATE TRIGGER canvas_export_identity BEFORE UPDATE ON canvas_export_versions
WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.run_id<>OLD.run_id
 OR (OLD.state<>'canvas' AND NEW.state<>OLD.state)
BEGIN SELECT RAISE(ABORT,'canvas_export_identity'); END;
CREATE VIEW canvas_asset_dispositions AS
 SELECT asset_id,state FROM canvas_media_outputs
 UNION ALL SELECT id AS asset_id,state FROM canvas_export_versions;
CREATE VIEW canvas_export_reclaimable AS
 SELECT v.* FROM canvas_export_versions v JOIN canvas_projects p ON p.id=v.project_id
 JOIN canvas_runs r ON r.id=v.run_id JOIN canvas_nodes n ON n.id=r.node_id
 WHERE v.state='canvas' AND (v.retired=1 OR p.deleted_at IS NOT NULL OR n.deleted_at IS NOT NULL)
 AND EXISTS(SELECT 1 FROM ai_text_assets a WHERE a.id=v.id)
 AND NOT EXISTS(SELECT 1 FROM canvas_nodes consumer JOIN canvas_projects cp ON cp.id=consumer.project_id
   WHERE consumer.asset_id=v.id AND consumer.deleted_at IS NULL AND cp.deleted_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM canvas_runs consumer JOIN canvas_projects cp ON cp.id=consumer.project_id,
   json_each(consumer.input_json,'$.connected_asset_ids') ref
   WHERE ref.value=v.id AND (cp.deleted_at IS NULL OR consumer.status IN ('queued','running')))
 AND NOT EXISTS(SELECT 1 FROM canvas_video_processing processing,json_each(processing.sources_json) source
   WHERE processing.status IN ('queued','processing','preview_pending') AND json_extract(source.value,'$.assetId')=v.id)
 AND NOT EXISTS(SELECT 1 FROM canvas_video_processing processing WHERE processing.id=v.id
   AND processing.status IN ('queued','processing','preview_pending'));
CREATE TRIGGER canvas_export_publication BEFORE UPDATE OF visibility ON ai_text_assets
WHEN NEW.visibility='public' AND EXISTS(SELECT 1 FROM canvas_export_versions WHERE id=NEW.id AND state<>'saved')
BEGIN SELECT RAISE(ABORT,'canvas_save_required'); END;
CREATE TRIGGER canvas_export_delete BEFORE DELETE ON ai_text_assets
WHEN (EXISTS(SELECT 1 FROM canvas_export_versions WHERE id=OLD.id AND state='canvas')
 AND NOT EXISTS(SELECT 1 FROM canvas_export_reclaimable WHERE id=OLD.id))
 OR EXISTS(SELECT 1 FROM canvas_video_processing p,json_each(p.sources_json) source
 WHERE p.recipe_json IS NOT NULL AND p.status IN ('queued','processing','preview_pending')
 AND json_extract(source.value,'$.assetId')=OLD.id)
BEGIN SELECT RAISE(ABORT,'canvas_export_in_use'); END;
CREATE TRIGGER canvas_export_deleted AFTER DELETE ON ai_text_assets
BEGIN UPDATE canvas_export_versions SET state='deleted' WHERE id=OLD.id AND state='canvas'; END;
