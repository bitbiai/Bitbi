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
import {
  buildTenantAssetEvidenceSummary,
  findUnsafeTenantAssetEvidenceFindings,
  normalizeTenantAssetEvidenceReportPayload,
  renderTenantAssetEvidenceSummaryMarkdown,
} from "./summarize-tenant-asset-evidence.mjs";
import {
  buildTenantAssetManualReviewPlan,
  parseTenantAssetManualReviewEvidence,
  parseTenantAssetManualReviewEvidenceMarkdown,
  renderTenantAssetManualReviewPlanMarkdown,
} from "./plan-tenant-asset-manual-review.mjs";

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
assert.equal(foldersImagesReport.mainEvidencePackage.status, "needs_manual_review");
assert.equal(foldersImagesReport.mainEvidencePackage.activeWorkflow, "main_only");
assert.equal(
  foldersImagesReport.mainEvidencePackage.evidenceSummaryFile,
  "docs/tenant-assets/evidence/2026-05-17-main-folders-images-owner-map-evidence.md"
);
assert.equal(
  foldersImagesReport.mainEvidencePackage.decisionFile,
  "docs/tenant-assets/evidence/MAIN_FOLDERS_IMAGES_OWNER_MAP_DECISION.md"
);
assert.equal(foldersImagesReport.mainEvidencePackage.decisionReviewed, true);
assert.equal(foldersImagesReport.mainEvidencePackage.realMainEvidenceFoundInRepo, true);
assert.equal(foldersImagesReport.mainEvidencePackage.accessSwitchDecision, "blocked");
assert.equal(foldersImagesReport.mainEvidencePackage.backfillDecision, "blocked");
assert.equal(foldersImagesReport.mainEvidencePackage.manualReviewDecision, "required");
assert.equal(foldersImagesReport.mainEvidencePackage.accessChecksChanged, false);
assert.equal(foldersImagesReport.mainEvidencePackage.backfillPerformed, false);
assert.equal(foldersImagesReport.mainEvidencePackage.r2LiveListed, false);
assert.equal(foldersImagesReport.manualReviewWorkflow.status, "manual_review_workflow_designed");
assert.equal(
  foldersImagesReport.manualReviewWorkflow.workflowDoc,
  "docs/tenant-assets/AI_FOLDERS_IMAGES_MANUAL_REVIEW_WORKFLOW.md"
);
assert.equal(
  foldersImagesReport.manualReviewWorkflow.planDoc,
  "docs/tenant-assets/evidence/2026-05-17-main-folders-images-manual-review-plan.md"
);
assert.equal(foldersImagesReport.manualReviewWorkflow.plannerScript, "scripts/plan-tenant-asset-manual-review.mjs");
assert.equal(foldersImagesReport.manualReviewWorkflow.designOnly, true);
assert.equal(foldersImagesReport.manualReviewWorkflow.reviewExecutionAdded, false);
assert.equal(foldersImagesReport.manualReviewWorkflow.endpointAdded, false);
assert.equal(foldersImagesReport.manualReviewWorkflow.adminUiAdded, false);
assert.equal(foldersImagesReport.manualReviewWorkflow.migrationAdded, false);
assert.equal(foldersImagesReport.manualReviewWorkflow.accessChecksChanged, false);
assert.equal(foldersImagesReport.manualReviewWorkflow.backfillPerformed, false);
assert.equal(foldersImagesReport.manualReviewWorkflow.r2LiveListed, false);
assert(foldersImagesReport.manualReviewWorkflow.issueCategories.includes("metadata_missing"));
assert(foldersImagesReport.manualReviewWorkflow.issueCategories.includes("public_unsafe"));
assert(foldersImagesReport.manualReviewWorkflow.issueCategories.includes("derivative_risk"));
assert(foldersImagesReport.manualReviewWorkflow.reviewStatuses.includes("pending_review"));
assert(foldersImagesReport.manualReviewWorkflow.reviewStatuses.includes("blocked_public_unsafe"));
assert.equal(
  foldersImagesReport.manualReviewWorkflow.recommendedNextPhase,
  "Phase 6.13 — Additive Manual Review State Schema for AI Folders & Images"
);
assert.equal(foldersImagesReport.manualReviewStateSchema.status, "manual_review_state_schema_designed");
assert.equal(
  foldersImagesReport.manualReviewStateSchema.designDoc,
  "docs/tenant-assets/AI_FOLDERS_IMAGES_MANUAL_REVIEW_STATE_SCHEMA_DESIGN.md"
);
assert.equal(
  foldersImagesReport.manualReviewStateSchema.expectedFutureMigration,
  "workers/auth/migrations/0057_add_ai_asset_manual_review_state.sql"
);
assert.equal(foldersImagesReport.manualReviewStateSchema.migrationAdded, false);
assert.equal(foldersImagesReport.manualReviewStateSchema.reviewRowsCreated, false);
assert.equal(foldersImagesReport.manualReviewStateSchema.reviewItemImportAdded, false);
assert.equal(foldersImagesReport.manualReviewStateSchema.endpointAdded, false);
assert.equal(foldersImagesReport.manualReviewStateSchema.adminUiAdded, false);
assert.equal(foldersImagesReport.manualReviewStateSchema.accessChecksChanged, false);
assert.equal(foldersImagesReport.manualReviewStateSchema.backfillPerformed, false);
assert.equal(foldersImagesReport.manualReviewStateSchema.r2LiveListed, false);
assert(foldersImagesReport.manualReviewStateSchema.proposedTables.includes("ai_asset_manual_review_items"));
assert(foldersImagesReport.manualReviewStateSchema.proposedTables.includes("ai_asset_manual_review_events"));
assert(foldersImagesReport.manualReviewStateSchema.proposedIndexes.includes("idx_ai_asset_manual_review_items_domain_asset"));
assert(foldersImagesReport.manualReviewStateSchema.futureActions.includes("create_review_item_from_evidence"));
assert.equal(
  foldersImagesReport.manualReviewStateSchema.recommendedNextPhase,
  "Phase 6.13 — Additive Manual Review State Schema for AI Folders & Images"
);
assert.equal(foldersImagesReport.recommendedNextPhase, "Phase 6.13 — Additive Manual Review State Schema for AI Folders & Images");
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

const evidenceFixturePath = path.join(
  repoRoot,
  "scripts/fixtures/tenant-assets/folders-images-evidence-export.json"
);
const evidencePayload = JSON.parse(fs.readFileSync(evidenceFixturePath, "utf8"));
const normalizedEvidence = normalizeTenantAssetEvidenceReportPayload(evidencePayload);
assert.equal(normalizedEvidence.source, "local_d1_read_only");
assert.equal(normalizedEvidence.domain, "folders_images");
const evidenceSummary = buildTenantAssetEvidenceSummary(evidencePayload, {
  sourcePath: "scripts/fixtures/tenant-assets/folders-images-evidence-export.json",
  operator: "synthetic_operator",
  commitSha: "synthetic_commit",
  evidenceEnvironment: "synthetic_fixture",
  syntheticFixture: true,
});
assert.equal(evidenceSummary.summaryVersion, "tenant-asset-owner-map-main-evidence-summary-v1");
assert.equal(evidenceSummary.mainOnlyEvidence, false);
assert.equal(evidenceSummary.syntheticFixture, true);
assert.equal(evidenceSummary.counts.totalFoldersScanned, 3);
assert.equal(evidenceSummary.counts.totalImagesScanned, 4);
assert.equal(evidenceSummary.counts.metadataMissingTotal, 4);
assert.equal(evidenceSummary.highRiskCounts.metadataConflictCount, 1);
assert.equal(evidenceSummary.highRiskCounts.relationshipConflictCount, 1);
assert.equal(evidenceSummary.highRiskCounts.orphanFolderReferences, 1);
assert.equal(evidenceSummary.highRiskCounts.publicImagesWithMissingOrAmbiguousOwnership, 1);
assert.equal(evidenceSummary.highRiskCounts.derivativeOwnershipRisks, 1);
assert.equal(evidenceSummary.highRiskCounts.simulatedDualReadUnsafeCount, 3);
assert.equal(evidenceSummary.highRiskCounts.needsManualReviewCount, 1);
assert.equal(evidenceSummary.decisionStatus, "blocked_for_access_switch_and_backfill");
const evidenceMarkdown = renderTenantAssetEvidenceSummaryMarkdown(evidenceSummary);
assert(evidenceMarkdown.includes("# Main AI Folders/Images Owner-Map Evidence Summary"));
assert(evidenceMarkdown.includes("Main-only evidence: no"));
assert(evidenceMarkdown.includes("Synthetic fixture: yes"));
assert(evidenceMarkdown.includes("Decision status: blocked_for_access_switch_and_backfill"));
assert(!evidenceMarkdown.includes("users/synthetic-user/folders"));
assert(!evidenceMarkdown.includes("Cookie:"));
assert(!evidenceMarkdown.includes("Bearer "));
assert.throws(
  () => normalizeTenantAssetEvidenceReportPayload({ source: "local_d1_read_only", domain: "folders_images" }),
  /missing required fields/i
);
assert.throws(
  () => normalizeTenantAssetEvidenceReportPayload({
    ...evidencePayload,
    folderEvidence: [
      {
        prompt: "synthetic prompt should not be present",
      },
    ],
  }),
  /unsafe fields/i
);
assert(
  findUnsafeTenantAssetEvidenceFindings({
    r2Key: "users/synthetic-user/folders/private/image.png",
  }).some((finding) => finding.includes("private user R2 key")),
  "unsafe raw R2 key should be detected"
);

const mainEvidenceSummaryPath = path.join(
  repoRoot,
  "docs/tenant-assets/evidence/2026-05-17-main-folders-images-owner-map-evidence.md"
);
const mainEvidenceMarkdown = fs.readFileSync(mainEvidenceSummaryPath, "utf8");
const parsedManualReviewEvidence = parseTenantAssetManualReviewEvidenceMarkdown(mainEvidenceMarkdown, {
  sourcePath: "docs/tenant-assets/evidence/2026-05-17-main-folders-images-owner-map-evidence.md",
});
assert.equal(parsedManualReviewEvidence.mainOnlyEvidence, true);
assert.equal(parsedManualReviewEvidence.syntheticFixture, false);
assert.equal(parsedManualReviewEvidence.decisionStatus, "blocked_for_access_switch_and_backfill");
assert.equal(parsedManualReviewEvidence.counts.totalFoldersScanned, 16);
assert.equal(parsedManualReviewEvidence.counts.totalImagesScanned, 63);
assert.equal(parsedManualReviewEvidence.counts.metadataMissingTotal, 75);
assert.equal(parsedManualReviewEvidence.counts.publicImagesWithMissingOrAmbiguousOwnership, 21);
assert.equal(parsedManualReviewEvidence.counts.derivativeOwnershipRisks, 63);
assert.equal(parsedManualReviewEvidence.counts.simulatedDualReadUnsafeCount, 42);
assert.equal(parsedManualReviewEvidence.counts.needsManualReviewCount, 90);
assert.equal(parsedManualReviewEvidence.counts.metadataConflictCount, 0);
assert.equal(parsedManualReviewEvidence.counts.relationshipConflictCount, 0);
assert.equal(parsedManualReviewEvidence.counts.orphanFolderReferences, 0);
assert.equal(parsedManualReviewEvidence.counts.organizationOwnedRowsFound, 0);
const manualReviewPlan = buildTenantAssetManualReviewPlan(parsedManualReviewEvidence, {
  generatedAt: "2026-05-17T00:00:00.000Z",
});
assert.equal(manualReviewPlan.planVersion, "tenant-folders-images-manual-review-plan-v1");
assert.equal(manualReviewPlan.phase, "6.11");
assert.equal(manualReviewPlan.blockedDecisions.accessCheckSwitch, "blocked_for_access_switch");
assert.equal(manualReviewPlan.blockedDecisions.ownershipBackfill, "blocked_for_backfill");
assert.equal(manualReviewPlan.blockedDecisions.tenantIsolation, "not_claimed");
assert.equal(manualReviewPlan.blockedDecisions.productionReadiness, "blocked");
assert(manualReviewPlan.reviewCategories.includes("metadata_missing"));
assert(manualReviewPlan.reviewCategories.includes("public_unsafe"));
assert(manualReviewPlan.reviewCategories.includes("derivative_risk"));
assert(manualReviewPlan.reviewCategories.includes("dual_read_unsafe"));
assert(manualReviewPlan.reviewCategories.includes("manual_review_needed"));
assert(manualReviewPlan.reviewCategories.includes("safe_observe_only"));
assert(manualReviewPlan.reviewStatuses.includes("approved_personal_user_asset"));
assert(manualReviewPlan.reviewStatuses.includes("blocked_missing_evidence"));
assert.equal(
  manualReviewPlan.recommendedNextPhase,
  "Phase 6.12 — Manual Review State Schema Design for AI Folders & Images"
);
assert.equal(manualReviewPlan.mutationSafety.d1RowsRewritten, false);
assert.equal(manualReviewPlan.mutationSafety.ownershipBackfillPerformed, false);
assert.equal(manualReviewPlan.mutationSafety.r2LiveListed, false);
assert.equal(manualReviewPlan.mutationSafety.runtimeAccessChecksChanged, false);
assert.equal(manualReviewPlan.mutationSafety.executableSqlEmitted, false);
assert.equal(manualReviewPlan.mutationSafety.liveEndpointCalls, false);
const manualReviewMarkdown = renderTenantAssetManualReviewPlanMarkdown(manualReviewPlan);
assert(manualReviewMarkdown.includes("# Main AI Folders/Images Manual Review Plan"));
assert(manualReviewMarkdown.includes("metadata_missing"));
assert(manualReviewMarkdown.includes("blocked_for_access_switch"));
assert(manualReviewMarkdown.includes("Phase 6.12"));
assert(!/\bUPDATE\s+ai_(folders|images)\b/i.test(manualReviewMarkdown));
assert(!/\bDELETE\s+FROM\b/i.test(manualReviewMarkdown));
assert(!/\bwrangler\s+d1\s+migrations\s+apply\b/i.test(manualReviewMarkdown));
assert(!manualReviewMarkdown.includes("users/synthetic-user/folders"));
assert(!manualReviewMarkdown.includes("Cookie:"));
assert(!manualReviewMarkdown.includes("Bearer "));
assert.throws(
  () => parseTenantAssetManualReviewEvidence("not an evidence summary"),
  /missing required evidence count fields/i
);
const summarizerSource = fs.readFileSync(path.join(repoRoot, "scripts/summarize-tenant-asset-evidence.mjs"), "utf8");
assert(!summarizerSource.includes("fetch("));
assert(!summarizerSource.includes("wrangler"));
assert(!summarizerSource.includes("d1 execute"));
const manualReviewPlannerSource = fs.readFileSync(
  path.join(repoRoot, "scripts/plan-tenant-asset-manual-review.mjs"),
  "utf8"
);
assert(!manualReviewPlannerSource.includes("fetch("));
assert(!manualReviewPlannerSource.includes("wrangler d1"));
assert(!manualReviewPlannerSource.includes("DELETE FROM"));
assert(!manualReviewPlannerSource.includes("UPDATE ai_"));

const manualReviewStateSchemaDesignPath = path.join(
  repoRoot,
  "docs/tenant-assets/AI_FOLDERS_IMAGES_MANUAL_REVIEW_STATE_SCHEMA_DESIGN.md"
);
assert(fs.existsSync(manualReviewStateSchemaDesignPath), "Phase 6.12 manual review state schema design must exist");
const manualReviewStateSchemaDesign = fs.readFileSync(manualReviewStateSchemaDesignPath, "utf8");
for (const expected of [
  "ai_asset_manual_review_items",
  "ai_asset_manual_review_events",
  "metadata_missing",
  "public_unsafe",
  "derivative_risk",
  "dual_read_unsafe",
  "pending_review",
  "review_in_progress",
  "approved_personal_user_asset",
  "blocked_public_unsafe",
  "create_review_item_from_evidence",
  "idx_ai_asset_manual_review_items_domain_asset",
  "Idempotency-Key",
  "No migration file is added in Phase 6.12",
  "No review rows are created",
]) {
  assert(manualReviewStateSchemaDesign.includes(expected), `manual review state schema design missing ${expected}`);
}
assert(!/\bUPDATE\s+ai_(folders|images)\b/i.test(manualReviewStateSchemaDesign));
assert(!/\bDELETE\s+FROM\b/i.test(manualReviewStateSchemaDesign));
assert(!/\bwrangler\s+d1\s+migrations\s+apply\b/i.test(manualReviewStateSchemaDesign));
assert(!manualReviewStateSchemaDesign.includes("Cookie:"));
assert(!manualReviewStateSchemaDesign.includes("Bearer "));

const manualReviewStateSchemaMigrationPath = path.join(
  repoRoot,
  "workers/auth/migrations/0057_add_ai_asset_manual_review_state.sql"
);
assert.equal(
  fs.existsSync(manualReviewStateSchemaMigrationPath),
  false,
  "Phase 6.12 must not add the future 0057 manual review state migration"
);

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
assert(focusedMarkdown.includes("Main Evidence Package"));
assert(focusedMarkdown.includes("needs_manual_review"));
assert(focusedMarkdown.includes("Manual Review Workflow"));
assert(focusedMarkdown.includes("manual_review_workflow_designed"));
assert(focusedMarkdown.includes("Manual Review State Schema"));
assert(focusedMarkdown.includes("manual_review_state_schema_designed"));
assert(focusedMarkdown.includes("ai_asset_manual_review_items"));
assert(focusedMarkdown.includes("Phase 6.13"));

console.log("Tenant asset ownership dry-run tests passed.");
