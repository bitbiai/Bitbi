import { addDaysIso, nowIso, randomTokenHex, sha256Hex } from "./tokens.js";
import { DataLifecycleError } from "./data-lifecycle.js";

export const DATA_EXPORT_ARCHIVE_CONTENT_TYPE = "application/json; charset=utf-8";

const ARCHIVE_BUCKET_BINDING = "AUDIT_ARCHIVE";
const ARCHIVE_BUCKET_LABEL = "AUDIT_ARCHIVE";
const ARCHIVE_MANIFEST_VERSION = 1;
const ARCHIVE_TTL_DAYS = 14;
const MAX_ARCHIVE_ITEMS = 1_000;
const MAX_ARCHIVE_BYTES = 512 * 1024;
const FORBIDDEN_SUMMARY_KEY_PATTERN =
  /(password|token|secret|signature|credential|recovery|mfa|hash|api[_-]?key|authorization|cookie)/i;

function archiveId() {
  return `dla_${randomTokenHex(16)}`;
}

function requireArchiveBucket(env) {
  const bucket = env?.[ARCHIVE_BUCKET_BINDING];
  if (!bucket || typeof bucket.put !== "function" || typeof bucket.get !== "function") {
    throw new DataLifecycleError("Export archive storage is unavailable.", {
      status: 503,
      code: "archive_storage_unavailable",
    });
  }
  return bucket;
}

function parseSummary(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeValue(value, depth = 0, forbiddenReferences = new Set()) {
  if (depth > 5) return null;
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, depth + 1, forbiddenReferences));
  }
  if (typeof value === "string" && forbiddenReferences.has(value)) {
    return "[redacted-internal-reference]";
  }
  if (typeof value !== "object") return value;

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_SUMMARY_KEY_PATTERN.test(key)) continue;
    output[key] = sanitizeValue(entry, depth + 1, forbiddenReferences);
  }
  return output;
}

function serializeArchive(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestId: row.request_id,
    subjectUserId: row.subject_user_id,
    status: row.status || "ready",
    manifestVersion: Number(row.manifest_version || ARCHIVE_MANIFEST_VERSION),
    sizeBytes: Number(row.size_bytes || 0),
    sha256: row.sha256 || null,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at || null,
    downloadedAt: row.downloaded_at || null,
    deletedAt: row.deleted_at || null,
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
    storage: {
      private: true,
      bucketBinding: ARCHIVE_BUCKET_LABEL,
      contentType: DATA_EXPORT_ARCHIVE_CONTENT_TYPE,
    },
  };
}

async function fetchRequest(env, requestId) {
  return env.DB.prepare(
    `SELECT id, type, subject_user_id, requested_by_user_id, requested_by_admin_id, status,
            reason, approval_required, approved_by_admin_id, approved_at, idempotency_key,
            request_hash, dry_run, created_at, updated_at, completed_at, expires_at,
            error_code, error_message
     FROM data_lifecycle_requests
     WHERE id = ?
     LIMIT 1`
  ).bind(requestId).first();
}

async function fetchItems(env, requestId) {
  const rows = await env.DB.prepare(
    `SELECT id, request_id, resource_type, resource_id, table_name, r2_bucket, r2_key,
            action, status, summary_json, created_at, updated_at
     FROM data_lifecycle_request_items
     WHERE request_id = ?
     ORDER BY created_at ASC, id ASC`
  ).bind(requestId).all();
  return rows.results || [];
}

async function fetchExistingReadyArchive(env, requestId, now) {
  return env.DB.prepare(
    `SELECT id, request_id, subject_user_id, r2_bucket, r2_key, sha256, size_bytes,
            manifest_version, status, expires_at, created_at, updated_at, downloaded_at,
            deleted_at, error_code, error_message
     FROM data_export_archives
     WHERE request_id = ? AND status = 'ready' AND expires_at > ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(requestId, now).first();
}

async function fetchLatestArchiveForRequest(env, requestId) {
  return env.DB.prepare(
    `SELECT id, request_id, subject_user_id, r2_bucket, r2_key, sha256, size_bytes,
            manifest_version, status, expires_at, created_at, updated_at, downloaded_at,
            deleted_at, error_code, error_message
     FROM data_export_archives
     WHERE request_id = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(requestId).first();
}

async function fetchArchiveById(env, archiveIdValue) {
  return env.DB.prepare(
    `SELECT id, request_id, subject_user_id, r2_bucket, r2_key, sha256, size_bytes,
            manifest_version, status, expires_at, created_at, updated_at, downloaded_at,
            deleted_at, error_code, error_message
     FROM data_export_archives
     WHERE id = ?
     LIMIT 1`
  ).bind(archiveIdValue).first();
}

async function markRequestExportFailure(env, requestId, code, message) {
  const now = nowIso();
  await env.DB.prepare(
    "UPDATE data_lifecycle_requests SET status = 'export_failed', error_code = ?, error_message = ?, updated_at = ? WHERE id = ?"
  ).bind(code, message, now, requestId).run();
}

function classifyR2Key(key) {
  if (String(key || "").startsWith("avatars/")) return "avatar";
  if (String(key || "").startsWith("users/")) return "user_media";
  return "private_object";
}

async function safeStorageReference(entry) {
  if (!entry.r2_key) return null;
  return {
    bucket: entry.r2_bucket || null,
    keyClass: classifyR2Key(entry.r2_key),
    keySha256: await sha256Hex(entry.r2_key),
    internalKeyIncluded: false,
  };
}

async function buildArchiveDocument(request, items, createdAt) {
  const records = [];
  const media = [];

  for (const entry of items) {
    const storageReference = await safeStorageReference(entry);
    const record = {
      id: entry.id,
      resourceType: entry.resource_type,
      resourceId: entry.resource_id || null,
      tableName: entry.table_name || null,
      action: entry.action,
      status: entry.status,
      summary: sanitizeValue(
        parseSummary(entry.summary_json),
        0,
        new Set([entry.r2_key].filter(Boolean))
      ),
      createdAt: entry.created_at,
    };
    if (storageReference) {
      record.storageReference = storageReference;
    }
    records.push(record);
    if (storageReference) {
      media.push({
        itemId: entry.id,
        resourceType: entry.resource_type,
        resourceId: entry.resource_id || null,
        ...storageReference,
        action: entry.action,
      });
    }
  }

  return {
    manifest: {
      version: ARCHIVE_MANIFEST_VERSION,
      generatedAt: createdAt,
      format: "bitbi-user-export-json-v1",
      binaryPolicy: "media_manifest_references_only",
      secretPolicy: "passwords_tokens_mfa_service_credentials_and_raw_internal_logs_omitted",
    },
    request: {
      id: request.id,
      type: request.type,
      status: request.status,
      subjectUserId: request.subject_user_id,
      approvedAt: request.approved_at || null,
      createdAt: request.created_at,
    },
    records,
    media,
  };
}

function assertArchiveRequestReady(request, items) {
  if (!request) {
    throw new DataLifecycleError("Data lifecycle request not found.", {
      status: 404,
      code: "request_not_found",
    });
  }
  if (request.type !== "export") {
    throw new DataLifecycleError("Only export requests can generate archives.", {
      status: 409,
      code: "not_export_request",
    });
  }
  if (request.status === "export_ready") return;
  if (request.status !== "approved") {
    throw new DataLifecycleError("Export request must be planned and approved before archive generation.", {
      status: 409,
      code: "export_approval_required",
    });
  }
  if (!items.length) {
    throw new DataLifecycleError("Export request must be planned before archive generation.", {
      status: 409,
      code: "plan_required",
    });
  }
}

export async function generateDataExportArchive({ env, requestId }) {
  const bucket = requireArchiveBucket(env);
  const now = nowIso();
  const existing = await fetchExistingReadyArchive(env, requestId, now);
  if (existing) {
    return { archive: serializeArchive(existing), reused: true };
  }

  const request = await fetchRequest(env, requestId);
  const items = request ? await fetchItems(env, request.id) : [];
  assertArchiveRequestReady(request, items);

  if (items.length > MAX_ARCHIVE_ITEMS) {
    await markRequestExportFailure(env, request.id, "export_too_large", "Export contains too many items for the bounded archive generator.");
    throw new DataLifecycleError("Export is too large for this archive generator.", {
      status: 413,
      code: "export_too_large",
    });
  }

  const archive = await buildArchiveDocument(request, items, now);
  const body = JSON.stringify(archive, null, 2);
  const sizeBytes = new TextEncoder().encode(body).byteLength;
  if (sizeBytes > MAX_ARCHIVE_BYTES) {
    await markRequestExportFailure(env, request.id, "export_too_large", "Export archive exceeds the bounded JSON archive size.");
    throw new DataLifecycleError("Export is too large for this archive generator.", {
      status: 413,
      code: "export_too_large",
    });
  }

  const id = archiveId();
  const key = `data-exports/${request.subject_user_id}/${request.id}/${id}.json`;
  const sha256 = await sha256Hex(body);
  const expiresAt = addDaysIso(ARCHIVE_TTL_DAYS);

  await env.DB.prepare(
    `INSERT INTO data_export_archives (
       id, request_id, subject_user_id, r2_bucket, r2_key, sha256, size_bytes,
       expires_at, created_at, manifest_version, status, updated_at, downloaded_at,
       deleted_at, error_code, error_message
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    request.id,
    request.subject_user_id,
    ARCHIVE_BUCKET_LABEL,
    key,
    sha256,
    sizeBytes,
    expiresAt,
    now,
    ARCHIVE_MANIFEST_VERSION,
    "pending",
    now,
    null,
    null,
    null,
    null
  ).run();

  try {
    await bucket.put(key, body, {
      httpMetadata: {
        contentType: DATA_EXPORT_ARCHIVE_CONTENT_TYPE,
        cacheControl: "private, no-store",
      },
    });
  } catch (error) {
    const updatedAt = nowIso();
    await env.DB.prepare(
      "UPDATE data_export_archives SET status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE id = ?"
    ).bind("archive_storage_failed", "Export archive storage failed.", updatedAt, id).run();
    await markRequestExportFailure(env, request.id, "archive_storage_failed", "Export archive storage failed.");
    throw new DataLifecycleError("Export archive storage failed.", {
      status: 503,
      code: "archive_storage_failed",
    });
  }

  const readyAt = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE data_export_archives SET status = 'ready', updated_at = ? WHERE id = ?"
    ).bind(readyAt, id),
    env.DB.prepare(
      "UPDATE data_lifecycle_requests SET status = 'export_ready', completed_at = ?, updated_at = ?, error_code = NULL, error_message = NULL WHERE id = ?"
    ).bind(readyAt, readyAt, request.id),
  ]);

  const row = await fetchArchiveById(env, id);
  return { archive: serializeArchive(row), reused: false };
}

export async function getDataExportArchiveForRequest(env, requestId) {
  const request = await fetchRequest(env, requestId);
  if (!request) {
    throw new DataLifecycleError("Data lifecycle request not found.", {
      status: 404,
      code: "request_not_found",
    });
  }
  const archive = await fetchLatestArchiveForRequest(env, request.id);
  if (!archive) {
    throw new DataLifecycleError("Export archive not found.", {
      status: 404,
      code: "archive_not_found",
    });
  }
  return { archive: serializeArchive(archive) };
}

export async function readDataExportArchive({ env, archiveId: archiveIdValue }) {
  const row = await fetchArchiveById(env, archiveIdValue);
  if (!row) {
    throw new DataLifecycleError("Export archive not found.", {
      status: 404,
      code: "archive_not_found",
    });
  }
  if (row.status !== "ready") {
    throw new DataLifecycleError("Export archive is not available.", {
      status: 409,
      code: "archive_not_ready",
    });
  }
  const now = nowIso();
  if (row.expires_at <= now) {
    await env.DB.prepare(
      "UPDATE data_export_archives SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'ready'"
    ).bind(now, row.id).run();
    throw new DataLifecycleError("Export archive has expired.", {
      status: 410,
      code: "archive_expired",
    });
  }

  const bucket = requireArchiveBucket(env);
  const object = await bucket.get(row.r2_key);
  if (!object) {
    throw new DataLifecycleError("Export archive object not found.", {
      status: 404,
      code: "archive_object_not_found",
    });
  }

  await env.DB.prepare(
    "UPDATE data_export_archives SET downloaded_at = ?, updated_at = ? WHERE id = ?"
  ).bind(now, now, row.id).run();

  return {
    archive: serializeArchive({ ...row, downloaded_at: now, updated_at: now }),
    object,
  };
}
