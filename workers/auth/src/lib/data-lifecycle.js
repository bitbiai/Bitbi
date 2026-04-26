import { nowIso, addDaysIso, randomTokenHex, sha256Hex } from "./tokens.js";

export const DATA_LIFECYCLE_REQUEST_TYPES = Object.freeze(["export", "delete", "anonymize"]);
export const DATA_LIFECYCLE_STATUSES = Object.freeze({
  submitted: "submitted",
  planned: "planned",
  approved: "approved",
  blocked: "blocked",
  safeActionsCompleted: "safe_actions_completed",
});

const EXPORT_ARCHIVE_TTL_DAYS = 14;
const MAX_REASON_LENGTH = 500;
const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

export class DataLifecycleError extends Error {
  constructor(message, { status = 400, code = "bad_request" } = {}) {
    super(message);
    this.name = "DataLifecycleError";
    this.status = status;
    this.code = code;
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
    expiresAt: row.expires_at || null,
    errorCode: row.error_code || null,
    errorMessage: row.error_message || null,
  };
}

function serializeItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestId: row.request_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id || null,
    tableName: row.table_name || null,
    r2Bucket: row.r2_bucket || null,
    r2Key: row.r2_key || null,
    action: row.action,
    status: row.status,
    summary: parseSummaryJson(row.summary_json),
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
  return (rows.results || []).map(serializeItem);
}

export async function listDataLifecycleRequests(env, { limit = 50 } = {}) {
  const appliedLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  const rows = await env.DB.prepare(
    `SELECT id, type, subject_user_id, requested_by_user_id, requested_by_admin_id, status,
            reason, approval_required, approved_by_admin_id, approved_at, idempotency_key,
            request_hash, dry_run, created_at, updated_at, completed_at, expires_at,
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
    summary: { bucket, key },
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
      "UPDATE data_lifecycle_requests SET status = 'safe_actions_completed', updated_at = ? WHERE id = ?"
    ).bind(now, row.id).run();
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

export function dataLifecycleErrorResponse(error) {
  const status = Number(error?.status || 400);
  return {
    ok: false,
    error: error?.message || "Invalid data lifecycle request.",
    code: error?.code || "bad_request",
    status,
  };
}
