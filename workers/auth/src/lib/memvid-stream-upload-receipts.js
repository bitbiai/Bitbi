import { nowIso, randomTokenHex } from './tokens.js';
import { normalizeStreamUid, hasReadyStreamDownloadMetadata } from './cloudflare-stream-previews.js';

export const STREAM_RECEIPT_PROTOCOL = 2;
const LEASE_MS = 10 * 60 * 1000;
const tokenPattern = /^[a-f0-9]{48}$/;
// An upload receipt survives source deletion; eligibility never does.
const eligible = `EXISTS (
  SELECT 1 FROM memvid_stream_previews p JOIN ai_text_assets a ON a.id=p.asset_id
  WHERE p.id=memvid_stream_upload_receipts.job_id
    AND p.asset_id=memvid_stream_upload_receipts.asset_id
    AND p.user_id=memvid_stream_upload_receipts.user_id AND a.user_id=p.user_id
    AND p.source_r2_key=memvid_stream_upload_receipts.source_r2_key AND a.r2_key=p.source_r2_key
    AND p.source_fingerprint=memvid_stream_upload_receipts.source_fingerprint
    AND a.visibility='public' AND a.source_module='video'
    AND p.status IN ('queued','processing','uploading','ready'))`;

export class StreamReceiptError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
function validToken(value) { return typeof value === 'string' && tokenPattern.test(value); }
function checkChanges(result, code) {
  if (Number(result?.meta?.changes) !== 1) throw new StreamReceiptError(code);
}
export async function getStreamUploadReceipt(env, id) {
  return env.DB.prepare('SELECT * FROM memvid_stream_upload_receipts WHERE job_id=?').bind(id).first();
}

const REPAIR_SCAN_KEY = 'memvid.stream_repair_scan.v2';
const REPAIR_SCAN_LIMIT = 64;
async function readRepairCursor(env) {
  const row = await env.DB.prepare('SELECT value_json FROM app_settings WHERE key=? LIMIT 1').bind(REPAIR_SCAN_KEY).first();
  if (!row) return null;
  let value;
  try { value = JSON.parse(row.value_json); } catch { throw new StreamReceiptError('stream_repair_cursor_invalid', 503); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StreamReceiptError('stream_repair_cursor_invalid', 503);
  if (Object.keys(value).length === 0) return null;
  if (Object.keys(value).length !== 2 || typeof value.created_at !== 'string' || value.created_at.length > 64
      || !Number.isFinite(Date.parse(value.created_at)) || typeof value.id !== 'string' || !/^msp_[A-Fa-f0-9]{16,64}$/.test(value.id))
    throw new StreamReceiptError('stream_repair_cursor_invalid', 503);
  return value;
}
async function advanceRepairCursor(env, cursor, now) {
  const result = await env.DB.prepare(`INSERT INTO app_settings(key,value_json,updated_at,updated_by_user_id,reason)
    VALUES(?,?,?,NULL,'Bounded Stream repair scan position; not claim authority')
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at,
      updated_by_user_id=NULL,reason=excluded.reason`).bind(REPAIR_SCAN_KEY, JSON.stringify(cursor || {}), now).run();
  if (Number(result?.meta?.changes) !== 1) throw new StreamReceiptError('stream_repair_cursor_write_failed', 503);
}

export async function claimStreamPreviewJobs(env, { limit = 1, repairDownloads = false } = {}) {
  limit = Math.max(1, Math.min(8, Math.floor(Number(limit) || 1)));
  const now = nowIso(), expires = new Date(Date.now() + LEASE_MS).toISOString();
  // New and already-receipted work is never hidden behind healthy historical
  // previews. All SQL reads remain bounded; repair readiness uses its exact JS
  // URL/status contract rather than an approximate SQL URL recognizer.
  const urgent = await env.DB.prepare(`SELECT p.*, a.mime_type, a.size_bytes
    FROM memvid_stream_previews p JOIN ai_text_assets a ON a.id=p.asset_id
    LEFT JOIN memvid_stream_upload_receipts r ON r.job_id=p.id
    WHERE a.visibility='public' AND a.source_module='video' AND a.user_id=p.user_id
      AND a.r2_key=p.source_r2_key AND p.source_fingerprint IS NOT NULL
      AND ((r.job_id IS NULL AND p.status='queued')
        OR (r.retired_at IS NULL AND r.claim_expires_at<=? AND r.phase IN ('prepared','received')
          AND p.status IN ('processing','uploading','ready')))
    ORDER BY p.created_at,p.id LIMIT ?`).bind(now, Math.min(32, limit * 4)).all();
  let legacy = [], scan = { checked: 0, incomplete: false };
  if (repairDownloads) {
    const cursor = await readRepairCursor(env);
    const page = await env.DB.prepare(`SELECT p.*, a.mime_type, a.size_bytes
      FROM memvid_stream_previews p JOIN ai_text_assets a ON a.id=p.asset_id
      LEFT JOIN memvid_stream_upload_receipts r ON r.job_id=p.id
      WHERE p.status='ready' AND p.stream_uid IS NOT NULL AND r.job_id IS NULL
        AND a.visibility='public' AND a.source_module='video' AND a.user_id=p.user_id
        AND a.r2_key=p.source_r2_key AND p.source_fingerprint IS NOT NULL
        ${cursor ? 'AND (p.created_at,p.id)>(?,?)' : ''}
      ORDER BY p.created_at,p.id LIMIT ?`).bind(...(cursor ? [cursor.created_at, cursor.id] : []), REPAIR_SCAN_LIMIT).all();
    const rows = page.results || [];
    scan = { checked: rows.length, incomplete: rows.length === REPAIR_SCAN_LIMIT };
    legacy = rows.filter(row => !hasReadyStreamDownloadMetadata(row.provider_metadata_json));
    // The cursor is advisory, never an upload permission. Concurrent scans may
    // revisit a page; per-job CAS remains authoritative. Reaching the end resets
    // the next pass, including rows inserted before a previous cursor.
    const last = rows.at(-1);
    await advanceRepairCursor(env, scan.incomplete && last ? { created_at: last.created_at, id: last.id } : null, now);
  }
  const found = [...(urgent.results || []), ...legacy];
  const claimed = [];
  for (const row of found) {
    if (claimed.length >= limit) break;
    const token = randomTokenHex(24);
    // The same transaction establishes the source-bound intent, claims it and
    // changes the preview. A zero-change claim grants no authority.
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO memvid_stream_upload_receipts
        (job_id,asset_id,user_id,source_r2_key,source_fingerprint,phase,stream_uid,claim_token,claim_expires_at,created_at,updated_at)
        SELECT p.id,p.asset_id,p.user_id,p.source_r2_key,p.source_fingerprint,
          CASE WHEN p.stream_uid IS NULL THEN 'prepared' ELSE 'received' END,p.stream_uid,?,?,?,?
        FROM memvid_stream_previews p JOIN ai_text_assets a ON a.id=p.asset_id
        WHERE p.id=? AND p.status IN ('queued','ready') AND a.visibility='public'
          AND a.source_module='video' AND a.user_id=p.user_id AND a.r2_key=p.source_r2_key
          AND p.source_fingerprint IS NOT NULL
        ON CONFLICT(job_id) DO NOTHING`).bind(token, expires, now, now, row.id),
      env.DB.prepare(`UPDATE memvid_stream_upload_receipts SET claim_token=?,claim_expires_at=?,updated_at=?
        WHERE job_id=? AND retired_at IS NULL AND phase IN ('prepared','received')
          AND (claim_token=? OR claim_expires_at<=?) AND ${eligible}`)
        .bind(token, expires, now, row.id, token, now),
      env.DB.prepare(`UPDATE memvid_stream_previews SET status=CASE WHEN status='ready' THEN status ELSE 'processing' END,updated_at=?
        WHERE id=? AND EXISTS(SELECT 1 FROM memvid_stream_upload_receipts r
          WHERE r.job_id=memvid_stream_previews.id AND r.claim_token=? AND r.retired_at IS NULL)`)
        .bind(now, row.id, token),
    ]);
    if (Number(results[1]?.meta?.changes) !== 1) continue;
    const receipt = await getStreamUploadReceipt(env, row.id);
    if (receipt?.claim_token !== token || receipt.retired_at) continue;
    claimed.push({ ...row, claim_token: token, stream_uid: receipt.stream_uid,
      repair_download: !!receipt.stream_uid, receipt_protocol: STREAM_RECEIPT_PROTOCOL });
  }
  scan.incomplete ||= found.length > claimed.length;
  return { jobs: claimed, scan };
}

export async function beginStreamUpload(env, id, { claim_token: token, source_fingerprint: fingerprint } = {}) {
  if (!validToken(token)) throw new StreamReceiptError('stream_claim_required');
  const now = nowIso();
  const result = await env.DB.prepare(`UPDATE memvid_stream_upload_receipts
    SET phase='upload_unknown',upload_token=?,updated_at=?,last_error_code=NULL
    WHERE job_id=? AND claim_token=? AND phase='prepared' AND stream_uid IS NULL
      AND source_fingerprint=? AND retired_at IS NULL AND claim_expires_at>? AND ${eligible}`)
    .bind(token, now, id, token, fingerprint || '', now).run();
  // Never replay an upload permit after a lost begin response.
  checkChanges(result, 'stream_upload_not_authorized');
  return { upload_token: token, phase: 'upload_unknown' };
}

export async function recordStreamUpload(env, id, { upload_token: token, stream_uid: value, source_fingerprint: fingerprint } = {}) {
  const uid = normalizeStreamUid(value);
  if (!validToken(token) || !uid) throw new StreamReceiptError('stream_receipt_invalid', 400);
  const existing = await getStreamUploadReceipt(env, id);
  if (!existing || existing.upload_token !== token || existing.source_fingerprint !== fingerprint)
    throw new StreamReceiptError('stream_receipt_identity_conflict');
  if (existing.stream_uid) {
    if (existing.stream_uid !== uid) throw new StreamReceiptError('stream_receipt_identity_conflict');
    return { phase: existing.phase, stream_uid: uid, retired: !!existing.retired_at };
  }
  // A late receipt is retained even when its lease/source is gone. It conveys
  // outcome evidence only, never renewed publication or deletion authority.
  const result = await env.DB.prepare(`UPDATE memvid_stream_upload_receipts
    SET stream_uid=?,phase='received',updated_at=?,last_error_code=NULL
    WHERE job_id=? AND upload_token=? AND source_fingerprint=? AND phase='upload_unknown' AND stream_uid IS NULL`)
    .bind(uid, nowIso(), id, token, fingerprint).run();
  if (Number(result?.meta?.changes) !== 1) {
    const current = await getStreamUploadReceipt(env, id);
    if (current?.stream_uid !== uid || current.upload_token !== token) throw new StreamReceiptError('stream_receipt_identity_conflict');
  }
  // UID is also projected into the existing diagnostic/gallery model, while
  // the independent receipt remains authoritative if this projection fails.
  await env.DB.prepare(`UPDATE memvid_stream_previews SET stream_uid=? WHERE id=?
    AND (stream_uid IS NULL OR stream_uid=?) AND source_fingerprint=?`).bind(uid, id, uid, fingerprint).run();
  const current = await getStreamUploadReceipt(env, id);
  return { phase: current.phase, stream_uid: uid, retired: !!current.retired_at };
}

export async function completeStreamUpload(env, id, body, { duration, maxLoops, metadata }) {
  const uid = normalizeStreamUid(body.stream_uid || body.streamUid), now = nowIso();
  const completionToken = randomTokenHex(24);
  if (!validToken(body.claim_token)) throw new StreamReceiptError('stream_claim_required');
  const existing = await getStreamUploadReceipt(env, id);
  if (existing?.phase === 'complete' && existing.stream_uid === uid
      && existing.source_fingerprint === body.source_fingerprint && !existing.retired_at)
    return { status: 'ready', stream_uid: uid, duplicate: true };
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE memvid_stream_upload_receipts SET phase='complete',updated_at=?,last_error_code=NULL,completion_token=?
      WHERE job_id=? AND stream_uid=? AND source_fingerprint=? AND claim_token=?
        AND claim_expires_at>? AND phase='received' AND retired_at IS NULL AND ${eligible}`)
      .bind(now, completionToken, id, uid, body.source_fingerprint || '', body.claim_token, now),
    env.DB.prepare(`UPDATE memvid_stream_previews SET status='ready',stream_uid=?,preview_duration_seconds=?,
      max_loop_count=?,completed_at=COALESCE(completed_at,?),updated_at=?,error_code=NULL,error_message=NULL,provider_metadata_json=?
      WHERE id=? AND EXISTS(SELECT 1 FROM memvid_stream_upload_receipts r
        WHERE r.job_id=memvid_stream_previews.id AND r.phase='complete' AND r.claim_token=?
          AND r.claim_expires_at>? AND r.retired_at IS NULL AND r.stream_uid=? AND r.completion_token=?)`)
      .bind(uid, duration, maxLoops, now, now, metadata, id, body.claim_token, now, uid, completionToken),
  ]);
  checkChanges(results[0], 'stream_completion_not_authorized');
  checkChanges(results[1], 'stream_completion_target_missing');
  return { status: 'ready', stream_uid: uid };
}

export async function failStreamUpload(env, id, body = {}) {
  if (!validToken(body.claim_token)) throw new StreamReceiptError('stream_claim_required');
  const now = nowIso(), code = String(body.error_code || 'stream_processing_failed').replace(/[^a-z0-9_:-]/gi, '_').slice(0, 80);
  const result = await env.DB.prepare(`UPDATE memvid_stream_upload_receipts
    SET last_error_code=?,updated_at=?,claim_expires_at=? WHERE job_id=? AND claim_token=?
      AND phase!='complete' AND retired_at IS NULL`).bind(code, now, now, id, body.claim_token).run();
  const row = await getStreamUploadReceipt(env, id);
  if (!row || row.claim_token !== body.claim_token) throw new StreamReceiptError('stream_claim_lost');
  if (row.phase === 'complete') return { status: 'ready', ignored: true };
  if (Number(result?.meta?.changes) !== 1 && !row.retired_at) throw new StreamReceiptError('stream_claim_lost');
  // Keep active preview membership: unknown upload outcomes cannot cause the
  // next publish/backfill to create a second job for the same source.
  await env.DB.prepare(`UPDATE memvid_stream_previews SET error_code=?,error_message=?,updated_at=?
    WHERE id=? AND status IN ('processing','uploading')
      AND EXISTS(SELECT 1 FROM memvid_stream_upload_receipts r WHERE r.job_id=memvid_stream_previews.id
        AND r.claim_token=? AND r.retired_at IS NULL AND r.phase!='complete')`).bind(code,
    row.phase === 'upload_unknown' ? 'Upload outcome unknown; reconcile the original provider intent before any new upload.'
      : 'Processing incomplete; resume the stored receipt or unstarted intent.', now, id, body.claim_token).run();
  return { status: row.retired_at ? 'retired' : 'processing', phase: row.phase,
    next_action: row.retired_at ? 'review_retained_receipt' : row.phase === 'upload_unknown' ? 'reconcile_provider_intent' : 'resume_same_job' };
}
