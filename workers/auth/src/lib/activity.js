/* ============================================================
   BITBI — Queue-backed audit/activity ingestion helpers
   ============================================================ */

import { nowIso } from "./tokens.js";
import {
  getErrorFields,
  getRequestLogFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";

export const ACTIVITY_INGEST_QUEUE_NAME = "bitbi-auth-activity-ingest";
export const ACTIVITY_INGEST_QUEUE_MESSAGE_TYPE = "bitbi.activity_ingest";
export const ACTIVITY_INGEST_QUEUE_SCHEMA_VERSION = 1;
export const USER_ACTIVITY_LOG_TABLE = "user_activity_log";
export const ADMIN_AUDIT_LOG_TABLE = "admin_audit_log";

function normalizeOptionalString(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function serializeMeta(meta) {
  return meta == null ? null : JSON.stringify(meta);
}

function getActivityQueue(env) {
  const queue = env?.ACTIVITY_INGEST_QUEUE;
  if (!queue || typeof queue.send !== "function") {
    throw new Error("Activity ingest queue binding is unavailable.");
  }
  return queue;
}

function logQueuePublishFailure({
  table,
  action,
  correlationId,
  requestInfo,
  actorFields = {},
  fallback,
  error,
}) {
  logDiagnostic({
    service: "bitbi-auth",
    component: "activity-ingest-producer",
    event: table === ADMIN_AUDIT_LOG_TABLE ? "admin_audit_enqueue_failed" : "user_activity_enqueue_failed",
    level: "warn",
    correlationId,
    table,
    action,
    fallback,
    ...getRequestLogFields(requestInfo),
    ...actorFields,
    ...getErrorFields(error, { includeMessage: false }),
  });
}

function logAdminFallbackOutcome({
  event,
  correlationId,
  requestInfo,
  action,
  adminUserId,
  targetUserId,
  fallback,
  changes = null,
  error = null,
}) {
  logDiagnostic({
    service: "bitbi-auth",
    component: "activity-ingest-producer",
    event,
    level: error ? "error" : "warn",
    correlationId,
    table: ADMIN_AUDIT_LOG_TABLE,
    action,
    fallback,
    admin_user_id: adminUserId,
    target_user_id: targetUserId,
    changes,
    ...getRequestLogFields(requestInfo),
    ...(error ? getErrorFields(error, { includeMessage: false }) : {}),
  });
}

export function buildUserActivityEvent({
  id = crypto.randomUUID(),
  userId,
  action,
  meta = null,
  ipAddress = null,
  createdAt = nowIso(),
  correlationId = null,
}) {
  return {
    schema_version: ACTIVITY_INGEST_QUEUE_SCHEMA_VERSION,
    type: ACTIVITY_INGEST_QUEUE_MESSAGE_TYPE,
    table: USER_ACTIVITY_LOG_TABLE,
    event_id: String(id),
    user_id: String(userId),
    action: String(action),
    meta_json: serializeMeta(meta),
    ip_address: normalizeOptionalString(ipAddress),
    created_at: String(createdAt),
    correlation_id: normalizeOptionalString(correlationId),
  };
}

export function buildAdminAuditEvent({
  id = crypto.randomUUID(),
  adminUserId,
  action,
  targetUserId = null,
  meta = null,
  createdAt = nowIso(),
  correlationId = null,
}) {
  return {
    schema_version: ACTIVITY_INGEST_QUEUE_SCHEMA_VERSION,
    type: ACTIVITY_INGEST_QUEUE_MESSAGE_TYPE,
    table: ADMIN_AUDIT_LOG_TABLE,
    event_id: String(id),
    admin_user_id: String(adminUserId),
    action: String(action),
    target_user_id: normalizeOptionalString(targetUserId),
    meta_json: serializeMeta(meta),
    created_at: String(createdAt),
    correlation_id: normalizeOptionalString(correlationId),
  };
}

export function buildUserActivityInsertStatement(env, event, { ignoreConflicts = false } = {}) {
  const verb = ignoreConflicts ? "INSERT OR IGNORE" : "INSERT";
  return env.DB.prepare(
    `${verb} INTO user_activity_log (id, user_id, action, meta_json, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    event.event_id,
    event.user_id,
    event.action,
    event.meta_json ?? null,
    event.ip_address ?? null,
    event.created_at
  );
}

export function buildAdminAuditInsertStatement(env, event, { ignoreConflicts = false } = {}) {
  const verb = ignoreConflicts ? "INSERT OR IGNORE" : "INSERT";
  return env.DB.prepare(
    `${verb} INTO admin_audit_log (id, admin_user_id, action, target_user_id, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    event.event_id,
    event.admin_user_id,
    event.action,
    event.target_user_id ?? null,
    event.meta_json ?? null,
    event.created_at
  );
}

export async function logUserActivity(
  env,
  userId,
  action,
  meta,
  ipAddress,
  { createdAt = nowIso(), correlationId = null, requestInfo = null } = {}
) {
  const event = buildUserActivityEvent({
    userId,
    action,
    meta,
    ipAddress,
    createdAt,
    correlationId,
  });

  try {
    await getActivityQueue(env).send(event);
    return { ok: true, queued: true, eventId: event.event_id };
  } catch (error) {
    logQueuePublishFailure({
      table: USER_ACTIVITY_LOG_TABLE,
      action,
      correlationId,
      requestInfo,
      actorFields: { user_id: event.user_id },
      fallback: "none",
      error,
    });
    return { ok: false, queued: false, eventId: event.event_id };
  }
}

export async function enqueueAdminAuditEvent(
  env,
  { adminUserId, action, targetUserId = null, meta = null, createdAt = nowIso() },
  { correlationId = null, requestInfo = null, allowDirectFallback = true } = {}
) {
  const event = buildAdminAuditEvent({
    adminUserId,
    action,
    targetUserId,
    meta,
    createdAt,
    correlationId,
  });

  try {
    await getActivityQueue(env).send(event);
    return { ok: true, queued: true, fallback: "queue", eventId: event.event_id };
  } catch (error) {
    logQueuePublishFailure({
      table: ADMIN_AUDIT_LOG_TABLE,
      action,
      correlationId,
      requestInfo,
      actorFields: {
        admin_user_id: event.admin_user_id,
        target_user_id: event.target_user_id,
      },
      fallback: allowDirectFallback ? "direct_d1" : "none",
      error,
    });

    if (!allowDirectFallback) {
      return {
        ok: false,
        queued: false,
        fallback: "none",
        eventId: event.event_id,
      };
    }

    try {
      const result = await buildAdminAuditInsertStatement(env, event, {
        ignoreConflicts: true,
      }).run();
      logAdminFallbackOutcome({
        event: "admin_audit_fallback_persisted",
        correlationId,
        requestInfo,
        action,
        adminUserId: event.admin_user_id,
        targetUserId: event.target_user_id,
        fallback: "direct_d1",
        changes: Number(result?.meta?.changes) || 0,
      });
      return {
        ok: true,
        queued: false,
        fallback: "direct_d1",
        eventId: event.event_id,
      };
    } catch (fallbackError) {
      logAdminFallbackOutcome({
        event: "admin_audit_fallback_failed",
        correlationId,
        requestInfo,
        action,
        adminUserId: event.admin_user_id,
        targetUserId: event.target_user_id,
        fallback: "direct_d1",
        error: fallbackError,
      });
      return {
        ok: false,
        queued: false,
        fallback: "direct_d1_failed",
        eventId: event.event_id,
      };
    }
  }
}
