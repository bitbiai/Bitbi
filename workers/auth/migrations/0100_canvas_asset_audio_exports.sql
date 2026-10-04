-- Preserve every accepted job, export, head, source and quota byte. Asset-node
-- anchors are real nodes, never synthetic generation runs. Child snapshots are
-- restored before guards resume; no asset/media rows or billing rows are changed.
CREATE TABLE canvas_processing_0100_snapshot AS SELECT * FROM canvas_video_processing;
CREATE TABLE canvas_versions_0100_snapshot AS SELECT * FROM canvas_export_versions;
CREATE TABLE canvas_heads_0100_snapshot AS SELECT * FROM canvas_export_heads;
DROP TABLE canvas_export_heads;
DROP TABLE canvas_export_versions;
DROP TABLE canvas_video_processing;
CREATE TABLE canvas_video_processing (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
 run_id TEXT REFERENCES canvas_runs(id) ON DELETE CASCADE,
 node_id TEXT REFERENCES canvas_nodes(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('poster','concat')),
 sources_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','preview_pending','ready','failed')),
 asset_id TEXT,
 processing_token TEXT,
 locked_until TEXT,
 attempt_count INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL,
 storage_reserved_bytes INTEGER NOT NULL DEFAULT 0,
 poster_reserved_bytes INTEGER NOT NULL DEFAULT 0,
 error_code TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 processing_backend TEXT NOT NULL DEFAULT 'github' CHECK(processing_backend IN ('github','cloudflare')),
 thumbnail_backend TEXT NOT NULL DEFAULT 'github' CHECK(thumbnail_backend IN ('github','cloudflare')),
 recipe_json TEXT,
 preview_base_key TEXT,
 preview_base_etag TEXT,
 preview_base_bytes INTEGER NOT NULL DEFAULT 0 CHECK(preview_base_bytes>=0),
 audio_timeline_json TEXT,
 CHECK ((run_id IS NOT NULL AND node_id IS NULL) OR (run_id IS NULL AND node_id IS NOT NULL AND kind='concat'))
);
CREATE INDEX canvas_video_processing_due ON canvas_video_processing(status,next_attempt_at);
CREATE INDEX canvas_video_processing_owner ON canvas_video_processing(user_id,project_id,run_id);
CREATE UNIQUE INDEX canvas_video_processing_poster ON canvas_video_processing(asset_id) WHERE kind='poster';
CREATE TABLE canvas_export_versions (
 id TEXT PRIMARY KEY REFERENCES canvas_video_processing(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
 run_id TEXT REFERENCES canvas_runs(id) ON DELETE CASCADE,
 node_id TEXT REFERENCES canvas_nodes(id) ON DELETE CASCADE,
 state TEXT NOT NULL DEFAULT 'canvas' CHECK(state IN ('canvas','saved','deleted')),
 retired INTEGER NOT NULL DEFAULT 0 CHECK(retired IN (0,1)),
 created_at TEXT NOT NULL,
 saved_at TEXT,
 CHECK ((run_id IS NOT NULL AND node_id IS NULL) OR (run_id IS NULL AND node_id IS NOT NULL))
);
CREATE TABLE canvas_export_heads (
 id TEXT PRIMARY KEY,
 run_id TEXT UNIQUE REFERENCES canvas_runs(id) ON DELETE CASCADE,
 node_id TEXT UNIQUE REFERENCES canvas_nodes(id) ON DELETE CASCADE,
 latest_id TEXT NOT NULL REFERENCES canvas_export_versions(id),
 current_id TEXT REFERENCES canvas_export_versions(id),
 CHECK ((run_id IS NOT NULL AND node_id IS NULL) OR (run_id IS NULL AND node_id IS NOT NULL))
);
INSERT INTO canvas_video_processing(id,user_id,project_id,run_id,kind,sources_json,status,asset_id,processing_token,locked_until,attempt_count,next_attempt_at,storage_reserved_bytes,poster_reserved_bytes,error_code,created_at,updated_at,processing_backend,thumbnail_backend,recipe_json,preview_base_key,preview_base_etag,preview_base_bytes) SELECT id,user_id,project_id,run_id,kind,sources_json,status,asset_id,processing_token,locked_until,attempt_count,next_attempt_at,storage_reserved_bytes,poster_reserved_bytes,error_code,created_at,updated_at,processing_backend,thumbnail_backend,recipe_json,preview_base_key,preview_base_etag,preview_base_bytes FROM canvas_processing_0100_snapshot;
INSERT INTO canvas_export_versions(id,user_id,project_id,run_id,state,retired,created_at,saved_at)
 SELECT id,user_id,project_id,run_id,state,retired,created_at,saved_at FROM canvas_versions_0100_snapshot;
INSERT INTO canvas_export_heads(id,run_id,latest_id,current_id)
 SELECT 'run:'||run_id,run_id,latest_id,current_id FROM canvas_heads_0100_snapshot;
DROP TABLE canvas_heads_0100_snapshot;
DROP TABLE canvas_versions_0100_snapshot;
DROP TABLE canvas_processing_0100_snapshot;
CREATE INDEX canvas_video_processing_node ON canvas_video_processing(user_id,project_id,node_id);
CREATE INDEX canvas_media_backend_due ON canvas_video_processing(processing_backend,status,next_attempt_at);
CREATE TRIGGER canvas_video_processing_identity BEFORE UPDATE ON canvas_video_processing
WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id
 OR NEW.run_id IS NOT OLD.run_id OR NEW.node_id IS NOT OLD.node_id OR NEW.kind<>OLD.kind OR NEW.sources_json<>OLD.sources_json
BEGIN SELECT RAISE(ABORT,'canvas_processing_identity_immutable'); END;
CREATE TRIGGER canvas_media_backend_immutable BEFORE UPDATE OF processing_backend ON canvas_video_processing
WHEN NEW.processing_backend<>OLD.processing_backend BEGIN SELECT RAISE(ABORT,'media_backend_immutable'); END;
CREATE TRIGGER canvas_thumbnail_backend_immutable BEFORE UPDATE OF thumbnail_backend ON canvas_video_processing
WHEN NEW.thumbnail_backend<>OLD.thumbnail_backend BEGIN SELECT RAISE(ABORT,'media_backend_immutable'); END;
CREATE TRIGGER canvas_media_processing_reference BEFORE INSERT ON canvas_video_processing
WHEN EXISTS(SELECT 1 FROM json_each(NEW.sources_json) ref JOIN canvas_media_outputs c
 ON c.asset_id=json_extract(ref.value,'$.assetId') WHERE c.state='deleted')
BEGIN SELECT RAISE(ABORT,'canvas_media_unavailable'); END;
CREATE TRIGGER canvas_preview_base_fence BEFORE UPDATE OF preview_base_key ON canvas_video_processing
WHEN NEW.preview_base_key IS NOT NULL AND EXISTS(SELECT 1 FROM r2_object_tombstones WHERE r2_key=NEW.preview_base_key)
BEGIN SELECT RAISE(ABORT,'r2_object_key_retired'); END;
CREATE TRIGGER canvas_preview_base_job_deleted AFTER DELETE ON canvas_video_processing
BEGIN
 UPDATE user_asset_storage_usage SET used_bytes=MAX(0,used_bytes-OLD.preview_base_bytes) WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER canvas_export_recipe_immutable BEFORE UPDATE OF recipe_json ON canvas_video_processing
WHEN NEW.recipe_json IS NOT OLD.recipe_json
BEGIN SELECT RAISE(ABORT,'canvas_export_recipe_immutable'); END;
CREATE TRIGGER canvas_export_register AFTER INSERT ON canvas_video_processing
WHEN NEW.kind='concat' AND NEW.recipe_json IS NOT NULL
BEGIN
 INSERT INTO canvas_export_versions(id,user_id,project_id,run_id,node_id,created_at)
 VALUES(NEW.id,NEW.user_id,NEW.project_id,NEW.run_id,NEW.node_id,NEW.created_at);
 INSERT INTO canvas_export_heads(id,run_id,node_id,latest_id) VALUES(COALESCE('run:'||NEW.run_id,'node:'||NEW.node_id),NEW.run_id,NEW.node_id,NEW.id)
 ON CONFLICT(id) DO UPDATE SET latest_id=NEW.id;
END;
-- In the same transaction as durable-result attachment: latest intent wins.
CREATE TRIGGER canvas_export_activate AFTER UPDATE OF asset_id ON canvas_video_processing
WHEN NEW.asset_id=NEW.id AND NEW.recipe_json IS NOT NULL
BEGIN
 UPDATE canvas_export_heads SET current_id=NEW.id WHERE run_id IS NEW.run_id AND node_id IS NEW.node_id AND latest_id=NEW.id;
 UPDATE canvas_export_versions SET retired=1 WHERE run_id IS NEW.run_id AND node_id IS NEW.node_id AND state='canvas'
 AND id<>COALESCE((SELECT current_id FROM canvas_export_heads WHERE run_id IS NEW.run_id AND node_id IS NEW.node_id),'')
 AND EXISTS(SELECT 1 FROM canvas_video_processing p WHERE p.id=canvas_export_versions.id AND p.asset_id IS NOT NULL);
END;
CREATE TRIGGER canvas_export_identity BEFORE UPDATE ON canvas_export_versions
WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.run_id IS NOT OLD.run_id OR NEW.node_id IS NOT OLD.node_id
 OR (OLD.state<>'canvas' AND NEW.state<>OLD.state)
BEGIN SELECT RAISE(ABORT,'canvas_export_identity'); END;
DROP VIEW canvas_export_reclaimable;
CREATE VIEW canvas_export_reclaimable AS
 SELECT v.* FROM canvas_export_versions v JOIN canvas_projects p ON p.id=v.project_id
 LEFT JOIN canvas_runs r ON r.id=v.run_id JOIN canvas_nodes n ON n.id=COALESCE(v.node_id,r.node_id)
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
CREATE TRIGGER canvas_audio_timeline_immutable BEFORE UPDATE OF audio_timeline_json ON canvas_video_processing
WHEN OLD.audio_timeline_json IS NOT NULL AND NEW.audio_timeline_json IS NOT OLD.audio_timeline_json
BEGIN SELECT RAISE(ABORT,'canvas_audio_timeline_immutable'); END;
