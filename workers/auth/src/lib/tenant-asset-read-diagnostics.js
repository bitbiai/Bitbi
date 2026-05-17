import {
  normalizeTenantAssetOwnerType,
  normalizeTenantAssetOwnershipStatus,
  TENANT_ASSET_OWNER_TYPE,
  TENANT_ASSET_OWNERSHIP_STATUS,
} from "./tenant-asset-ownership.js";

export const TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATIONS = Object.freeze([
  "same_allow",
  "same_deny",
  "legacy_allows_metadata_denies",
  "legacy_denies_metadata_allows",
  "metadata_missing",
  "metadata_conflict",
  "relationship_conflict",
  "orphan_reference",
  "unsafe_to_switch",
  "needs_manual_review",
  "not_applicable",
]);

export const TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION = Object.freeze({
  SAME_ALLOW: "same_allow",
  SAME_DENY: "same_deny",
  LEGACY_ALLOWS_METADATA_DENIES: "legacy_allows_metadata_denies",
  LEGACY_DENIES_METADATA_ALLOWS: "legacy_denies_metadata_allows",
  METADATA_MISSING: "metadata_missing",
  METADATA_CONFLICT: "metadata_conflict",
  RELATIONSHIP_CONFLICT: "relationship_conflict",
  ORPHAN_REFERENCE: "orphan_reference",
  UNSAFE_TO_SWITCH: "unsafe_to_switch",
  NEEDS_MANUAL_REVIEW: "needs_manual_review",
  NOT_APPLICABLE: "not_applicable",
});

const DEFAULT_DIAGNOSTIC_LIMIT = 100;
const MAX_DIAGNOSTIC_LIMIT = 500;

function boundedLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DIAGNOSTIC_LIMIT;
  return Math.min(Math.floor(parsed), MAX_DIAGNOSTIC_LIMIT);
}

function normalizeMaybeId(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 128) return null;
  if (/[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function pickId(row, snakeKey, camelKey = snakeKey) {
  return normalizeMaybeId(row?.[snakeKey] ?? row?.[camelKey]);
}

function isPublicRow(row) {
  return String(row?.visibility || "").toLowerCase() === "public"
    || row?.is_public === true
    || row?.isPublic === true
    || Boolean(row?.published_at || row?.publishedAt);
}

function hasUnsafeKeyCharacters(key) {
  return (
    key.includes("..") ||
    key.includes("\\") ||
    key.includes("\0") ||
    key.includes("//") ||
    key.startsWith("/") ||
    /[\u0000-\u001f\u007f]/.test(key)
  );
}

function summarizeR2Key(value) {
  const key = String(value || "").trim();
  if (!key) {
    return { present: false, keyClass: "missing", unsafeCharacters: false };
  }
  let keyClass = "present";
  if (key.startsWith("users/")) keyClass = "users/{userId}/...";
  else if (key.startsWith("tmp/ai-generated/")) keyClass = "tmp/ai-generated/{userId}/...";
  else if (key.startsWith("news-pulse/")) keyClass = "news-pulse/...";
  else if (key.startsWith("avatars/")) keyClass = "avatars/{userId}";
  else if (key.startsWith("data-exports/")) keyClass = "data-exports/...";
  else if (key.startsWith("platform-budget-evidence/")) keyClass = "platform-budget-evidence/...";
  return {
    present: true,
    keyClass,
    unsafeCharacters: hasUnsafeKeyCharacters(key),
  };
}

function getOwnerType(row) {
  return normalizeTenantAssetOwnerType(row?.asset_owner_type ?? row?.assetOwnerType);
}

function getOwnershipStatus(row) {
  return normalizeTenantAssetOwnershipStatus(row?.ownership_status ?? row?.ownershipStatus);
}

function hasAnyOwnershipMetadata(row) {
  return Boolean(
    row?.asset_owner_type ||
    row?.assetOwnerType ||
    row?.owning_user_id ||
    row?.owningUserId ||
    row?.owning_organization_id ||
    row?.owningOrganizationId ||
    row?.created_by_user_id ||
    row?.createdByUserId ||
    row?.ownership_status ||
    row?.ownershipStatus ||
    row?.ownership_source ||
    row?.ownershipSource ||
    row?.ownership_confidence ||
    row?.ownershipConfidence ||
    row?.ownership_metadata_json ||
    row?.ownershipMetadataJson ||
    row?.ownership_assigned_at ||
    row?.ownershipAssignedAt
  );
}

function hasAmbiguousOwnershipStatus(status) {
  return status === TENANT_ASSET_OWNERSHIP_STATUS.AMBIGUOUS
    || status === TENANT_ASSET_OWNERSHIP_STATUS.ORPHAN_REFERENCE
    || status === TENANT_ASSET_OWNERSHIP_STATUS.UNSAFE_TO_MIGRATE
    || status === TENANT_ASSET_OWNERSHIP_STATUS.PENDING_REVIEW
    || status === TENANT_ASSET_OWNERSHIP_STATUS.LEGACY_UNCLASSIFIED;
}

function buildDiagnosticId(table, row, index, suffix = "read") {
  return `${table}:${pickId(row, "id") || `row-${index}`}:${suffix}`;
}

function makeItem({
  id,
  domain,
  sourceId,
  classification,
  severity,
  reason,
  userId = null,
  owningUserId = null,
  owningOrganizationId = null,
  ownerType = null,
  ownershipStatus = null,
  folderId = null,
  publicState = false,
  evidence = {},
  recommendation = null,
}) {
  return serializeTenantAssetReadDiagnosticItem({
    id,
    domain,
    sourceId,
    classification,
    severity,
    reason,
    legacyUserId: userId,
    owningUserId,
    owningOrganizationId,
    ownerType,
    ownershipStatus,
    folderId,
    public: publicState,
    evidence,
    recommendation,
  });
}

export function classifyTenantAssetReadDiagnosticSeverity(classification) {
  if (
    classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.UNSAFE_TO_SWITCH ||
    classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.METADATA_CONFLICT ||
    classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.RELATIONSHIP_CONFLICT ||
    classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.ORPHAN_REFERENCE ||
    classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.LEGACY_ALLOWS_METADATA_DENIES ||
    classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.LEGACY_DENIES_METADATA_ALLOWS
  ) {
    return "critical";
  }
  if (
    classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.METADATA_MISSING ||
    classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.NEEDS_MANUAL_REVIEW
  ) {
    return "warning";
  }
  return "info";
}

export function compareLegacyAndOwnershipAccessSignals(row) {
  const userId = pickId(row, "user_id", "userId");
  const owningUserId = pickId(row, "owning_user_id", "owningUserId");
  const owningOrganizationId = pickId(row, "owning_organization_id", "owningOrganizationId");
  const ownerType = getOwnerType(row);
  const ownershipStatus = getOwnershipStatus(row);
  const metadataPresent = hasAnyOwnershipMetadata(row);

  if (!metadataPresent) {
    return {
      classification: TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.METADATA_MISSING,
      reason: "ownership_metadata_missing",
      ownerType: null,
      ownershipStatus: null,
      userId,
      owningUserId,
      owningOrganizationId,
    };
  }

  if (!ownerType || (row?.ownership_status || row?.ownershipStatus) && !ownershipStatus) {
    return {
      classification: TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.UNSAFE_TO_SWITCH,
      reason: "unknown_owner_type_or_status",
      ownerType: ownerType || null,
      ownershipStatus: ownershipStatus || null,
      userId,
      owningUserId,
      owningOrganizationId,
    };
  }

  if (hasAmbiguousOwnershipStatus(ownershipStatus)) {
    return {
      classification: TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.NEEDS_MANUAL_REVIEW,
      reason: `ownership_status_${ownershipStatus}`,
      ownerType,
      ownershipStatus,
      userId,
      owningUserId,
      owningOrganizationId,
    };
  }

  if (ownerType === TENANT_ASSET_OWNER_TYPE.PERSONAL_USER_ASSET) {
    if (userId && owningUserId && userId === owningUserId) {
      return {
        classification: TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW,
        reason: "legacy_user_matches_owning_user",
        ownerType,
        ownershipStatus,
        userId,
        owningUserId,
        owningOrganizationId,
      };
    }
    return {
      classification: TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.METADATA_CONFLICT,
      reason: "personal_owner_does_not_match_legacy_user",
      ownerType,
      ownershipStatus,
      userId,
      owningUserId,
      owningOrganizationId,
    };
  }

  if (
    ownerType === TENANT_ASSET_OWNER_TYPE.ORGANIZATION_ASSET ||
    ownerType === TENANT_ASSET_OWNER_TYPE.PLATFORM_ADMIN_TEST_ASSET
  ) {
    return {
      classification: TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.NEEDS_MANUAL_REVIEW,
      reason: `${ownerType}_access_not_enabled`,
      ownerType,
      ownershipStatus,
      userId,
      owningUserId,
      owningOrganizationId,
    };
  }

  return {
    classification: TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.UNSAFE_TO_SWITCH,
    reason: `${ownerType}_not_supported_for_folder_image_access`,
    ownerType,
    ownershipStatus,
    userId,
    owningUserId,
    owningOrganizationId,
  };
}

export function diagnoseFolderOwnershipReadSafety(folder, { index = 0 } = {}) {
  const comparison = compareLegacyAndOwnershipAccessSignals(folder);
  const severity = classifyTenantAssetReadDiagnosticSeverity(comparison.classification);
  return makeItem({
    id: buildDiagnosticId("ai_folders", folder, index),
    domain: "ai_folders",
    sourceId: pickId(folder, "id"),
    classification: comparison.classification,
    severity,
    reason: comparison.reason,
    userId: comparison.userId,
    owningUserId: comparison.owningUserId,
    owningOrganizationId: comparison.owningOrganizationId,
    ownerType: comparison.ownerType,
    ownershipStatus: comparison.ownershipStatus,
    evidence: {
      status: String(folder?.status || "unknown").slice(0, 40),
      metadataPresent: hasAnyOwnershipMetadata(folder),
      legacyAccessBasis: "ai_folders.user_id",
      simulatedOnly: true,
    },
    recommendation: comparison.classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW
      ? "Keep observing before any access switch."
      : "Do not switch this folder to ownership-metadata access without review.",
  });
}

function summarizeDerivativeFields(image, parentClassification) {
  const thumb = summarizeR2Key(image?.thumb_key ?? image?.thumbKey);
  const medium = summarizeR2Key(image?.medium_key ?? image?.mediumKey);
  const hasDerivative = thumb.present || medium.present;
  return {
    thumb_key: thumb,
    medium_key: medium,
    hasDerivative,
    r2LiveListed: false,
    derivativeOwnershipRisk: hasDerivative && parentClassification !== TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW
      ? "derivative_parent_ownership_not_safe"
      : "inherits_parent_owner",
  };
}

export function diagnoseImageOwnershipReadSafety(image, {
  index = 0,
  foldersById = new Map(),
  folderDiagnosticsById = new Map(),
} = {}) {
  const folderId = pickId(image, "folder_id", "folderId");
  const folder = folderId ? foldersById.get(folderId) : null;
  const comparison = compareLegacyAndOwnershipAccessSignals(image);
  let classification = comparison.classification;
  let reason = comparison.reason;
  const publicState = isPublicRow(image);

  if (folderId && !folder) {
    classification = TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.ORPHAN_REFERENCE;
    reason = "image_references_missing_folder";
  } else if (folder) {
    const imageUserId = comparison.userId;
    const folderUserId = pickId(folder, "user_id", "userId");
    const imageOwnerType = comparison.ownerType;
    const folderComparison = compareLegacyAndOwnershipAccessSignals(folder);
    const imageOwnerKey = `${imageOwnerType || ""}:${comparison.owningUserId || ""}:${comparison.owningOrganizationId || ""}`;
    const folderOwnerKey = `${folderComparison.ownerType || ""}:${folderComparison.owningUserId || ""}:${folderComparison.owningOrganizationId || ""}`;

    if (imageUserId && folderUserId && imageUserId !== folderUserId) {
      classification = TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.RELATIONSHIP_CONFLICT;
      reason = "folder_image_legacy_user_conflict";
    } else if (
      imageOwnerType &&
      folderComparison.ownerType &&
      imageOwnerKey !== folderOwnerKey
    ) {
      classification = TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.RELATIONSHIP_CONFLICT;
      reason = "folder_image_metadata_owner_conflict";
    } else if (
      hasAnyOwnershipMetadata(image) !== hasAnyOwnershipMetadata(folder) &&
      classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW
    ) {
      classification = TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.NEEDS_MANUAL_REVIEW;
      reason = "folder_image_metadata_presence_mismatch";
    }

    const folderDiagnostic = folderDiagnosticsById.get(folderId);
    if (
      folderDiagnostic?.classification &&
      folderDiagnostic.classification !== TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW &&
      classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW
    ) {
      classification = TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.NEEDS_MANUAL_REVIEW;
      reason = "folder_metadata_not_safe";
    }
  }

  if (
    publicState &&
    (
      classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.METADATA_MISSING ||
      classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.METADATA_CONFLICT ||
      classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.RELATIONSHIP_CONFLICT ||
      classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.ORPHAN_REFERENCE ||
      classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.NEEDS_MANUAL_REVIEW
    )
  ) {
    classification = TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.UNSAFE_TO_SWITCH;
    reason = `public_image_${reason}`;
  }

  const derivative = summarizeDerivativeFields(image, classification);
  const severity = classifyTenantAssetReadDiagnosticSeverity(classification);

  return makeItem({
    id: buildDiagnosticId("ai_images", image, index),
    domain: "ai_images",
    sourceId: pickId(image, "id"),
    classification,
    severity,
    reason,
    userId: comparison.userId,
    owningUserId: comparison.owningUserId,
    owningOrganizationId: comparison.owningOrganizationId,
    ownerType: comparison.ownerType,
    ownershipStatus: comparison.ownershipStatus,
    folderId,
    publicState,
    evidence: {
      visibility: String(image?.visibility || "private").slice(0, 40),
      metadataPresent: hasAnyOwnershipMetadata(image),
      legacyAccessBasis: "ai_images.user_id",
      r2KeyFields: {
        r2_key: summarizeR2Key(image?.r2_key ?? image?.r2Key),
        thumb_key: derivative.thumb_key,
        medium_key: derivative.medium_key,
      },
      derivative,
      r2LiveListed: false,
      simulatedOnly: true,
    },
    recommendation: classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW
      ? "Keep observing before any access switch."
      : "Do not switch this image to ownership-metadata access without review.",
  });
}

function buildRelationshipDiagnostic(image, {
  index = 0,
  foldersById = new Map(),
}) {
  const folderId = pickId(image, "folder_id", "folderId");
  if (!folderId) {
    return makeItem({
      id: buildDiagnosticId("ai_images", image, index, "relationship"),
      domain: "folder_image_relationship",
      sourceId: pickId(image, "id"),
      classification: TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.NOT_APPLICABLE,
      severity: "info",
      reason: "image_has_no_folder",
      folderId: null,
      publicState: isPublicRow(image),
      evidence: { simulatedOnly: true },
      recommendation: "No folder relationship to compare.",
    });
  }
  const folder = foldersById.get(folderId);
  if (!folder) {
    return makeItem({
      id: buildDiagnosticId("ai_images", image, index, "relationship"),
      domain: "folder_image_relationship",
      sourceId: pickId(image, "id"),
      classification: TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.ORPHAN_REFERENCE,
      severity: "critical",
      reason: "image_references_missing_folder",
      userId: pickId(image, "user_id", "userId"),
      folderId,
      publicState: isPublicRow(image),
      evidence: { simulatedOnly: true },
      recommendation: "Resolve missing folder evidence before any ownership-based access switch.",
    });
  }

  const imageComparison = compareLegacyAndOwnershipAccessSignals(image);
  const folderComparison = compareLegacyAndOwnershipAccessSignals(folder);
  const imageUserId = imageComparison.userId;
  const folderUserId = folderComparison.userId;
  const imageOwnerKey = `${imageComparison.ownerType || ""}:${imageComparison.owningUserId || ""}:${imageComparison.owningOrganizationId || ""}`;
  const folderOwnerKey = `${folderComparison.ownerType || ""}:${folderComparison.owningUserId || ""}:${folderComparison.owningOrganizationId || ""}`;

  let classification = TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW;
  let reason = "folder_image_legacy_user_and_metadata_match";
  if (imageUserId && folderUserId && imageUserId !== folderUserId) {
    classification = TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.RELATIONSHIP_CONFLICT;
    reason = "folder_image_legacy_user_conflict";
  } else if (imageComparison.ownerType && folderComparison.ownerType && imageOwnerKey !== folderOwnerKey) {
    classification = TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.RELATIONSHIP_CONFLICT;
    reason = "folder_image_metadata_owner_conflict";
  } else if (hasAnyOwnershipMetadata(image) !== hasAnyOwnershipMetadata(folder)) {
    classification = TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.NEEDS_MANUAL_REVIEW;
    reason = "folder_image_metadata_presence_mismatch";
  } else if (
    imageComparison.classification !== TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW ||
    folderComparison.classification !== TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW
  ) {
    classification = TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.NEEDS_MANUAL_REVIEW;
    reason = "folder_or_image_metadata_not_safe";
  }

  return makeItem({
    id: buildDiagnosticId("ai_images", image, index, "relationship"),
    domain: "folder_image_relationship",
    sourceId: pickId(image, "id"),
    classification,
    severity: classifyTenantAssetReadDiagnosticSeverity(classification),
    reason,
    userId: imageUserId,
    owningUserId: imageComparison.owningUserId,
    owningOrganizationId: imageComparison.owningOrganizationId,
    ownerType: imageComparison.ownerType,
    ownershipStatus: imageComparison.ownershipStatus,
    folderId,
    publicState: isPublicRow(image),
    evidence: {
      folderUserId,
      folderOwnerType: folderComparison.ownerType,
      folderOwningUserId: folderComparison.owningUserId,
      folderOwningOrganizationId: folderComparison.owningOrganizationId,
      simulatedOnly: true,
    },
    recommendation: classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW
      ? "Relationship is safe in the simulated diagnostic only; do not change access checks yet."
      : "Review folder/image owner alignment before any access-check migration.",
  });
}

function buildPublicGalleryDiagnostic(image, { index = 0 } = {}) {
  if (!isPublicRow(image)) return null;
  const comparison = compareLegacyAndOwnershipAccessSignals(image);
  let classification = comparison.classification;
  let reason = comparison.reason;
  if (
    classification !== TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW
  ) {
    classification = TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.UNSAFE_TO_SWITCH;
    reason = `public_image_${reason}`;
  }
  return makeItem({
    id: buildDiagnosticId("ai_images", image, index, "public"),
    domain: "public_gallery",
    sourceId: pickId(image, "id"),
    classification,
    severity: classifyTenantAssetReadDiagnosticSeverity(classification),
    reason,
    userId: comparison.userId,
    owningUserId: comparison.owningUserId,
    owningOrganizationId: comparison.owningOrganizationId,
    ownerType: comparison.ownerType,
    ownershipStatus: comparison.ownershipStatus,
    folderId: pickId(image, "folder_id", "folderId"),
    publicState: true,
    evidence: {
      currentAttributionBasis: "ai_images.user_id -> profiles",
      organizationPublisherPolicyImplemented: false,
      publicBehaviorChanged: false,
      simulatedOnly: true,
    },
    recommendation: classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW
      ? "Safe for current legacy user-profile attribution only; not tenant isolation evidence."
      : "Keep public row on legacy user-profile attribution until ownership is reviewed.",
  });
}

function buildDerivativeDiagnostic(image, { index = 0, parentClassification } = {}) {
  const derivative = summarizeDerivativeFields(image, parentClassification);
  if (!derivative.hasDerivative) return null;
  const classification = derivative.derivativeOwnershipRisk === "inherits_parent_owner"
    ? TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW
    : TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.NEEDS_MANUAL_REVIEW;
  return makeItem({
    id: buildDiagnosticId("ai_images", image, index, "derivative"),
    domain: "image_derivatives",
    sourceId: pickId(image, "id"),
    classification,
    severity: classifyTenantAssetReadDiagnosticSeverity(classification),
    reason: derivative.derivativeOwnershipRisk,
    userId: pickId(image, "user_id", "userId"),
    owningUserId: pickId(image, "owning_user_id", "owningUserId"),
    owningOrganizationId: pickId(image, "owning_organization_id", "owningOrganizationId"),
    ownerType: getOwnerType(image),
    ownershipStatus: getOwnershipStatus(image),
    folderId: pickId(image, "folder_id", "folderId"),
    publicState: isPublicRow(image),
    evidence: {
      derivative,
      r2LiveListed: false,
      targetModel: "derivatives_inherit_parent_owner",
      simulatedOnly: true,
    },
    recommendation: classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW
      ? "Derivative keys can inherit the parent owner in future design; do not move R2 keys in this phase."
      : "Review parent image ownership before relying on derivative ownership inheritance.",
  });
}

function countWhere(items, predicate) {
  return items.reduce((count, item) => count + (predicate(item) ? 1 : 0), 0);
}

export function buildTenantAssetReadDiagnosticSummary({
  folders = [],
  images = [],
  folderDiagnostics = [],
  imageDiagnostics = [],
  relationshipDiagnostics = [],
  publicGalleryDiagnostics = [],
  derivativeDiagnostics = [],
} = {}) {
  const all = [
    ...folderDiagnostics,
    ...imageDiagnostics,
    ...relationshipDiagnostics,
    ...publicGalleryDiagnostics,
    ...derivativeDiagnostics,
  ];
  const classificationCounts = {};
  const severityCounts = {};
  for (const item of all) {
    classificationCounts[item.classification] = (classificationCounts[item.classification] || 0) + 1;
    severityCounts[item.severity] = (severityCounts[item.severity] || 0) + 1;
  }
  return {
    totalFoldersScanned: folders.length,
    totalImagesScanned: images.length,
    foldersWithOwnershipMetadata: countWhere(folders, hasAnyOwnershipMetadata),
    imagesWithOwnershipMetadata: countWhere(images, hasAnyOwnershipMetadata),
    foldersWithNullOwnershipMetadata: countWhere(folders, (row) => !hasAnyOwnershipMetadata(row)),
    imagesWithNullOwnershipMetadata: countWhere(images, (row) => !hasAnyOwnershipMetadata(row)),
    legacyUserOwnerMatchingNewOwningUser: countWhere([...folders, ...images], (row) => {
      const comparison = compareLegacyAndOwnershipAccessSignals(row);
      return comparison.classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW;
    }),
    mismatchedUserIdVsOwningUserId: countWhere([...folders, ...images], (row) => {
      const comparison = compareLegacyAndOwnershipAccessSignals(row);
      return comparison.classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.METADATA_CONFLICT;
    }),
    organizationOwnedRowsFound: countWhere([...folders, ...images], (row) => getOwnerType(row) === TENANT_ASSET_OWNER_TYPE.ORGANIZATION_ASSET),
    ambiguousRows: countWhere(all, (item) => (
      item.classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.UNSAFE_TO_SWITCH ||
      item.classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.METADATA_CONFLICT ||
      item.classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.RELATIONSHIP_CONFLICT ||
      item.classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.NEEDS_MANUAL_REVIEW
    )),
    orphanFolderReferences: countWhere(relationshipDiagnostics, (item) => item.classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.ORPHAN_REFERENCE),
    publicImagesWithMissingOrAmbiguousOwnership: countWhere(publicGalleryDiagnostics, (item) => item.classification !== TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW),
    derivativeOwnershipRisks: countWhere(derivativeDiagnostics, (item) => item.classification !== TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW),
    simulatedDualReadSafeCount: countWhere(all, (item) => item.classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.SAME_ALLOW),
    simulatedDualReadUnsafeCount: countWhere(all, (item) => (
      item.classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.UNSAFE_TO_SWITCH ||
      item.classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.METADATA_CONFLICT ||
      item.classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.RELATIONSHIP_CONFLICT ||
      item.classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.ORPHAN_REFERENCE
    )),
    needsManualReviewCount: countWhere(all, (item) => item.classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.NEEDS_MANUAL_REVIEW),
    metadataConflictCount: countWhere(all, (item) => item.classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.METADATA_CONFLICT),
    relationshipConflictCount: countWhere(all, (item) => item.classification === TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.RELATIONSHIP_CONFLICT),
    classificationCounts,
    severityCounts,
  };
}

export function serializeTenantAssetReadDiagnosticItem(item) {
  return {
    id: String(item?.id || "").slice(0, 180),
    domain: String(item?.domain || "unknown").slice(0, 80),
    sourceId: normalizeMaybeId(item?.sourceId),
    classification: TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATIONS.includes(item?.classification)
      ? item.classification
      : TENANT_ASSET_READ_DIAGNOSTIC_CLASSIFICATION.NOT_APPLICABLE,
    severity: ["critical", "warning", "info"].includes(item?.severity) ? item.severity : "info",
    reason: String(item?.reason || "not_provided").slice(0, 160),
    legacyUserId: normalizeMaybeId(item?.legacyUserId),
    owningUserId: normalizeMaybeId(item?.owningUserId),
    owningOrganizationId: normalizeMaybeId(item?.owningOrganizationId),
    ownerType: normalizeTenantAssetOwnerType(item?.ownerType) || null,
    ownershipStatus: normalizeTenantAssetOwnershipStatus(item?.ownershipStatus) || null,
    folderId: normalizeMaybeId(item?.folderId),
    public: item?.public === true,
    evidence: sanitizeEvidence(item?.evidence),
    recommendation: item?.recommendation ? String(item.recommendation).slice(0, 240) : null,
  };
}

function sanitizeEvidence(value, depth = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  if (depth > 2) return {};
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 40)) {
    const key = String(rawKey || "").replace(/[^\w.-]/g, "_").slice(0, 80);
    if (!key) continue;
    if (/prompt|input|output|provider|response|request|secret|token|cookie|authorization|idempotency|r2_key_raw|raw/i.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    if (rawValue === null || rawValue === undefined) {
      out[key] = null;
    } else if (typeof rawValue === "string") {
      out[key] = rawValue.slice(0, 300);
    } else if (typeof rawValue === "number") {
      out[key] = Number.isFinite(rawValue) ? rawValue : null;
    } else if (typeof rawValue === "boolean") {
      out[key] = rawValue;
    } else if (Array.isArray(rawValue)) {
      out[key] = rawValue.slice(0, 20).map((item) => (
        typeof item === "object" ? sanitizeEvidence(item, depth + 1) : String(item).slice(0, 160)
      ));
    } else if (typeof rawValue === "object") {
      out[key] = sanitizeEvidence(rawValue, depth + 1);
    }
  }
  return out;
}

export function buildTenantAssetReadDiagnosticsReport({
  folders = [],
  images = [],
  generatedAt = new Date().toISOString(),
  source = "source_fixture_dry_run",
  limit = DEFAULT_DIAGNOSTIC_LIMIT,
  includePublic = true,
  includeRelationships = true,
} = {}) {
  const appliedLimit = boundedLimit(limit);
  const boundedFolders = Array.isArray(folders) ? folders.slice(0, appliedLimit) : [];
  const boundedImages = Array.isArray(images) ? images.slice(0, appliedLimit) : [];
  const foldersById = new Map();
  const folderDiagnosticsById = new Map();
  const folderDiagnostics = boundedFolders.map((folder, index) => {
    const id = pickId(folder, "id");
    if (id) foldersById.set(id, folder);
    const diagnostic = diagnoseFolderOwnershipReadSafety(folder, { index });
    if (id) folderDiagnosticsById.set(id, diagnostic);
    return diagnostic;
  });
  const imageDiagnostics = boundedImages.map((image, index) => diagnoseImageOwnershipReadSafety(image, {
    index,
    foldersById,
    folderDiagnosticsById,
  }));
  const relationshipDiagnostics = includeRelationships
    ? boundedImages.map((image, index) => buildRelationshipDiagnostic(image, { index, foldersById }))
    : [];
  const publicGalleryDiagnostics = includePublic
    ? boundedImages.map((image, index) => buildPublicGalleryDiagnostic(image, { index })).filter(Boolean)
    : [];
  const derivativeDiagnostics = boundedImages
    .map((image, index) => buildDerivativeDiagnostic(image, {
      index,
      parentClassification: imageDiagnostics[index]?.classification,
    }))
    .filter(Boolean);
  const summary = buildTenantAssetReadDiagnosticSummary({
    folders: boundedFolders,
    images: boundedImages,
    folderDiagnostics,
    imageDiagnostics,
    relationshipDiagnostics,
    publicGalleryDiagnostics,
    derivativeDiagnostics,
  });

  return {
    reportVersion: "tenant-asset-read-diagnostics-v1",
    generatedAt,
    source,
    domain: "folders_images",
    runtimeBehaviorChanged: false,
    accessChecksChanged: false,
    tenantIsolationClaimed: false,
    backfillPerformed: false,
    r2LiveListed: false,
    bounded: true,
    limit: appliedLimit,
    summary,
    folderDiagnostics,
    imageDiagnostics,
    relationshipDiagnostics,
    publicGalleryDiagnostics,
    derivativeDiagnostics,
    recommendations: [
      "Do not switch folder/image reads to ownership metadata until metadata_missing, conflict, public unsafe, derivative-risk, and relationship-risk counts are cleared or accepted by operator review.",
      "Keep legacy user_id access as the runtime authorization model until an explicit future access-check phase.",
      "Collect local/staging D1 evidence before any backfill or organization-owned asset access implementation.",
    ],
    limitations: [
      "Diagnostics are simulated and do not authorize requests.",
      "No D1 or R2 mutations are performed.",
      "No live R2 objects are listed or validated.",
      "Organization-owned access is not considered safe until role-aware organization checks are implemented.",
      "Fixture/source diagnostics do not represent production row counts.",
    ],
  };
}
