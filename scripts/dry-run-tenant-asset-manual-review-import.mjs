#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findUnsafeTenantAssetEvidenceFindings,
  normalizeTenantAssetEvidenceReportPayload,
} from "./summarize-tenant-asset-evidence.mjs";
import {
  parseTenantAssetManualReviewEvidenceMarkdown,
} from "./plan-tenant-asset-manual-review.mjs";
import {
  normalizeTenantAssetManualReviewIssueCategory,
  normalizeTenantAssetManualReviewPriority,
  normalizeTenantAssetManualReviewSeverity,
  normalizeTenantAssetManualReviewStatus,
  serializeTenantAssetManualReviewMetadata,
} from "../workers/auth/src/lib/tenant-asset-manual-review.js";

const DEFAULT_INPUT = "docs/tenant-assets/evidence/2026-05-17-main-folders-images-owner-map-evidence.md";
const REPORT_VERSION = "tenant-asset-manual-review-import-dry-run-v1";
const NEXT_PHASE_FOR_AGGREGATE_ONLY = "Phase 6.15 — Operator Provides JSON Evidence for Item-level Review Import";
const NEXT_PHASE_FOR_ITEM_LEVEL = "Phase 6.15 — Admin-approved Manual Review Item Import Executor";

const SUMMARY_COUNT_KEYS = Object.freeze([
  "totalFoldersScanned",
  "totalImagesScanned",
  "foldersWithOwnershipMetadata",
  "imagesWithOwnershipMetadata",
  "foldersWithNullOwnershipMetadata",
  "imagesWithNullOwnershipMetadata",
  "metadataMissingTotal",
  "metadataConflictCount",
  "relationshipConflictCount",
  "orphanFolderReferences",
  "publicImagesWithMissingOrAmbiguousOwnership",
  "derivativeOwnershipRisks",
  "simulatedDualReadSafeCount",
  "simulatedDualReadUnsafeCount",
  "needsManualReviewCount",
  "organizationOwnedRowsFound",
]);

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

function normalizeRequiredIssueCategory(value) {
  const normalized = normalizeTenantAssetManualReviewIssueCategory(value);
  if (!normalized) throw new Error(`Unsupported manual-review issue category: ${value}`);
  return normalized;
}

function normalizeRequiredStatus(value) {
  const normalized = normalizeTenantAssetManualReviewStatus(value);
  if (!normalized) throw new Error(`Unsupported manual-review status: ${value}`);
  return normalized;
}

function normalizeRequiredSeverity(value) {
  const normalized = normalizeTenantAssetManualReviewSeverity(value);
  if (!normalized) throw new Error(`Unsupported manual-review severity: ${value}`);
  return normalized;
}

function normalizeRequiredPriority(value) {
  const normalized = normalizeTenantAssetManualReviewPriority(value);
  if (!normalized) throw new Error(`Unsupported manual-review priority: ${value}`);
  return normalized;
}

function countSummary(summary = {}) {
  const foldersMissing = toNumber(summary.foldersWithNullOwnershipMetadata);
  const imagesMissing = toNumber(summary.imagesWithNullOwnershipMetadata);
  const counts = {};
  for (const key of SUMMARY_COUNT_KEYS) {
    counts[key] = toNumber(summary[key]);
  }
  if (!counts.metadataMissingTotal) {
    counts.metadataMissingTotal = foldersMissing + imagesMissing;
  }
  return counts;
}

function parseEvidenceInput(content, { sourcePath = DEFAULT_INPUT } = {}) {
  const unsafeFindings = findUnsafeTenantAssetEvidenceFindings(content);
  if (unsafeFindings.length > 0) {
    throw new Error(`Unsafe evidence content detected: ${unsafeFindings.slice(0, 5).join("; ")}`);
  }

  const trimmed = String(content || "").trimStart();
  if (trimmed.startsWith("{")) {
    const payload = JSON.parse(content);
    const report = normalizeTenantAssetEvidenceReportPayload(payload);
    const evidenceItems = [
      ...(Array.isArray(report.folderEvidence) ? report.folderEvidence : []),
      ...(Array.isArray(report.imageEvidence) ? report.imageEvidence : []),
      ...(Array.isArray(report.relationshipEvidence) ? report.relationshipEvidence : []),
      ...(Array.isArray(report.publicGalleryEvidence) ? report.publicGalleryEvidence : []),
      ...(Array.isArray(report.derivativeEvidence) ? report.derivativeEvidence : []),
      ...(Array.isArray(report.manualReviewQueue) ? report.manualReviewQueue : []),
    ];
    return {
      inputType: "json_export",
      sourcePath,
      evidenceReportGeneratedAt: report.generatedAt || null,
      counts: countSummary(report.summary || {}),
      evidenceItems,
      filters: report.filters || {},
      decisionStatus: report.productionReadiness === "blocked"
        ? "blocked_for_access_switch_and_backfill"
        : "blocked",
    };
  }

  const parsed = parseTenantAssetManualReviewEvidenceMarkdown(content, { sourcePath });
  return {
    inputType: "markdown_summary",
    sourcePath,
    evidenceReportGeneratedAt: parsed.sourceReportGeneratedAt || parsed.generatedAt || null,
    counts: countSummary(parsed.counts || {}),
    evidenceItems: [],
    filters: {},
    decisionStatus: parsed.decisionStatus || "blocked_for_access_switch_and_backfill",
  };
}

function sourceTableForDomain(assetDomain) {
  if (assetDomain === "ai_folders") return "ai_folders";
  if (assetDomain === "ai_images" || assetDomain === "public_gallery" || assetDomain === "derivative") return "ai_images";
  return null;
}

function domainFromItemType(itemType) {
  if (itemType === "folder") return "ai_folders";
  if (itemType === "image") return "ai_images";
  if (itemType === "relationship") return "relationship";
  if (itemType === "public_gallery") return "public_gallery";
  if (itemType === "derivative") return "derivative";
  return "ai_images";
}

function hasRisk(value) {
  const text = String(value || "").trim();
  return Boolean(text && text !== "not_applicable" && text !== "not_public");
}

function issueCategoryForItem(item) {
  const itemType = String(item?.itemType || "");
  const classification = String(item?.classification || "");
  if (itemType === "public_gallery" || hasRisk(item?.publicGalleryRisk) && item?.publicGalleryRisk !== "legacy_public_attribution_only") {
    return "public_unsafe";
  }
  if (itemType === "derivative" || hasRisk(item?.derivativeRisk)) {
    return "derivative_risk";
  }
  if (itemType === "relationship" || classification === "relationship_conflict" || classification === "orphan_reference") {
    return "relationship_review";
  }
  if (classification === "metadata_missing") return "metadata_missing";
  if (classification === "same_allow") return "safe_observe_only";
  if (
    classification === "unsafe_to_switch" ||
    classification === "legacy_allows_metadata_denies" ||
    classification === "legacy_denies_metadata_allows"
  ) {
    return "dual_read_unsafe";
  }
  return "manual_review_needed";
}

function reviewMapping(category) {
  switch (category) {
    case "public_unsafe":
      return { review_status: "blocked_public_unsafe", severity: "critical", priority: "high" };
    case "derivative_risk":
      return { review_status: "blocked_derivative_risk", severity: "warning", priority: "medium" };
    case "dual_read_unsafe":
      return { review_status: "pending_review", severity: "critical", priority: "high" };
    case "relationship_review":
      return { review_status: "pending_review", severity: "warning", priority: "medium" };
    case "safe_observe_only":
      return { review_status: "deferred", severity: "info", priority: "low" };
    case "metadata_missing":
      return { review_status: "pending_review", severity: "warning", priority: "medium" };
    case "legacy_unclassified":
      return { review_status: "pending_review", severity: "warning", priority: "medium" };
    case "future_org_ownership_review":
      return { review_status: "pending_review", severity: "warning", priority: "medium" };
    case "platform_admin_test_review":
      return { review_status: "deferred", severity: "info", priority: "low" };
    case "manual_review_needed":
    default:
      return { review_status: "pending_review", severity: "warning", priority: "medium" };
  }
}

function safeItemId(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 160 || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function buildDedupeKey({ assetDomain, assetId, relatedAssetId, issueCategory, evidenceSourcePath }) {
  return [
    assetDomain || "not_recorded",
    assetId || "aggregate",
    relatedAssetId || "none",
    issueCategory,
    evidenceSourcePath || "not_recorded",
  ].join("|");
}

function buildProposedItem(item, evidence) {
  const issueCategory = normalizeRequiredIssueCategory(issueCategoryForItem(item));
  const mapping = reviewMapping(issueCategory);
  const assetDomain = domainFromItemType(item?.itemType);
  const assetId = safeItemId(item?.itemId);
  const relatedAssetId = safeItemId(item?.relatedItemId || item?.relatedAssetId);
  const dedupeKey = buildDedupeKey({
    assetDomain,
    assetId,
    relatedAssetId,
    issueCategory,
    evidenceSourcePath: evidence.sourcePath,
  });
  const evidenceSummary = {
    classification: item?.classification || "not_recorded",
    sourceItemType: item?.itemType || "not_recorded",
    severity: item?.severity || mapping.severity,
    publicGalleryRisk: item?.publicGalleryRisk || "not_recorded",
    relationshipRisk: item?.relationshipRisk || "not_recorded",
    derivativeRisk: item?.derivativeRisk || "not_recorded",
  };
  const metadata = {
    dryRunPhase: "6.14",
    dedupeKey,
    sourceInputType: evidence.inputType,
    recommendedNextAction: item?.recommendedNextAction || "Review before any future import executor.",
  };
  return {
    proposedId: `dryrun_review_${shortHash(dedupeKey)}`,
    dedupeKey,
    aggregateOnly: false,
    asset_domain: assetDomain,
    asset_id: assetId,
    related_asset_id: relatedAssetId,
    source_table: sourceTableForDomain(assetDomain),
    source_row_id: assetId,
    issue_category: issueCategory,
    review_status: normalizeRequiredStatus(mapping.review_status),
    severity: normalizeRequiredSeverity(mapping.severity),
    priority: normalizeRequiredPriority(mapping.priority),
    legacy_owner_user_id: null,
    proposed_asset_owner_type: null,
    proposed_owning_user_id: null,
    proposed_owning_organization_id: null,
    proposed_ownership_status: "pending_review",
    proposed_ownership_source: null,
    proposed_ownership_confidence: null,
    evidence_source_path: evidence.sourcePath,
    evidence_report_generated_at: evidence.evidenceReportGeneratedAt,
    evidence_summary_json: serializeTenantAssetManualReviewMetadata(evidenceSummary),
    safe_notes: safeNotesForCategory(issueCategory),
    created_at: "would_be_set_by_future_import_executor",
    updated_at: "would_be_set_by_future_import_executor",
    metadata_json: serializeTenantAssetManualReviewMetadata(metadata),
  };
}

function safeNotesForCategory(category) {
  switch (category) {
    case "public_unsafe":
      return "Public/gallery attribution and visibility must be reviewed before any ownership access switch.";
    case "derivative_risk":
      return "Parent image ownership must be reviewed before derivative/poster/thumb inheritance.";
    case "metadata_missing":
      return "Existing row has no ownership metadata; classify before any backfill or access switch.";
    case "dual_read_unsafe":
      return "Simulated ownership access is unsafe or divergent; keep runtime access checks unchanged.";
    case "relationship_review":
      return "Folder/image relationship ownership needs review before migration planning.";
    case "safe_observe_only":
      return "Matching metadata is observation evidence only and does not prove tenant isolation.";
    default:
      return "Manual review is required before any future import executor or remediation.";
  }
}

function buildAggregateBucket(category, count, evidence) {
  const issueCategory = normalizeRequiredIssueCategory(category);
  const mapping = reviewMapping(issueCategory);
  const dedupeKey = [
    "aggregate",
    issueCategory,
    evidence.sourcePath,
    evidence.evidenceReportGeneratedAt || "not_recorded",
  ].join("|");
  return {
    bucketKey: `aggregate_${shortHash(dedupeKey)}`,
    dedupeKey,
    aggregateOnly: true,
    itemLevelImportReady: false,
    issue_category: issueCategory,
    review_status: normalizeRequiredStatus(mapping.review_status),
    severity: normalizeRequiredSeverity(mapping.severity),
    priority: normalizeRequiredPriority(mapping.priority),
    candidateCount: count,
    evidence_source_path: evidence.sourcePath,
    evidence_report_generated_at: evidence.evidenceReportGeneratedAt,
    safe_notes: safeNotesForCategory(issueCategory),
  };
}

function aggregateBucketsFromCounts(evidence) {
  const counts = evidence.counts || {};
  const bucketInputs = [
    ["metadata_missing", counts.metadataMissingTotal],
    ["public_unsafe", counts.publicImagesWithMissingOrAmbiguousOwnership],
    ["derivative_risk", counts.derivativeOwnershipRisks],
    ["dual_read_unsafe", counts.simulatedDualReadUnsafeCount],
    ["manual_review_needed", counts.needsManualReviewCount],
    ["relationship_review", counts.relationshipConflictCount + counts.orphanFolderReferences],
    ["legacy_unclassified", counts.metadataMissingTotal],
    ["future_org_ownership_review", counts.organizationOwnedRowsFound],
    ["platform_admin_test_review", 0],
    ["safe_observe_only", counts.simulatedDualReadSafeCount],
  ];
  return bucketInputs.map(([category, count]) => buildAggregateBucket(category, toNumber(count), evidence));
}

function rollupBy(items, key, countKey = null) {
  const rollup = {};
  for (const item of items) {
    const value = item[key] || "unknown";
    const increment = countKey ? toNumber(item[countKey]) : 1;
    rollup[value] = (rollup[value] || 0) + increment;
  }
  return rollup;
}

export function buildTenantAssetManualReviewImportDryRun(content, options = {}) {
  const evidence = parseEvidenceInput(content, {
    sourcePath: options.sourcePath || DEFAULT_INPUT,
  });
  const proposedByKey = new Map();
  for (const item of evidence.evidenceItems) {
    const proposed = buildProposedItem(item, evidence);
    if (!proposedByKey.has(proposed.dedupeKey)) {
      proposedByKey.set(proposed.dedupeKey, proposed);
    }
  }
  const proposedItems = [...proposedByKey.values()].sort((left, right) => left.dedupeKey.localeCompare(right.dedupeKey));
  const aggregateBuckets = proposedItems.length > 0 ? [] : aggregateBucketsFromCounts(evidence);
  const itemLevelImportReady = evidence.inputType === "json_export" && proposedItems.length > 0;
  const allRollupItems = itemLevelImportReady ? proposedItems : aggregateBuckets;
  return {
    reportVersion: REPORT_VERSION,
    phase: "6.14",
    generatedAt: options.generatedAt || evidence.evidenceReportGeneratedAt || "not_recorded",
    sourceInputFile: evidence.sourcePath,
    inputType: evidence.inputType,
    itemLevelImportReady,
    requiresJsonEvidenceForItemImport: !itemLevelImportReady,
    noMutation: true,
    noSqlEmitted: true,
    noBackfill: true,
    noAccessSwitch: true,
    noD1Connection: true,
    noR2Operation: true,
    unsafeInputDetected: false,
    proposedReviewItemCount: proposedItems.length,
    aggregateBucketCount: aggregateBuckets.length,
    categoryRollup: rollupBy(allRollupItems, "issue_category", itemLevelImportReady ? null : "candidateCount"),
    severityRollup: rollupBy(allRollupItems, "severity", itemLevelImportReady ? null : "candidateCount"),
    priorityRollup: rollupBy(allRollupItems, "priority", itemLevelImportReady ? null : "candidateCount"),
    proposedItems,
    aggregateBuckets,
    blockedReasons: [
      "dry_run_only",
      "review_rows_not_created",
      "future_import_execution_requires_explicit_admin_approval",
      "ownership_backfill_blocked",
      "access_check_switch_blocked",
    ],
    nextRecommendedPhase: itemLevelImportReady ? NEXT_PHASE_FOR_ITEM_LEVEL : NEXT_PHASE_FOR_AGGREGATE_ONLY,
    limitations: [
      evidence.inputType === "markdown_summary"
        ? "Markdown summary evidence supports aggregate buckets only; item-level review import requires JSON evidence with bounded detail arrays."
        : "JSON detail arrays are converted into proposed candidates only; no D1 writes are performed.",
      "The dry run does not emit executable SQL, row-write statements, backfill commands, or access-switch instructions.",
      "Private prompts, raw provider payloads, private R2 keys, cookies, auth headers, Stripe data, Cloudflare tokens, private keys, and raw idempotency keys are rejected or redacted.",
    ],
  };
}

export function renderTenantAssetManualReviewImportDryRunMarkdown(report) {
  const lines = [
    "# AI Folders/Images Manual Review Import Dry Run",
    "",
    `Generated at: \`${report.generatedAt}\``,
    `Source input file: \`${report.sourceInputFile}\``,
    `Input type: \`${report.inputType}\``,
    `Item-level import ready: ${report.itemLevelImportReady ? "yes" : "no"}`,
    `Requires JSON evidence for item import: ${report.requiresJsonEvidenceForItemImport ? "yes" : "no"}`,
    "",
    "## Safety",
    "",
    "| Flag | Value |",
    "| --- | --- |",
    `| noMutation | ${report.noMutation} |`,
    `| noSqlEmitted | ${report.noSqlEmitted} |`,
    `| noBackfill | ${report.noBackfill} |`,
    `| noAccessSwitch | ${report.noAccessSwitch} |`,
    `| noD1Connection | ${report.noD1Connection} |`,
    `| noR2Operation | ${report.noR2Operation} |`,
    "",
    "## Rollups",
    "",
    "| Category | Count |",
    "| --- | ---: |",
    ...Object.entries(report.categoryRollup).map(([key, value]) => `| \`${key}\` | ${value} |`),
    "",
    "## Proposed Items",
    "",
  ];
  if (report.proposedItems.length === 0) {
    lines.push("No per-item review candidates were produced from this input.");
  } else {
    lines.push("| Proposed id | Domain | Asset id | Category | Status | Severity | Priority | Dedupe key |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const item of report.proposedItems) {
      lines.push(`| \`${item.proposedId}\` | \`${item.asset_domain}\` | \`${item.asset_id || "not_recorded"}\` | \`${item.issue_category}\` | \`${item.review_status}\` | \`${item.severity}\` | \`${item.priority}\` | \`${item.dedupeKey}\` |`);
    }
  }
  lines.push("", "## Aggregate Buckets", "");
  if (report.aggregateBuckets.length === 0) {
    lines.push("No aggregate-only buckets were needed because item-level evidence was available.");
  } else {
    lines.push("| Bucket | Category | Candidate count | Status | Severity | Priority |");
    lines.push("| --- | --- | ---: | --- | --- | --- |");
    for (const bucket of report.aggregateBuckets) {
      lines.push(`| \`${bucket.bucketKey}\` | \`${bucket.issue_category}\` | ${bucket.candidateCount} | \`${bucket.review_status}\` | \`${bucket.severity}\` | \`${bucket.priority}\` |`);
    }
  }
  lines.push(
    "",
    "## Blocked Reasons",
    "",
    ...report.blockedReasons.map((reason) => `- \`${reason}\``),
    "",
    "## Limitations",
    "",
    ...report.limitations.map((limitation) => `- ${limitation}`),
    "",
    "## Next Recommended Phase",
    "",
    report.nextRecommendedPhase,
    "",
  );
  return `${lines.join("\n")}`;
}

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
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
    "Usage: node scripts/dry-run-tenant-asset-manual-review-import.mjs --input <evidence.md|evidence.json> [--format markdown|json] [--output <path>]",
    "",
    "Builds a non-mutating manual-review import dry-run from local evidence.",
    "The script never calls live endpoints, never connects to D1/R2, never emits executable SQL, and never creates review rows.",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.format !== "markdown" && args.format !== "json") {
    throw new Error("--format must be markdown or json");
  }
  const inputPath = path.resolve(args.input);
  const content = fs.readFileSync(inputPath, "utf8");
  const report = buildTenantAssetManualReviewImportDryRun(content, {
    sourcePath: path.relative(process.cwd(), inputPath),
  });
  const rendered = args.format === "json"
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderTenantAssetManualReviewImportDryRunMarkdown(report);
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
