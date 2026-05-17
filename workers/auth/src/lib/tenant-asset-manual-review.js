export const TENANT_ASSET_MANUAL_REVIEW_ISSUE_CATEGORIES = Object.freeze([
  "metadata_missing",
  "public_unsafe",
  "derivative_risk",
  "dual_read_unsafe",
  "manual_review_needed",
  "relationship_review",
  "legacy_unclassified",
  "future_org_ownership_review",
  "platform_admin_test_review",
  "safe_observe_only",
]);

export const TENANT_ASSET_MANUAL_REVIEW_STATUSES = Object.freeze([
  "pending_review",
  "review_in_progress",
  "approved_personal_user_asset",
  "approved_organization_asset",
  "approved_legacy_unclassified",
  "approved_platform_admin_test_asset",
  "blocked_public_unsafe",
  "blocked_derivative_risk",
  "blocked_relationship_conflict",
  "blocked_missing_evidence",
  "needs_legal_privacy_review",
  "deferred",
  "rejected",
  "superseded",
]);

export const TENANT_ASSET_MANUAL_REVIEW_EVENT_TYPES = Object.freeze([
  "created",
  "assigned",
  "note_added",
  "status_changed",
  "superseded",
  "deferred",
  "rejected",
]);

export const TENANT_ASSET_MANUAL_REVIEW_SEVERITIES = Object.freeze([
  "info",
  "warning",
  "critical",
]);

export const TENANT_ASSET_MANUAL_REVIEW_PRIORITIES = Object.freeze([
  "low",
  "medium",
  "high",
  "urgent",
]);

const MANUAL_REVIEW_METADATA_MAX_BYTES = 4096;
const SENSITIVE_MANUAL_REVIEW_KEY_PATTERN =
  /prompt|provider|response|request|r2_?key|signed_?url|secret|token|cookie|authorization|stripe|cloudflare|private_?key|idempotency|fingerprint/i;

function normalizeAllowlistedValue(value, allowedValues) {
  const normalized = String(value || "").trim();
  return allowedValues.includes(normalized) ? normalized : null;
}

export function normalizeTenantAssetManualReviewIssueCategory(value) {
  return normalizeAllowlistedValue(value, TENANT_ASSET_MANUAL_REVIEW_ISSUE_CATEGORIES);
}

export function normalizeTenantAssetManualReviewStatus(value) {
  return normalizeAllowlistedValue(value, TENANT_ASSET_MANUAL_REVIEW_STATUSES);
}

export function normalizeTenantAssetManualReviewEventType(value) {
  return normalizeAllowlistedValue(value, TENANT_ASSET_MANUAL_REVIEW_EVENT_TYPES);
}

export function normalizeTenantAssetManualReviewSeverity(value) {
  return normalizeAllowlistedValue(value, TENANT_ASSET_MANUAL_REVIEW_SEVERITIES);
}

export function normalizeTenantAssetManualReviewPriority(value) {
  return normalizeAllowlistedValue(value, TENANT_ASSET_MANUAL_REVIEW_PRIORITIES);
}

function sanitizeManualReviewMetadataValue(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (depth >= 2) return [];
    return value.slice(0, 20).map((entry) => sanitizeManualReviewMetadataValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= 2) return {};
    const output = {};
    for (const [key, entry] of Object.entries(value).slice(0, 40)) {
      const safeKey = String(key || "").replace(/[^\w.-]/g, "_").slice(0, 80);
      if (!safeKey) continue;
      if (SENSITIVE_MANUAL_REVIEW_KEY_PATTERN.test(safeKey)) {
        output[safeKey] = "[redacted]";
        continue;
      }
      output[safeKey] = sanitizeManualReviewMetadataValue(entry, depth + 1);
    }
    return output;
  }
  return null;
}

export function serializeTenantAssetManualReviewMetadata(value = {}) {
  const sanitized = sanitizeManualReviewMetadataValue(value) || {};
  let serialized = JSON.stringify(sanitized);
  if (new TextEncoder().encode(serialized).byteLength <= MANUAL_REVIEW_METADATA_MAX_BYTES) {
    return serialized;
  }
  serialized = JSON.stringify({
    truncated: true,
    keys: Object.keys(sanitized).slice(0, 40),
  });
  return serialized;
}
