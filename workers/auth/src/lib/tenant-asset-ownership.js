export const TENANT_ASSET_OWNER_TYPES = Object.freeze([
  "personal_user_asset",
  "organization_asset",
  "platform_admin_test_asset",
  "platform_background_asset",
  "legacy_unclassified_asset",
  "external_reference_asset",
  "audit_archive_asset",
]);

export const TENANT_ASSET_OWNER_TYPE = Object.freeze({
  PERSONAL_USER_ASSET: "personal_user_asset",
  ORGANIZATION_ASSET: "organization_asset",
  PLATFORM_ADMIN_TEST_ASSET: "platform_admin_test_asset",
  PLATFORM_BACKGROUND_ASSET: "platform_background_asset",
  LEGACY_UNCLASSIFIED_ASSET: "legacy_unclassified_asset",
  EXTERNAL_REFERENCE_ASSET: "external_reference_asset",
  AUDIT_ARCHIVE_ASSET: "audit_archive_asset",
});

export const TENANT_ASSET_OWNERSHIP_STATUSES = Object.freeze([
  "current",
  "legacy_unclassified",
  "ambiguous",
  "orphan_reference",
  "unsafe_to_migrate",
  "pending_review",
]);

export const TENANT_ASSET_OWNERSHIP_STATUS = Object.freeze({
  CURRENT: "current",
  LEGACY_UNCLASSIFIED: "legacy_unclassified",
  AMBIGUOUS: "ambiguous",
  ORPHAN_REFERENCE: "orphan_reference",
  UNSAFE_TO_MIGRATE: "unsafe_to_migrate",
  PENDING_REVIEW: "pending_review",
});

export const TENANT_ASSET_OWNERSHIP_SOURCES = Object.freeze([
  "new_write_personal",
  "new_write_org_context",
  "admin_selected_org",
  "platform_admin_test",
  "dry_run_inferred",
  "manual_review",
  "legacy_default",
]);

export const TENANT_ASSET_OWNERSHIP_SOURCE = Object.freeze({
  NEW_WRITE_PERSONAL: "new_write_personal",
  NEW_WRITE_ORG_CONTEXT: "new_write_org_context",
  ADMIN_SELECTED_ORG: "admin_selected_org",
  PLATFORM_ADMIN_TEST: "platform_admin_test",
  DRY_RUN_INFERRED: "dry_run_inferred",
  MANUAL_REVIEW: "manual_review",
  LEGACY_DEFAULT: "legacy_default",
});

export const TENANT_ASSET_OWNERSHIP_CONFIDENCES = Object.freeze([
  "high",
  "medium",
  "low",
  "none",
]);

export const TENANT_ASSET_OWNERSHIP_CONFIDENCE = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  NONE: "none",
});

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

export function buildTenantAssetOwnershipFields({
  ownerType,
  owningUserId = null,
  owningOrganizationId = null,
  createdByUserId = null,
  status = TENANT_ASSET_OWNERSHIP_STATUS.CURRENT,
  source,
  confidence = TENANT_ASSET_OWNERSHIP_CONFIDENCE.HIGH,
  assignedAt = null,
  metadata = {},
} = {}) {
  const normalizedOwnerType = normalizeTenantAssetOwnerType(ownerType);
  const normalizedStatus = normalizeTenantAssetOwnershipStatus(status);
  const normalizedSource = normalizeTenantAssetOwnershipSource(source);
  const normalizedConfidence = normalizeTenantAssetOwnershipConfidence(confidence);

  if (!normalizedOwnerType || !normalizedStatus || !normalizedSource || !normalizedConfidence) {
    throw new Error("Invalid tenant asset ownership metadata.");
  }

  return {
    assetOwnerType: normalizedOwnerType,
    owningUserId: owningUserId || null,
    owningOrganizationId: owningOrganizationId || null,
    createdByUserId: createdByUserId || null,
    ownershipStatus: normalizedStatus,
    ownershipSource: normalizedSource,
    ownershipConfidence: normalizedConfidence,
    ownershipMetadataJson: serializeTenantAssetOwnershipMetadata(metadata),
    ownershipAssignedAt: assignedAt || new Date().toISOString(),
  };
}

export function buildPersonalUserAssetOwnershipFields({
  userId,
  assignedAt = null,
  metadata = {},
} = {}) {
  return buildTenantAssetOwnershipFields({
    ownerType: TENANT_ASSET_OWNER_TYPE.PERSONAL_USER_ASSET,
    owningUserId: userId || null,
    owningOrganizationId: null,
    createdByUserId: userId || null,
    status: TENANT_ASSET_OWNERSHIP_STATUS.CURRENT,
    source: TENANT_ASSET_OWNERSHIP_SOURCE.NEW_WRITE_PERSONAL,
    confidence: TENANT_ASSET_OWNERSHIP_CONFIDENCE.HIGH,
    assignedAt,
    metadata,
  });
}
