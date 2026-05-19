import { spawnSync } from "node:child_process";
import { createReleasePlanFromRepo } from "./release-plan.mjs";
import { collectReleaseCutoverEvidence } from "./release-cutover-evidence.mjs";
import { createProductionReadinessDossier } from "./readiness-dossier.mjs";
import { buildCloudflareResourceModel } from "./cloudflare-resource-model.mjs";
import { buildEvidenceIndex } from "./evidence-index.mjs";
import { createRollbackDrill } from "./rollback-drill.mjs";
import { createRcCheckPlan } from "./rc-check.mjs";

export const RELEASE_CANDIDATE_VERSION = "omega-p1-wave10-release-candidate-v1";

const BLOCKED_CLAIMS = Object.freeze([
  { id: "production_readiness", label: "Production readiness", status: "blocked" },
  { id: "live_billing_readiness", label: "Live billing readiness", status: "blocked" },
  { id: "tenant_isolation", label: "Tenant isolation", status: "not_claimed" },
  { id: "ownership_backfill_readiness", label: "Ownership backfill readiness", status: "blocked" },
  { id: "access_switch_readiness", label: "Access-switch readiness", status: "blocked" },
  { id: "confirmed_legacy_media_reset_readiness", label: "Confirmed legacy media reset readiness", status: "blocked" },
]);

const REMAINING_EVIDENCE_BLOCKERS = Object.freeze([
  "sanitized legacy reset dry-run evidence",
  "manual-review idempotency evidence",
  "live billing canary evidence",
  "production live/manual Cloudflare evidence",
  "remote auth D1 migration verification",
  "Worker deploy evidence",
  "static deploy evidence if affected",
  "post-deploy live read-only evidence",
  "rollback drill placeholders and smoke evidence",
]);

const WAVE_MATRIX = Object.freeze([
  { id: "p0-01", label: "P0-01 main release readiness gate", status: "complete_repo_supported" },
  { id: "p0-02", label: "P0-02 confirmed legacy reset execution gate", status: "complete_default_off" },
  { id: "p0-03", label: "P0-03 sanitized legacy reset dry-run evidence templates", status: "blocked_pending_operator_evidence" },
  { id: "p0-04", label: "P0-04 manual-review idempotency evidence templates", status: "blocked_pending_operator_evidence" },
  { id: "p0-05", label: "P0-05 active documentation drift cleanup", status: "complete_repo_supported" },
  { id: "p1-wave-1", label: "P1 Wave 1 security/cost boundary hardening", status: "complete_repo_supported" },
  { id: "p1-wave-2", label: "P1 Wave 2 release/canary/billing/admin mutation hardening", status: "complete_repo_supported" },
  { id: "p1-wave-3", label: "P1 Wave 3 admin/data/observability/scale hardening", status: "complete_repo_supported" },
  { id: "p1-wave-4", label: "P1 Wave 4 Admin Readiness & Evidence Dashboard", status: "complete_repo_supported" },
  { id: "p1-wave-5", label: "P1 Wave 5 release cutover evidence and live-read-only verification", status: "complete_repo_supported_live_evidence_pending" },
  { id: "p1-wave-6", label: "P1 Wave 6 tenant asset domain/storage evidence expansion", status: "complete_repo_supported_tenant_isolation_unclaimed" },
  { id: "p1-wave-7", label: "P1 Wave 7 Billing Evidence Center / Financial Control Plane", status: "complete_repo_supported_live_billing_blocked" },
  { id: "p1-wave-8", label: "P1 Wave 8 Operator Timeline/Triage and Evidence Index", status: "complete_repo_supported" },
  { id: "p1-wave-9", label: "P1 Wave 9 production readiness execution framework", status: "complete_repo_supported_live_evidence_pending" },
  { id: "p1-wave-10", label: "P1 Wave 10 Release Candidate consolidation", status: "implemented_local_only_candidate" },
  { id: "dependency-hotfixes", label: "Dependency hotfixes for root and Worker package audit blockers", status: "complete_repo_supported" },
]);

function runGit(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return result.status === 0 ? String(result.stdout || "").trim() : null;
}

function getGitState(repoRoot) {
  const status = runGit(repoRoot, ["status", "--short"]);
  const lines = status ? status.split(/\r?\n/).filter(Boolean) : [];
  return {
    branch: runGit(repoRoot, ["branch", "--show-current"]) || "unknown",
    commit: runGit(repoRoot, ["rev-parse", "HEAD"]) || "unknown",
    dirty: lines.length > 0,
    dirtyFileCount: lines.length,
    dirtySample: lines.slice(0, 25),
    classification: lines.length > 0 ? "dirty_local_candidate" : "clean_worktree_candidate",
  };
}

function summarizeReleasePlan(plan) {
  return {
    changedFileCount: (plan.changedFiles || []).length,
    changedFiles: plan.changedFiles || [],
    deployUnits: (plan.deploySteps || []).map((step) => step.id),
    deployOrder: (plan.deploySteps || []).length
      ? (plan.deploySteps || []).map((step) => step.id)
      : ["no runtime deploy steps required"],
    migrationsRequired: (plan.schemaApplies || []).map((step) => ({
      id: step.id,
      databaseName: step.databaseName,
      latestMigration: step.latestMigration,
    })),
    workerDeploys: (plan.workerDeploys || []).map((step) => ({
      id: step.id,
      worker: step.worker,
      workerName: step.workerName,
    })),
    staticDeployRequired: plan.staticDeploy?.required === true || (plan.impacts?.static?.required === true),
    validationOnlyFiles: plan.impacts?.validationOnlyFiles || [],
    uncategorizedFiles: plan.impacts?.uncategorizedFiles || [],
    recommendedChecks: plan.recommendedChecks || [],
    consistencyIssues: plan.consistencyIssues || [],
    isNoop: plan.isNoop === true,
  };
}

function summarizeResourceModel(model) {
  return {
    version: model.version,
    mode: model.mode,
    ok: model.ok === true,
    totalResources: model.summary?.totalResources || 0,
    issueCount: model.summary?.issueCount || 0,
    byClass: model.summary?.byClass || {},
    byStatus: model.summary?.byStatus || {},
    liveEvidenceRequired: model.liveEvidenceRequired === true,
    repoTruthIsLiveProof: model.repoTruthIsLiveProof === true,
    productionReadiness: model.productionReadiness || "blocked",
  };
}

function summarizeEvidenceIndex(index) {
  return {
    ok: index.ok === true,
    mode: index.mode,
    scannedFiles: index.scannedFiles,
    accepted: index.summary?.byClassification?.accepted || 0,
    pending: index.summary?.byClassification?.pending || 0,
    rejectedUnsafe: index.summary?.byClassification?.["rejected/unsafe"] || 0,
    templates: index.summary?.byClassification?.template || 0,
    historical: index.summary?.byClassification?.historical || 0,
    unsafeMarkerCandidates: index.summary?.unsafeCount || 0,
    unsafeReviewSummary: index.unsafeReviewSummary || {
      byTriage: {},
      candidates: [],
    },
    rawValuesPrinted: false,
  };
}

function summarizeDossier(dossier) {
  return {
    version: dossier.version,
    mode: dossier.mode,
    localOnly: dossier.localOnly === true,
    productionReadiness: dossier.productionReadiness || "blocked",
    liveBillingReadiness: dossier.liveBillingReadiness || "blocked",
    finalVerdict: dossier.finalVerdict || { productionReadiness: "blocked", liveBillingReadiness: "blocked" },
  };
}

export function createReleaseCandidateManifest({
  repoRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
  releasePlan = null,
  cloudflareResourceModel = null,
  evidenceIndex = null,
  readinessDossier = null,
  cutoverEvidence = null,
  rollbackDrill = null,
  rcCheckPlan = null,
} = {}) {
  const git = getGitState(repoRoot);
  const plan = releasePlan || createReleasePlanFromRepo(repoRoot);
  const resourceModel = cloudflareResourceModel || buildCloudflareResourceModel({ repoRoot, generatedAt });
  const index = evidenceIndex || buildEvidenceIndex({ repoRoot, generatedAt });
  const dossier = readinessDossier || createProductionReadinessDossier({
    repoRoot,
    generatedAt,
    releasePlan: plan,
    cloudflareResourceModel: resourceModel,
    evidenceIndex: index,
    cutoverEvidence,
    rollbackDrill,
  });
  const cutover = cutoverEvidence || collectReleaseCutoverEvidence({
    repoRoot,
    generatedAt,
    allowDirtyPlanning: true,
    releasePlan: plan,
  });
  const rollback = rollbackDrill || createRollbackDrill({ repoRoot, generatedAt, releasePlan: plan });
  const checkPlan = rcCheckPlan || createRcCheckPlan({ generatedAt });

  const releaseCandidateStatus = git.dirty
    ? "blocked_until_clean_worktree_and_ci_pass"
    : "allowed_for_code_merge_or_deploy_preparation_only";

  return {
    ok: true,
    version: RELEASE_CANDIDATE_VERSION,
    generatedAt,
    mode: "local_only_release_candidate_manifest",
    localOnly: true,
    nonMutating: true,
    externalCallsMade: false,
    cloudflareApiCallsMade: false,
    stripeCallsMade: false,
    providerCallsMade: false,
    deployRun: false,
    remoteMigrationsRun: false,
    repo: git,
    audits: {
      root: { status: "operator_to_run_or_attach", command: "npm audit --audit-level=low" },
      workers: [
        { worker: "auth", status: "operator_to_run_or_attach", command: "npm --prefix workers/auth audit --audit-level=low" },
        { worker: "contact", status: "operator_to_run_or_attach", command: "npm --prefix workers/contact audit --audit-level=low" },
        { worker: "ai", status: "operator_to_run_or_attach", command: "npm --prefix workers/ai audit --audit-level=low" },
      ],
    },
    releasePlan: summarizeReleasePlan(plan),
    latestMigrationCheckpoint: {
      auth: dossier.latestMigrationCheckpoint?.auth || cutover.releaseTruth?.latestAuthMigration || "0058_add_legacy_media_reset_actions.sql",
      databaseName: dossier.latestMigrationCheckpoint?.databaseName || cutover.releaseTruth?.authDatabaseName || "bitbi-auth-db",
      remoteVerificationRequired: true,
    },
    cloudflareResourceModel: summarizeResourceModel(resourceModel),
    readinessDossier: summarizeDossier(dossier),
    evidenceIndex: summarizeEvidenceIndex(index),
    cutoverEvidence: {
      kind: cutover.kind,
      localOnly: cutover.localOnly === true,
      nonMutating: cutover.nonMutating === true,
      blockedClaims: cutover.blockedClaims || [],
      rollbackPlaceholders: cutover.rollbackPlaceholders || [],
    },
    rollbackDrill: {
      version: rollback.version,
      rollbackExecuted: rollback.rollbackExecuted === true,
      affectedDeployUnits: rollback.current?.affectedDeployUnits || [],
      placeholders: rollback.placeholders || {},
      postRollbackSmokeChecks: rollback.postRollbackSmokeChecks || [],
    },
    rcValidationMatrix: {
      command: "npm run rc:check",
      mode: checkPlan.mode,
      commandCount: checkPlan.commandCount,
      categories: checkPlan.summary?.byCategory || {},
      runsByDefault: checkPlan.defaultRunsCommands === true,
      executeOptIn: checkPlan.executionOptInFlag,
      liveUrlsRequired: checkPlan.liveUrlsRequired === true,
      secretsRequired: checkPlan.secretsRequired === true,
    },
    waveCompletionMatrix: WAVE_MATRIX,
    blockedClaims: BLOCKED_CLAIMS,
    remainingEvidenceBlockers: [...REMAINING_EVIDENCE_BLOCKERS],
    goNoGo: {
      repoChecks: "pending_operator_run",
      deployReadiness: git.dirty
        ? "blocked_dirty_worktree"
        : "blocked_until_clean_checks_and_operator_evidence",
      productionReadiness: "blocked",
      liveBillingReadiness: "blocked",
      releaseCandidate: releaseCandidateStatus,
      codeMergeOrDeployPreparation: git.dirty ? "blocked_until_clean_worktree" : "allowed_if_ci_passes_and_review_approves",
      productionGoNoGo: "NO_GO_for_production_readiness_claim",
      notes: [
        "Release Candidate artifacts support code merge/deploy preparation only.",
        "Production readiness remains blocked until live/manual evidence is collected and reviewed.",
        "Live billing, tenant isolation, ownership backfill, access-switch, and confirmed reset readiness remain blocked or unclaimed.",
      ],
    },
    operatorNextActions: [
      "Run npm run rc:check and then the exact commands it prints or execute the matrix only with explicit --run.",
      "Generate npm run release:rc:markdown for the final RC handoff packet.",
      "Generate cutover evidence, readiness dossier, Cloudflare resource model, rollback drill, and evidence index artifacts.",
      "Review evidence-index unsafe marker candidates by file path and marker ID only.",
      "Deploy affected units only after approval, clean checks, and required operator evidence.",
      "Collect post-deploy live read-only evidence after deploy; keep blocked claims blocked until evidence proves otherwise.",
    ],
    redactionGuarantees: {
      secretValuesPrinted: false,
      rawCookiesPrinted: false,
      rawAuthorizationHeadersPrinted: false,
      rawStripePayloadsPrinted: false,
      rawStripeSignaturesPrinted: false,
      rawR2KeysPrinted: false,
      unsafeEvidenceMarkerValuesPrinted: false,
    },
  };
}

function rowsFromCounts(counts) {
  const entries = Object.entries(counts || {}).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) return "- none";
  return entries.map(([key, value]) => `- ${key}: ${value}`).join("\n");
}

function list(values) {
  if (!values || values.length === 0) return "- none";
  return values.map((value) => `- ${typeof value === "string" ? value : JSON.stringify(value)}`).join("\n");
}

export function renderReleaseCandidateMarkdown(manifest) {
  const waves = manifest.waveCompletionMatrix
    .map((entry) => `| ${entry.id} | ${entry.label} | ${entry.status} |`)
    .join("\n");
  const blocked = manifest.blockedClaims
    .map((claim) => `- ${claim.label}: **${claim.status}**`)
    .join("\n");
  const candidates = (manifest.evidenceIndex.unsafeReviewSummary?.candidates || [])
    .slice(0, 50)
    .map((candidate) => `| \`${candidate.path}\` | ${candidate.markerIds.join(", ")} | ${candidate.triage} |`)
    .join("\n");

  return `# BITBI Release Candidate Go/No-Go Manifest

Generated: ${manifest.generatedAt}

Final status: **${manifest.goNoGo.productionGoNoGo}**

This manifest is local-only and non-mutating. It did not deploy, run remote migrations, call Cloudflare/Stripe/provider APIs, list live R2, mutate D1/R2/Queues/GitHub, create checkout sessions, issue refunds, mutate subscriptions, execute reset, backfill ownership, or switch tenant access checks.

## Repository

- Branch: \`${manifest.repo.branch}\`
- Commit: \`${manifest.repo.commit}\`
- Worktree classification: **${manifest.repo.classification}**
- Dirty file count: **${manifest.repo.dirtyFileCount}**

## Go/No-Go

- Repo checks: **${manifest.goNoGo.repoChecks}**
- Deploy readiness: **${manifest.goNoGo.deployReadiness}**
- Release candidate: **${manifest.goNoGo.releaseCandidate}**
- Code merge/deploy preparation: **${manifest.goNoGo.codeMergeOrDeployPreparation}**
- Production readiness: **${manifest.goNoGo.productionReadiness}**
- Live billing readiness: **${manifest.goNoGo.liveBillingReadiness}**

## Release Plan

- Changed files: **${manifest.releasePlan.changedFileCount}**
- Deploy units: ${manifest.releasePlan.deployUnits.map((unit) => `\`${unit}\``).join(", ") || "`none`"}
- Deploy order:
${list(manifest.releasePlan.deployOrder)}
- Auth D1 migration checkpoint: \`${manifest.latestMigrationCheckpoint.auth}\`
- Remote migration verification required: **${manifest.latestMigrationCheckpoint.remoteVerificationRequired}**

## Cloudflare Resource Model

- Mode: **${manifest.cloudflareResourceModel.mode}**
- Repo OK: **${manifest.cloudflareResourceModel.ok}**
- Total resources: **${manifest.cloudflareResourceModel.totalResources}**
- Issue count: **${manifest.cloudflareResourceModel.issueCount}**
- Repo truth is live proof: **${manifest.cloudflareResourceModel.repoTruthIsLiveProof}**
- Live evidence required: **${manifest.cloudflareResourceModel.liveEvidenceRequired}**

### Resource Status Counts

${rowsFromCounts(manifest.cloudflareResourceModel.byStatus)}

## Evidence Index

- Files scanned: **${manifest.evidenceIndex.scannedFiles}**
- Accepted: **${manifest.evidenceIndex.accepted}**
- Pending: **${manifest.evidenceIndex.pending}**
- Rejected/unsafe: **${manifest.evidenceIndex.rejectedUnsafe}**
- Templates: **${manifest.evidenceIndex.templates}**
- Historical: **${manifest.evidenceIndex.historical}**
- Unsafe marker candidate files: **${manifest.evidenceIndex.unsafeMarkerCandidates}**
- Raw marker values printed: **${manifest.evidenceIndex.rawValuesPrinted}**

### Unsafe Marker Review Summary

${rowsFromCounts(manifest.evidenceIndex.unsafeReviewSummary?.byTriage)}

| Path | Marker IDs | Triage |
| --- | --- | --- |
${candidates || "| none | - | - |"}

## RC Validation Matrix

- Command: \`${manifest.rcValidationMatrix.command}\`
- Mode: **${manifest.rcValidationMatrix.mode}**
- Runs by default: **${manifest.rcValidationMatrix.runsByDefault}**
- Execute opt-in: \`${manifest.rcValidationMatrix.executeOptIn}\`
- Command count: **${manifest.rcValidationMatrix.commandCount}**

## P0/P1 Completion Matrix

| ID | Scope | Status |
| --- | --- | --- |
${waves}

## Blocked Claims

${blocked}

## Remaining Evidence Blockers

${list(manifest.remainingEvidenceBlockers)}

## Operator Next Actions

${list(manifest.operatorNextActions)}

## Redaction Guarantees

${Object.entries(manifest.redactionGuarantees).map(([key, value]) => `- ${key}: **${value}**`).join("\n")}
`;
}
