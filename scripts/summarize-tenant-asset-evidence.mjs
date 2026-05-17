#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_REPORT_FIELDS = Object.freeze([
  "generatedAt",
  "source",
  "domain",
  "runtimeBehaviorChanged",
  "accessChecksChanged",
  "tenantIsolationClaimed",
  "backfillPerformed",
  "r2LiveListed",
  "productionReadiness",
  "summary",
]);

const HIGH_RISK_COUNT_KEYS = Object.freeze([
  "metadataMissingTotal",
  "metadataConflictCount",
  "relationshipConflictCount",
  "orphanFolderReferences",
  "publicImagesWithMissingOrAmbiguousOwnership",
  "derivativeOwnershipRisks",
  "simulatedDualReadUnsafeCount",
  "needsManualReviewCount",
]);

function repoRootFromScript() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function unwrapReportPayload(payload) {
  const maybeReport = asObject(payload);
  return asObject(maybeReport.report || maybeReport);
}

function isRedacted(value) {
  if (value == null || value === false) return true;
  if (typeof value !== "string") return false;
  const text = value.trim().toLowerCase();
  return !text || text === "[redacted]" || text === "redacted" || text === "<redacted>";
}

function unsafeKeyFinding(key, value, pathLabel) {
  if (!/(prompt|provider.*request|provider.*response|provider.*body|request_body|response_body|raw.*r2|cookie|authorization|secret|token|stripe|cloudflare.*token|private_key|idempotency)/i.test(key)) {
    return null;
  }
  return isRedacted(value) ? null : `${pathLabel}: unsafe field "${key}" must be redacted or removed`;
}

function unsafeStringFinding(value, pathLabel) {
  const text = String(value || "");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) return `${pathLabel}: private key material detected`;
  if (/\bAuthorization:\s*\S+/i.test(text)) return `${pathLabel}: authorization header detected`;
  if (/\bCookie:\s*(?!<)[^\s]+/i.test(text)) return `${pathLabel}: cookie value detected`;
  if (/\bBearer\s+[A-Za-z0-9._~+/-]{20,}/.test(text)) return `${pathLabel}: bearer token detected`;
  if (/\b(?:sk_live|sk_test|rk_live|pk_live)_[A-Za-z0-9]{8,}/.test(text)) return `${pathLabel}: Stripe-looking key detected`;
  if (/https?:\/\/[^\s"]+\?(?=[^\s"]*(X-Amz-Signature|Expires=|Policy=))/i.test(text)) return `${pathLabel}: signed URL detected`;
  if (/\busers\/(?!\{userId\})[^/\s"]+\/(?:folders|derivatives|video-jobs)\//.test(text)) return `${pathLabel}: private user R2 key detected`;
  if (/\btmp\/ai-generated\/(?!\{userId\})[^/\s"]+\//.test(text)) return `${pathLabel}: private temporary generated R2 key detected`;
  return null;
}

export function findUnsafeTenantAssetEvidenceFindings(value, pathLabel = "$", findings = []) {
  if (findings.length > 20) return findings;
  if (typeof value === "string") {
    const finding = unsafeStringFinding(value, pathLabel);
    if (finding) findings.push(finding);
    return findings;
  }
  if (!value || typeof value !== "object") return findings;
  if (Array.isArray(value)) {
    value.slice(0, 200).forEach((entry, index) => {
      findUnsafeTenantAssetEvidenceFindings(entry, `${pathLabel}[${index}]`, findings);
    });
    return findings;
  }
  for (const [key, entry] of Object.entries(value).slice(0, 300)) {
    const nextPath = `${pathLabel}.${key}`;
    const fieldFinding = unsafeKeyFinding(key, entry, nextPath);
    if (fieldFinding) findings.push(fieldFinding);
    findUnsafeTenantAssetEvidenceFindings(entry, nextPath, findings);
  }
  return findings;
}

export function normalizeTenantAssetEvidenceReportPayload(payload) {
  const report = unwrapReportPayload(payload);
  const missing = REQUIRED_REPORT_FIELDS.filter((field) => !(field in report));
  if (missing.length) {
    throw new Error(`Tenant asset evidence report missing required fields: ${missing.join(", ")}`);
  }
  if (report.source !== "local_d1_read_only") {
    throw new Error("Tenant asset evidence report source must be local_d1_read_only.");
  }
  if (report.domain !== "folders_images") {
    throw new Error("Tenant asset evidence report domain must be folders_images.");
  }
  const unsafe = findUnsafeTenantAssetEvidenceFindings(report);
  if (unsafe.length) {
    throw new Error(`Tenant asset evidence report contains unsafe fields: ${unsafe.slice(0, 5).join("; ")}`);
  }
  return report;
}

function buildCountSummary(summary, rollup = {}) {
  const foldersMissing = toNumber(summary.foldersWithNullOwnershipMetadata);
  const imagesMissing = toNumber(summary.imagesWithNullOwnershipMetadata);
  const metadataMissingTotal = toNumber(summary.metadataMissingTotal ?? rollup.metadataMissing) || foldersMissing + imagesMissing;
  return {
    totalFoldersScanned: toNumber(summary.totalFoldersScanned),
    totalImagesScanned: toNumber(summary.totalImagesScanned),
    foldersWithOwnershipMetadata: toNumber(summary.foldersWithOwnershipMetadata),
    imagesWithOwnershipMetadata: toNumber(summary.imagesWithOwnershipMetadata),
    foldersWithNullOwnershipMetadata: foldersMissing,
    imagesWithNullOwnershipMetadata: imagesMissing,
    metadataMissingTotal,
    metadataConflictCount: toNumber(summary.metadataConflictCount),
    relationshipConflictCount: toNumber(summary.relationshipConflictCount),
    orphanFolderReferences: toNumber(summary.orphanFolderReferences),
    publicImagesWithMissingOrAmbiguousOwnership: toNumber(summary.publicImagesWithMissingOrAmbiguousOwnership),
    derivativeOwnershipRisks: toNumber(summary.derivativeOwnershipRisks),
    simulatedDualReadSafeCount: toNumber(summary.simulatedDualReadSafeCount ?? rollup.safe),
    simulatedDualReadUnsafeCount: toNumber(summary.simulatedDualReadUnsafeCount ?? rollup.unsafe),
    needsManualReviewCount: toNumber(summary.needsManualReviewCount ?? rollup.needsManualReview),
    organizationOwnedRowsFound: toNumber(summary.organizationOwnedRowsFound),
  };
}

function safetyFlags(report) {
  return {
    runtimeBehaviorChanged: report.runtimeBehaviorChanged === true,
    accessChecksChanged: report.accessChecksChanged === true,
    tenantIsolationClaimed: report.tenantIsolationClaimed === true,
    backfillPerformed: report.backfillPerformed === true,
    r2LiveListed: report.r2LiveListed === true,
    productionReadiness: String(report.productionReadiness || "blocked"),
  };
}

function buildDecisionStatus(counts, flags) {
  const unsafeFlag = (
    flags.runtimeBehaviorChanged ||
    flags.accessChecksChanged ||
    flags.tenantIsolationClaimed ||
    flags.backfillPerformed ||
    flags.r2LiveListed ||
    flags.productionReadiness !== "blocked"
  );
  if (unsafeFlag) return "blocked";
  const hasHighRisk = HIGH_RISK_COUNT_KEYS.some((key) => toNumber(counts[key]) > 0);
  if (hasHighRisk) return "blocked_for_access_switch_and_backfill";
  return "safe_to_continue_design_only";
}

export function buildTenantAssetEvidenceSummary(report, {
  sourcePath = null,
  operator = "not_recorded",
  commitSha = "not_recorded",
  evidenceEnvironment = "main",
  syntheticFixture = false,
} = {}) {
  const normalized = normalizeTenantAssetEvidenceReportPayload(report);
  const counts = buildCountSummary(normalized.summary || {}, normalized.dualReadSafetyRollup || {});
  const flags = safetyFlags(normalized);
  return {
    summaryVersion: "tenant-asset-owner-map-main-evidence-summary-v1",
    generatedAt: new Date().toISOString(),
    sourcePath,
    reportGeneratedAt: normalized.generatedAt,
    operator,
    commitSha,
    evidenceEnvironment,
    syntheticFixture,
    mainOnlyEvidence: evidenceEnvironment === "main" || evidenceEnvironment === "live-main",
    endpointTested: "/api/admin/tenant-assets/folders-images/evidence/export?format=json",
    source: normalized.source,
    domain: normalized.domain,
    filters: normalized.filters || {},
    counts,
    safetyFlags: flags,
    decisionStatus: buildDecisionStatus(counts, flags),
    highRiskCounts: Object.fromEntries(HIGH_RISK_COUNT_KEYS.map((key) => [key, toNumber(counts[key])])),
    noMutationStatement: {
      noBackfill: normalized.backfillPerformed === false,
      accessChecksUnchanged: normalized.accessChecksChanged === false,
      runtimeBehaviorUnchanged: normalized.runtimeBehaviorChanged === false,
      r2NotLiveListed: normalized.r2LiveListed === false,
      tenantIsolationNotClaimed: normalized.tenantIsolationClaimed === false,
    },
  };
}

function markdownValue(value) {
  return String(value ?? "").replace(/\|/g, "\\|");
}

export function renderTenantAssetEvidenceSummaryMarkdown(summary) {
  const lines = [
    "# Main AI Folders/Images Owner-Map Evidence Summary",
    "",
    `Generated at: ${summary.generatedAt}`,
    `Source report generated at: ${summary.reportGeneratedAt}`,
    `Source file: ${summary.sourcePath || "operator-provided JSON export"}`,
    `Environment: ${summary.evidenceEnvironment}`,
    `Main-only evidence: ${summary.mainOnlyEvidence ? "yes" : "no"}`,
    `Synthetic fixture: ${summary.syntheticFixture ? "yes" : "no"}`,
    `Operator: ${summary.operator}`,
    `Commit SHA: ${summary.commitSha}`,
    `Decision status: ${summary.decisionStatus}`,
    "",
    summary.syntheticFixture
      ? "This summary is derived from a synthetic fixture for local validation only. It is not main evidence and does not apply a backfill, change access checks, mutate D1/R2, list live R2, call providers, call Stripe, mutate Cloudflare, or prove full tenant isolation."
      : "This summary is derived from an operator-provided read-only JSON export. It does not apply a backfill, change access checks, mutate D1/R2, list live R2, call providers, call Stripe, mutate Cloudflare, or prove full tenant isolation.",
    "",
    "## Safety Flags",
    "",
    "| Field | Observed |",
    "| --- | --- |",
    ...Object.entries(summary.safetyFlags).map(([key, value]) => `| ${key} | ${markdownValue(value)} |`),
    "",
    "## Summary Counts",
    "",
    "| Count | Value |",
    "| --- | ---: |",
    ...Object.entries(summary.counts).map(([key, value]) => `| ${key} | ${value} |`),
    "",
    "## High-Risk Counts",
    "",
    "| Signal | Value |",
    "| --- | ---: |",
    ...Object.entries(summary.highRiskCounts).map(([key, value]) => `| ${key} | ${value} |`),
    "",
    "## Decision",
    "",
    summary.decisionStatus === "safe_to_continue_design_only"
      ? "No high-risk counts were present in the provided bounded export. This supports design-only continuation, not tenant-isolation approval."
      : "Access-check switching and ownership backfill remain blocked until high-risk counts are reviewed and resolved or explicitly accepted by the operator.",
    "",
    "## Explicit No-Mutation Statement",
    "",
    "- No ownership backfill is recorded.",
    "- No runtime access checks are recorded as changed.",
    "- No D1/R2 mutation or live R2 listing is recorded.",
    "- No tenant isolation, production readiness, or live billing readiness claim is made.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
    operator: "not_recorded",
    commitSha: "not_recorded",
    evidenceEnvironment: "main",
    evidenceEnvironmentProvided: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") {
      args.input = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--input=")) {
      args.input = arg.slice("--input=".length);
    } else if (arg === "--output") {
      args.output = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--output=")) {
      args.output = arg.slice("--output=".length);
    } else if (arg === "--operator") {
      args.operator = argv[index + 1] || args.operator;
      index += 1;
    } else if (arg === "--commit") {
      args.commitSha = argv[index + 1] || args.commitSha;
      index += 1;
    } else if (arg === "--environment") {
      args.evidenceEnvironment = argv[index + 1] || args.evidenceEnvironment;
      args.evidenceEnvironmentProvided = true;
      index += 1;
    }
  }
  return args;
}

function assertSafeOutputPath(outputPath, repoRoot) {
  const absolute = path.resolve(repoRoot, outputPath);
  const evidenceRoot = path.join(repoRoot, "docs", "tenant-assets", "evidence");
  const relative = path.relative(evidenceRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !absolute.endsWith(".md")) {
    throw new Error("Output path must be a Markdown file under docs/tenant-assets/evidence/.");
  }
  return absolute;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    throw new Error("Usage: node scripts/summarize-tenant-asset-evidence.mjs --input <evidence-export.json> [--output docs/tenant-assets/evidence/<summary>.md]");
  }
  const repoRoot = repoRootFromScript();
  const inputPath = path.resolve(repoRoot, args.input);
  const relativeInputPath = path.relative(repoRoot, inputPath);
  const syntheticFixture = relativeInputPath.split(path.sep).includes("fixtures");
  const evidenceEnvironment = syntheticFixture && !args.evidenceEnvironmentProvided
    ? "synthetic_fixture"
    : args.evidenceEnvironment;
  const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const summary = buildTenantAssetEvidenceSummary(payload, {
    sourcePath: relativeInputPath,
    operator: args.operator,
    commitSha: args.commitSha,
    evidenceEnvironment,
    syntheticFixture,
  });
  const markdown = renderTenantAssetEvidenceSummaryMarkdown(summary);
  if (args.output) {
    const outputPath = assertSafeOutputPath(args.output, repoRoot);
    fs.writeFileSync(outputPath, markdown);
    return;
  }
  process.stdout.write(markdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
