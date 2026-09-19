-- Existing jobs retain GitHub processing; only newly accepted jobs use the setting.
ALTER TABLE member_generation_jobs ADD COLUMN processing_backend TEXT NOT NULL DEFAULT 'github' CHECK(processing_backend IN ('github','cloudflare'));
ALTER TABLE canvas_video_processing ADD COLUMN processing_backend TEXT NOT NULL DEFAULT 'github' CHECK(processing_backend IN ('github','cloudflare'));
CREATE TRIGGER member_media_backend_immutable BEFORE UPDATE OF processing_backend ON member_generation_jobs
WHEN NEW.processing_backend<>OLD.processing_backend BEGIN SELECT RAISE(ABORT,'media_backend_immutable'); END;
CREATE TRIGGER canvas_media_backend_immutable BEFORE UPDATE OF processing_backend ON canvas_video_processing
WHEN NEW.processing_backend<>OLD.processing_backend BEGIN SELECT RAISE(ABORT,'media_backend_immutable'); END;
CREATE INDEX member_media_backend_due ON member_generation_jobs(processing_backend,status,next_attempt_at);
CREATE INDEX canvas_media_backend_due ON canvas_video_processing(processing_backend,status,next_attempt_at);
-- A fenced start lease, not a second job queue. Actual work stays in existing jobs.
CREATE TABLE private_media_dispatch (
 backend TEXT PRIMARY KEY CHECK(backend IN ('github','cloudflare')),
 token TEXT,
 runner_id TEXT,
 lease_until TEXT,
 error_code TEXT,
 updated_at TEXT NOT NULL
);
INSERT INTO private_media_dispatch(backend,updated_at) VALUES('github',strftime('%Y-%m-%dT%H:%M:%fZ','now')),('cloudflare',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
