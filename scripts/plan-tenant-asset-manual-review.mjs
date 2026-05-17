#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTenantAssetEvidenceSummary,
  findUnsafeTenantAssetEvidenceFindings,
  normalizeTenantAssetEvidenceReportPayload,
} from "./summarize-tenant-asset-evidence.mjs";

const REQUIRED_COUNT_FIELDS = Object.freeze([
  "totalFoldersScanned",
  "totalImagesScanned",
  "metadataMissingTotal",
  "metadataConflictCount",
  "relationshipConflictCount",
  "orphanFolderReferences",
  "publicImagesWithMissingOrAmbiguousOwnership",
  "derivativeOwnershipRisks",
  "simulatedDualReadSafeCount",
  "simulatedDualReadUnsafeCount",
  "needsManualReviewCount",
]);

const REVIEW_CATEGORIES = Object.freeze([
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

const REVIEW_STATUSES = Object.freeze([
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

function parseScalar(rawValue) {
  const value = String(rawValue || "").trim().replace(/^`|`$/g, "");
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  if (value === "yes" || value === "true") {
    return true;
  }
  if (value === "no" || value === "false") {
    return false;
  }
  return value;
}

function parseInlineField(markdown, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^${escapedLabel}:\\s*(.+)$`, "mi"));
  return match ? parseScalar(match[1]) : null;
}

function parseMarkdownTables(markdown) {
  const values = {};
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^\|\s*`?([A-Za-z0-9_ -]+)`?\s*\|\s*`?([^|`]+)`?\s*\|$/);
    if (!match) {
      continue;
    }
    const key = match[1].trim();
    if (key === "Field" || key === "---" || key === "Flag" || key === "Count") {
      continue;
    }
    values[key] = parseScalar(match[2]);
  }
  return values;
}

function buildCountsFromEvidenceSummary(summary) {
  const counts = {
    totalFoldersScanned: summary.counts.totalFoldersScanned,
    totalImagesScanned: summary.counts.totalImagesScanned,
    foldersWithOwnershipMetadata: summary.counts.foldersWithOwnershipMetadata,
    imagesWithOwnershipMetadata: summary.counts.imagesWithOwnershipMetadata,
    foldersWithNullOwnershipMetadata: summary.counts.foldersWithNullOwnershipMetadata,
    imagesWithNullOwnershipMetadata: summary.counts.imagesWithNullOwnershipMetadata,
    metadataMissingTotal: summary.counts.metadataMissingTotal,
    metadataConflictCount: summary.highRiskCounts.metadataConflictCount,
    relationshipConflictCount: summary.highRiskCounts.relationshipConflictCount,
    orphanFolderReferences: summary.highRiskCounts.orphanFolderReferences,
    publicImagesWithMissingOrAmbiguousOwnership: summary.highRiskCounts.publicImagesWithMissingOrAmbiguousOwnership,
    derivativeOwnershipRisks: summary.highRiskCounts.derivativeOwnershipRisks,
    simulatedDualReadSafeCount: summary.highRiskCounts.simulatedDualReadSafeCount,
    simulatedDualReadUnsafeCount: summary.highRiskCounts.simulatedDualReadUnsafeCount,
    needsManualReviewCount: summary.highRiskCounts.needsManualReviewCount,
    organizationOwnedRowsFound: summary.highRiskCounts.organizationOwnedRowsFound,
  };
  return counts;
}

function assertRequiredCounts(counts) {
  const missing = REQUIRED_COUNT_FIELDS.filter((field) => !Number.isFinite(counts[field]));
  if (missing.length > 0) {
    throw new Error(`Missing required evidence count fields: ${missing.join(", ")}`);
  }
}

export function parseTenantAssetManualReviewEvidenceMarkdown(markdown, options = {}) {
  const unsafeFindings = findUnsafeTenantAssetEvidenceFindings(markdown);
  if (unsafeFindings.length > 0) {
    throw new Error(`Unsafe evidence content detected: ${unsafeFindings.join("; ")}`);
  }
  const tableValues = parseMarkdownTables(markdown);
  const counts = {
    totalFoldersScanned: tableValues.totalFoldersScanned,
    totalImagesScanned: tableValues.totalImagesScanned,
    foldersWithOwnershipMetadata: tableValues.foldersWithOwnershipMetadata,
    imagesWithOwnershipMetadata: tableValues.imagesWithOwnershipMetadata,
    foldersWithNullOwnershipMetadata: tableValues.foldersWithNullOwnershipMetadata,
    imagesWithNullOwnershipMetadata: tableValues.imagesWithNullOwnershipMetadata,
    metadataMissingTotal: tableValues.metadataMissingTotal,
    metadataConflictCount: tableValues.metadataConflictCount,
    relationshipConflictCount: tableValues.relationshipConflictCount,
    orphanFolderReferences: tableValues.orphanFolderReferences,
    publicImagesWithMissingOrAmbiguousOwnership: tableValues.publicImagesWithMissingOrAmbiguousOwnership,
    derivativeOwnershipRisks: tableValues.derivativeOwnershipRisks,
    simulatedDualReadSafeCount: tableValues.simulatedDualReadSafeCount,
    simulatedDualReadUnsafeCount: tableValues.simulatedDualReadUnsafeCount,
    needsManualReviewCount: tableValues.needsManualReviewCount,
    organizationOwnedRowsFound: tableValues.organizationOwnedRowsFound,
  };
  assertRequiredCounts(counts);
  return {
    sourcePath: options.sourcePath || "not_recorded",
    sourceType: "markdown_summary",
    generatedAt: parseInlineField(markdown, "Generated at"),
    sourceReportGeneratedAt: parseInlineField(markdown, "Source report generated at"),
    operator: parseInlineField(markdown, "Operator"),
    commitSha: parseInlineField(markdown, "Commit SHA"),
    environment: parseInlineField(markdown, "Environment"),
    mainOnlyEvidence: parseInlineField(markdown, "Main-only evidence"),
    syntheticFixture: parseInlineField(markdown, "Synthetic fixture"),
    decisionStatus: parseInlineField(markdown, "Decision status"),
    counts,
  };
}

function parseTenantAssetManualReviewEvidenceJson(rawJson, options = {}) {
  const payload = JSON.parse(rawJson);
  normalizeTenantAssetEvidenceReportPayload(payload);
  const summary = buildTenantAssetEvidenceSummary(payload, {
    sourcePath: options.sourcePath || "not_recorded",
    evidenceEnvironment: options.evidenceEnvironment || "main",
    syntheticFixture: Boolean(options.syntheticFixture),
  });
  const counts = buildCountsFromEvidenceSummary(summary);
  assertRequiredCounts(counts);
  return {
    sourcePath: options.sourcePath || "not_recorded",
    sourceType: "json_export",
    generatedAt: summary.generatedAt,
    sourceReportGeneratedAt: summary.sourceReportGeneratedAt,
    operator: summary.operator,
    commitSha: summary.commitSha,
    environment: summary.evidenceEnvironment,
    mainOnlyEvidence: summary.mainOnlyEvidence,
    syntheticFixture: summary.syntheticFixture,
    decisionStatus: summary.decisionStatus,
    counts,
  };
}

export function parseTenantAssetManualReviewEvidence(content, options = {}) {
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{")) {
    return parseTenantAssetManualReviewEvidenceJson(content, options);
  }
  return parseTenantAssetManualReviewEvidenceMarkdown(content, options);
}

function countValue(counts, key) {
  return Number.isFinite(counts[key]) ? counts[key] : 0;
}

function buildCategoryRollup(counts) {
  const metadataMissing = countValue(counts, "metadataMissingTotal");
  const publicUnsafe = countValue(counts, "publicImagesWithMissingOrAmbiguousOwnership");
  const derivativeRisks = countValue(counts, "derivativeOwnershipRisks");
  const dualReadUnsafe = countValue(counts, "simulatedDualReadUnsafeCount");
  const manualReview = countValue(counts, "needsManualReviewCount");
  const relationshipConflicts = countValue(counts, "relationshipConflictCount");
  const orgRows = countValue(counts, "organizationOwnedRowsFound");
  const safeObserve = countValue(counts, "simulatedDualReadSafeCount");

  return [
    {
      category: "metadata_missing",
      count: metadataMissing,
      severity: metadataMissing > 0 ? "high" : "observe",
      priority: metadataMissing > 0 ? "P0" : "P2",
      initialStatus: metadataMissing > 0 ? "blocked_missing_evidence" : "deferred",
      nextAction: "Classify old null-metadata rows before any ownership-based access or backfill design.",
    },
    {
      category: "public_unsafe",
      count: publicUnsafe,
      severity: publicUnsafe > 0 ? "critical" : "observe",
      priority: publicUnsafe > 0 ? "P0" : "P2",
      initialStatus: publicUnsafe > 0 ? "blocked_public_unsafe" : "deferred",
      nextAction: "Review public/gallery rows separately because visibility and attribution are involved.",
    },
    {
      category: "derivative_risk",
      count: derivativeRisks,
      severity: derivativeRisks > 0 ? "high" : "observe",
      priority: derivativeRisks > 0 ? "P0" : "P2",
      initialStatus: derivativeRisks > 0 ? "blocked_derivative_risk" : "deferred",
      nextAction: "Resolve parent image ownership before treating derivative/poster/thumb assets as inherited.",
    },
    {
      category: "dual_read_unsafe",
      count: dualReadUnsafe,
      severity: dualReadUnsafe > 0 ? "high" : "observe",
      priority: dualReadUnsafe > 0 ? "P0" : "P2",
      initialStatus: dualReadUnsafe > 0 ? "pending_review" : "deferred",
      nextAction: "Keep access-check switching blocked until simulated metadata access is safe.",
    },
    {
      category: "manual_review_needed",
      count: manualReview,
      severity: manualReview > 0 ? "high" : "observe",
      priority: manualReview > 0 ? "P0" : "P2",
      initialStatus: manualReview > 0 ? "pending_review" : "deferred",
      nextAction: "Create operator review records before any approved remediation executor exists.",
    },
    {
      category: "relationship_review",
      count: relationshipConflicts,
      severity: relationshipConflicts > 0 ? "high" : "observe",
      priority: relationshipConflicts > 0 ? "P0" : "P2",
      initialStatus: relationshipConflicts > 0 ? "blocked_relationship_conflict" : "deferred",
      nextAction: "Zero conflicts are a positive signal but do not unblock migration by themselves.",
    },
    {
      category: "legacy_unclassified",
      count: metadataMissing,
      severity: metadataMissing > 0 ? "high" : "observe",
      priority: metadataMissing > 0 ? "P1" : "P2",
      initialStatus: metadataMissing > 0 ? "pending_review" : "deferred",
      nextAction: "Decide whether old rows stay legacy user-owned or require future metadata assignment.",
    },
    {
      category: "future_org_ownership_review",
      count: orgRows,
      severity: orgRows > 0 ? "high" : "observe",
      priority: orgRows > 0 ? "P1" : "P3",
      initialStatus: orgRows > 0 ? "pending_review" : "deferred",
      nextAction: "Only approve organization ownership with strong server-side org evidence.",
    },
    {
      category: "platform_admin_test_review",
      count: 0,
      severity: "observe",
      priority: "P3",
      initialStatus: "deferred",
      nextAction: "Reserve for future admin/test artifacts if they appear in evidence.",
    },
    {
      category: "safe_observe_only",
      count: safeObserve,
      severity: "observe",
      priority: "P3",
      initialStatus: "deferred",
      nextAction: "Treat matching rows as observation evidence only, not access-switch approval.",
    },
  ];
}

export function buildTenantAssetManualReviewPlan(parsedEvidence, options = {}) {
  const counts = parsedEvidence.counts;
  assertRequiredCounts(counts);
  const rollup = buildCategoryRollup(counts);
  const highRiskCount = [
    "metadataMissingTotal",
    "metadataConflictCount",
    "relationshipConflictCount",
    "orphanFolderReferences",
    "publicImagesWithMissingOrAmbiguousOwnership",
    "derivativeOwnershipRisks",
    "simulatedDualReadUnsafeCount",
    "needsManualReviewCount",
  ].reduce((total, key) => total + countValue(counts, key), 0);
  return {
    planVersion: "tenant-folders-images-manual-review-plan-v1",
    phase: "6.11",
    generatedAt: options.generatedAt || new Date().toISOString(),
    sourceEvidenceFile: parsedEvidence.sourcePath,
    sourceEvidenceType: parsedEvidence.sourceType,
    evidenceDecisionStatus: parsedEvidence.decisionStatus || "not_recorded",
    evidenceEnvironment: parsedEvidence.environment || "not_recorded",
    mainOnlyEvidence: parsedEvidence.mainOnlyEvidence === true,
    syntheticFixture: parsedEvidence.syntheticFixture === true,
    reviewCategories: REVIEW_CATEGORIES,
    reviewStatuses: REVIEW_STATUSES,
    counts,
    highRiskSignalCount: highRiskCount,
    issueCategoryRollup: rollup,
    blockedDecisions: {
      accessCheckSwitch: "blocked_for_access_switch",
      ownershipBackfill: "blocked_for_backfill",
      tenantIsolation: "not_claimed",
      productionReadiness: "blocked",
    },
    priorities: [
      "P0: public_unsafe, derivative_risk, metadata_missing, dual_read_unsafe, and manual_review_needed rows.",
      "P1: legacy_unclassified rows and any future strong organization evidence.",
      "P2: relationship_review confirmations when conflicts are zero.",
      "P3: safe_observe_only rows and reserved platform/admin-test categories.",
    ],
    recommendedNextPhase: "Phase 6.12 — Manual Review State Schema Design for AI Folders & Images",
    mutationSafety: {
      d1RowsRewritten: false,
      ownershipBackfillPerformed: false,
      r2LiveListed: false,
      r2ObjectsMovedOrDeleted: false,
      runtimeAccessChecksChanged: false,
      executableSqlEmitted: false,
      liveEndpointCalls: false,
      cloudflareApiCalls: false,
      stripeApiCalls: false,
      providerCalls: false,
      creditBillingMutations: false,
    },
  };
}

export function renderTenantAssetManualReviewPlanMarkdown(plan) {
  const lines = [
    "# Main AI Folders/Images Manual Review Plan",
    "",
    `Generated at: \`${plan.generatedAt}\``,
    `Source evidence file: \`${plan.sourceEvidenceFile}\``,
    `Evidence decision status: \`${plan.evidenceDecisionStatus}\``,
    `Main-only evidence: ${plan.mainOnlyEvidence ? "yes" : "no"}`,
    `Synthetic fixture: ${plan.syntheticFixture ? "yes" : "no"}`,
    "",
    "## Decision",
    "",
    "| Decision | Status |",
    "| --- | --- |",
    `| Access-check switch | \`${plan.blockedDecisions.accessCheckSwitch}\` |`,
    `| Ownership backfill | \`${plan.blockedDecisions.ownershipBackfill}\` |`,
    `| Tenant isolation | \`${plan.blockedDecisions.tenantIsolation}\` |`,
    `| Production readiness | \`${plan.blockedDecisions.productionReadiness}\` |`,
    "",
    "## Evidence Counts",
    "",
    "| Field | Value |",
    "| --- | --- |",
    ...Object.entries(plan.counts).map(([field, value]) => `| \`${field}\` | \`${value}\` |`),
    "",
    "## Issue Category Rollup",
    "",
    "| Category | Count | Severity | Priority | Initial status | Next action |",
    "| --- | ---: | --- | --- | --- | --- |",
    ...plan.issueCategoryRollup.map((item) => (
      `| \`${item.category}\` | ${item.count} | ${item.severity} | ${item.priority} | \`${item.initialStatus}\` | ${item.nextAction} |`
    )),
    "",
    "## Review Statuses",
    "",
    plan.reviewStatuses.map((status) => `- \`${status}\``).join("\n"),
    "",
    "## Priorities",
    "",
    ...plan.priorities.map((priority) => `- ${priority}`),
    "",
    "## Safety",
    "",
    "- This plan is documentation/check tooling only.",
    "- It does not emit executable SQL or backfill commands.",
    "- It does not call live endpoints, Cloudflare, Stripe, GitHub, or AI providers.",
    "- It does not read, list, move, delete, or rewrite live R2 objects.",
    "- It does not rewrite D1 rows or switch runtime access checks.",
    "",
    "## Next Phase",
    "",
    plan.recommendedNextPhase,
  ];
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
    format: "markdown",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") {
      args.input = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--output") {
      args.output = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--format") {
      args.format = argv[index + 1] || "markdown";
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node scripts/plan-tenant-asset-manual-review.mjs --input <evidence.md|evidence.json> [--output <plan.md>] [--format markdown|json]",
    "",
    "Reads a local, committed tenant asset ownership evidence file and prints a non-mutating manual-review plan.",
    "The script does not call live endpoints and does not emit executable SQL/backfill commands.",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.input) {
    throw new Error("--input is required");
  }
  if (args.format !== "markdown" && args.format !== "json") {
    throw new Error("--format must be markdown or json");
  }
  const inputPath = path.resolve(args.input);
  const content = fs.readFileSync(inputPath, "utf8");
  const parsedEvidence = parseTenantAssetManualReviewEvidence(content, {
    sourcePath: path.relative(process.cwd(), inputPath),
  });
  const plan = buildTenantAssetManualReviewPlan(parsedEvidence);
  const rendered = args.format === "json"
    ? `${JSON.stringify(plan, null, 2)}\n`
    : renderTenantAssetManualReviewPlanMarkdown(plan);
  if (args.output) {
    const outputPath = path.resolve(args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, rendered, "utf8");
    return;
  }
  process.stdout.write(rendered);
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
