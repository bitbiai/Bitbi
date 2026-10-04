-- Additive: accepted exports, heads, source snapshots and billing stay intact.
ALTER TABLE canvas_video_processing ADD COLUMN seam_result_json TEXT;
-- Cached comparisons can answer several explicit request keys. Preserve each
-- key's accepted identity even when the graph/settings change after a lost reply.
CREATE TABLE canvas_preview_requests (
 request_id TEXT PRIMARY KEY,
 job_id TEXT NOT NULL REFERENCES canvas_video_processing(id) ON DELETE CASCADE
);
CREATE INDEX canvas_preview_requests_job ON canvas_preview_requests(job_id);
CREATE TRIGGER canvas_seam_result_immutable BEFORE UPDATE OF seam_result_json ON canvas_video_processing
WHEN OLD.seam_result_json IS NOT NULL AND NEW.seam_result_json IS NOT OLD.seam_result_json
BEGIN SELECT RAISE(ABORT,'canvas_seam_result_immutable'); END;

DROP TRIGGER canvas_export_register;
CREATE TRIGGER canvas_export_register AFTER INSERT ON canvas_video_processing
WHEN NEW.kind='concat' AND NEW.recipe_json IS NOT NULL
BEGIN
 INSERT INTO canvas_export_versions(id,user_id,project_id,run_id,node_id,created_at)
 VALUES(NEW.id,NEW.user_id,NEW.project_id,NEW.run_id,NEW.node_id,NEW.created_at);
 INSERT INTO canvas_export_heads(id,run_id,node_id,latest_id)
 SELECT COALESCE('run:'||NEW.run_id,'node:'||NEW.node_id),NEW.run_id,NEW.node_id,NEW.id
 WHERE json_extract(NEW.recipe_json,'$.preview') IS NULL
 ON CONFLICT(id) DO UPDATE SET latest_id=NEW.id;
END;
DROP TRIGGER canvas_export_activate;
CREATE TRIGGER canvas_export_activate AFTER UPDATE OF asset_id ON canvas_video_processing
WHEN NEW.asset_id=NEW.id AND NEW.recipe_json IS NOT NULL AND json_extract(NEW.recipe_json,'$.preview') IS NULL
BEGIN
 UPDATE canvas_export_heads SET current_id=NEW.id WHERE run_id IS NEW.run_id AND node_id IS NEW.node_id AND latest_id=NEW.id;
 UPDATE canvas_export_versions SET retired=1 WHERE run_id IS NEW.run_id AND node_id IS NEW.node_id AND state='canvas'
 AND id<>COALESCE((SELECT current_id FROM canvas_export_heads WHERE run_id IS NEW.run_id AND node_id IS NEW.node_id),'')
 AND EXISTS(SELECT 1 FROM canvas_video_processing p WHERE p.id=canvas_export_versions.id AND p.asset_id IS NOT NULL AND json_extract(p.recipe_json,'$.preview') IS NULL);
END;
-- One recoverable comparison per endpoint; superseded temporary comparisons
-- use the existing quota/reclamation lifecycle and never retire full exports.
CREATE TRIGGER canvas_seam_preview_activate AFTER UPDATE OF asset_id ON canvas_video_processing
WHEN NEW.asset_id=NEW.id AND json_extract(NEW.recipe_json,'$.preview') IS NOT NULL
BEGIN
 UPDATE canvas_export_versions SET retired=1 WHERE run_id IS NEW.run_id AND node_id IS NEW.node_id AND state='canvas'
 AND EXISTS(SELECT 1 FROM canvas_video_processing p WHERE p.id=canvas_export_versions.id AND p.asset_id IS NOT NULL AND json_extract(p.recipe_json,'$.preview') IS NOT NULL
   AND p.rowid<(SELECT MAX(newer.rowid) FROM canvas_video_processing newer WHERE newer.run_id IS NEW.run_id AND newer.node_id IS NEW.node_id
     AND newer.asset_id IS NOT NULL AND json_extract(newer.recipe_json,'$.preview') IS NOT NULL));
END;
