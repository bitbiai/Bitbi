-- Only newly registered Canvas runs participate. Legacy/imported assets and
-- concat outputs have no row here and retain their existing permanent lifetime.
CREATE TABLE canvas_media_outputs (
 run_id TEXT REFERENCES canvas_runs(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
 node_id TEXT NOT NULL REFERENCES canvas_nodes(id) ON DELETE CASCADE,
 asset_id TEXT PRIMARY KEY,
 role TEXT NOT NULL DEFAULT 'original' CHECK(role IN ('original','frame')),
 kind TEXT NOT NULL CHECK(kind IN ('image','video','music')),
 state TEXT NOT NULL DEFAULT 'canvas' CHECK(state IN ('canvas','saved','deleted')),
 created_at TEXT NOT NULL,
 saved_at TEXT
);
CREATE UNIQUE INDEX canvas_media_original ON canvas_media_outputs(run_id) WHERE role='original';
CREATE INDEX canvas_media_cleanup ON canvas_media_outputs(state,created_at);
CREATE INDEX canvas_media_owner ON canvas_media_outputs(user_id,state);
CREATE INDEX canvas_media_node ON canvas_media_outputs(node_id,state);
CREATE TRIGGER canvas_media_identity BEFORE UPDATE ON canvas_media_outputs
WHEN NEW.run_id IS NOT OLD.run_id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id
 OR NEW.node_id<>OLD.node_id OR NEW.kind<>OLD.kind OR NEW.role<>OLD.role
 OR (OLD.state<>'canvas' AND NEW.state<>OLD.state)
 OR (NEW.asset_id<>OLD.asset_id AND (OLD.state<>'canvas' OR EXISTS(SELECT 1 FROM ai_text_assets WHERE id=OLD.asset_id)))
BEGIN SELECT RAISE(ABORT,'canvas_media_identity'); END;
ALTER TABLE member_generation_jobs ADD COLUMN canvas_run_id TEXT REFERENCES canvas_runs(id) ON DELETE SET NULL;
-- Durable video output has the job's stable ID, assigned before the queue send.
CREATE TRIGGER canvas_media_job AFTER INSERT ON member_generation_jobs
BEGIN UPDATE canvas_media_outputs SET asset_id=NEW.id
 WHERE user_id=NEW.user_id AND kind=NEW.media_type AND NEW.canvas_run_id=run_id AND role='original'; END;

-- A deleted producer is not enough: consumers and in-flight writers retain the
-- original until their own reference/lease lifecycle completes.
CREATE VIEW canvas_media_reclaimable AS
SELECT c.* FROM canvas_media_outputs c
JOIN canvas_nodes producer ON producer.id=c.node_id
JOIN canvas_projects project ON project.id=c.project_id
WHERE c.state='canvas' AND (producer.deleted_at IS NOT NULL OR project.deleted_at IS NOT NULL)
AND NOT EXISTS(SELECT 1 FROM canvas_nodes n JOIN canvas_projects p ON p.id=n.project_id
 WHERE n.user_id=c.user_id AND n.deleted_at IS NULL AND p.deleted_at IS NULL AND n.asset_id=c.asset_id)
AND NOT EXISTS(SELECT 1 FROM canvas_runs r JOIN canvas_nodes n ON n.id=r.node_id JOIN canvas_projects p ON p.id=r.project_id
 WHERE r.user_id=c.user_id AND r.id IS NOT c.run_id
 AND ((n.deleted_at IS NULL AND p.deleted_at IS NULL) OR r.status IN ('queued','running')
   OR EXISTS(SELECT 1 FROM member_generation_jobs j WHERE j.request_key='canvas-video-'||r.id AND j.user_id=r.user_id AND j.status IN ('queued','processing','ingesting','preview_pending')
 AND NOT (j.status='preview_pending' AND COALESCE(j.error_code,'')='preview_retry_exhausted' AND j.locked_until IS NULL)))
 AND (EXISTS(SELECT 1 FROM json_each(r.input_json,'$.connected_asset_ids') ref WHERE ref.value=c.asset_id)
 OR EXISTS(SELECT 1 FROM json_each(r.input_json,'$.connected_video_inputs') ref WHERE json_extract(ref.value,'$.frame.imageId')=c.asset_id OR json_extract(ref.value,'$.assetId')=c.asset_id)))
AND NOT EXISTS(SELECT 1 FROM canvas_edges e WHERE e.user_id=c.user_id AND e.deleted_at IS NULL AND json_extract(e.config_json,'$.videoInput.frame.imageId')=c.asset_id)
AND NOT EXISTS(SELECT 1 FROM member_generation_jobs j WHERE j.id=c.asset_id AND j.status IN ('queued','processing','ingesting','preview_pending')
 AND NOT (j.status='preview_pending' AND COALESCE(j.error_code,'')='preview_retry_exhausted' AND j.locked_until IS NULL))
AND NOT EXISTS(SELECT 1 FROM canvas_video_processing p, json_each(p.sources_json) source
 WHERE p.user_id=c.user_id AND p.status IN ('queued','processing','preview_pending') AND json_extract(source.value,'$.assetId')=c.asset_id)
AND NOT EXISTS(SELECT 1 FROM ai_images a WHERE a.id=c.asset_id AND a.derivatives_status IN ('pending','processing'))
AND NOT EXISTS(SELECT 1 FROM canvas_runs r WHERE r.id=c.run_id AND r.status IN ('queued','running'));

CREATE TRIGGER canvas_media_image_insert BEFORE INSERT ON ai_images
WHEN EXISTS(SELECT 1 FROM canvas_media_outputs WHERE asset_id=NEW.id AND (user_id<>NEW.user_id OR state='deleted' OR NEW.visibility='public'))
BEGIN SELECT RAISE(ABORT,'canvas_media_unavailable'); END;
CREATE TRIGGER canvas_media_text_insert BEFORE INSERT ON ai_text_assets
WHEN EXISTS(SELECT 1 FROM canvas_media_outputs WHERE asset_id=NEW.id AND (user_id<>NEW.user_id OR state='deleted' OR NEW.visibility='public'))
BEGIN SELECT RAISE(ABORT,'canvas_media_unavailable'); END;
CREATE TRIGGER canvas_media_image_publication BEFORE UPDATE OF visibility ON ai_images
WHEN NEW.visibility='public' AND EXISTS(SELECT 1 FROM canvas_media_outputs WHERE asset_id=NEW.id AND state<>'saved')
BEGIN SELECT RAISE(ABORT,'canvas_save_required'); END;
CREATE TRIGGER canvas_media_text_publication BEFORE UPDATE OF visibility ON ai_text_assets
WHEN NEW.visibility='public' AND EXISTS(SELECT 1 FROM canvas_media_outputs WHERE asset_id=NEW.id AND state<>'saved')
BEGIN SELECT RAISE(ABORT,'canvas_save_required'); END;
CREATE TRIGGER canvas_media_image_delete BEFORE DELETE ON ai_images
WHEN EXISTS(SELECT 1 FROM canvas_media_outputs WHERE asset_id=OLD.id AND state='canvas')
 AND NOT EXISTS(SELECT 1 FROM canvas_media_reclaimable WHERE asset_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'canvas_media_in_use'); END;
CREATE TRIGGER canvas_media_text_delete BEFORE DELETE ON ai_text_assets
WHEN EXISTS(SELECT 1 FROM canvas_media_outputs WHERE asset_id=OLD.id AND state='canvas')
 AND NOT EXISTS(SELECT 1 FROM canvas_media_reclaimable WHERE asset_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'canvas_media_in_use'); END;
CREATE TRIGGER canvas_media_image_deleted AFTER DELETE ON ai_images
BEGIN UPDATE canvas_media_outputs SET state='deleted' WHERE asset_id=OLD.id AND state='canvas'; END;
CREATE TRIGGER canvas_media_text_deleted AFTER DELETE ON ai_text_assets
BEGIN UPDATE canvas_media_outputs SET state='deleted' WHERE asset_id=OLD.id AND state='canvas'; END;
CREATE TRIGGER canvas_media_node_reference BEFORE UPDATE OF asset_id ON canvas_nodes
WHEN EXISTS(SELECT 1 FROM canvas_media_outputs WHERE asset_id=NEW.asset_id AND state='deleted')
BEGIN SELECT RAISE(ABORT,'canvas_media_unavailable'); END;
CREATE TRIGGER canvas_media_run_reference BEFORE INSERT ON canvas_runs
WHEN EXISTS(SELECT 1 FROM json_each(NEW.input_json,'$.connected_asset_ids') ref JOIN canvas_media_outputs c ON c.asset_id=ref.value WHERE c.state='deleted')
 OR EXISTS(SELECT 1 FROM json_each(NEW.input_json,'$.connected_video_inputs') ref JOIN canvas_media_outputs c ON c.asset_id=json_extract(ref.value,'$.frame.imageId') WHERE c.state='deleted')
BEGIN SELECT RAISE(ABORT,'canvas_media_unavailable'); END;

CREATE TRIGGER canvas_media_node_insert BEFORE INSERT ON canvas_nodes
WHEN EXISTS(SELECT 1 FROM canvas_media_outputs WHERE asset_id=NEW.asset_id AND state='deleted')
BEGIN SELECT RAISE(ABORT,'canvas_media_unavailable'); END;
CREATE TRIGGER canvas_media_processing_reference BEFORE INSERT ON canvas_video_processing
WHEN EXISTS(SELECT 1 FROM json_each(NEW.sources_json) ref JOIN canvas_media_outputs c
 ON c.asset_id=json_extract(ref.value,'$.assetId') WHERE c.state='deleted')
BEGIN SELECT RAISE(ABORT,'canvas_media_unavailable'); END;

CREATE TRIGGER canvas_media_edge_reference BEFORE UPDATE OF config_json ON canvas_edges
WHEN EXISTS(SELECT 1 FROM canvas_media_outputs WHERE asset_id=json_extract(NEW.config_json,'$.videoInput.frame.imageId') AND state='deleted')
BEGIN SELECT RAISE(ABORT,'canvas_media_unavailable'); END;
