CREATE TABLE canvas_media_inspections (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
 node_id TEXT NOT NULL REFERENCES canvas_nodes(id) ON DELETE CASCADE,
 source_asset_id TEXT NOT NULL,
 source_version TEXT NOT NULL,
 source_bytes INTEGER NOT NULL,
 frame_json TEXT NOT NULL CHECK(json_valid(frame_json)),
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','ready','failed')),
 processing_backend TEXT NOT NULL DEFAULT 'cloudflare' CHECK(processing_backend='cloudflare'),
 processing_token TEXT, locked_until TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)), error_code TEXT
);
CREATE INDEX canvas_media_inspections_due ON canvas_media_inspections(status,next_attempt_at);
CREATE TRIGGER canvas_inspection_identity BEFORE UPDATE ON canvas_media_inspections
WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.node_id<>OLD.node_id
 OR NEW.source_asset_id<>OLD.source_asset_id OR NEW.source_version<>OLD.source_version OR NEW.source_bytes<>OLD.source_bytes
 OR NEW.frame_json<>OLD.frame_json OR NEW.processing_backend<>OLD.processing_backend
 OR OLD.result_json IS NOT NULL AND NEW.result_json IS NOT OLD.result_json
BEGIN SELECT RAISE(ABORT,'canvas_inspection_identity'); END;
CREATE TRIGGER canvas_inspection_source_retained BEFORE DELETE ON ai_text_assets
WHEN EXISTS(SELECT 1 FROM canvas_media_inspections i JOIN canvas_projects p ON p.id=i.project_id
 WHERE i.source_asset_id=OLD.id AND i.user_id=OLD.user_id AND i.status IN ('queued','processing') AND p.deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'canvas_inspection_source_in_use'); END;

-- Bounded technical work per ordinary project, including distinct timepoints.
-- Existing identities remain replayable when the project has reached its cap.
CREATE INDEX canvas_media_inspections_project ON canvas_media_inspections(project_id);
CREATE TRIGGER canvas_inspection_limit BEFORE INSERT ON canvas_media_inspections
WHEN NOT EXISTS(SELECT 1 FROM canvas_media_inspections WHERE id=NEW.id)
 AND (SELECT COUNT(*) FROM canvas_media_inspections WHERE project_id=NEW.project_id)>=480
BEGIN SELECT RAISE(ABORT,'canvas_inspection_limit'); END;
