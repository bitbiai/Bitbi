import {
  DATA_EXPORT_ARCHIVE_PREFIX,
  isApprovedDataExportArchiveKey,
  requireArchiveBucket,
  serializeDataExportArchive,
} from "./data-export-archive.js";
import { DataLifecycleError } from "./data-lifecycle.js";
import { nowIso, sha256Hex } from "./tokens.js";

const ARCHIVE_BUCKET_LABEL = "AUDIT_ARCHIVE";
const DEFAULT_CLEANUP_LIMIT = 25;
const MAX_CLEANUP_LIMIT = 50;

function normalizeCleanupLimit(value) {
  return Math.max(1, Math.min(Number(value) || DEFAULT_CLEANUP_LIMIT, MAX_CLEANUP_LIMIT));
}

async function listCleanupCandidates(env, now, limit) {
  const rows = await env.DB.prepare(
    `SELECT id, request_id, subject_user_id, r2_bucket, r2_key, sha256, size_bytes,
            manifest_version, status, expires_at, created_at, updated_at, downloaded_at,
            deleted_at, error_code, error_message
     FROM data_export_archives
     WHERE deleted_at IS NULL
       AND expires_at <= ?
       AND (
         status IN ('ready', 'expired')
         OR (status = 'cleanup_failed' AND error_code = 'archive_cleanup_r2_failed')
       )
     ORDER BY expires_at ASC, created_at ASC, id ASC
     LIMIT ?`
  ).bind(now, limit).all();
  return rows.results || [];
}

async function requestIsExport(env, requestId) {
  const row = await env.DB.prepare(
    "SELECT id, type FROM data_lifecycle_requests WHERE id = ? LIMIT 1"
  ).bind(requestId).first();
  return row?.type === "export";
}

async function markArchiveCleanupFailure(env, archiveId, now, code, message) {
  await env.DB.prepare(
    "UPDATE data_export_archives SET status = 'cleanup_failed', error_code = ?, error_message = ?, updated_at = ? WHERE id = ?"
  ).bind(code, message, now, archiveId).run();
}

async function markArchiveDeleted(env, archiveId, now) {
  await env.DB.prepare(
    "UPDATE data_export_archives SET status = 'deleted', deleted_at = ?, updated_at = ?, error_code = NULL, error_message = NULL WHERE id = ?"
  ).bind(now, now, archiveId).run();
}

export async function cleanupExpiredDataExportArchives({ env, now = nowIso(), limit = DEFAULT_CLEANUP_LIMIT } = {}) {
  const appliedLimit = normalizeCleanupLimit(limit);
  const bucket = requireArchiveBucket(env);
  if (typeof bucket.delete !== "function") {
    throw new DataLifecycleError("Export archive cleanup storage is unavailable.", {
      status: 503,
      code: "archive_cleanup_storage_unavailable",
    });
  }

  const candidates = await listCleanupCandidates(env, now, appliedLimit);
  const results = [];
  let deletedCount = 0;
  let missingCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const row of candidates) {
    const keyHash = row.r2_key ? await sha256Hex(row.r2_key) : null;
    const result = {
      archiveId: row.id,
      requestId: row.request_id,
      statusBefore: row.status || null,
      keySha256: keyHash,
      deleted: false,
      missing: false,
      skipped: false,
      errorCode: null,
    };

    if (row.r2_bucket !== ARCHIVE_BUCKET_LABEL || !isApprovedDataExportArchiveKey(row.r2_key)) {
      await markArchiveCleanupFailure(
        env,
        row.id,
        now,
        "archive_cleanup_invalid_scope",
        `Export archive cleanup only deletes ${DATA_EXPORT_ARCHIVE_PREFIX} objects from ${ARCHIVE_BUCKET_LABEL}.`
      );
      result.skipped = true;
      result.errorCode = "archive_cleanup_invalid_scope";
      skippedCount += 1;
      results.push(result);
      continue;
    }

    if (!(await requestIsExport(env, row.request_id))) {
      await markArchiveCleanupFailure(
        env,
        row.id,
        now,
        "archive_cleanup_request_missing",
        "Export archive cleanup requires a matching export lifecycle request."
      );
      result.skipped = true;
      result.errorCode = "archive_cleanup_request_missing";
      skippedCount += 1;
      results.push(result);
      continue;
    }

    try {
      const object = await bucket.get(row.r2_key);
      if (object) {
        await bucket.delete(row.r2_key);
        result.deleted = true;
        deletedCount += 1;
      } else {
        result.missing = true;
        missingCount += 1;
      }
      await markArchiveDeleted(env, row.id, now);
    } catch {
      await markArchiveCleanupFailure(
        env,
        row.id,
        now,
        "archive_cleanup_r2_failed",
        "Export archive R2 cleanup failed."
      );
      result.errorCode = "archive_cleanup_r2_failed";
      failedCount += 1;
    }
    results.push(result);
  }

  return {
    scannedCount: candidates.length,
    deletedCount,
    missingCount,
    failedCount,
    skippedCount,
    appliedLimit,
    results,
  };
}

export function serializeCleanupCandidate(row) {
  return serializeDataExportArchive(row);
}
