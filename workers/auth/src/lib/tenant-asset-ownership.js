export const TENANT_ASSET_OWNER_TYPES = Object.freeze([
  "personal_user_asset",
  "organization_asset",
  "platform_admin_test_asset",
  "platform_background_asset",
  "legacy_unclassified_asset",
  "external_reference_asset",
  "audit_archive_asset",
]);

export const TENANT_ASSET_OWNERSHIP_STATUSES = Object.freeze([
  "current",
  "legacy_unclassified",
  "ambiguous",
  "orphan_reference",
  "unsafe_to_migrate",
  "pending_review",
]);

export const TENANT_ASSET_OWNERSHIP_SOURCES = Object.freeze([
  "new_write_personal",
  "new_write_org_context",
  "admin_selected_org",
  "platform_admin_test",
  "dry_run_inferred",
  "manual_review",
  "legacy_default",
]);

export const TENANT_ASSET_OWNERSHIP_CONFIDENCES = Object.freeze([
  "high",
  "medium",
  "low",
  "none",
]);

const TENANT_ASSET_METADATA_MAX_BYTES = 4096;
const SENSITIVE_METADATA_KEY_PATTERN = /prompt|input|output|provider|response|request|secret|token|cookie|authorization|idempotency/i;

function normalizeAllowlistedValue(value, allowedValues) {
  const normalized = String(value || "").trim();
  return allowedValues.includes(normalized) ? normalized : null;
}

export function normalizeTenantAssetOwnerType(value) {
  return normalizeAllowlistedValue(value, TENANT_ASSET_OWNER_TYPES);
}

export function normalizeTenantAssetOwnershipStatus(value) {
  return normalizeAllowlistedValue(value, TENANT_ASSET_OWNERSHIP_STATUSES);
}

export function normalizeTenantAssetOwnershipSource(value) {
  return normalizeAllowlistedValue(value, TENANT_ASSET_OWNERSHIP_SOURCES);
}

export function normalizeTenantAssetOwnershipConfidence(value) {
  return normalizeAllowlistedValue(value, TENANT_ASSET_OWNERSHIP_CONFIDENCES);
}

function sanitizeMetadataValue(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (depth >= 2) return [];
    return value.slice(0, 20).map((item) => sanitizeMetadataValue(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= 2) return {};
    const output = {};
    for (const [key, entry] of Object.entries(value).slice(0, 40)) {
      const safeKey = String(key || "").replace(/[^\w.-]/g, "_").slice(0, 80);
      if (!safeKey) continue;
      if (SENSITIVE_METADATA_KEY_PATTERN.test(safeKey)) {
        output[safeKey] = "[redacted]";
        continue;
      }
      output[safeKey] = sanitizeMetadataValue(entry, depth + 1);
    }
    return output;
  }
  return null;
}

export function serializeTenantAssetOwnershipMetadata(value = {}) {
  const sanitized = sanitizeMetadataValue(value) || {};
  let serialized = JSON.stringify(sanitized);
  if (new TextEncoder().encode(serialized).byteLength <= TENANT_ASSET_METADATA_MAX_BYTES) {
    return serialized;
  }
  serialized = JSON.stringify({
    truncated: true,
    keys: Object.keys(sanitized).slice(0, 40),
  });
  return serialized;
}
