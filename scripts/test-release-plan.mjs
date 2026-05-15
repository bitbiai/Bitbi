import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadReleaseCompatibilityContext } from "./lib/release-compat.mjs";
import {
  createReleasePlan,
  createReleasePlanFromRepo,
  runReleaseApply,
} from "./lib/release-plan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function createContext() {
  const context = loadReleaseCompatibilityContext(repoRoot);
  context.repoRoot = repoRoot;
  return context;
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["workers/contact/src/index.js"],
  });
  assert.deepEqual(Object.keys(plan.impacts.workers), ["contact"]);
  assert.equal(plan.impacts.static.required, false);
  assert.deepEqual(plan.schemaApplies, []);
  assert.deepEqual(
    plan.workerDeploys.map((step) => step.worker),
    ["contact"]
  );
  assert(plan.recommendedChecks.includes("npm run test:workers"));
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["admin/index.html"],
  });
  assert.equal(plan.impacts.static.required, true);
  assert.deepEqual(Object.keys(plan.impacts.workers), []);
  assert.deepEqual(plan.deploySteps.map((step) => step.type), ["static"]);
  assert(plan.recommendedChecks.includes("npm run test:static"));
  assert(plan.recommendedChecks.includes("npm run test:asset-version"));
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["workers/auth/src/index.js", "js/pages/admin/main.js"],
  });
  assert.deepEqual(Object.keys(plan.impacts.workers), ["auth"]);
  assert.equal(plan.impacts.static.required, true);
  assert.deepEqual(
    plan.deploySteps.map((step) => step.id),
    ["auth-worker", "static-site"]
  );
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["workers/auth/migrations/0030_harden_ai_video_jobs_phase1b.sql"],
  });
  assert.deepEqual(Object.keys(plan.impacts.schemaCheckpoints), ["auth"]);
  assert.deepEqual(Object.keys(plan.impacts.workers), ["auth"]);
  assert.deepEqual(
    plan.deploySteps.map((step) => step.id),
    ["auth-migrations", "auth-worker"]
  );
  assert.deepEqual(
    plan.schemaApplies.map((step) => step.databaseName),
    ["bitbi-auth-db"]
  );
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["workers/contact/src/index.js"],
  });
  assert.deepEqual(plan.schemaApplies, []);
  assert.deepEqual(plan.workerDeploys.map((step) => step.id), ["contact-worker"]);
  assert.deepEqual(plan.workerDeploys[0].includesWranglerMigrations, ["v1-public-rate-limiter"]);
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["workers/auth/src/index.js"],
  });
  assert(
    plan.manualPrerequisites.required.some((entry) => entry.id === "auth-session-secret")
  );
  assert(
    plan.manualPrerequisites.required.some((entry) => entry.id === "auth-audit-archive-bucket-created")
  );
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["config/release-compat.json"],
  });
  assert.equal(plan.deploySteps.length, 0);
  assert.deepEqual(plan.impacts.validationOnlyFiles, ["config/release-compat.json"]);
  assert.equal(plan.isNoop, true);
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: [
      "tests/workers.spec.js",
      "AGENTS.md",
      "ALPHA_AUDIT_2026_05_15.md",
      "AUDIT_NEXT_LEVEL.md",
      "PHASE0_REMEDIATION_REPORT.md",
      "PHASE0B_REMEDIATION_REPORT.md",
      "PHASE1A_REMEDIATION_REPORT.md",
      "PHASE1B_REMEDIATION_REPORT.md",
      "PHASE1_OBSERVABILITY_BASELINE.md",
      "PHASE_MEMBER_SUBSCRIPTIONS_PRO_REPORT.md",
      "AI_VIDEO_ASYNC_JOB_DESIGN.md",
      "DATA_INVENTORY.md",
      "CURRENT_IMPLEMENTATION_HANDOFF.md",
      "SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md",
      "docs/audits/README.md",
    ],
  });
  assert.equal(plan.deploySteps.length, 0);
  assert.deepEqual(plan.impacts.validationOnlyFiles, [
    "AGENTS.md",
    "AI_VIDEO_ASYNC_JOB_DESIGN.md",
    "ALPHA_AUDIT_2026_05_15.md",
    "AUDIT_NEXT_LEVEL.md",
    "CURRENT_IMPLEMENTATION_HANDOFF.md",
    "DATA_INVENTORY.md",
    "PHASE0B_REMEDIATION_REPORT.md",
    "PHASE0_REMEDIATION_REPORT.md",
    "PHASE1A_REMEDIATION_REPORT.md",
    "PHASE1B_REMEDIATION_REPORT.md",
    "PHASE1_OBSERVABILITY_BASELINE.md",
    "PHASE_MEMBER_SUBSCRIPTIONS_PRO_REPORT.md",
    "SAAS_PROGRESS_AND_CURRENT_STATE_REPORT.md",
    "docs/audits/README.md",
    "tests/workers.spec.js",
  ]);
  assert.equal(plan.isNoop, true);
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["workers/ai/package-lock.json"],
  });
  assert.deepEqual(Object.keys(plan.impacts.workers), ["ai"]);
  assert.deepEqual(
    plan.deploySteps.map((step) => step.id),
    ["ai-worker"]
  );
  assert(plan.recommendedChecks.includes("npm run test:workers"));
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["js/shared/admin-ai-contract.mjs"],
  });
  assert.deepEqual(Object.keys(plan.impacts.workers).sort(), ["ai", "auth"]);
  assert.equal(plan.impacts.static.required, true);
}

{
  const plan = createReleasePlanFromRepo(repoRoot, {
    files: ["js/shared/request-body.mjs"],
  });
  assert.deepEqual(Object.keys(plan.impacts.workers).sort(), ["ai", "auth", "contact"]);
  assert.equal(plan.impacts.static.required, true);
  assert(plan.recommendedChecks.includes("npm run test:workers"));
}

{
  const calls = [];
  const result = runReleaseApply(
    repoRoot,
    {
      files: ["workers/auth/src/index.js"],
    },
    {
      runCommand(command, options) {
        calls.push({ command, ...options });
        return {
          ok: true,
          dryRun: !options.execute,
          pretty: options.cwd ? `(cd ${options.cwd} && ${command.join(" ")})` : command.join(" "),
          command,
          cwd: options.cwd,
          code: 0,
        };
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.deepEqual(
    calls.map((entry) => entry.command.join(" ")),
    ["npx wrangler deploy"]
  );
  assert(calls.every((entry) => entry.execute === false));
}

{
  const calls = [];
  const result = runReleaseApply(
    repoRoot,
    {
      execute: true,
      files: [
        "workers/auth/migrations/0029_add_ai_video_jobs.sql",
        "workers/auth/migrations/0030_harden_ai_video_jobs_phase1b.sql",
        "workers/ai/src/index.js",
        "workers/auth/src/index.js",
      ],
    },
    {
      runCommand(command, options) {
        calls.push({ command, ...options });
        return {
          ok: true,
          dryRun: !options.execute,
          pretty: options.cwd ? `(cd ${options.cwd} && ${command.join(" ")})` : command.join(" "),
          command,
          cwd: options.cwd,
          code: 0,
        };
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, false);
  assert.deepEqual(
    calls.map((entry) => ({
      command: entry.command.join(" "),
      cwd: entry.cwd || null,
      execute: entry.execute,
    })),
    [
      { command: "npm run check:toolchain", cwd: null, execute: true },
      { command: "npm run test:quality-gates", cwd: null, execute: true },
      { command: "npm run check:secrets", cwd: null, execute: true },
      { command: "npm run check:dom-sinks", cwd: null, execute: true },
      { command: "npm run check:route-policies", cwd: null, execute: true },
      { command: "npm run test:operational-readiness", cwd: null, execute: true },
      { command: "npm run check:operational-readiness", cwd: null, execute: true },
      { command: "npm run check:live-health", cwd: null, execute: true },
      { command: "npm run check:live-security-headers", cwd: null, execute: true },
      { command: "npm run check:js", cwd: null, execute: true },
      { command: "npm run test:release-compat", cwd: null, execute: true },
      { command: "npm run validate:release", cwd: null, execute: true },
      { command: "npm run validate:cloudflare-prereqs", cwd: null, execute: true },
      { command: "npm run check:worker-body-parsers", cwd: null, execute: true },
      { command: "npm run check:admin-activity-query-shape", cwd: null, execute: true },
      { command: "npm run check:data-lifecycle", cwd: null, execute: true },
      { command: "npm run test:doc-currentness", cwd: null, execute: true },
      { command: "npm run check:doc-currentness", cwd: null, execute: true },
      { command: "npm run test:readiness-evidence", cwd: null, execute: true },
      { command: "npm run test:main-release-readiness", cwd: null, execute: true },
      { command: "npm run test:ai-cost-gateway", cwd: null, execute: true },
      { command: "npm run test:ai-cost-operations", cwd: null, execute: true },
      { command: "npm run test:workers", cwd: null, execute: true },
      {
        command: "npx wrangler d1 migrations apply bitbi-auth-db --remote",
        cwd: "workers/auth",
        execute: true,
      },
      {
        command: "npx wrangler deploy",
        cwd: "workers/ai",
        execute: true,
      },
      {
        command: "npx wrangler deploy",
        cwd: "workers/auth",
        execute: true,
      },
    ]
  );
}

{
  const context = createContext();
  const plan = createReleasePlan(context, {
    changedFiles: ["workers/auth/migrations/9999_missing.sql"],
    source: { mode: "explicit" },
  });
  assert(
    plan.consistencyIssues.some((issue) =>
      issue.includes('Changed migration file "workers/auth/migrations/9999_missing.sql" no longer exists on disk.')
    )
  );
}

console.log("Release planner tests passed.");
