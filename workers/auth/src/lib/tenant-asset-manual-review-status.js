import { nowIso, sha256Hex } from "./tokens.js";
import {
  TENANT_ASSET_MANUAL_REVIEW_STATUSES,
  normalizeTenantAssetManualReviewStatus,
  serializeTenantAssetManualReviewMetadata,
} from "./tenant-asset-manual-review.js";
import {
  serializeTenantAssetManualReviewEvent,
  serializeTenantAssetManualReviewItem,
} from "./tenant-asset-manual-review-queue.js";

export const TENANT_ASSET_MANUAL_REVIEW_STATUS_ENDPOINT_SUFFIX = "/status";
export const TENANT_ASSET_MANUAL_REVIEW_STATUS_VERSION =
  "tenant-asset-manual-review-status-v1";

const MAX_REASON_LENGTH = 500;
const MAX_SAFE_ID_LENGTH = 180;
const STATUS_METADATA_MAX_KEYS = 40;

const APPROVED_STATUSES = new Set([
  "approved_personal_user_asset",
  "approved_organization_asset",
  "approved_legacy_unclassified",
  "approved_platform_admin_test_asset",
]);

const BLOCKED_STATUSES = new Set([
  "blocked_public_unsafe",
  "blocked_derivative_risk",
  "blocked_relationship_conflict",
  "blocked_missing_evidence",
]);

const TERMINAL_STATUSES = new Set([
  ...APPROVED_STATUSES,
  ...BLOCKED_STATUSES,
  "rejected",
]);

const TRANSITIONS = Object.freeze({
  pending_review: Object.freeze([
    "review_in_progress",
    "deferred",
    "rejected",
    "needs_legal_privacy_review",
  ]),
  review_in_progress: Object.freeze([
    ...APPROVED_STATUSES,
    ...BLOCKED_STATUSES,
    "deferred",
    "rejected",
    "needs_legal_privacy_review",
  ]),
  deferred: Object.freeze(["pending_review"]),
  needs_legal_privacy_review: Object.freeze(["review_in_progress"]),
  approved_personal_user_asset: Object.freeze(["superseded"]),
  approved_organization_asset: Object.freeze(["superseded"]),
  approved_legacy_unclassified: Object.freeze(["superseded"]),
  approved_platform_admin_test_asset: Object.freeze(["superseded"]),
  blocked_public_unsafe: Object.freeze(["superseded"]),
  blocked_derivative_risk: Object.freeze(["superseded"]),
  blocked_relationship_conflict: Object.freeze(["superseded"]),
  blocked_missing_evidence: Object.freeze(["superseded"]),
  rejected: Object.freeze(["superseded"]),
  superseded: Object.freeze([]),
});

const ITEM_SELECT_COLUMNS = `id, asset_domain, asset_id, related_asset_id, source_table, source_row_id,
  issue_category, review_status, severity, priority, legacy_owner_user_id,
  proposed_asset_owner_type, proposed_owning_user_id, proposed_owning_organization_id,
  proposed_ownership_status, proposed_ownership_source, proposed_ownership_confidence,
  evidence_source_path, evidence_report_generated_at, evidence_summary_json, safe_notes,
  assigned_to_user_id, reviewed_by_user_id, reviewed_at, created_by_user_id,
  created_at, updated_at, superseded_by_id, metadata_json`;

const EVENT_SELECT_COLUMNS = `id, review_item_id, event_type, old_status, new_status,
  actor_user_id, actor_email, reason, idempotency_key, request_hash, event_metadata_json, created_at`;

export class TenantAssetManualReviewStatusError extends Error {
  constructor(message, { status = 400, code = "tenant_asset_manual_review_status_error", fields = {} } = {}) {
    super(message);
    this.name = "TenantAssetManualReviewStatusError";
    this.status = status;
    this.code = code;
    this.fields = Object.freeze({ ...fields });
  }
}

function isMissingReviewTableError(error) {
  return /no such table:\s*ai_asset_manual_review_/i.test(String(error?.message || ""));
}

function normalizeSafeText(value, { maxLength = 160, required = false, field = "text" } = {}) {
  const text = String(value || "").trim();
  if (!text) {
    if (required) {
      throw new TenantAssetManualReviewStatusError("Required manual-review status field is missing.", {
        code: "tenant_asset_manual_review_status_required",
        fields: { field },
      });
    }
    return null;
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new TenantAssetManualReviewStatusError("Manual-review status field contains unsafe control characters.", {
      code: "tenant_asset_manual_review_status_unsafe_text",
      fields: { field },
    });
  }
  return text.slice(0, maxLength);
}

function normalizeBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (value === true || value === false) return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  throw new TenantAssetManualReviewStatusError("Invalid manual-review status boolean option.", {
    code: "tenant_asset_manual_review_status_invalid_boolean",
  });
}

function normalizeSafeId(value, { field = "id", required = false } = {}) {
  const text = String(value || "").trim();
  if (!text) {
    if (required) {
      throw new TenantAssetManualReviewStatusError("Required manual-review status identifier is missing.", {
        code: "tenant_asset_manual_review_status_required",
        fields: { field },
      });
    }
    return null;
  }
  if (text.length > MAX_SAFE_ID_LENGTH || /[\u0000-\u001f\u007f/]/.test(text)) {
    throw new TenantAssetManualReviewStatusError("Invalid manual-review status identifier.", {
      code: "tenant_asset_manual_review_status_invalid_id",
      fields: { field },
    });
  }
  return text;
}

function normalizeIdempotencyKey(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new TenantAssetManualReviewStatusError("A valid Idempotency-Key header is required.", {
      status: 428,
      code: "idempotency_key_required",
    });
  }
  const key = normalizeSafeText(value, { maxLength: 160, required: true, field: "Idempotency-Key" });
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key)) {
    throw new TenantAssetManualReviewStatusError("A valid Idempotency-Key header is required.", {
      status: 428,
      code: "idempotency_key_required",
    });
  }
  return key;
}

function normalizeRequiredStatus(value) {
  const normalized = normalizeTenantAssetManualReviewStatus(value);
  if (!normalized) {
    throw new TenantAssetManualReviewStatusError("Unsupported manual-review status.", {
      code: "tenant_asset_manual_review_status_invalid",
      fields: { newStatus: value },
    });
  }
  return normalized;
}

function normalizeMetadata(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TenantAssetManualReviewStatusError("Manual-review status metadata must be an object.", {
      code: "tenant_asset_manual_review_status_metadata_invalid",
    });
  }
  return Object.fromEntries(Object.entries(value).slice(0, STATUS_METADATA_MAX_KEYS));
}

export function normalizeManualReviewStatusUpdateRequest(input = {}) {
  const newStatus = normalizeRequiredStatus(input.newStatus ?? input.new_status);
  const reason = normalizeSafeText(input.reason, {
    maxLength: MAX_REASON_LENGTH,
    required: true,
    field: "reason",
  });
  const confirm = normalizeBoolean(input.confirm, false);
  if (!confirm) {
    throw new TenantAssetManualReviewStatusError("Manual-review status updates require confirm=true.", {
      code: "tenant_asset_manual_review_status_confirmation_required",
    });
  }
  return {
    domain: "folders_images",
    newStatus,
    reason,
    confirm,
    metadata: normalizeMetadata(input.metadata),
  };
}

export function validateManualReviewStatusTransition(currentStatus, newStatus) {
  const current = normalizeTenantAssetManualReviewStatus(currentStatus);
  const next = normalizeTenantAssetManualReviewStatus(newStatus);
  if (!current || !next) {
    return {
      allowed: false,
      code: "tenant_asset_manual_review_status_invalid",
      reason: "status_not_allowlisted",
    };
  }
  if (current === next) {
    return {
      allowed: false,
      code: "tenant_asset_manual_review_status_noop",
      reason: "already_at_requested_status",
    };
  }
  const allowedNext = TRANSITIONS[current] || [];
  if (!allowedNext.includes(next)) {
    return {
      allowed: false,
      code: "tenant_asset_manual_review_status_transition_forbidden",
      reason: "transition_not_allowed",
    };
  }
  return {
    allowed: true,
    currentStatus: current,
    newStatus: next,
    eventType: eventTypeForStatus(next),
    terminal: TERMINAL_STATUSES.has(next) || next === "superseded",
  };
}

function eventTypeForStatus(status) {
  if (status === "deferred") return "deferred";
  if (status === "rejected") return "rejected";
  if (status === "superseded") return "superseded";
  return "status_changed";
}

async function readReviewItem(env, itemId) {
  return env.DB.prepare(
    `SELECT ${ITEM_SELECT_COLUMNS}
       FROM ai_asset_manual_review_items
      WHERE id = ?
      LIMIT 1`
  ).bind(itemId).first();
}

async function readReviewEvent(env, eventId) {
  return env.DB.prepare(
    `SELECT ${EVENT_SELECT_COLUMNS}
       FROM ai_asset_manual_review_events
      WHERE id = ?
      LIMIT 1`
  ).bind(eventId).first();
}

async function listEventsForIdempotency(env, idempotencyKeyHash, limit = 20) {
  const result = await env.DB.prepare(
    `SELECT ${EVENT_SELECT_COLUMNS}
       FROM ai_asset_manual_review_events
      WHERE idempotency_key = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?`
  ).bind(idempotencyKeyHash, limit).all();
  return result?.results || [];
}

export async function buildManualReviewStatusRequestHash({ itemId, request }) {
  const normalized = {
    operation: "tenant_asset_manual_review_status_update",
    domain: "folders_images",
    itemId,
    newStatus: request.newStatus,
    reason: request.reason,
    metadata: request.metadata || {},
  };
  return sha256Hex(JSON.stringify(normalized));
}

async function buildManualReviewStatusEventId({ reviewItemId, idempotencyKeyHash, requestHash }) {
  const hash = await sha256Hex(`status|${reviewItemId}|${idempotencyKeyHash}|${requestHash}`);
  return `ta_mre_${hash.slice(0, 32)}`;
}

export function buildManualReviewStatusEvent({
  eventId,
  itemId,
  eventType,
  oldStatus,
  newStatus,
  adminUser,
  reason,
  idempotencyKeyHash,
  requestHash,
  metadata,
  now,
}) {
  const eventMetadataJson = serializeTenantAssetManualReviewMetadata({
    statusWorkflowPhase: "6.17",
    operatorMetadata: metadata || {},
    accessChecksChanged: false,
    ownershipBackfillPerformed: false,
    sourceAssetMutation: false,
    r2Operation: false,
  });
  return {
    id: eventId,
    review_item_id: itemId,
    event_type: eventType,
    old_status: oldStatus,
    new_status: newStatus,
    actor_user_id: adminUser?.id || null,
    actor_email: adminUser?.email || null,
    reason,
    idempotency_key: idempotencyKeyHash,
    request_hash: requestHash,
    event_metadata_json: eventMetadataJson,
    created_at: now,
  };
}

function statusErrorFromMissingSchema(error) {
  if (isMissingReviewTableError(error)) {
    return new TenantAssetManualReviewStatusError("Manual-review state tables are unavailable.", {
      status: 409,
      code: "tenant_asset_manual_review_schema_unavailable",
    });
  }
  return error;
}

export async function updateTenantAssetManualReviewStatus(env, {
  itemId,
  request,
  adminUser,
  idempotencyKey,
} = {}) {
  const safeItemId = normalizeSafeId(itemId, { field: "id", required: true });
  const normalizedRequest = normalizeManualReviewStatusUpdateRequest(request || {});
  const safeIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
  const idempotencyKeyHash = await sha256Hex(`tenant-asset-manual-review-status:${safeIdempotencyKey}`);
  const requestHash = await buildManualReviewStatusRequestHash({
    itemId: safeItemId,
    request: normalizedRequest,
  });

  try {
    const existingEvents = await listEventsForIdempotency(env, idempotencyKeyHash);
    if (existingEvents.length > 0) {
      if (existingEvents.some((event) => event.request_hash !== requestHash)) {
        throw new TenantAssetManualReviewStatusError("Idempotency-Key was already used for a different manual-review status request.", {
          status: 409,
          code: "idempotency_conflict",
        });
      }
      const item = await readReviewItem(env, safeItemId);
      if (!item?.id) {
        throw new TenantAssetManualReviewStatusError("Manual-review item was not found.", {
          status: 404,
          code: "tenant_asset_manual_review_item_not_found",
        });
      }
      return {
        reportVersion: TENANT_ASSET_MANUAL_REVIEW_STATUS_VERSION,
        generatedAt: nowIso(),
        domain: "folders_images",
        itemId: safeItemId,
        previousStatus: existingEvents[0].old_status || null,
        newStatus: existingEvents[0].new_status || normalizedRequest.newStatus,
        eventType: existingEvents[0].event_type || eventTypeForStatus(normalizedRequest.newStatus),
        idempotency: {
          required: true,
          storedAs: "sha256",
          replayed: true,
          eventCount: existingEvents.length,
        },
        item: serializeTenantAssetManualReviewItem(item),
        event: serializeTenantAssetManualReviewEvent(existingEvents[0]),
        noBackfill: true,
        noAccessSwitch: true,
        noSourceAssetMutation: true,
        noR2Operation: true,
      };
    }

    const item = await readReviewItem(env, safeItemId);
    if (!item?.id) {
      throw new TenantAssetManualReviewStatusError("Manual-review item was not found.", {
        status: 404,
        code: "tenant_asset_manual_review_item_not_found",
      });
    }
    const transition = validateManualReviewStatusTransition(item.review_status, normalizedRequest.newStatus);
    if (!transition.allowed) {
      throw new TenantAssetManualReviewStatusError("Manual-review status transition is not allowed.", {
        status: transition.code === "tenant_asset_manual_review_status_noop" ? 409 : 400,
        code: transition.code,
        fields: {
          currentStatus: item.review_status,
          newStatus: normalizedRequest.newStatus,
          reason: transition.reason,
        },
      });
    }

    const timestamp = nowIso();
    const eventId = await buildManualReviewStatusEventId({
      reviewItemId: safeItemId,
      idempotencyKeyHash,
      requestHash,
    });
    const event = buildManualReviewStatusEvent({
      eventId,
      itemId: safeItemId,
      eventType: transition.eventType,
      oldStatus: item.review_status,
      newStatus: normalizedRequest.newStatus,
      adminUser,
      reason: normalizedRequest.reason,
      idempotencyKeyHash,
      requestHash,
      metadata: normalizedRequest.metadata,
      now: timestamp,
    });

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE ai_asset_manual_review_items
            SET review_status = ?,
                reviewed_by_user_id = ?,
                reviewed_at = ?,
                updated_at = ?
          WHERE id = ?`
      ).bind(
        normalizedRequest.newStatus,
        adminUser?.id || null,
        timestamp,
        timestamp,
        safeItemId
      ),
      env.DB.prepare(
        `INSERT INTO ai_asset_manual_review_events (
          id, review_item_id, event_type, old_status, new_status, actor_user_id,
          actor_email, reason, idempotency_key, request_hash, event_metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        event.id,
        event.review_item_id,
        event.event_type,
        event.old_status,
        event.new_status,
        event.actor_user_id,
        event.actor_email,
        event.reason,
        event.idempotency_key,
        event.request_hash,
        event.event_metadata_json,
        event.created_at
      ),
    ]);

    const updatedItem = await readReviewItem(env, safeItemId);
    const createdEvent = await readReviewEvent(env, eventId);
    return {
      reportVersion: TENANT_ASSET_MANUAL_REVIEW_STATUS_VERSION,
      generatedAt: nowIso(),
      domain: "folders_images",
      itemId: safeItemId,
      previousStatus: item.review_status,
      newStatus: normalizedRequest.newStatus,
      eventType: transition.eventType,
      idempotency: {
        required: true,
        storedAs: "sha256",
        replayed: false,
      },
      item: serializeTenantAssetManualReviewItem(updatedItem),
      event: serializeTenantAssetManualReviewEvent(createdEvent),
      noBackfill: true,
      noAccessSwitch: true,
      noSourceAssetMutation: true,
      noR2Operation: true,
    };
  } catch (error) {
    throw statusErrorFromMissingSchema(error);
  }
}

export function serializeManualReviewStatusUpdateResult(result) {
  return {
    ...result,
    statusWorkflowAvailable: true,
    allowedStatuses: TENANT_ASSET_MANUAL_REVIEW_STATUSES,
    runtimeBehaviorChanged: false,
    accessChecksChanged: false,
    tenantIsolationClaimed: false,
    backfillPerformed: false,
    sourceAssetRowsMutated: false,
    ownershipMetadataUpdated: false,
    r2LiveListed: false,
    productionReadiness: "blocked",
  };
}
