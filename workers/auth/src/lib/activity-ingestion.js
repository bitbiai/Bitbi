import {
  getDurationMs,
  getErrorFields,
  logDiagnostic,
} from "../../../../js/shared/worker-observability.mjs";
import {
  ACTIVITY_INGEST_QUEUE_MESSAGE_TYPE,
  ACTIVITY_INGEST_QUEUE_SCHEMA_VERSION,
  ADMIN_AUDIT_LOG_TABLE,
  USER_ACTIVITY_LOG_TABLE,
  buildAdminAuditInsertStatement,
  buildUserActivityInsertStatement,
} from "./activity.js";

function permanentIngestError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.permanent = true;
  return error;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw permanentIngestError(`Queue payload ${fieldName} is required.`, "bad_queue_payload");
  }
  return value;
}

function optionalString(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function requireNullableJsonString(value, fieldName) {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw permanentIngestError(`Queue payload ${fieldName} must be a string when present.`, "bad_queue_payload");
  }
  return value;
}

function normalizeActivityEvent(body) {
  if (!isPlainObject(body)) {
    throw permanentIngestError("Queue payload must be an object.", "bad_queue_payload");
  }
  if (body.type !== ACTIVITY_INGEST_QUEUE_MESSAGE_TYPE) {
    throw permanentIngestError("Queue payload type is invalid.", "bad_queue_payload");
  }
  if (body.schema_version !== ACTIVITY_INGEST_QUEUE_SCHEMA_VERSION) {
    throw permanentIngestError("Queue payload schema version is invalid.", "bad_queue_payload");
  }
  const table = requireString(body.table, "table");
  const base = {
    table,
    event_id: requireString(body.event_id, "event_id"),
    action: requireString(body.action, "action"),
    created_at: requireString(body.created_at, "created_at"),
    correlation_id: optionalString(body.correlation_id),
  };

  if (table === USER_ACTIVITY_LOG_TABLE) {
    return {
      ...base,
      user_id: requireString(body.user_id, "user_id"),
      meta_json: requireNullableJsonString(body.meta_json, "meta_json"),
      ip_address: optionalString(body.ip_address),
    };
  }

  if (table === ADMIN_AUDIT_LOG_TABLE) {
    return {
      ...base,
      admin_user_id: requireString(body.admin_user_id, "admin_user_id"),
      target_user_id: optionalString(body.target_user_id),
      meta_json: requireNullableJsonString(body.meta_json, "meta_json"),
    };
  }

  throw permanentIngestError("Queue payload table is invalid.", "bad_queue_payload");
}

function buildInsertStatement(env, event) {
  if (event.table === USER_ACTIVITY_LOG_TABLE) {
    return buildUserActivityInsertStatement(env, event, { ignoreConflicts: true });
  }
  return buildAdminAuditInsertStatement(env, event, { ignoreConflicts: true });
}

export function isLikelyActivityIngestMessage(body) {
  if (!isPlainObject(body)) return false;
  return (
    body.type === ACTIVITY_INGEST_QUEUE_MESSAGE_TYPE ||
    body.table === USER_ACTIVITY_LOG_TABLE ||
    body.table === ADMIN_AUDIT_LOG_TABLE
  );
}

export async function processActivityIngestQueueBatch(batch, env) {
  const startedAt = Date.now();
  const messages = Array.isArray(batch?.messages) ? batch.messages : [];
  if (messages.length === 0) {
    return {
      validCount: 0,
      insertedCount: 0,
      duplicateCount: 0,
      invalidCount: 0,
    };
  }

  const valid = [];
  let invalidCount = 0;
  let adminAuditCount = 0;
  let userActivityCount = 0;

  for (const message of messages) {
    try {
      const event = normalizeActivityEvent(message.body);
      valid.push({ message, event });
      if (event.table === ADMIN_AUDIT_LOG_TABLE) {
        adminAuditCount += 1;
      } else {
        userActivityCount += 1;
      }
    } catch (error) {
      invalidCount += 1;
      logDiagnostic({
        service: "bitbi-auth",
        component: "activity-ingest-queue",
        event: "activity_ingest_bad_payload",
        level: "error",
        correlationId: message?.body?.correlation_id || null,
        attempts: message?.attempts ?? 0,
        table: message?.body?.table || null,
        ...getErrorFields(error, { includeMessage: false }),
      });
      message.ack();
    }
  }

  if (valid.length === 0) {
    return {
      validCount: 0,
      insertedCount: 0,
      duplicateCount: 0,
      invalidCount,
    };
  }

  try {
    const results = await env.DB.batch(valid.map(({ event }) => buildInsertStatement(env, event)));
    let insertedCount = 0;
    for (const result of results) {
      insertedCount += Number(result?.meta?.changes) || 0;
    }
    const duplicateCount = Math.max(0, valid.length - insertedCount);
    for (const { message } of valid) {
      message.ack();
    }
    logDiagnostic({
      service: "bitbi-auth",
      component: "activity-ingest-queue",
      event: "activity_ingest_batch_completed",
      level: "info",
      batch_size: valid.length,
      invalid_count: invalidCount,
      inserted_count: insertedCount,
      duplicate_count: duplicateCount,
      admin_audit_count: adminAuditCount,
      user_activity_count: userActivityCount,
      duration_ms: getDurationMs(startedAt),
    });
    return {
      validCount: valid.length,
      insertedCount,
      duplicateCount,
      invalidCount,
    };
  } catch (error) {
    logDiagnostic({
      service: "bitbi-auth",
      component: "activity-ingest-queue",
      event: "activity_ingest_batch_retry",
      level: "error",
      batch_size: valid.length,
      invalid_count: invalidCount,
      admin_audit_count: adminAuditCount,
      user_activity_count: userActivityCount,
      duration_ms: getDurationMs(startedAt),
      ...getErrorFields(error, { includeMessage: false }),
    });
    for (const { message } of valid) {
      message.retry();
    }
    return {
      validCount: valid.length,
      insertedCount: 0,
      duplicateCount: 0,
      invalidCount,
      error,
    };
  }
}
