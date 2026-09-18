-- Private postprocessing only. No usage attempt, inference or credit operation.
CREATE TABLE canvas_video_processing (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES canvas_projects(id) ON DELETE CASCADE,
 run_id TEXT NOT NULL REFERENCES canvas_runs(id) ON DELETE CASCADE,
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
 updated_at TEXT NOT NULL
);
CREATE INDEX canvas_video_processing_due ON canvas_video_processing(status,next_attempt_at);
CREATE INDEX canvas_video_processing_owner ON canvas_video_processing(user_id,project_id,run_id);
CREATE UNIQUE INDEX canvas_video_processing_poster ON canvas_video_processing(asset_id) WHERE kind='poster';
CREATE TRIGGER canvas_video_processing_identity BEFORE UPDATE ON canvas_video_processing
WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id
 OR NEW.run_id<>OLD.run_id OR NEW.kind<>OLD.kind OR NEW.sources_json<>OLD.sources_json
BEGIN SELECT RAISE(ABORT,'canvas_processing_identity_immutable'); END;
-- An expired processor cannot insert an original; existing generation guards stay intact.
ALTER TABLE ai_text_assets ADD COLUMN canvas_processing_token TEXT;
CREATE TRIGGER canvas_processing_asset_claim BEFORE INSERT ON ai_text_assets
WHEN NEW.canvas_processing_token IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM canvas_video_processing WHERE id=NEW.id AND user_id=NEW.user_id AND kind='concat'
 AND processing_token=NEW.canvas_processing_token AND status='processing'
 AND locked_until>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'canvas_processing_claim_lost'); END;
