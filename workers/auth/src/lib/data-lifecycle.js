import { nowIso, addDaysIso, randomTokenHex, sha256Hex } from "./tokens.js";
import {
  classifyStorageObjectKey,
  redactStorageObjectKey,
  sanitizeStorageEvidenceSummary,
} from "./storage-key-redaction.js";

export const DATA_LIFECYCLE_REQUEST_TYPES = Object.freeze(["export", "delete", "anonymize"]);
export const DATA_LIFECYCLE_STATUSES = Object.freeze({
  submitted: "submitted",
  planned: "planned",
  approved: "approved",
  blocked: "blocked",
  safeActionsCompleted: "safe_actions_completed",
  completed: "completed",
  completedWithRetention: "completed_with_retention",
  rejected: "rejected",
  closed: "closed",
  blockedRequiresLegalReview: "blocked_requires_legal_review",
});

const EXPORT_ARCHIVE_TTL_DAYS = 14;
const MAX_REASON_LENGTH = 500;
const MAX_COMPLETION_NOTE_LENGTH = 1000;
const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const FINAL_STATUSES = new Set([
  DATA_LIFECYCLE_STATUSES.completed,
  DATA_LIFECYCLE_STATUSES.completedWithRetention,
  DATA_LIFECYCLE_STATUSES.rejected,
  DATA_LIFECYCLE_STATUSES.closed,
  DATA_LIFECYCLE_STATUSES.blockedRequiresLegalReview,
]);
const POLICY_RETAINED_CATEGORY_IDS = new Set([
  "billing_credit_ledger",
  "provider_webhook_evidence",
  "admin_audit_user_activity_security",
  "legal_compliance_retention",
  "lifecycle_evidence_records",
]);

export class DataLifecycleError extends Error {
  constructor(message, { status = 400, code = "bad_request", details = null } = {}) {
    super(message);
    this.name = "DataLifecycleError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function normalizeDataLifecycleIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (
    key.length < IDEMPOTENCY_KEY_MIN_LENGTH ||
    key.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
    !IDEMPOTENCY_KEY_PATTERN.test(key)
  ) {
    throw new DataLifecycleError("A valid Idempotency-Key header is required.", {
      status: 428,
      code: "idempotency_key_required",
    });
  }
  return key;
}

export function requireDataLifecycleConfirmation(body, {
  message = "Explicit confirmation is required for this data lifecycle action.",
  code = "confirmation_required",
} = {}) {
  if (body?.confirm !== true) {
    throw new DataLifecycleError(message, {
      status: 409,
      code,
    });
  }
}

function normalizeType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (!DATA_LIFECYCLE_REQUEST_TYPES.includes(type)) {
    throw new DataLifecycleError("Invalid data lifecycle request type.", {
      status: 400,
      code: "invalid_type",
    });
  }
  return type;
}

function normalizeUserId(value) {
  const userId = String(value || "").trim();
  if (!userId || userId.length > 128) {
    throw new DataLifecycleError("A valid subject user id is required.", {
      status: 400,
      code: "invalid_subject_user",
    });
  }
  return userId;
}

function normalizeReason(value) {
  if (value == null) return null;
  const reason = String(value).trim();
  if (!reason) return null;
  return reason.slice(0, MAX_REASON_LENGTH);
}

function lifecycleRequestId() {
  return `dlr_${randomTokenHex(16)}`;
}

function lifecycleItemId(requestId, index) {
  return `dli_${requestId}_${String(index).padStart(4, "0")}`;
}

function serializeBoolean(value) {
  return Number(value || 0) === 1;
}

function parseSummaryJson(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonValue(value, fallback) {
  try {
    if (value == null || value === "") return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeCompletionNote(value, {
  fieldName = "completion note",
  code = "completion_note_required",
} = {}) {
  const note = String(value || "").trim();
  if (!note) {
    throw new DataLifecycleError(`A ${fieldName} is required.`, {
      status: 400,
      code,
    });
  }
  return note.slice(0, MAX_COMPLETION_NOTE_LENGTH);
}

function isFinalStatus(status) {
  return FINAL_STATUSES.has(String(status || ""));
}

function serializeRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    subjectUserId: row.subject_user_id,
    requestedByUserId: row.requested_by_user_id || null,
    requestedByAdminId: row.requested_by_admin_id || null,
    status: row.status,
    reason: row.reason || null,
    approvalRequired: serializeBoolean(row.approval_required),
    approvedByAdminId: row.approved_by_admin_id || null,
    approvedAt: row.approved_at || null,
    dryRun: serializeBoolean(row.dry_run),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || null,
    finalStatus: row.final_status || (isFinalStatus(row.status) ? row.status : null),
    evidenceStatus: row.evidence_status || null,
    completedByUserId: row.completed_by_user_id || null,
    completionNote: row.completion_note || null,
    completionSummary: parseJsonValue(row.completion_summary_json, null),
    retainedCategories: parseJsonValue(row.retained_categories_json, []),
    executionSummary: parseJsonValue(row.execution_summary_json, null),
    closedAt: row.closed_at || null,
    closedByUserId: row.closed_by_user_id || null,
    closureReason: row.closure_reason || null,
    rejectionReason: row.rejection_reason || null,
    expiresAt: row.expires_at || null,
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
  };
}

async function serializeItem(row) {
  if (!row) return null;
  const storageReference = row.r2_key
    ? await redactStorageObjectKey(row.r2_key, { bucket: row.r2_bucket || null })
    : null;
  const summary = row.r2_key
    ? await sanitizeStorageEvidenceSummary(parseSummaryJson(row.summary_json), [row.r2_key])
    : parseSummaryJson(row.summary_json);
  return {
    id: row.id,
    requestId: row.request_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id || null,
    tableName: row.table_name || null,
    r2Bucket: row.r2_bucket || null,
    r2Key: null,
    internalR2KeyIncluded: false,
    storageReference,
    action: row.action,
    status: row.status,
    summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function safeJson(value) {
  return JSON.stringify(value || {});
}

function item({
  requestId,
  index,
  resourceType,
  resourceId = null,
  tableName = null,
  r2Bucket = null,
  r2Key = null,
  action,
  status = "planned",
  summary = {},
  createdAt,
}) {
  return {
    id: lifecycleItemId(requestId, index),
    request_id: requestId,
    resource_type: resourceType,
    resource_id: resourceId,
    table_name: tableName,
    r2_bucket: r2Bucket,
    r2_key: r2Key,
    action,
    status,
    summary_json: safeJson(summary),
    created_at: createdAt,
    updated_at: createdAt,
  };
}

async function fetchSubjectUser(env, userId) {
  const user = await env.DB.prepare(
    "SELECT id, email, role, status FROM users WHERE id = ? LIMIT 1"
  ).bind(userId).first();
  if (!user) {
    throw new DataLifecycleError("Subject user not found.", {
      status: 404,
      code: "subject_not_found",
    });
  }
  return user;
}

async function buildRequestHash({ type, subjectUserId, adminUserId, reason, dryRun }) {
  return sha256Hex(JSON.stringify({
    type,
    subjectUserId,
    adminUserId,
    reason: reason || "",
    dryRun: Boolean(dryRun),
  }));
}

async function fetchExistingRequest(env, { type, subjectUserId, adminUserId, idempotencyKey }) {
  return env.DB.prepare(
    `SELECT id, type, subject_user_id, requested_by_user_id, requested_by_admin_id, status,
            reason, approval_required, approved_by_admin_id, approved_at, idempotency_key,
            request_hash, dry_run, created_at, updated_at, completed_at, expires_at,
            final_status, evidence_status, completed_by_user_id, completion_note,
            completion_summary_json, retained_categories_json, execution_summary_json,
            closed_at, closed_by_user_id, closure_reason, rejection_reason,
            error_code, error_message
     FROM data_lifecycle_requests
     WHERE type = ? AND requested_by_admin_id = ? AND subject_user_id = ? AND idempotency_key = ?
     LIMIT 1`
  ).bind(type, adminUserId, subjectUserId, idempotencyKey).first();
}

export async function createDataLifecycleRequest({ env, adminUser, body, idempotencyKey }) {
  const type = normalizeType(body?.type);
  const subjectUserId = normalizeUserId(body?.subjectUserId ?? body?.subject_user_id);
  const reason = normalizeReason(body?.reason);
  // Phase 1-H is planning-only. Keep every request dry-run until an explicit
  // archive generator or deletion/anonymization executor is implemented.
  const dryRun = true;
  const adminUserId = adminUser?.id;
  if (!adminUserId) {
    throw new DataLifecycleError("Admin session is required.", {
      status: 401,
      code: "unauthorized",
    });
  }

  const subject = await fetchSubjectUser(env, subjectUserId);
  const requestHash = await buildRequestHash({
    type,
    subjectUserId,
    adminUserId,
    reason,
    dryRun,
  });
  const existing = await fetchExistingRequest(env, {
    type,
    subjectUserId,
    adminUserId,
    idempotencyKey,
  });
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new DataLifecycleError("Idempotency-Key conflicts with a different request.", {
        status: 409,
        code: "idempotency_conflict",
      });
    }
    return {
      request: serializeRequest(existing),
      subject: {
        id: subject.id,
        email: subject.email,
        role: subject.role,
        status: subject.status,
      },
      reused: true,
    };
  }

  const createdAt = nowIso();
  const requestId = lifecycleRequestId();
  await env.DB.prepare(
    `INSERT INTO data_lifecycle_requests (
       id, type, subject_user_id, requested_by_user_id, requested_by_admin_id,
       status, reason, approval_required, approved_by_admin_id, approved_at,
       idempotency_key, request_hash, dry_run, created_at, updated_at,
       completed_at, expires_at, error_code, error_message
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    requestId,
    type,
    subjectUserId,
    null,
    adminUserId,
    DATA_LIFECYCLE_STATUSES.submitted,
    reason,
    1,
    null,
    null,
    idempotencyKey,
    requestHash,
    dryRun ? 1 : 0,
    createdAt,
    createdAt,
    null,
    addDaysIso(EXPORT_ARCHIVE_TTL_DAYS),
    null,
    null
  ).run();

  const row = await getDataLifecycleRequestRow(env, requestId);
  return {
    request: serializeRequest(row),
    subject: {
      id: subject.id,
      email: subject.email,
      role: subject.role,
      status: subject.status,
    },
    reused: false,
  };
}

async function getDataLifecycleRequestRow(env, requestId) {
  return env.DB.prepare(
    `SELECT id, type, subject_user_id, requested_by_user_id, requested_by_admin_id, status,
            reason, approval_required, approved_by_admin_id, approved_at, idempotency_key,
            request_hash, dry_run, created_at, updated_at, completed_at, expires_at,
            final_status, evidence_status, completed_by_user_id, completion_note,
            completion_summary_json, retained_categories_json, execution_summary_json,
            closed_at, closed_by_user_id, closure_reason, rejection_reason,
            error_code, error_message
     FROM data_lifecycle_requests
     WHERE id = ?
     LIMIT 1`
  ).bind(requestId).first();
}

async function getItems(env, requestId) {
  const rows = await env.DB.prepare(
    `SELECT id, request_id, resource_type, resource_id, table_name, r2_bucket, r2_key,
            action, status, summary_json, created_at, updated_at
     FROM data_lifecycle_request_items
     WHERE request_id = ?
     ORDER BY created_at ASC, id ASC`
  ).bind(requestId).all();
  return Promise.all((rows.results || []).map(serializeItem));
}

export async function listDataLifecycleRequests(env, { limit = 50 } = {}) {
  const appliedLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const rows = await env.DB.prepare(
    `SELECT id, type, subject_user_id, requested_by_user_id, requested_by_admin_id, status,
            reason, approval_required, approved_by_admin_id, approved_at, idempotency_key,
            request_hash, dry_run, created_at, updated_at, completed_at, expires_at,
            final_status, evidence_status, completed_by_user_id, completion_note,
            completion_summary_json, retained_categories_json, execution_summary_json,
            closed_at, closed_by_user_id, closure_reason, rejection_reason,
            error_code, error_message
     FROM data_lifecycle_requests
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  ).bind(appliedLimit).all();
  return {
    requests: (rows.results || []).map(serializeRequest),
    appliedLimit,
  };
}

export async function getDataLifecycleRequest(env, requestId, { includeItems = true } = {}) {
  const row = await getDataLifecycleRequestRow(env, normalizeUserId(requestId));
  if (!row) {
    throw new DataLifecycleError("Data lifecycle request not found.", {
      status: 404,
      code: "request_not_found",
    });
  }
  return {
    request: serializeRequest(row),
    items: includeItems ? await getItems(env, row.id) : [],
  };
}

async function all(env, sql, ...bindings) {
  const res = await env.DB.prepare(sql).bind(...bindings).all();
  return res.results || [];
}

async function first(env, sql, ...bindings) {
  return env.DB.prepare(sql).bind(...bindings).first();
}

function addR2Reference(items, requestId, index, {
  bucket,
  key,
  action,
  resourceType = "r2_object",
  resourceId = null,
  createdAt,
  ownerTable,
}) {
  if (!key) return index;
  items.push(item({
    requestId,
    index,
    resourceType,
    resourceId,
    tableName: ownerTable,
    r2Bucket: bucket,
    r2Key: key,
    action,
    summary: {
      bucket,
      keyClass: classifyStorageObjectKey(key),
      internalKeyIncluded: false,
    },
    createdAt,
  }));
  return index + 1;
}

function exportAction(type) {
  return type === "export" ? "export" : "retain";
}

function dataAction(type, destructiveAction = "delete") {
  if (type === "export") return "export";
  if (type === "anonymize") return "anonymize";
  return destructiveAction;
}

function r2Action(type) {
  if (type === "export") return "export_reference";
  if (type === "anonymize") return "retain_or_rekey";
  return "delete_planned";
}

async function buildPlanItems(env, request) {
  const requestId = request.id;
  const userId = request.subject_user_id;
  const type = request.type;
  const createdAt = nowIso();
  const items = [];
  let index = 1;

  const user = await first(
    env,
    `SELECT id, email, role, status, created_at, updated_at, email_verified_at, verification_method
     FROM users WHERE id = ? LIMIT 1`,
    userId
  );
  if (!user) {
    throw new DataLifecycleError("Subject user not found.", {
      status: 404,
      code: "subject_not_found",
    });
  }

  const activeAdminCount = await first(
    env,
    "SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND status = 'active'"
  );
  const onlyActiveAdmin = user.role === "admin" && Number(activeAdminCount?.cnt || 0) <= 1;
  const blocked = type !== "export" && onlyActiveAdmin;

  items.push(item({
    requestId,
    index: index++,
    resourceType: "user",
    resourceId: user.id,
    tableName: "users",
    action: blocked ? "manual_review_required" : dataAction(type, "anonymize"),
    status: blocked ? "blocked" : "planned",
    summary: {
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.created_at,
      emailVerified: Boolean(user.email_verified_at),
      verificationMethod: user.verification_method || null,
    },
    createdAt,
  }));

  const profile = await first(
    env,
    `SELECT user_id, display_name, bio, website, youtube_url, has_avatar, avatar_updated_at, created_at, updated_at
     FROM profiles WHERE user_id = ? LIMIT 1`,
    userId
  );
  if (profile) {
    items.push(item({
      requestId,
      index: index++,
      resourceType: "profile",
      resourceId: userId,
      tableName: "profiles",
      action: dataAction(type, "delete"),
      summary: {
        displayName: profile.display_name || "",
        hasBio: Boolean(profile.bio),
        website: profile.website || "",
        youtubeUrl: profile.youtube_url || "",
        hasAvatar: Number(profile.has_avatar || 0) === 1,
        avatarUpdatedAt: profile.avatar_updated_at || null,
      },
      createdAt,
    }));
    if (Number(profile.has_avatar || 0) === 1) {
      index = addR2Reference(items, requestId, index, {
        bucket: "PRIVATE_MEDIA",
        key: `avatars/${userId}`,
        action: r2Action(type),
        resourceId: userId,
        createdAt,
        ownerTable: "profiles",
      });
    }
  }

  const wallets = await all(
    env,
    `SELECT id, address_display, address_normalized, chain_id, is_primary, linked_at, last_login_at, created_at, updated_at
     FROM linked_wallets WHERE user_id = ? ORDER BY created_at DESC`,
    userId
  );
  for (const wallet of wallets) {
    items.push(item({
      requestId,
      index: index++,
      resourceType: "wallet",
      resourceId: wallet.id,
      tableName: "linked_wallets",
      action: dataAction(type, "delete"),
      summary: {
        address: wallet.address_display,
        chainId: wallet.chain_id,
        isPrimary: Number(wallet.is_primary || 0) === 1,
        linkedAt: wallet.linked_at,
        lastLoginAt: wallet.last_login_at || null,
      },
      createdAt,
    }));
  }

  const favorites = await all(
    env,
    "SELECT item_type, item_id, title, created_at FROM favorites WHERE user_id = ? ORDER BY created_at DESC",
    userId
  );
  for (const favorite of favorites) {
    items.push(item({
      requestId,
      index: index++,
      resourceType: "favorite",
      resourceId: `${favorite.item_type}:${favorite.item_id}`,
      tableName: "favorites",
      action: dataAction(type, "delete"),
      summary: {
        itemType: favorite.item_type,
        itemId: favorite.item_id,
        title: favorite.title || null,
        createdAt: favorite.created_at || null,
      },
      createdAt,
    }));
  }

  const folders = await all(
    env,
    "SELECT id, name, slug, status, created_at FROM ai_folders WHERE user_id = ? ORDER BY created_at DESC",
    userId
  );
  for (const folder of folders) {
    items.push(item({
      requestId,
      index: index++,
      resourceType: "ai_folder",
      resourceId: folder.id,
      tableName: "ai_folders",
      action: dataAction(type, "delete"),
      summary: {
        name: folder.name,
        slug: folder.slug,
        status: folder.status || "active",
        createdAt: folder.created_at,
      },
      createdAt,
    }));
  }

  const images = await all(
    env,
    `SELECT id, folder_id, r2_key, prompt, model, steps, seed, visibility, published_at,
            created_at, thumb_key, medium_key
     FROM ai_images WHERE user_id = ? ORDER BY created_at DESC`,
    userId
  );
  for (const image of images) {
    items.push(item({
      requestId,
      index: index++,
      resourceType: "ai_image",
      resourceId: image.id,
      tableName: "ai_images",
      action: dataAction(type, "delete"),
      summary: {
        folderId: image.folder_id || null,
        prompt: image.prompt || "",
        model: image.model || null,
        visibility: image.visibility || "private",
        publishedAt: image.published_at || null,
        createdAt: image.created_at,
      },
      createdAt,
    }));
    for (const key of [image.r2_key, image.thumb_key, image.medium_key]) {
      index = addR2Reference(items, requestId, index, {
        bucket: "USER_IMAGES",
        key,
        action: r2Action(type),
        resourceId: image.id,
        createdAt,
        ownerTable: "ai_images",
      });
    }
  }

  const textAssets = await all(
    env,
    `SELECT id, folder_id, r2_key, title, file_name, source_module, mime_type, size_bytes,
            preview_text, created_at, poster_r2_key
     FROM ai_text_assets WHERE user_id = ? ORDER BY created_at DESC`,
    userId
  );
  for (const asset of textAssets) {
    items.push(item({
      requestId,
      index: index++,
      resourceType: "ai_text_asset",
      resourceId: asset.id,
      tableName: "ai_text_assets",
      action: dataAction(type, "delete"),
      summary: {
        title: asset.title,
        fileName: asset.file_name,
        sourceModule: asset.source_module,
        mimeType: asset.mime_type,
        sizeBytes: asset.size_bytes,
        previewText: asset.preview_text || "",
        createdAt: asset.created_at,
      },
      createdAt,
    }));
    for (const key of [asset.r2_key, asset.poster_r2_key]) {
      index = addR2Reference(items, requestId, index, {
        bucket: "USER_IMAGES",
        key,
        action: r2Action(type),
        resourceId: asset.id,
        createdAt,
        ownerTable: "ai_text_assets",
      });
    }
  }

  const videoJobs = await all(
    env,
    `SELECT id, scope, status, provider, model, prompt, output_r2_key, poster_r2_key,
            created_at, completed_at, error_code
     FROM ai_video_jobs WHERE user_id = ? ORDER BY created_at DESC`,
    userId
  );
  for (const job of videoJobs) {
    items.push(item({
      requestId,
      index: index++,
      resourceType: "ai_video_job",
      resourceId: job.id,
      tableName: "ai_video_jobs",
      action: dataAction(type, "delete"),
      summary: {
        scope: job.scope,
        status: job.status,
        provider: job.provider,
        model: job.model,
        prompt: job.prompt || "",
        createdAt: job.created_at,
        completedAt: job.completed_at || null,
        errorCode: job.error_code || null,
      },
      createdAt,
    }));
    for (const key of [job.output_r2_key, job.poster_r2_key]) {
      index = addR2Reference(items, requestId, index, {
        bucket: "USER_IMAGES",
        key,
        action: r2Action(type),
        resourceId: job.id,
        createdAt,
        ownerTable: "ai_video_jobs",
      });
    }
  }

  const activityRows = await all(
    env,
    "SELECT id, action, created_at FROM user_activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
    userId
  );
  for (const activity of activityRows) {
    items.push(item({
      requestId,
      index: index++,
      resourceType: "user_activity",
      resourceId: activity.id,
      tableName: "user_activity_log",
      action: exportAction(type),
      summary: {
        action: activity.action,
        createdAt: activity.created_at,
      },
      createdAt,
    }));
  }

  const quotaRows = await all(
    env,
    "SELECT id, day_start, status, created_at, consumed_at FROM ai_daily_quota_usage WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
    userId
  );
  for (const quota of quotaRows) {
    items.push(item({
      requestId,
      index: index++,
      resourceType: "ai_quota_usage",
      resourceId: quota.id,
      tableName: "ai_daily_quota_usage",
      action: dataAction(type, "retain"),
      summary: {
        dayStart: quota.day_start,
        status: quota.status,
        createdAt: quota.created_at,
        consumedAt: quota.consumed_at || null,
      },
      createdAt,
    }));
  }

  if (type !== "export") {
    const sessionCount = await first(env, "SELECT COUNT(*) AS cnt FROM sessions WHERE user_id = ?", userId);
    if (Number(sessionCount?.cnt || 0) > 0) {
      items.push(item({
        requestId,
        index: index++,
        resourceType: "session",
        tableName: "sessions",
        action: "revoke",
        summary: { count: Number(sessionCount.cnt || 0) },
        createdAt,
      }));
    }

    for (const [tableName, label] of [
      ["password_reset_tokens", "password_reset"],
      ["email_verification_tokens", "email_verification"],
      ["siwe_challenges", "siwe_challenge"],
    ]) {
      const count = await first(env, `SELECT COUNT(*) AS cnt FROM ${tableName} WHERE user_id = ?`, userId);
      if (Number(count?.cnt || 0) > 0) {
        items.push(item({
          requestId,
          index: index++,
          resourceType: label,
          tableName,
          action: "expire_or_delete",
          summary: { count: Number(count.cnt || 0) },
          createdAt,
        }));
      }
    }

    const adminMfaCount = await first(env, "SELECT COUNT(*) AS cnt FROM admin_mfa_credentials WHERE admin_user_id = ?", userId);
    if (Number(adminMfaCount?.cnt || 0) > 0) {
      items.push(item({
        requestId,
        index: index++,
        resourceType: "admin_mfa",
        tableName: "admin_mfa_credentials",
        action: blocked ? "manual_review_required" : "revoke",
        status: blocked ? "blocked" : "planned",
        summary: { enrolled: true },
        createdAt,
      }));
    }

    const auditCount = await first(env, "SELECT COUNT(*) AS cnt FROM admin_audit_log WHERE target_user_id = ?", userId);
    if (Number(auditCount?.cnt || 0) > 0) {
      items.push(item({
        requestId,
        index: index++,
        resourceType: "admin_audit_log",
        tableName: "admin_audit_log",
        action: "retain_or_anonymize",
        summary: {
          count: Number(auditCount.cnt || 0),
          reason: "Security audit records are retained or anonymized according to retention policy.",
        },
        createdAt,
      }));
    }
  }

  return { items, blocked };
}

async function insertItems(env, items) {
  if (!items.length) return;
  await env.DB.batch(items.map((entry) => env.DB.prepare(
    `INSERT OR IGNORE INTO data_lifecycle_request_items (
       id, request_id, resource_type, resource_id, table_name, r2_bucket, r2_key,
       action, status, summary_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    entry.id,
    entry.request_id,
    entry.resource_type,
    entry.resource_id,
    entry.table_name,
    entry.r2_bucket,
    entry.r2_key,
    entry.action,
    entry.status,
    entry.summary_json,
    entry.created_at,
    entry.updated_at
  )));
}

export async function planDataLifecycleRequest(env, requestId) {
  const row = await getDataLifecycleRequestRow(env, normalizeUserId(requestId));
  if (!row) {
    throw new DataLifecycleError("Data lifecycle request not found.", {
      status: 404,
      code: "request_not_found",
    });
  }

  const existingItems = await getItems(env, row.id);
  if (existingItems.length > 0) {
    return {
      request: serializeRequest(row),
      items: existingItems,
      blocked: existingItems.some((entry) => entry.status === "blocked"),
      reused: true,
    };
  }

  const plan = await buildPlanItems(env, row);
  await insertItems(env, plan.items);
  const updatedAt = nowIso();
  const nextStatus = plan.blocked
    ? DATA_LIFECYCLE_STATUSES.blocked
    : DATA_LIFECYCLE_STATUSES.planned;
  await env.DB.prepare(
    "UPDATE data_lifecycle_requests SET status = ?, updated_at = ? WHERE id = ?"
  ).bind(nextStatus, updatedAt, row.id).run();

  const updated = await getDataLifecycleRequestRow(env, row.id);
  return {
    request: serializeRequest(updated),
    items: await getItems(env, row.id),
    blocked: plan.blocked,
    reused: false,
  };
}

export async function approveDataLifecycleRequest({ env, adminUser, requestId }) {
  const row = await getDataLifecycleRequestRow(env, normalizeUserId(requestId));
  if (!row) {
    throw new DataLifecycleError("Data lifecycle request not found.", {
      status: 404,
      code: "request_not_found",
    });
  }
  if (row.status === DATA_LIFECYCLE_STATUSES.approved) {
    return { request: serializeRequest(row), reused: true };
  }
  if (row.status === DATA_LIFECYCLE_STATUSES.blocked) {
    throw new DataLifecycleError("This request is blocked and requires manual review.", {
      status: 409,
      code: "request_blocked",
    });
  }
  if (row.status !== DATA_LIFECYCLE_STATUSES.planned) {
    throw new DataLifecycleError("Request must be planned before approval.", {
      status: 409,
      code: "plan_required",
    });
  }

  const blockedItem = await env.DB.prepare(
    "SELECT id FROM data_lifecycle_request_items WHERE request_id = ? AND status = 'blocked' LIMIT 1"
  ).bind(row.id).first();
  if (blockedItem) {
    throw new DataLifecycleError("This request contains blocked items and requires manual review.", {
      status: 409,
      code: "request_blocked",
    });
  }

  const now = nowIso();
  await env.DB.prepare(
    "UPDATE data_lifecycle_requests SET status = 'approved', approved_by_admin_id = ?, approved_at = ?, updated_at = ? WHERE id = ?"
  ).bind(adminUser.id, now, now, row.id).run();
  const updated = await getDataLifecycleRequestRow(env, row.id);
  return { request: serializeRequest(updated), reused: false };
}

function isDestructiveExecutionRequested(body = {}) {
  return Boolean(
    body?.allowHardDelete ||
    body?.hardDelete ||
    body?.destructive ||
    String(body?.mode || "").toLowerCase() === "destructive"
  );
}

async function assertSafeExecutorAllowed(env, row, body) {
  if (!row) {
    throw new DataLifecycleError("Data lifecycle request not found.", {
      status: 404,
      code: "request_not_found",
    });
  }
  if (row.type === "export") {
    throw new DataLifecycleError("Export requests are handled by archive generation, not deletion execution.", {
      status: 409,
      code: "export_request_not_executable",
    });
  }
  if (isDestructiveExecutionRequested(body)) {
    throw new DataLifecycleError("Irreversible deletion is disabled.", {
      status: 409,
      code: "destructive_execution_disabled",
    });
  }
  if (row.status === DATA_LIFECYCLE_STATUSES.blocked) {
    throw new DataLifecycleError("This request is blocked and requires manual review.", {
      status: 409,
      code: "request_blocked",
    });
  }
  if (
    row.status !== DATA_LIFECYCLE_STATUSES.approved &&
    row.status !== DATA_LIFECYCLE_STATUSES.safeActionsCompleted
  ) {
    throw new DataLifecycleError("Request must be approved before safe execution.", {
      status: 409,
      code: "approval_required",
    });
  }

  const subject = await fetchSubjectUser(env, row.subject_user_id);
  const activeAdminCount = await first(
    env,
    "SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND status = 'active'"
  );
  if (subject.role === "admin" && Number(activeAdminCount?.cnt || 0) <= 1) {
    throw new DataLifecycleError("The only active admin cannot be deleted or anonymized by the lifecycle executor.", {
      status: 409,
      code: "only_admin_blocked",
    });
  }
  return subject;
}

function safeActionRows(items) {
  return items.filter((entry) => (
    (entry.tableName === "sessions" && entry.action === "revoke") ||
    (["password_reset_tokens", "email_verification_tokens", "siwe_challenges"].includes(entry.tableName) && entry.action === "expire_or_delete") ||
    (entry.resourceType === "data_export_archive" && entry.action === "expire")
  ));
}

function categoryForItem(entry) {
  const tableName = entry?.tableName || entry?.table_name || "";
  const resourceType = entry?.resourceType || entry?.resource_type || "";
  if (["sessions", "password_reset_tokens", "email_verification_tokens", "siwe_challenges", "admin_mfa_credentials"].includes(tableName)) {
    return "auth_session_token_profile";
  }
  if (["profiles", "linked_wallets", "favorites", "ai_daily_quota_usage"].includes(tableName)) {
    return "auth_session_token_profile";
  }
  if (tableName === "users" || resourceType === "user") return "operational_user_account";
  if (["ai_folders", "ai_images", "ai_text_assets", "ai_video_jobs"].includes(tableName)) {
    return "ai_asset_metadata_folders";
  }
  if (resourceType === "r2_object" || tableName === "profiles") return "avatar_reference_media";
  if (["member_credit_ledger", "member_subscriptions", "member_subscription_credit_buckets", "stripe_credit_pack_checkout_sessions"].includes(tableName)) {
    return "billing_credit_ledger";
  }
  if (["billing_provider_events", "billing_reviews"].includes(tableName)) return "provider_webhook_evidence";
  if (["admin_audit_log", "user_activity_log", "activity_events"].includes(tableName) || resourceType === "admin_audit_log") {
    return "admin_audit_user_activity_security";
  }
  if (["data_lifecycle_requests", "data_lifecycle_request_items", "data_export_archives"].includes(tableName) || resourceType === "data_export_archive") {
    return "lifecycle_evidence_records";
  }
  return "legal_compliance_retention";
}

const CATEGORY_LABELS = Object.freeze({
  auth_session_token_profile: "Auth, session, token, profile, wallet, preference records",
  operational_user_account: "Operational user account",
  ai_asset_metadata_folders: "AI asset metadata, folders, and user-owned operational assets",
  avatar_reference_media: "Avatar and reference media",
  billing_credit_ledger: "Billing and credit ledger",
  provider_webhook_evidence: "Provider and webhook evidence",
  admin_audit_user_activity_security: "Admin audit, user activity, and security records",
  legal_compliance_retention: "Legal and compliance retention records",
  lifecycle_evidence_records: "Lifecycle request and evidence records",
});

function categoryResultForItem(entry) {
  const action = String(entry?.action || "").toLowerCase();
  const status = String(entry?.status || "").toLowerCase();
  if (status === "blocked" || action === "manual_review_required") return "blocked";
  if (["retain", "retain_or_anonymize", "retain_or_rekey", "export_reference", "export"].includes(action)) {
    return "retained";
  }
  if (status === "completed") {
    if (["anonymize", "retain_or_anonymize", "retain_or_rekey"].includes(action)) return "anonymized";
    return "deleted";
  }
  if (["anonymize", "retain_or_anonymize", "retain_or_rekey"].includes(action)) return "anonymized";
  if (["delete", "delete_planned", "revoke", "expire_or_delete", "expire"].includes(action)) return "pending";
  return "not_applicable";
}

function mergeCategoryResult(previous, next) {
  const rank = {
    blocked: 6,
    retained: 5,
    pending: 4,
    anonymized: 3,
    deleted: 2,
    already_missing: 1,
    not_applicable: 0,
  };
  return (rank[next] || 0) > (rank[previous] || 0) ? next : previous;
}

export function buildDataLifecycleCategoryMatrix(request, items = []) {
  const matrix = Object.entries(CATEGORY_LABELS).map(([id, label]) => ({
    id,
    label,
    result: "not_applicable",
    itemCount: 0,
    completedCount: 0,
    retainedByPolicy: POLICY_RETAINED_CATEGORY_IDS.has(id),
    note: POLICY_RETAINED_CATEGORY_IDS.has(id)
      ? "Policy-controlled records are retained or anonymized according to retention/legal rules."
      : "No category activity recorded yet.",
  }));
  const byId = new Map(matrix.map((entry) => [entry.id, entry]));
  for (const entry of items || []) {
    const id = categoryForItem(entry);
    const category = byId.get(id) || byId.get("legal_compliance_retention");
    const result = categoryResultForItem(entry);
    category.itemCount += 1;
    if (String(entry?.status || "").toLowerCase() === "completed") category.completedCount += 1;
    category.result = mergeCategoryResult(category.result, result);
    category.note = result === "retained"
      ? "Retained/anonymized according to policy; not blindly deleted by lifecycle execution."
      : result === "blocked"
        ? "Manual legal/operator review required before this category can be completed."
        : result === "pending"
          ? "Planned but not fully executed by the safe lifecycle executor."
          : result === "deleted"
            ? "Eligible operational records were deleted or expired by safe execution."
            : result === "anonymized"
              ? "Eligible records are planned or handled as anonymized/rekeyed policy records."
              : category.note;
  }
  for (const id of POLICY_RETAINED_CATEGORY_IDS) {
    const category = byId.get(id);
    if (category && category.result === "not_applicable") {
      category.result = "retained";
      category.note = "Retained by policy unless a future approved lifecycle workflow records anonymization or legal disposition.";
    }
  }
  if (request?.status === DATA_LIFECYCLE_STATUSES.safeActionsCompleted) {
    const authCategory = byId.get("auth_session_token_profile");
    if (authCategory && authCategory.result === "pending") {
      authCategory.result = "deleted";
      authCategory.note = "Safe execution revoked sessions and expired eligible authentication tokens.";
    }
  }
  return matrix;
}

function retainedCategoriesFromMatrix(matrix) {
  return matrix
    .filter((entry) => entry.result === "retained" || entry.retainedByPolicy)
    .map((entry) => entry.id)
    .sort();
}

function buildLifecycleCompletionSummary(row, items, {
  finalStatus = null,
  completedAt = null,
  completedByUserId = null,
  completionNote = null,
} = {}) {
  const serializedRequest = serializeRequest(row);
  const categoryMatrix = buildDataLifecycleCategoryMatrix(serializedRequest, items);
  const retainedCategories = retainedCategoriesFromMatrix(categoryMatrix);
  const blockedCategories = categoryMatrix
    .filter((entry) => entry.result === "blocked")
    .map((entry) => entry.id)
    .sort();
  return {
    requestId: row.id,
    requestType: row.type,
    finalStatus,
    completedAt,
    completedByUserId,
    completionNote: completionNote || null,
    evidenceComplete: Boolean(finalStatus) && blockedCategories.length === 0,
    categoryMatrix,
    retainedCategories,
    blockedCategories,
    legalCompletionTruth: finalStatus === DATA_LIFECYCLE_STATUSES.completed
      ? "completed_without_policy_retention_beyond_lifecycle_evidence"
      : finalStatus === DATA_LIFECYCLE_STATUSES.completedWithRetention
        ? "completed_with_policy_retention"
        : finalStatus || "not_completed",
    destructivePurgePerformed: false,
    rawSecretsRendered: false,
  };
}

function completionBlockers(row, items) {
  const blockers = [];
  if (!items.length) blockers.push("plan_required");
  if (row.status === DATA_LIFECYCLE_STATUSES.blocked) blockers.push("blocked_items_require_manual_review");
  if (items.some((entry) => entry.status === "blocked")) blockers.push("blocked_plan_items");
  if (row.type === "export") {
    if (row.status !== "export_ready") blockers.push("export_archive_required");
  } else if (row.status !== DATA_LIFECYCLE_STATUSES.safeActionsCompleted) {
    blockers.push("safe_execution_required");
  }
  return Array.from(new Set(blockers));
}

export async function executeSafeDataLifecycleActions({ env, adminUser, requestId, body = {} }) {
  if (!adminUser?.id) {
    throw new DataLifecycleError("Admin session is required.", {
      status: 401,
      code: "unauthorized",
    });
  }
  const row = await getDataLifecycleRequestRow(env, normalizeUserId(requestId));
  const subject = await assertSafeExecutorAllowed(env, row, body);
  const dryRun = body?.dryRun !== false;
  const items = await getItems(env, row.id);
  const safeItems = safeActionRows(items);
  const now = nowIso();

  if (row.status === DATA_LIFECYCLE_STATUSES.safeActionsCompleted && !dryRun) {
    return {
      request: serializeRequest(row),
      subject: {
        id: subject.id,
        email: subject.email,
        role: subject.role,
        status: subject.status,
      },
      dryRun,
      reused: true,
      actions: safeItems.map((entry) => ({
        itemId: entry.id,
        resourceType: entry.resourceType,
        tableName: entry.tableName,
        action: entry.action,
        status: entry.status,
        affectedCount: 0,
      })),
      destructiveActionsDisabled: true,
    };
  }

  const actions = [];
  let sessionsRevoked = 0;
  let passwordTokensExpired = 0;
  let verificationTokensExpired = 0;
  let siweChallengesExpired = 0;
  let exportArchivesExpired = 0;

  if (!dryRun) {
    const sessionResult = await env.DB.prepare(
      "DELETE FROM sessions WHERE user_id = ?"
    ).bind(row.subject_user_id).run();
    sessionsRevoked = Number(sessionResult?.meta?.changes || 0);

    const passwordResult = await env.DB.prepare(
      "UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL"
    ).bind(now, row.subject_user_id).run();
    passwordTokensExpired = Number(passwordResult?.meta?.changes || 0);

    const verificationResult = await env.DB.prepare(
      "UPDATE email_verification_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL"
    ).bind(now, row.subject_user_id).run();
    verificationTokensExpired = Number(verificationResult?.meta?.changes || 0);

    const siweResult = await env.DB.prepare(
      "UPDATE siwe_challenges SET used_at = ? WHERE user_id = ? AND used_at IS NULL"
    ).bind(now, row.subject_user_id).run();
    siweChallengesExpired = Number(siweResult?.meta?.changes || 0);

    const archiveResult = await env.DB.prepare(
      "UPDATE data_export_archives SET status = 'expired', expires_at = ?, updated_at = ? WHERE subject_user_id = ? AND status = 'ready' AND expires_at > ?"
    ).bind(now, now, row.subject_user_id, now).run();
    exportArchivesExpired = Number(archiveResult?.meta?.changes || 0);
    const executionSummary = {
      executedAt: now,
      executedByUserId: adminUser.id,
      dryRun: false,
      safeExecutorOnly: true,
      destructivePurgePerformed: false,
      affectedCounts: {
        sessions: sessionsRevoked,
        password_reset_tokens: passwordTokensExpired,
        email_verification_tokens: verificationTokensExpired,
        siwe_challenges: siweChallengesExpired,
        data_export_archives: exportArchivesExpired,
      },
      retainedPolicyCategories: Array.from(POLICY_RETAINED_CATEGORY_IDS).sort(),
    };

    await env.DB.prepare(
      `UPDATE data_lifecycle_request_items
       SET status = 'completed', updated_at = ?
       WHERE request_id = ?
         AND (
           (table_name = 'sessions' AND action = 'revoke')
           OR (table_name IN ('password_reset_tokens', 'email_verification_tokens', 'siwe_challenges') AND action = 'expire_or_delete')
           OR (resource_type = 'data_export_archive' AND action = 'expire')
         )`
    ).bind(now, row.id).run();
    await env.DB.prepare(
      "UPDATE data_lifecycle_requests SET status = 'safe_actions_completed', evidence_status = 'safe_actions_completed_evidence_available', execution_summary_json = ?, updated_at = ? WHERE id = ?"
    ).bind(safeJson(executionSummary), now, row.id).run();
  }

  const affectedByTable = {
    sessions: sessionsRevoked,
    password_reset_tokens: passwordTokensExpired,
    email_verification_tokens: verificationTokensExpired,
    siwe_challenges: siweChallengesExpired,
    data_export_archives: exportArchivesExpired,
  };
  for (const entry of safeItems) {
    const key = entry.tableName || entry.resourceType;
    actions.push({
      itemId: entry.id,
      resourceType: entry.resourceType,
      tableName: entry.tableName,
      action: entry.action,
      status: dryRun ? "would_execute" : "completed",
      affectedCount: dryRun ? null : Number(affectedByTable[key] || 0),
    });
  }
  if (!safeItems.some((entry) => entry.resourceType === "data_export_archive")) {
    actions.push({
      itemId: null,
      resourceType: "data_export_archive",
      tableName: "data_export_archives",
      action: "expire",
      status: dryRun ? "would_execute" : "completed",
      affectedCount: dryRun ? null : exportArchivesExpired,
    });
  }

  const updated = dryRun ? row : await getDataLifecycleRequestRow(env, row.id);
  return {
    request: serializeRequest(updated),
    subject: {
      id: subject.id,
      email: subject.email,
      role: subject.role,
      status: subject.status,
    },
    dryRun,
    reused: false,
    actions,
    destructiveActionsDisabled: true,
  };
}

export async function completeDataLifecycleRequest({ env, adminUser, requestId, body = {} }) {
  if (!adminUser?.id) {
    throw new DataLifecycleError("Admin session is required.", {
      status: 401,
      code: "unauthorized",
    });
  }
  const row = await getDataLifecycleRequestRow(env, normalizeUserId(requestId));
  if (!row) {
    throw new DataLifecycleError("Data lifecycle request not found.", {
      status: 404,
      code: "request_not_found",
    });
  }
  const items = await getItems(env, row.id);
  if (isFinalStatus(row.status) || isFinalStatus(row.final_status)) {
    const summary = row.completion_summary_json
      ? parseJsonValue(row.completion_summary_json, {})
      : buildLifecycleCompletionSummary(row, items, {
        finalStatus: row.final_status || row.status,
        completedAt: row.completed_at || null,
        completedByUserId: row.completed_by_user_id || null,
        completionNote: row.completion_note || null,
      });
    return {
      request: serializeRequest(row),
      completion: summary,
      reused: true,
    };
  }

  const completionNote = normalizeCompletionNote(body?.completionNote ?? body?.reason, {
    fieldName: "completion note",
    code: "completion_note_required",
  });
  const blockers = completionBlockers(row, items);
  if (blockers.length > 0) {
    const summary = buildLifecycleCompletionSummary(row, items, {
      finalStatus: DATA_LIFECYCLE_STATUSES.blockedRequiresLegalReview,
    });
    throw new DataLifecycleError("This lifecycle request is not eligible for final completion yet.", {
      status: 409,
      code: "completion_prerequisites_missing",
      details: {
        blockedReasons: blockers,
        currentStatus: row.status,
        retainedCategories: summary.retainedCategories,
        categoryMatrix: summary.categoryMatrix,
      },
    });
  }

  const preliminary = buildLifecycleCompletionSummary(row, items);
  const retainedCategories = preliminary.retainedCategories;
  const finalStatus = retainedCategories.filter((entry) => entry !== "lifecycle_evidence_records").length > 0
    ? DATA_LIFECYCLE_STATUSES.completedWithRetention
    : DATA_LIFECYCLE_STATUSES.completed;
  const requestedFinalStatus = String(body?.finalStatus || "").trim();
  if (
    requestedFinalStatus &&
    requestedFinalStatus !== finalStatus &&
    requestedFinalStatus === DATA_LIFECYCLE_STATUSES.completed &&
    finalStatus === DATA_LIFECYCLE_STATUSES.completedWithRetention
  ) {
    throw new DataLifecycleError("This request still has retained policy categories and must be completed with retention.", {
      status: 409,
      code: "completion_final_status_overclaim",
      details: {
        requestedFinalStatus,
        requiredFinalStatus: finalStatus,
        retainedCategories,
      },
    });
  }

  const now = nowIso();
  const completionSummary = buildLifecycleCompletionSummary(row, items, {
    finalStatus,
    completedAt: now,
    completedByUserId: adminUser.id,
    completionNote,
  });
  const evidenceStatus = finalStatus === DATA_LIFECYCLE_STATUSES.completedWithRetention
    ? "complete_with_retention_evidence_recorded"
    : "complete_evidence_recorded";
  await env.DB.prepare(
    `UPDATE data_lifecycle_requests
     SET status = ?,
         final_status = ?,
         evidence_status = ?,
         completed_at = ?,
         completed_by_user_id = ?,
         completion_note = ?,
         completion_summary_json = ?,
         retained_categories_json = ?,
         updated_at = ?,
         error_code = NULL,
         error_message = NULL
     WHERE id = ?`
  ).bind(
    finalStatus,
    finalStatus,
    evidenceStatus,
    now,
    adminUser.id,
    completionNote,
    safeJson(completionSummary),
    JSON.stringify(retainedCategories),
    now,
    row.id
  ).run();
  const updated = await getDataLifecycleRequestRow(env, row.id);
  return {
    request: serializeRequest(updated),
    completion: completionSummary,
    reused: false,
  };
}

function assertMutableFinalState(row, action) {
  if (isFinalStatus(row.status) || isFinalStatus(row.final_status)) {
    throw new DataLifecycleError(`This request is already in final state and cannot be ${action}.`, {
      status: 409,
      code: "request_already_final",
      details: {
        currentStatus: row.status,
        finalStatus: row.final_status || row.status,
      },
    });
  }
}

export async function rejectDataLifecycleRequest({ env, adminUser, requestId, body = {} }) {
  if (!adminUser?.id) {
    throw new DataLifecycleError("Admin session is required.", {
      status: 401,
      code: "unauthorized",
    });
  }
  const row = await getDataLifecycleRequestRow(env, normalizeUserId(requestId));
  if (!row) {
    throw new DataLifecycleError("Data lifecycle request not found.", {
      status: 404,
      code: "request_not_found",
    });
  }
  if ((row.final_status || row.status) === DATA_LIFECYCLE_STATUSES.rejected) {
    const items = await getItems(env, row.id);
    return {
      request: serializeRequest(row),
      completion: row.completion_summary_json
        ? parseJsonValue(row.completion_summary_json, {})
        : buildLifecycleCompletionSummary(row, items, { finalStatus: DATA_LIFECYCLE_STATUSES.rejected }),
      reused: true,
      executesDataDeletion: false,
    };
  }
  assertMutableFinalState(row, "rejected");
  const reason = normalizeCompletionNote(body?.reason, {
    fieldName: "rejection reason",
    code: "rejection_reason_required",
  });
  const items = await getItems(env, row.id);
  const now = nowIso();
  const summary = buildLifecycleCompletionSummary(row, items, {
    finalStatus: DATA_LIFECYCLE_STATUSES.rejected,
    completedAt: null,
    completedByUserId: adminUser.id,
    completionNote: reason,
  });
  await env.DB.prepare(
    `UPDATE data_lifecycle_requests
     SET status = 'rejected',
         final_status = 'rejected',
         evidence_status = 'rejected_no_execution',
         closed_at = ?,
         closed_by_user_id = ?,
         rejection_reason = ?,
         completion_summary_json = ?,
         retained_categories_json = ?,
         updated_at = ?
     WHERE id = ?`
  ).bind(
    now,
    adminUser.id,
    reason,
    safeJson(summary),
    JSON.stringify(summary.retainedCategories),
    now,
    row.id
  ).run();
  const updated = await getDataLifecycleRequestRow(env, row.id);
  return {
    request: serializeRequest(updated),
    completion: summary,
    reused: false,
    executesDataDeletion: false,
  };
}

export async function closeDataLifecycleRequest({ env, adminUser, requestId, body = {} }) {
  if (!adminUser?.id) {
    throw new DataLifecycleError("Admin session is required.", {
      status: 401,
      code: "unauthorized",
    });
  }
  const row = await getDataLifecycleRequestRow(env, normalizeUserId(requestId));
  if (!row) {
    throw new DataLifecycleError("Data lifecycle request not found.", {
      status: 404,
      code: "request_not_found",
    });
  }
  const requestedFinalStatus = String(body?.finalStatus || body?.status || "").trim();
  const finalStatus = requestedFinalStatus === DATA_LIFECYCLE_STATUSES.blockedRequiresLegalReview
    ? DATA_LIFECYCLE_STATUSES.blockedRequiresLegalReview
    : DATA_LIFECYCLE_STATUSES.closed;
  if ((row.final_status || row.status) === finalStatus) {
    const items = await getItems(env, row.id);
    return {
      request: serializeRequest(row),
      completion: row.completion_summary_json
        ? parseJsonValue(row.completion_summary_json, {})
        : buildLifecycleCompletionSummary(row, items, { finalStatus }),
      reused: true,
      executesDataDeletion: false,
    };
  }
  assertMutableFinalState(row, "closed");
  const reason = normalizeCompletionNote(body?.reason, {
    fieldName: "closure reason",
    code: "closure_reason_required",
  });
  const items = await getItems(env, row.id);
  const now = nowIso();
  const summary = buildLifecycleCompletionSummary(row, items, {
    finalStatus,
    completedAt: null,
    completedByUserId: adminUser.id,
    completionNote: reason,
  });
  await env.DB.prepare(
    `UPDATE data_lifecycle_requests
     SET status = ?,
         final_status = ?,
         evidence_status = ?,
         closed_at = ?,
         closed_by_user_id = ?,
         closure_reason = ?,
         completion_summary_json = ?,
         retained_categories_json = ?,
         updated_at = ?
     WHERE id = ?`
  ).bind(
    finalStatus,
    finalStatus,
    finalStatus === DATA_LIFECYCLE_STATUSES.blockedRequiresLegalReview ? "blocked_requires_legal_review" : "closed_no_execution",
    now,
    adminUser.id,
    reason,
    safeJson(summary),
    JSON.stringify(summary.retainedCategories),
    now,
    row.id
  ).run();
  const updated = await getDataLifecycleRequestRow(env, row.id);
  return {
    request: serializeRequest(updated),
    completion: summary,
    reused: false,
    executesDataDeletion: false,
  };
}

export function dataLifecycleErrorResponse(error) {
  const status = Number(error?.status || 400);
  const response = {
    ok: false,
    error: error?.message || "Invalid data lifecycle request.",
    code: error?.code || "bad_request",
    status,
  };
  if (error?.details && typeof error.details === "object") {
    response.details = error.details;
  }
  return response;
}
