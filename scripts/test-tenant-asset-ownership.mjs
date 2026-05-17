#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildFoldersImagesOwnerMapDryRunReport,
  buildTenantAssetOwnershipDryRunReport,
  FOLDERS_IMAGES_OWNER_MAP_CLASSES,
  renderFoldersImagesOwnerMapMarkdown,
  renderTenantAssetOwnershipMarkdown,
  TENANT_ASSET_OWNER_CLASSES,
} from "./dry-run-tenant-asset-ownership.mjs";

const repoRoot = process.cwd();
const report = buildTenantAssetOwnershipDryRunReport(repoRoot, {
  generatedAt: "2026-05-17T00:00:00.000Z",
});

assert.equal(report.reportVersion, "tenant-asset-ownership-dry-run-v1");
assert.equal(report.source, "repo_source_read_only");
assert.equal(report.mutationMode, "dry_run_only");
assert.equal(report.productionReadiness, "blocked");
assert.equal(report.tenantIsolationReadiness, "blocked");

assert.deepEqual(report.mutationSafety.emittedCommands, []);
assert.equal(report.mutationSafety.d1Writes, false);
assert.equal(report.mutationSafety.r2Writes, false);
assert.equal(report.mutationSafety.r2Deletes, false);
assert.equal(report.mutationSafety.r2Moves, false);
assert.equal(report.mutationSafety.cloudflareApiCalls, false);
assert.equal(report.mutationSafety.stripeApiCalls, false);
assert.equal(report.mutationSafety.providerCalls, false);
assert.equal(report.mutationSafety.remoteQueries, false);

for (const ownerClass of [
  "personal_user_asset",
  "organization_asset",
  "platform_admin_test_asset",
  "platform_background_asset",
  "legacy_unclassified_asset",
  "external_reference_asset",
  "audit_archive_asset",
]) {
  assert(TENANT_ASSET_OWNER_CLASSES.includes(ownerClass), `missing owner class ${ownerClass}`);
  assert(report.ownerClasses.includes(ownerClass), `report missing owner class ${ownerClass}`);
}

const domainIds = new Set(report.assetDomains.map((domain) => domain.id));
for (const expected of [
  "ai_images",
  "ai_text_assets",
  "ai_folders",
  "ai_video_jobs",
  "profiles_avatars",
  "favorites",
  "user_asset_storage_usage",
  "data_lifecycle",
  "news_pulse_visuals",
]) {
  assert(domainIds.has(expected), `missing asset domain ${expected}`);
}

const textDomain = report.assetDomains.find((domain) => domain.id === "ai_text_assets");
assert(textDomain.routeFiles.includes("workers/auth/src/routes/ai/music-generate.js"));
assert(textDomain.routeFiles.includes("workers/auth/src/routes/ai/video-generate.js"));
assert(textDomain.routeFiles.includes("workers/auth/src/routes/audio-gallery.js"));
assert(textDomain.routeFiles.includes("workers/auth/src/routes/video-gallery.js"));
assert(textDomain.keyPatterns.some((pattern) => pattern.includes("{text|audio|video}")));

const routeIds = new Set(report.routeDomains.map((domain) => domain.id));
assert(routeIds.has("public_gallery"));
assert(routeIds.has("member_private_assets"));
assert(routeIds.has("data_lifecycle"));

const bindingIds = new Set(report.r2Bindings.map((binding) => binding.binding));
assert(bindingIds.has("USER_IMAGES"));
assert(bindingIds.has("PRIVATE_MEDIA"));
assert(bindingIds.has("AUDIT_ARCHIVE"));

const userImages = report.r2Bindings.find((binding) => binding.binding === "USER_IMAGES");
assert(userImages.keyPatterns.some((pattern) => pattern.startsWith("users/{userId}/folders")));
assert(userImages.keyPatterns.some((pattern) => pattern.startsWith("tmp/ai-generated")));
assert(userImages.keyPatterns.some((pattern) => pattern.startsWith("news-pulse/thumbs")));

assert(report.findings.some((finding) => finding.code === "missing_owning_organization_id"));
assert(report.findings.some((finding) => finding.code === "public_gallery_user_attribution_only"));
assert(report.findings.some((finding) => finding.code === "lifecycle_user_only"));
assert(report.lifecycleGaps.length >= 1);
assert(report.blockedUntil.some((entry) => entry.includes("owner-map")));
assert(report.futurePhases.some((entry) => entry.phase === "6.2"));
assert(report.futurePhases.some((entry) => entry.phase === "6.10"));

for (const domain of report.assetDomains) {
  assert(domain.evidence.migrationEvidence.length >= 1, `${domain.id} missing migration evidence`);
  assert(domain.evidence.routeEvidence.length >= 1, `${domain.id} missing route evidence`);
  assert(domain.evidence.migrationEvidence.some((entry) => entry.exists), `${domain.id} has no existing migration evidence`);
}

const serialized = JSON.stringify(report);
assert(!serialized.includes("DELETE FROM"));
assert(!serialized.includes("UPDATE ai_images SET user_id"));
assert(!serialized.includes("wrangler d1 migrations apply"));
assert(!serialized.includes("stripe "));
assert(!serialized.includes("cloudflare api"));

const markdown = renderTenantAssetOwnershipMarkdown(report);
assert(markdown.includes("# Tenant Asset Ownership Dry Run"));
assert(markdown.includes("No R2 writes, moves, or deletes."));
assert(markdown.includes("| ai_images | ai_images | user_id |"));

const foldersImagesReport = buildFoldersImagesOwnerMapDryRunReport(repoRoot, {
  generatedAt: "2026-05-17T00:00:00.000Z",
  fixturePath: "scripts/fixtures/tenant-assets/folders-images.json",
});

assert.equal(foldersImagesReport.reportVersion, "tenant-folders-images-owner-map-dry-run-v1");
assert.equal(foldersImagesReport.phase, "6.2");
assert.equal(foldersImagesReport.domain, "folders-images");
assert.equal(foldersImagesReport.source, "repo_source_and_fixture_read_only");
assert.equal(foldersImagesReport.mutationMode, "dry_run_only");
assert.equal(foldersImagesReport.fixture.folderCount, 4);
assert.equal(foldersImagesReport.fixture.imageCount, 8);
assert.deepEqual(foldersImagesReport.mutationSafety.emittedCommands, []);
assert.equal(foldersImagesReport.mutationSafety.d1Writes, false);
assert.equal(foldersImagesReport.mutationSafety.r2Writes, false);
assert.equal(foldersImagesReport.mutationSafety.r2Deletes, false);
assert.equal(foldersImagesReport.mutationSafety.r2Moves, false);
assert.equal(foldersImagesReport.mutationSafety.cloudflareApiCalls, false);
assert.equal(foldersImagesReport.mutationSafety.stripeApiCalls, false);
assert.equal(foldersImagesReport.mutationSafety.providerCalls, false);
assert.equal(foldersImagesReport.mutationSafety.backfillSqlEmitted, false);

for (const ownerClass of [
  "personal_user_asset",
  "organization_asset",
  "platform_admin_test_asset",
  "legacy_unclassified_asset",
  "ambiguous_owner",
  "orphan_reference",
  "unsafe_to_migrate",
]) {
  assert(FOLDERS_IMAGES_OWNER_MAP_CLASSES.includes(ownerClass), `missing owner-map class ${ownerClass}`);
  assert(foldersImagesReport.ownerMapClasses.includes(ownerClass), `report missing owner-map class ${ownerClass}`);
}

assert.deepEqual(foldersImagesReport.scope.tables, ["ai_folders", "ai_images"]);
assert(foldersImagesReport.schemaSummary.folders.ownerColumns.includes("user_id"));
assert(foldersImagesReport.schemaSummary.images.r2KeyFields.includes("r2_key"));
assert(foldersImagesReport.schemaSummary.images.r2KeyFields.includes("thumb_key"));
assert(foldersImagesReport.schemaSummary.images.derivativeFields.includes("medium_key"));
assert.equal(foldersImagesReport.schemaReadiness.status, "schema_added_not_backfilled");
assert.equal(foldersImagesReport.schemaReadiness.migrationAdded, true);
assert.equal(
  foldersImagesReport.schemaReadiness.migrationFile,
  "workers/auth/migrations/0056_add_ai_folder_image_ownership_metadata.sql"
);
assert.equal(foldersImagesReport.schemaReadiness.executableSqlEmitted, false);
for (const field of [
  "asset_owner_type",
  "owning_user_id",
  "owning_organization_id",
  "created_by_user_id",
  "ownership_status",
  "ownership_source",
  "ownership_confidence",
  "ownership_metadata_json",
  "ownership_assigned_at",
]) {
  assert(foldersImagesReport.schemaReadiness.proposedSchema.ai_folders.proposedFields.includes(field), `missing folder proposed field ${field}`);
  assert(foldersImagesReport.schemaReadiness.proposedSchema.ai_images.proposedFields.includes(field), `missing image proposed field ${field}`);
}
assert(foldersImagesReport.schemaReadiness.proposedOwnerValues.assetOwnerTypes.includes("organization_asset"));
assert(foldersImagesReport.schemaReadiness.proposedOwnerValues.assetOwnerTypes.includes("audit_archive_asset"));
assert(foldersImagesReport.schemaReadiness.proposedOwnerValues.ownershipStatuses.includes("unsafe_to_migrate"));
assert(foldersImagesReport.schemaReadiness.proposedOwnerValues.ownershipSources.includes("new_write_org_context"));
assert(foldersImagesReport.schemaReadiness.proposedOwnerValues.ownershipConfidences.includes("none"));
assert(foldersImagesReport.schemaReadiness.migrationReadiness.includes("schema_added_not_backfilled"));
assert(foldersImagesReport.schemaReadiness.migrationReadiness.includes("access_checks_not_changed"));
assert(foldersImagesReport.schemaReadiness.migrationReadiness.includes("write_paths_assigned_for_new_rows"));
assert(foldersImagesReport.schemaReadiness.migrationReadiness.includes("backfill_not_started"));
assert(foldersImagesReport.schemaReadiness.migrationReadiness.includes("owner_map_not_complete"));
assert.equal(foldersImagesReport.schemaReadiness.currentlyMissingFields.ai_folders.length, 0);
assert.equal(foldersImagesReport.schemaReadiness.currentlyMissingFields.ai_images.length, 0);
assert.equal(foldersImagesReport.writePathAssignment.status, "write_paths_assigned_for_new_rows");
assert(foldersImagesReport.writePathAssignment.assigned.some((entry) => entry.id === "folder_personal_context"));
assert(foldersImagesReport.writePathAssignment.assigned.some((entry) => entry.id === "image_save_personal_context"));
assert(foldersImagesReport.writePathAssignment.assigned.every((entry) => entry.ownerClass === "personal_user_asset"));
assert(foldersImagesReport.writePathAssignment.notAssigned.some((entry) => entry.id === "org_scoped_image_save_context"));
assert(foldersImagesReport.writePathAssignment.notAssigned.some((entry) => entry.reason.includes("weak client hints are ignored")));
assert.equal(foldersImagesReport.writePathAssignment.accessChecksChanged, false);
assert.equal(foldersImagesReport.writePathAssignment.backfillStarted, false);

const accessImpactIds = new Set(foldersImagesReport.accessImpactMatrix.map((entry) => entry.id));
for (const expected of [
  "image_list_read",
  "image_create_save",
  "image_update_move",
  "image_delete",
  "image_media_serving",
  "public_gallery_images",
  "folder_list_read",
  "folder_create_update_delete",
  "data_lifecycle_export_delete",
  "storage_quota",
]) {
  assert(accessImpactIds.has(expected), `missing access impact ${expected}`);
}
for (const entry of foldersImagesReport.accessImpactMatrix) {
  assert.equal(entry.phase63BehaviorChange, "no", `${entry.id} must not change behavior in Phase 6.3`);
}
const writeRuleIds = new Set(foldersImagesReport.futureWritePathRules.map((entry) => entry.id));
assert(writeRuleIds.has("personal_generation"));
assert(writeRuleIds.has("org_scoped_generation"));
assert(writeRuleIds.has("derivatives_inherit_parent"));
assert(foldersImagesReport.futureWritePathRules.some((entry) => entry.rule.includes("validated organization context")));
assert(foldersImagesReport.futureWritePathRules.some((entry) => entry.rule.includes("Publishing or unpublishing")));
assert(foldersImagesReport.backfillPolicy.some((rule) => rule.includes("dry-run-first")));
assert(foldersImagesReport.backfillPolicy.some((rule) => rule.includes("Do not infer organization ownership")));
assert(foldersImagesReport.backfillPolicy.some((rule) => rule.includes("Public ambiguous rows are unsafe_to_migrate")));
assert.equal(foldersImagesReport.schemaAccessImpact.phase63BehaviorChange, false);
assert.equal(foldersImagesReport.schemaAccessImpact.phase64BehaviorChange, false);
assert.equal(foldersImagesReport.schemaAccessImpact.phase65AccessBehaviorChange, false);
assert.equal(foldersImagesReport.schemaAccessImpact.phase66AccessBehaviorChange, false);
assert.equal(foldersImagesReport.schemaAccessImpact.readDiagnosticsAdded, true);
assert.equal(foldersImagesReport.schemaAccessImpact.dualReadSafetySimulated, true);
assert.equal(foldersImagesReport.schemaAccessImpact.adminEvidenceReportReady, true);
assert.equal(foldersImagesReport.schemaAccessImpact.adminEvidenceEndpoint, "/api/admin/tenant-assets/folders-images/evidence");
assert.equal(foldersImagesReport.schemaAccessImpact.adminEvidenceExportEndpoint, "/api/admin/tenant-assets/folders-images/evidence/export");
assert.deepEqual(foldersImagesReport.schemaAccessImpact.adminEvidenceExportFormats, ["json", "markdown"]);
assert(foldersImagesReport.schemaAccessImpact.readDiagnosticsSummary.simulatedDualReadSafeCount >= 1);
assert(foldersImagesReport.schemaAccessImpact.readDiagnosticsSummary.simulatedDualReadUnsafeCount >= 1);
assert(foldersImagesReport.schemaAccessImpact.manualReviewRollup.totalReviewSignals >= 1);
assert(foldersImagesReport.schemaAccessImpact.manualReviewRollup.unsafeToSwitchCount >= 1);
assert(foldersImagesReport.schemaAccessImpact.routesNeedingFutureAccessUpdates.includes("image_list_read"));
assert(foldersImagesReport.schemaAccessImpact.writePathsAssignedForNewRows.includes("folder_personal_context"));
assert(foldersImagesReport.schemaAccessImpact.writePathsAssignedForNewRows.includes("image_save_personal_context"));
assert(foldersImagesReport.schemaAccessImpact.writePathsNeedingFutureOwnershipAssignment.includes("org_scoped_generation"));
assert.equal(foldersImagesReport.adminEvidenceReport.status, "admin_evidence_report_ready");
assert.equal(foldersImagesReport.adminEvidenceReport.readOnly, true);
assert.equal(foldersImagesReport.adminEvidenceReport.endpoint, "/api/admin/tenant-assets/folders-images/evidence");
assert.equal(foldersImagesReport.adminEvidenceReport.exportEndpoint, "/api/admin/tenant-assets/folders-images/evidence/export");
assert.deepEqual(foldersImagesReport.adminEvidenceReport.exportFormats, ["json", "markdown"]);
assert.equal(foldersImagesReport.adminEvidenceReport.accessChecksChanged, false);
assert.equal(foldersImagesReport.adminEvidenceReport.backfillPerformed, false);
assert.equal(foldersImagesReport.adminEvidenceReport.r2LiveListed, false);
assert(foldersImagesReport.adminEvidenceReport.manualReviewRollup.totalReviewSignals >= 1);
assert.equal(foldersImagesReport.recommendedNextPhase, "Phase 6.9 — Staging/Main Owner-Map Evidence Collection for AI Folders & Images");
assert(foldersImagesReport.sourceEvidence.domains.some((domain) => domain.id === "ai_folders"));
assert(foldersImagesReport.sourceEvidence.domains.some((domain) => domain.id === "ai_images"));
assert(foldersImagesReport.sourceEvidence.routeDomains.some((domain) => domain.id === "member_asset_writes"));
assert(foldersImagesReport.sourceEvidence.routeDomains.some((domain) => domain.id === "public_gallery"));
assert(foldersImagesReport.sourceEvidence.r2Bindings.some((binding) => binding.binding === "USER_IMAGES"));
assert.equal(foldersImagesReport.readDiagnostics.reportVersion, "tenant-asset-read-diagnostics-v1");
assert.equal(foldersImagesReport.readDiagnostics.source, "source_fixture_dry_run");
assert.equal(foldersImagesReport.readDiagnostics.domain, "folders_images");
assert.equal(foldersImagesReport.readDiagnostics.runtimeBehaviorChanged, false);
assert.equal(foldersImagesReport.readDiagnostics.accessChecksChanged, false);
assert.equal(foldersImagesReport.readDiagnostics.tenantIsolationClaimed, false);
assert.equal(foldersImagesReport.readDiagnostics.backfillPerformed, false);
assert.equal(foldersImagesReport.readDiagnostics.r2LiveListed, false);
assert.equal(foldersImagesReport.readDiagnostics.summary.totalFoldersScanned, 4);
assert.equal(foldersImagesReport.readDiagnostics.summary.totalImagesScanned, 8);
assert(foldersImagesReport.readDiagnosticClasses.includes("same_allow"));
assert(foldersImagesReport.readDiagnosticClasses.includes("metadata_missing"));
assert(foldersImagesReport.readDiagnosticClasses.includes("unsafe_to_switch"));

function folderDiagnostic(sourceId) {
  const found = foldersImagesReport.readDiagnostics.folderDiagnostics.find((entry) => entry.sourceId === sourceId);
  assert(found, `missing folder diagnostic ${sourceId}`);
  return found;
}

function imageDiagnostic(sourceId) {
  const found = foldersImagesReport.readDiagnostics.imageDiagnostics.find((entry) => entry.sourceId === sourceId);
  assert(found, `missing image diagnostic ${sourceId}`);
  return found;
}

function relationshipDiagnostic(sourceId) {
  const found = foldersImagesReport.readDiagnostics.relationshipDiagnostics.find((entry) => entry.sourceId === sourceId);
  assert(found, `missing relationship diagnostic ${sourceId}`);
  return found;
}

function publicDiagnostic(sourceId) {
  const found = foldersImagesReport.readDiagnostics.publicGalleryDiagnostics.find((entry) => entry.sourceId === sourceId);
  assert(found, `missing public diagnostic ${sourceId}`);
  return found;
}

function derivativeDiagnostic(sourceId) {
  const found = foldersImagesReport.readDiagnostics.derivativeDiagnostics.find((entry) => entry.sourceId === sourceId);
  assert(found, `missing derivative diagnostic ${sourceId}`);
  return found;
}

assert.equal(folderDiagnostic("folder_personal").classification, "same_allow");
assert.equal(folderDiagnostic("folder_weak_org").classification, "metadata_missing");
assert.equal(folderDiagnostic("folder_conflict").classification, "metadata_conflict");
assert.equal(imageDiagnostic("image_personal").classification, "same_allow");
assert.equal(imageDiagnostic("image_weak_org").classification, "metadata_missing");
assert.equal(imageDiagnostic("image_public_ambiguous").classification, "unsafe_to_switch");
assert.equal(publicDiagnostic("image_public_ambiguous").classification, "unsafe_to_switch");
assert.equal(imageDiagnostic("image_missing_folder").classification, "orphan_reference");
assert.equal(relationshipDiagnostic("image_missing_folder").classification, "orphan_reference");
assert.equal(imageDiagnostic("image_conflict").classification, "relationship_conflict");
assert.equal(relationshipDiagnostic("image_conflict").classification, "relationship_conflict");
assert.equal(derivativeDiagnostic("image_derivative_low_confidence").classification, "needs_manual_review");
assert.equal(imageDiagnostic("image_org_strong").classification, "needs_manual_review");
assert.equal(imageDiagnostic("image_admin_test").classification, "needs_manual_review");
assert.equal(imageDiagnostic("image_personal").evidence.r2KeyFields.r2_key.keyClass, "users/{userId}/...");
assert.equal(imageDiagnostic("image_personal").evidence.r2LiveListed, false);

function candidate(id) {
  const found = foldersImagesReport.candidates.find((entry) => entry.sourceId === id);
  assert(found, `missing owner-map candidate ${id}`);
  return found;
}

assert.equal(candidate("folder_personal").inferredOwnerClass, "personal_user_asset");
assert.equal(candidate("folder_personal").confidence, "medium");
assert.equal(candidate("image_personal").inferredOwnerClass, "personal_user_asset");
assert.equal(candidate("image_personal").confidence, "medium");

assert.equal(candidate("folder_org_strong").inferredOwnerClass, "organization_asset");
assert.equal(candidate("folder_org_strong").inferredOwningOrganizationId, "org_acme");
assert.equal(candidate("image_org_strong").inferredOwnerClass, "organization_asset");
assert.equal(candidate("image_org_strong").inferredOwningOrganizationId, "org_acme");
assert.equal(candidate("image_org_strong").confidence, "high");

assert.equal(candidate("folder_weak_org").inferredOwnerClass, "personal_user_asset");
assert(candidate("folder_weak_org").ambiguityReasons.includes("weak_org_signal_ignored"));
assert.equal(candidate("image_weak_org").inferredOwnerClass, "personal_user_asset");
assert(candidate("image_weak_org").ambiguityReasons.includes("weak_org_signal_ignored"));

assert.equal(candidate("image_conflict").inferredOwnerClass, "ambiguous_owner");
assert(candidate("image_conflict").ambiguityReasons.includes("folder_image_user_conflict"));
assert.equal(candidate("image_missing_folder").inferredOwnerClass, "orphan_reference");
assert.equal(candidate("image_missing_folder").blockedReason, "image_references_missing_folder");
assert.equal(candidate("image_public_ambiguous").inferredOwnerClass, "unsafe_to_migrate");
assert.equal(candidate("image_public_ambiguous").publicGalleryRisk, "public_owner_ambiguous");
assert.equal(candidate("image_derivative_low_confidence").relatedDerivativeFields.derivativeOwnershipRisk, "derivative_parent_ownership_not_high_confidence");
assert(candidate("image_derivative_low_confidence").ambiguityReasons.includes("derivative_parent_ownership_unclear"));
assert.equal(candidate("image_admin_test").inferredOwnerClass, "platform_admin_test_asset");

assert.equal(foldersImagesReport.risks.lifecycleExportDelete.includes("subject_user_id"), true);
assert.equal(foldersImagesReport.risks.storageQuota.includes("user_asset_storage_usage"), true);
assert(foldersImagesReport.summary.byOwnerClass.personal_user_asset >= 1);
assert(foldersImagesReport.summary.byOwnerClass.organization_asset >= 1);
assert(foldersImagesReport.summary.byOwnerClass.ambiguous_owner >= 1);
assert(foldersImagesReport.summary.byOwnerClass.orphan_reference >= 1);
assert(foldersImagesReport.summary.byOwnerClass.unsafe_to_migrate >= 1);

const focusedSerialized = JSON.stringify(foldersImagesReport);
assert(!focusedSerialized.includes("UPDATE ai_folders"));
assert(!focusedSerialized.includes("UPDATE ai_images"));
assert(!focusedSerialized.includes("DELETE FROM"));
assert(!focusedSerialized.includes("ALTER TABLE"));
assert(!focusedSerialized.includes("CREATE INDEX"));
assert(!focusedSerialized.includes("wrangler d1 migrations apply"));
assert(!focusedSerialized.includes("r2 delete"));
assert(!focusedSerialized.includes("r2 move"));
assert(!focusedSerialized.includes("r2 list"));
assert(!focusedSerialized.includes("stripe "));
assert(!focusedSerialized.includes("cloudflare api"));
assert(!focusedSerialized.includes("synthetic prompt omitted"));
assert(!focusedSerialized.includes("users/user_personal/folders/personal/image_personal.png"));

const ownershipMigrationPath = path.join(
  repoRoot,
  "workers/auth/migrations/0056_add_ai_folder_image_ownership_metadata.sql"
);
assert(fs.existsSync(ownershipMigrationPath), "Phase 6.4 must add the ownership metadata migration");
const ownershipMigration = fs.readFileSync(ownershipMigrationPath, "utf8");
for (const table of ["ai_folders", "ai_images"]) {
  for (const field of foldersImagesReport.schemaReadiness.proposedSchema[table].proposedFields) {
    assert(
      ownershipMigration.includes(`ALTER TABLE ${table} ADD COLUMN ${field} TEXT`),
      `ownership migration missing ${table}.${field}`
    );
  }
}
for (const indexName of [
  "idx_ai_folders_owning_user_id",
  "idx_ai_folders_owning_organization_id",
  "idx_ai_folders_asset_owner_type",
  "idx_ai_folders_ownership_status",
  "idx_ai_images_owning_user_id",
  "idx_ai_images_owning_organization_id",
  "idx_ai_images_asset_owner_type",
  "idx_ai_images_ownership_status",
]) {
  assert(ownershipMigration.includes(`CREATE INDEX ${indexName}`), `ownership migration missing ${indexName}`);
}
assert(!/\bUPDATE\s+ai_(folders|images)\b/i.test(ownershipMigration));
assert(!/\bDELETE\s+FROM\b/i.test(ownershipMigration));
assert(!/\bDROP\b/i.test(ownershipMigration));

const focusedMarkdown = renderFoldersImagesOwnerMapMarkdown(foldersImagesReport);
assert(focusedMarkdown.includes("# AI Folders & Images Owner-Map Dry Run"));
assert(focusedMarkdown.includes("No owner backfill SQL is emitted."));
assert(focusedMarkdown.includes("asset_owner_type"));
assert(focusedMarkdown.includes("image_list_read"));
assert(focusedMarkdown.includes("Write Path Assignment"));
assert(focusedMarkdown.includes("image_save_personal_context"));
assert(focusedMarkdown.includes("image_public_ambiguous"));
assert(focusedMarkdown.includes("Read Diagnostics"));
assert(focusedMarkdown.includes("metadata_missing"));
assert(focusedMarkdown.includes("unsafe_to_switch"));

console.log("Tenant asset ownership dry-run tests passed.");
