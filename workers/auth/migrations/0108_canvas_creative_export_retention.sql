-- Creative timing changes duration validation, not the lifetime of a completed
-- editable assembly. Extend the existing delivery rule only to recipe 8.
-- No historical export, disposition, recipe, ownership or quota is rewritten.
DROP TRIGGER canvas_assembly_export_preserve;
CREATE TRIGGER canvas_assembly_export_preserve AFTER UPDATE OF asset_id ON canvas_video_processing
WHEN NEW.asset_id=NEW.id AND json_extract(NEW.recipe_json,'$.version') IN (7,8)
 AND json_extract(NEW.recipe_json,'$.assembly.version')=1
 AND json_extract(NEW.recipe_json,'$.preview') IS NULL
BEGIN
 UPDATE canvas_export_versions SET state='saved',saved_at=NEW.updated_at
 WHERE id=NEW.id AND state='canvas';
END;
