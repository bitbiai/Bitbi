-- Q4: durable, source-bound Stream upload intent and receipt.
-- Deliberately no cascading FK: deleting the source must not erase an external
-- side effect whose completion/deletion is still unknown. No historic jobs are
-- requeued, marked fulfilled, or assigned invented provider receipts here.
CREATE TABLE memvid_stream_upload_receipts (
  job_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_r2_key TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('prepared','upload_unknown','received','complete')),
  stream_uid TEXT UNIQUE,
  upload_token TEXT,
  completion_token TEXT,
  claim_token TEXT NOT NULL,
  claim_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  retired_at TEXT,
  last_error_code TEXT,
  CHECK (phase NOT IN ('received','complete') OR stream_uid IS NOT NULL),
  CHECK (phase != 'upload_unknown' OR upload_token IS NOT NULL)
);
CREATE INDEX idx_memvid_stream_receipts_phase_lease
  ON memvid_stream_upload_receipts(phase, retired_at, claim_expires_at);
CREATE INDEX idx_memvid_stream_receipts_source
  ON memvid_stream_upload_receipts(asset_id, user_id);
CREATE TRIGGER memvid_stream_receipt_identity_guard
BEFORE UPDATE ON memvid_stream_upload_receipts
WHEN NEW.job_id IS NOT OLD.job_id OR NEW.asset_id IS NOT OLD.asset_id
  OR NEW.user_id IS NOT OLD.user_id OR NEW.source_r2_key IS NOT OLD.source_r2_key
  OR NEW.source_fingerprint IS NOT OLD.source_fingerprint
  OR (OLD.stream_uid IS NOT NULL AND NEW.stream_uid IS NOT OLD.stream_uid)
  OR (OLD.upload_token IS NOT NULL AND NEW.upload_token IS NOT OLD.upload_token)
  OR (OLD.retired_at IS NOT NULL AND NEW.retired_at IS NOT OLD.retired_at)
  OR (OLD.phase != 'prepared' AND NEW.phase = 'prepared')
  OR (OLD.phase IN ('received','complete') AND NEW.phase = 'upload_unknown')
  OR (OLD.phase = 'complete' AND NEW.phase != 'complete')
BEGIN
  SELECT RAISE(ABORT, 'memvid_stream_receipt_identity_conflict');
END;
CREATE TRIGGER memvid_stream_receipt_preview_deleted
AFTER DELETE ON memvid_stream_previews
BEGIN
  UPDATE memvid_stream_upload_receipts
  SET retired_at = COALESCE(retired_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  WHERE job_id = OLD.id;
END;
CREATE TRIGGER memvid_stream_receipt_preview_retired
AFTER UPDATE ON memvid_stream_previews
WHEN NEW.status IN ('disabled','superseded')
  OR NEW.user_id IS NOT OLD.user_id OR NEW.asset_id IS NOT OLD.asset_id
  OR NEW.source_fingerprint IS NOT OLD.source_fingerprint
  OR NEW.source_r2_key IS NOT OLD.source_r2_key
BEGIN
  UPDATE memvid_stream_upload_receipts
  SET retired_at = COALESCE(retired_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  WHERE job_id = OLD.id;
END;
CREATE TRIGGER memvid_stream_receipt_source_changed
AFTER UPDATE ON ai_text_assets
WHEN NEW.visibility != 'public' OR NEW.source_module != 'video'
  OR NEW.user_id IS NOT OLD.user_id OR NEW.r2_key IS NOT OLD.r2_key
  OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.mime_type IS NOT OLD.mime_type
BEGIN
  UPDATE memvid_stream_upload_receipts
  SET retired_at = COALESCE(retired_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  WHERE asset_id = OLD.id;
END;

-- Bounded keyset scans of legacy ready previews must advance past healthy rows.
CREATE INDEX idx_memvid_stream_preview_status_created_id
  ON memvid_stream_previews(status, created_at, id);
