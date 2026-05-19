import { spawnSync } from "node:child_process";
import { createReleasePlanFromRepo } from "./release-plan.mjs";

export const ROLLBACK_DRILL_VERSION = "omega-p1-wave9-rollback-drill-v1";

function runGit(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return result.status === 0 ? String(result.stdout || "").trim() : null;
}

function summarizeDeployUnits(plan) {
  const deploySteps = Array.isArray(plan.deploySteps) ? plan.deploySteps : [];
  if (!deploySteps.length) return ["no runtime deploy steps required by current diff"];
  return deploySteps.map((step) => step.id);
}

export function createRollbackDrill({ repoRoot = process.cwd(), generatedAt = new Date().toISOString(), releasePlan = null } = {}) {
  const plan = releasePlan || createReleasePlanFromRepo(repoRoot);
  const currentCommit = runGit(repoRoot, ["rev-parse", "HEAD"]) || "unknown";
  const previousCommit = runGit(repoRoot, ["rev-parse", "HEAD^"]) || "operator to fill";
  return {
    ok: true,
    version: ROLLBACK_DRILL_VERSION,
    generatedAt,
    localOnly: true,
    nonMutating: true,
    rollbackExecuted: false,
    cloudflareApiCallsMade: false,
    githubApiCallsMade: false,
    current: {
      branch: runGit(repoRoot, ["branch", "--show-current"]) || "unknown",
      commit: currentCommit,
      releasePlanSource: plan.source || { mode: "unknown" },
      affectedDeployUnits: summarizeDeployUnits(plan),
      changedFiles: plan.changedFiles || [],
    },
    placeholders: {
      previousCommit,
      previousAuthWorkerVersion: "operator to fill",
      previousAiWorkerVersion: "operator to fill",
      previousContactWorkerVersion: "operator to fill",
      previousStaticArtifact: "operator to fill",
      rollbackOwner: "operator to fill",
      evidenceLocation: "docs/production-readiness/evidence/",
    },
    decisionCriteria: [
      "Customer-impacting auth/API regression after deploy.",
      "Static Pages deploy breaks critical public/member navigation.",
      "Auth Worker deploy fails health/readiness smoke checks.",
      "Provider, billing, reset, backfill, or access-switch risk appears unexpectedly.",
      "Operator cannot collect required post-deploy read-only evidence within the approved window.",
    ],
    rollbackChecklist: [
      "Do not execute rollback from this drill artifact.",
      "Identify exact previous Worker versions and previous static artifact before deploy.",
      "Confirm whether remote D1 migrations are forward-compatible before any Worker rollback.",
      "Use approved Cloudflare/GitHub release channels only if rollback is authorized.",
      "Run post-rollback smoke checks and save sanitized evidence.",
    ],
    postRollbackSmokeChecks: [
      "GET /api/health returns bitbi-auth health contract.",
      "Public homepage loads with current asset references.",
      "Admin readiness endpoint remains blocked/read-only.",
      "Billing evidence remains blocked and does not expose secrets.",
      "Operator timeline remains bounded/redacted.",
    ],
    blockedClaimsAfterRollback: [
      { id: "production_readiness", status: "blocked" },
      { id: "live_billing_readiness", status: "blocked" },
      { id: "tenant_isolation", status: "not_claimed" },
      { id: "ownership_backfill_readiness", status: "blocked" },
      { id: "access_switch_readiness", status: "blocked" },
      { id: "confirmed_legacy_media_reset_readiness", status: "blocked" },
    ],
  };
}

function list(values) {
  return values.map((value) => `- ${value}`).join("\n");
}

export function renderRollbackDrillMarkdown(drill) {
  return `# BITBI Rollback Drill

Generated: ${drill.generatedAt}

This is a local-only, non-mutating rollback readiness artifact. It did not execute rollback, call Cloudflare/GitHub APIs, deploy, run remote migrations, mutate D1/R2/Queues, or change Stripe/provider state.

## Current Release Context

- Branch: \`${drill.current.branch}\`
- Current commit: \`${drill.current.commit}\`
- Affected deploy units: ${drill.current.affectedDeployUnits.map((unit) => `\`${unit}\``).join(", ")}

## Placeholders To Complete Before Deploy

- Previous commit: \`${drill.placeholders.previousCommit}\`
- Previous Auth Worker version/deploy ID: \`${drill.placeholders.previousAuthWorkerVersion}\`
- Previous AI Worker version/deploy ID: \`${drill.placeholders.previousAiWorkerVersion}\`
- Previous Contact Worker version/deploy ID: \`${drill.placeholders.previousContactWorkerVersion}\`
- Previous static artifact/deploy ID: \`${drill.placeholders.previousStaticArtifact}\`
- Rollback owner: \`${drill.placeholders.rollbackOwner}\`
- Evidence location: \`${drill.placeholders.evidenceLocation}\`

## Decision Criteria

${list(drill.decisionCriteria)}

## Rollback Checklist

${list(drill.rollbackChecklist)}

## Post-Rollback Smoke Checks

${list(drill.postRollbackSmokeChecks)}

## Blocked Claims After Rollback

${drill.blockedClaimsAfterRollback.map((claim) => `- ${claim.id}: **${claim.status}**`).join("\n")}
`;
}
