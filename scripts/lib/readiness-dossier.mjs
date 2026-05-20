import { spawnSync } from "node:child_process";
import { createReleasePlanFromRepo } from "./release-plan.mjs";
import { collectReleaseCutoverEvidence } from "./release-cutover-evidence.mjs";
import { buildEvidenceIndex } from "./evidence-index.mjs";
import { buildCloudflareResourceModel } from "./cloudflare-resource-model.mjs";
import { createRollbackDrill } from "./rollback-drill.mjs";

export const READINESS_DOSSIER_VERSION = "current-baseline-readiness-dossier-v1";

const VALIDATION_COMMANDS = Object.freeze([
  "git status --short",
  "npm audit --audit-level=low",
  "npm --prefix workers/auth audit --audit-level=low",
  "npm --prefix workers/contact audit --audit-level=low",
  "npm --prefix workers/ai audit --audit-level=low",
  "npm run check:js",
  "npm run check:secrets",
  "npm run check:route-policies",
  "npm run check:dom-sinks",
  "npm run test:workers",
  "npm run test:static",
  "npm run test:readiness-evidence",
  "npm run test:live-canary",
  "npm run test:main-release-readiness",
  "npm run check:doc-currentness",
  "npm run test:doc-currentness",
  "npm run validate:release",
  "npm run test:release-compat",
  "npm run test:release-plan",
  "npm run release:plan",
  "npm run release:cutover-evidence",
  "npm run release:cutover-evidence:markdown",
  "npm run evidence:index",
  "npm run evidence:index:markdown",
  "npm run test:cloudflare-resource-model",
  "npm run cloudflare:resource-model",
  "npm run cloudflare:resource-model:markdown",
  "npm run test:readiness-dossier",
  "npm run readiness:dossier",
  "npm run readiness:dossier:markdown",
  "npm run test:rollback-drill",
  "npm run release:rollback-drill",
  "npm run test:release-rc",
  "npm run release:rc",
  "npm run release:rc:markdown",
  "npm run test:rc-check",
  "npm run rc:check",
  "git diff --check",
]);

function runGit(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return result.status === 0 ? String(result.stdout || "").trim() : null;
}

function getStatusSummary(repoRoot) {
  const status = runGit(repoRoot, ["status", "--short"]);
  const lines = status ? status.split(/\r?\n/).filter(Boolean) : [];
  return {
    available: status !== null,
    clean: status === "",
    total: lines.length,
    sample: lines.slice(0, 20),
  };
}

function summarizeReleasePlan(plan) {
  return {
    source: plan.source || { mode: "unknown" },
    changedFiles: plan.changedFiles || [],
    deployUnits: (plan.deploySteps || []).map((step) => step.id),
    deployOrder: (plan.deploySteps || []).length
      ? (plan.deploySteps || []).map((step) => step.id)
      : ["no runtime deploy steps required"],
    impacts: plan.impacts || {},
    manualPrerequisites: plan.manualPrerequisites || { required: [], optional: [] },
    compatibilityNotes: plan.compatibilityNotes || [],
    consistencyIssues: plan.consistencyIssues || [],
    isNoop: plan.isNoop === true,
  };
}

function summarizeCutover(cutover) {
  return {
    kind: cutover.kind,
    localOnly: cutover.localOnly,
    nonMutating: cutover.nonMutating,
    latestAuthMigration: cutover.releaseTruth?.latestAuthMigration || null,
    authDatabaseName: cutover.releaseTruth?.authDatabaseName || null,
    deployUnits: cutover.releasePlan?.deployUnits || [],
    expectedDeployOrder: cutover.releasePlan?.expectedDeployOrder || [],
    blockedClaims: cutover.blockedClaims || [],
    rollbackPlaceholders: cutover.rollbackPlaceholders || [],
  };
}

function summarizeEvidenceIndex(index) {
  return {
    ok: index.ok === true,
    mode: index.mode,
    scannedFiles: index.scannedFiles,
    summary: index.summary,
    liveR2Listed: index.liveR2Listed === true,
    externalCallsMade: index.externalCallsMade === true,
    secretsPrinted: index.secretsPrinted === true,
  };
}

export function createProductionReadinessDossier({
  repoRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
  releasePlan = null,
  cloudflareResourceModel = null,
  evidenceIndex = null,
  cutoverEvidence = null,
  rollbackDrill = null,
} = {}) {
  const plan = releasePlan || createReleasePlanFromRepo(repoRoot);
  const resourceModel = cloudflareResourceModel || buildCloudflareResourceModel({ repoRoot, generatedAt });
  const index = evidenceIndex || buildEvidenceIndex({ repoRoot, generatedAt });
  const cutover = cutoverEvidence || collectReleaseCutoverEvidence({
    repoRoot,
    generatedAt,
    allowDirtyPlanning: true,
    releasePlan: plan,
  });
  const rollback = rollbackDrill || createRollbackDrill({ repoRoot, generatedAt, releasePlan: plan });
  const latestAuthMigration = cutover.releaseTruth?.latestAuthMigration || null;

  const blockedReasons = [
    "Repository configuration is not live Cloudflare proof.",
    "Cloudflare resource and dashboard-managed prerequisites require operator live/manual evidence.",
    "Remote auth D1 migration status must be verified before dependent Auth Worker deploy.",
    "Worker/static deploy evidence and post-deploy smoke evidence are not attached by this local dossier.",
    "Live billing canary evidence is pending.",
    "Tenant isolation is not claimed; ownership backfill/access-switch readiness remain blocked.",
    "Confirmed legacy media reset readiness remains blocked.",
  ];

  return {
    ok: true,
    version: READINESS_DOSSIER_VERSION,
    generatedAt,
    mode: "local_only_dossier",
    localOnly: true,
    nonMutating: true,
    externalCallsMade: false,
    cloudflareApiCallsMade: false,
    stripeCallsMade: false,
    providerCallsMade: false,
    deployRun: false,
    remoteMigrationsRun: false,
    productionReadiness: "blocked",
    liveBillingReadiness: "blocked",
    repo: {
      branch: runGit(repoRoot, ["branch", "--show-current"]) || "unknown",
      commit: runGit(repoRoot, ["rev-parse", "HEAD"]) || "unknown",
      previousCommit: runGit(repoRoot, ["rev-parse", "HEAD^"]) || null,
      status: getStatusSummary(repoRoot),
    },
    releasePlan: summarizeReleasePlan(plan),
    latestMigrationCheckpoint: {
      auth: latestAuthMigration,
      databaseName: cutover.releaseTruth?.authDatabaseName || "bitbi-auth-db",
      remoteVerificationRequired: true,
    },
    cloudflareResourceModel: {
      version: resourceModel.version,
      ok: resourceModel.ok,
      mode: resourceModel.mode,
      summary: resourceModel.summary,
      liveEvidenceRequired: resourceModel.liveEvidenceRequired,
      repoTruthIsLiveProof: resourceModel.repoTruthIsLiveProof,
      issueCount: resourceModel.issues.length,
    },
    audits: {
      status: "operator_to_run_or_attach",
      guidance: [
        "npm audit --audit-level=low",
        "npm --prefix workers/auth audit --audit-level=low",
        "npm --prefix workers/contact audit --audit-level=low",
        "npm --prefix workers/ai audit --audit-level=low",
      ],
    },
    localValidationChecklist: VALIDATION_COMMANDS,
    cutoverEvidence: summarizeCutover(cutover),
    liveReadOnlyEvidence: {
      status: "pending",
      defaultMode: "skipped_without_explicit_urls",
      command: "npm run readiness:live-readonly -- --static-url https://bitbi.ai --auth-worker-url https://bitbi.ai --admin-readiness-url https://bitbi.ai",
      getOnlyByDefault: true,
      adminCookieRedacted: true,
      operatorReviewRequired: true,
    },
    evidenceIndex: summarizeEvidenceIndex(index),
    billingEvidence: {
      status: "blocked",
      canary: "pending_operator_evidence",
      checkoutGrantPolicy: "checkout_creation_does_not_grant_credits",
      webhookPolicy: "verified_webhook_or_paid_invoice_required",
    },
    tenantEvidence: {
      resetDryRun: "pending_or_blocked_until_sanitized_evidence",
      manualReviewIdempotency: "pending_or_blocked_until_operator_evidence",
      tenantIsolation: "not_claimed",
      ownershipBackfillReadiness: "blocked",
      accessSwitchReadiness: "blocked",
    },
    adminReadiness: {
      status: "repo_supported_live_proof_pending",
      dashboard: "read_only_copy_only",
    },
    rollbackPlan: {
      version: rollback.version,
      rollbackExecuted: rollback.rollbackExecuted,
      placeholders: rollback.placeholders,
      affectedDeployUnits: rollback.current.affectedDeployUnits,
      decisionCriteria: rollback.decisionCriteria,
      postRollbackSmokeChecks: rollback.postRollbackSmokeChecks,
    },
    finalVerdict: {
      productionReadiness: "blocked",
      liveBillingReadiness: "blocked",
      reasons: blockedReasons,
    },
    redactionGuarantees: {
      secretValuesPrinted: false,
      rawCookiesPrinted: false,
      rawStripePayloadsPrinted: false,
      rawR2KeysPrinted: false,
      unsafeEvidenceMarkerValuesPrinted: false,
    },
  };
}

function countRows(counts) {
  const entries = Object.entries(counts || {}).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) return "- none";
  return entries.map(([key, value]) => `- ${key}: ${value}`).join("\n");
}

function list(values) {
  if (!values || values.length === 0) return "- none";
  return values.map((value) => `- \`${value}\``).join("\n");
}

export function renderProductionReadinessDossierMarkdown(dossier) {
  return `# BITBI Production Readiness Execution Dossier

Generated: ${dossier.generatedAt}

Final verdict: **production readiness ${dossier.finalVerdict.productionReadiness}; live billing readiness ${dossier.finalVerdict.liveBillingReadiness}**

This dossier is local-only and non-mutating. It did not deploy, run remote migrations, call Cloudflare/Stripe/provider APIs, list live R2, mutate D1/R2/Queues/GitHub, create checkout sessions, issue refunds, mutate subscriptions, execute reset, backfill ownership, or switch tenant access checks.

## Repository

- Branch: \`${dossier.repo.branch}\`
- Commit: \`${dossier.repo.commit}\`
- Previous commit placeholder/source: \`${dossier.repo.previousCommit || "operator to fill"}\`
- Worktree clean: \`${dossier.repo.status.clean}\`
- Worktree entries: \`${dossier.repo.status.total}\`

## Release Plan

- Source: \`${dossier.releasePlan.source?.mode || "unknown"}\`
- No-op: \`${dossier.releasePlan.isNoop}\`
- Deploy order:
${list(dossier.releasePlan.deployOrder)}

## Latest Migration Checkpoint

- Auth D1 migration: \`${dossier.latestMigrationCheckpoint.auth}\`
- Auth D1 database: \`${dossier.latestMigrationCheckpoint.databaseName}\`
- Remote verification required: \`${dossier.latestMigrationCheckpoint.remoteVerificationRequired}\`

## Cloudflare Resource Model

- Version: \`${dossier.cloudflareResourceModel.version}\`
- Mode: \`${dossier.cloudflareResourceModel.mode}\`
- Repo model OK: \`${dossier.cloudflareResourceModel.ok}\`
- Repo truth is live proof: \`${dossier.cloudflareResourceModel.repoTruthIsLiveProof}\`
- Live evidence required: \`${dossier.cloudflareResourceModel.liveEvidenceRequired}\`
- Issue count: \`${dossier.cloudflareResourceModel.issueCount}\`

### Resource Status Counts

${countRows(dossier.cloudflareResourceModel.summary.byStatus)}

## Evidence Index

- Mode: \`${dossier.evidenceIndex.mode}\`
- Files scanned: \`${dossier.evidenceIndex.scannedFiles}\`
- Unsafe marker candidate files: \`${dossier.evidenceIndex.summary?.unsafeCount || 0}\`
- Live R2 listed: \`${dossier.evidenceIndex.liveR2Listed}\`
- External calls made: \`${dossier.evidenceIndex.externalCallsMade}\`

## Live Read-Only Verification

- Status: **${dossier.liveReadOnlyEvidence.status}**
- Default mode: \`${dossier.liveReadOnlyEvidence.defaultMode}\`
- GET-only by default: \`${dossier.liveReadOnlyEvidence.getOnlyByDefault}\`
- Admin cookie redacted: \`${dossier.liveReadOnlyEvidence.adminCookieRedacted}\`
- Command: \`${dossier.liveReadOnlyEvidence.command}\`

## Rollback Drill

- Rollback executed: \`${dossier.rollbackPlan.rollbackExecuted}\`
- Affected deploy units: ${dossier.rollbackPlan.affectedDeployUnits.map((unit) => `\`${unit}\``).join(", ")}
- Rollback owner: \`${dossier.rollbackPlan.placeholders.rollbackOwner}\`
- Previous Auth Worker version: \`${dossier.rollbackPlan.placeholders.previousAuthWorkerVersion}\`
- Previous static artifact: \`${dossier.rollbackPlan.placeholders.previousStaticArtifact}\`

## Billing And Tenant Evidence

- Billing status: **${dossier.billingEvidence.status}**
- Billing canary: \`${dossier.billingEvidence.canary}\`
- Tenant isolation: \`${dossier.tenantEvidence.tenantIsolation}\`
- Ownership backfill readiness: \`${dossier.tenantEvidence.ownershipBackfillReadiness}\`
- Access-switch readiness: \`${dossier.tenantEvidence.accessSwitchReadiness}\`

## Validation Checklist

${list(dossier.localValidationChecklist)}

## Final Blockers

${dossier.finalVerdict.reasons.map((reason) => `- ${reason}`).join("\n")}

## Redaction Guarantees

${Object.entries(dossier.redactionGuarantees).map(([key, value]) => `- ${key}: \`${value}\``).join("\n")}
`;
}
