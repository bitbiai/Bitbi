import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createReleasePlanFromRepo } from "./release-plan.mjs";

export const CUTOVER_EVIDENCE_OUTPUT_DIR = "docs/production-readiness/evidence";

const BLOCKED_CLAIMS = Object.freeze([
  { id: "production_readiness", label: "Production readiness", status: "BLOCKED" },
  { id: "live_billing_readiness", label: "Live billing readiness", status: "BLOCKED" },
  { id: "tenant_isolation", label: "Tenant isolation", status: "NOT CLAIMED" },
  { id: "ownership_backfill_readiness", label: "Ownership backfill readiness", status: "BLOCKED" },
  { id: "access_switch_readiness", label: "Access-switch readiness", status: "BLOCKED" },
  { id: "confirmed_legacy_media_reset_readiness", label: "Confirmed legacy media reset readiness", status: "BLOCKED" },
  { id: "confirmed_media_deletion_reset", label: "Confirmed media deletion/reset", status: "NOT APPROVED" },
]);

const MANUAL_CHECKLIST = Object.freeze([
  "Review this manifest before any deployment.",
  "Run release/preflight checks locally and attach output.",
  "Verify remote auth D1 migrations through the latest release checkpoint before dependent Auth Worker deployment.",
  "Deploy affected Workers/static assets only through approved release channels.",
  "Run live read-only verification after deploy and save sanitized evidence.",
  "Keep live billing, tenant isolation, ownership backfill, access-switch, and confirmed reset claims blocked unless separate evidence proves them.",
]);

const ROLLBACK_PLACEHOLDERS = Object.freeze([
  "Previous Auth Worker version/commit:",
  "Previous AI Worker version/commit:",
  "Previous Contact Worker version/commit:",
  "Previous static Pages artifact/commit:",
  "Rollback owner:",
  "Rollback time window:",
  "Post-rollback smoke test:",
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runGit(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) return null;
  return String(result.stdout || "").trim();
}

function getStatusSummary(repoRoot) {
  const status = runGit(repoRoot, ["status", "--short"]);
  if (status === null || status === "") {
    return {
      available: status !== null,
      clean: status === "",
      total: 0,
      modified: 0,
      added: 0,
      deleted: 0,
      renamed: 0,
      untracked: 0,
      other: 0,
      sample: [],
    };
  }

  const summary = {
    available: true,
    clean: false,
    total: 0,
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    untracked: 0,
    other: 0,
    sample: [],
  };

  for (const line of status.split(/\r?\n/).filter(Boolean)) {
    summary.total += 1;
    const code = line.slice(0, 2);
    if (code === "??") summary.untracked += 1;
    else if (code.includes("M")) summary.modified += 1;
    else if (code.includes("A")) summary.added += 1;
    else if (code.includes("D")) summary.deleted += 1;
    else if (code.includes("R")) summary.renamed += 1;
    else summary.other += 1;
    if (summary.sample.length < 20) summary.sample.push(line);
  }

  return summary;
}

function classifyWorktree(status, allowDirtyPlanning) {
  if (!status.available) return "unknown_git_unavailable";
  if (status.clean) return "clean";
  return allowDirtyPlanning
    ? "dirty_allowed_for_local_planning"
    : "dirty_blocked_for_actual_cutover_evidence";
}

function commandLabel(command) {
  return Array.isArray(command) && command.length > 0 ? command.join(" ") : null;
}

function summarizeDeployStep(step) {
  const base = {
    id: step.id,
    type: step.type,
    command: commandLabel(step.command),
    cwd: step.cwd || null,
  };
  if (step.type === "schema-checkpoint") {
    return {
      ...base,
      checkpoint: step.checkpoint,
      databaseName: step.databaseName,
      latestMigration: step.latestMigration,
      migrationDirectory: step.migrationDirectory,
      workerId: step.workerId,
    };
  }
  if (step.type === "worker") {
    return {
      ...base,
      worker: step.worker,
      workerName: step.workerName,
      wranglerPath: step.wranglerPath,
      includesWranglerMigrations: step.includesWranglerMigrations || [],
    };
  }
  if (step.type === "static") {
    return {
      ...base,
      deploymentModel: step.deploymentModel,
      workflowPath: step.workflowPath,
      applySupported: step.applySupported === true,
    };
  }
  return base;
}

function summarizeImpacts(plan) {
  return {
    workers: Object.fromEntries(
      Object.entries(plan.impacts?.workers || {}).map(([id, data]) => [
        id,
        {
          workerName: data.workerName || id,
          changedFiles: data.changedFiles || [],
          reasons: data.reasons || [],
        },
      ])
    ),
    schemaCheckpoints: Object.fromEntries(
      Object.entries(plan.impacts?.schemaCheckpoints || {}).map(([id, data]) => [
        id,
        {
          databaseName: data.databaseName || null,
          latestMigration: data.latestMigration || null,
          changedFiles: data.changedFiles || [],
          reasons: data.reasons || [],
        },
      ])
    ),
    static: {
      required: plan.impacts?.static?.required === true,
      changedFiles: plan.impacts?.static?.changedFiles || [],
      reasons: plan.impacts?.static?.reasons || [],
      deploymentModel: plan.impacts?.static?.deploymentModel || "github-pages-push-to-main",
      workflowPath: plan.impacts?.static?.workflowPath || ".github/workflows/static.yml",
    },
    validationOnlyFiles: plan.impacts?.validationOnlyFiles || [],
    uncategorizedFiles: plan.impacts?.uncategorizedFiles || [],
  };
}

export function collectReleaseCutoverEvidence(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const generatedAt = options.generatedAt || new Date().toISOString();
  const allowDirtyPlanning = options.allowDirtyPlanning === true;
  const manifest = readJson(path.join(repoRoot, "config", "release-compat.json"));
  const latestAuthMigration = manifest?.release?.schemaCheckpoints?.auth?.latest || null;
  const authDatabaseName = manifest?.release?.schemaCheckpoints?.auth?.databaseName || null;
  const plan = options.releasePlan || createReleasePlanFromRepo(repoRoot, options.releasePlanOptions || {});
  const status = getStatusSummary(repoRoot);
  const worktreeClassification = classifyWorktree(status, allowDirtyPlanning);
  const deploySteps = (plan.deploySteps || []).map(summarizeDeployStep);

  return {
    generatedAt,
    kind: "bitbi_release_cutover_expected_state",
    localOnly: true,
    nonMutating: true,
    noDeployRun: true,
    noRemoteMigrationsRun: true,
    liveChecksRun: false,
    repo: {
      branch: runGit(repoRoot, ["branch", "--show-current"]) || "unknown",
      commit: runGit(repoRoot, ["rev-parse", "HEAD"]) || "unknown",
      status,
      worktreeClassification,
      actualCutoverEvidenceAllowed: worktreeClassification === "clean",
    },
    releaseTruth: {
      source: "config/release-compat.json",
      latestAuthMigration,
      authDatabaseName,
      staticDeploySeparateFromWorkers: true,
    },
    releasePlan: {
      source: plan.source || { mode: "unknown" },
      changedFiles: plan.changedFiles || [],
      isNoop: plan.isNoop === true,
      deploySteps,
      deployUnits: deploySteps.map((step) => step.id),
      expectedDeployOrder: deploySteps.length > 0
        ? deploySteps.map((step) => step.id)
        : ["no runtime deploy steps required"],
      impacted: summarizeImpacts(plan),
      recommendedChecks: plan.recommendedChecks || [],
      compatibilityNotes: plan.compatibilityNotes || [],
      remainingManualSteps: plan.remainingManualSteps || [],
      manualPrerequisites: plan.manualPrerequisites || { required: [], optional: [] },
      consistencyIssues: plan.consistencyIssues || [],
    },
    rolloutWarnings: [
      "Repository release truth is not live deploy proof.",
      "Auth/AI caller-policy provider-cost route changes are paired and order-sensitive when both workers are affected.",
      "Apply required remote auth D1 migrations before dependent Auth Worker deploys.",
      "This manifest did not deploy, migrate, call live endpoints, call Stripe/providers, or mutate Cloudflare/D1/R2/Queues/GitHub.",
    ],
    blockedClaims: BLOCKED_CLAIMS,
    manualOperatorChecklist: MANUAL_CHECKLIST,
    rollbackPlaceholders: ROLLBACK_PLACEHOLDERS,
  };
}

function formatStatusSummary(status) {
  if (!status.available) return "unknown (git unavailable)";
  if (status.clean) return "clean";
  return `dirty (${status.total} entries: ${status.modified} modified, ${status.added} added, ${status.deleted} deleted, ${status.renamed} renamed, ${status.untracked} untracked, ${status.other} other)`;
}

function formatDeployStep(step) {
  if (step.type === "schema-checkpoint") {
    return `- ${step.id}: auth D1 checkpoint \`${step.latestMigration}\` for \`${step.databaseName}\` (command not run: \`${step.command}\`)`;
  }
  if (step.type === "worker") {
    return `- ${step.id}: deploy ${step.worker} Worker \`${step.workerName}\` (command not run: \`${step.command}\`)`;
  }
  if (step.type === "static") {
    return `- ${step.id}: static Pages deploy via \`${step.workflowPath}\` (no browser/API deploy run)`;
  }
  return `- ${step.id}: ${step.type}`;
}

function formatRows(rows, emptyText = "- none") {
  if (!rows || rows.length === 0) return emptyText;
  return rows.map((row) => `- ${row}`).join("\n");
}

export function renderReleaseCutoverEvidenceMarkdown(evidence) {
  const deploySteps = evidence.releasePlan.deploySteps.length > 0
    ? evidence.releasePlan.deploySteps.map(formatDeployStep).join("\n")
    : "- no runtime deploy steps required";

  return `# BITBI Release Cutover Expected-State Manifest

Generated at: ${evidence.generatedAt}

This manifest is local-only and non-mutating. It did not deploy, run remote migrations, call live endpoints, call Stripe/providers, mutate Cloudflare/D1/R2/Queues/GitHub, execute reset/delete, backfill ownership, or switch tenant access checks.

## Repository State

- Branch: \`${evidence.repo.branch}\`
- Commit: \`${evidence.repo.commit}\`
- Worktree: ${formatStatusSummary(evidence.repo.status)}
- Worktree classification: \`${evidence.repo.worktreeClassification}\`
- Actual cutover evidence allowed from this manifest: \`${evidence.repo.actualCutoverEvidenceAllowed}\`

## Release Truth

- Source: \`${evidence.releaseTruth.source}\`
- Latest auth D1 migration: \`${evidence.releaseTruth.latestAuthMigration}\`
- Auth D1 database: \`${evidence.releaseTruth.authDatabaseName}\`
- Static deploy separate from Workers: \`${evidence.releaseTruth.staticDeploySeparateFromWorkers}\`

## Release Plan Snapshot

- Changed-file source: \`${evidence.releasePlan.source?.mode || "unknown"}\`
- Changed files: \`${evidence.releasePlan.changedFiles.length}\`
- No-op / validation-only: \`${evidence.releasePlan.isNoop}\`

### Deploy Order

${deploySteps}

### Recommended Checks

${formatRows(evidence.releasePlan.recommendedChecks.map((check) => `\`${check}\``))}

### Compatibility Notes

${formatRows(evidence.releasePlan.compatibilityNotes)}

### Manual Prerequisites

${formatRows(evidence.releasePlan.manualPrerequisites.required.map((entry) => `${entry.id}: ${entry.summary || entry.kind}`))}

## Blocked Claims

${evidence.blockedClaims.map((claim) => `- ${claim.label}: **${claim.status}**`).join("\n")}

## Manual Operator Checklist

${formatRows(evidence.manualOperatorChecklist)}

## Rollback Placeholders

${formatRows(evidence.rollbackPlaceholders)}

## Final Verdict

Evidence incomplete until an operator records deploy output, remote migration verification, live read-only checks, rollback details, and sanitized manual evidence. Production readiness and live billing readiness remain blocked.
`;
}

export function resolveCutoverEvidenceOutputPath(repoRoot, outputPath, { force = false } = {}) {
  if (!outputPath) throw new Error("An output path is required.");
  const allowedRoot = path.resolve(repoRoot, CUTOVER_EVIDENCE_OUTPUT_DIR);
  const target = path.resolve(repoRoot, outputPath);
  if (target !== allowedRoot && !target.startsWith(`${allowedRoot}${path.sep}`)) {
    throw new Error(`Output path must be under ${CUTOVER_EVIDENCE_OUTPUT_DIR}/`);
  }
  if (fs.existsSync(target) && !force) {
    throw new Error("Output file already exists. Pass --force to overwrite.");
  }
  return target;
}

export function writeReleaseCutoverEvidence(repoRoot, outputPath, content, { force = false } = {}) {
  const target = resolveCutoverEvidenceOutputPath(repoRoot, outputPath, { force });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return path.relative(repoRoot, target).replace(/\\/g, "/");
}
