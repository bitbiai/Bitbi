-- Playback order is normal project data, separate from generation references.
-- No backfill or reclassification of older recipes/results.
ALTER TABLE canvas_projects ADD COLUMN assembly_json TEXT;

-- Completed assembly versions are deliberate private deliveries. Preserve them
-- as saved assets within existing storage accounting; never publish them.
CREATE TRIGGER canvas_assembly_export_preserve AFTER UPDATE OF asset_id ON canvas_video_processing
WHEN NEW.asset_id=NEW.id AND json_extract(NEW.recipe_json,'$.version')=7
 AND json_extract(NEW.recipe_json,'$.assembly.version')=1
 AND json_extract(NEW.recipe_json,'$.preview') IS NULL
BEGIN
 UPDATE canvas_export_versions SET state='saved',saved_at=NEW.updated_at
 WHERE id=NEW.id AND state='canvas';
END;
