import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  createReleasePlanFromRepo,
  evaluateStaticDeploySafety,
  STATIC_DEPLOY_DEPENDENCY_ACKNOWLEDGEMENT,
} from "./lib/release-plan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const GUARD_ENV_KEYS = Object.freeze([
  "GITHUB_ACTIONS",
  "GITHUB_EVENT_NAME",
  "BITBI_STATIC_DEPLOY_GUARD_EVENT_NAME",
  "BITBI_STATIC_DEPLOY_GUARD_BASE_REF",
  "BITBI_STATIC_DEPLOY_GUARD_HEAD_REF",
  "BITBI_STATIC_DEPLOY_GUARD_ACK",
  "BITBI_STATIC_DEPLOY_GUARD_FIXTURE",
  "STATIC_DEPLOY_EVENT",
  "STATIC_DEPLOY_BASE_REF",
  "STATIC_DEPLOY_HEAD_REF",
  "STATIC_DEPLOY_ACK",
]);

function safetyFor(files, options = {}) {
  const plan = createReleasePlanFromRepo(repoRoot, { files });
  return {
    plan,
    safety: evaluateStaticDeploySafety(plan, options),
  };
}

function cleanGuardEnv(extraEnv = {}) {
  const env = { ...process.env };
  for (const key of GUARD_ENV_KEYS) delete env[key];
  return {
    ...env,
    ...extraEnv,
  };
}

function guard(args, options = {}) {
  return spawnSync(
    process.execPath,
    ["scripts/check-static-deploy-safety.mjs", ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: cleanGuardEnv(options.env),
    }
  );
}

function writeJsonFixture(name, value) {
  const fixturePath = path.join(os.tmpdir(), `bitbi-${name}-${process.pid}.json`);
  fs.writeFileSync(fixturePath, typeof value === "string" ? value : JSON.stringify(value), "utf8");
  return fixturePath;
}

{
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts["check:static-deploy-safety:github"],
    "node scripts/check-static-deploy-safety.mjs --github-output"
  );
  const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/static.yml"), "utf8");
  assert(workflow.includes("npm run check:static-deploy-safety:github --"));
  assert(!workflow.includes("npm run check:static-deploy-safety -- --base"));
  assert(workflow.includes("Report skipped static deploy"));
  assert(workflow.includes("steps.static_safety.outputs.static_deploy_skipped != 'true'"));
  assert(
    workflow.indexOf("Check static deploy release-plan safety")
      < workflow.indexOf("Setup Pages"),
    "static deploy safety must run before Pages setup"
  );
}

{
  const { safety } = safetyFor(["docs/production-readiness/README.md"]);
  assert.equal(safety.ok, true);
  assert.equal(safety.mode, "validation_only");
  assert.equal(safety.staticRequired, false);
}

{
  const { safety } = safetyFor(["admin/index.html"]);
  assert.equal(safety.ok, true);
  assert.equal(safety.mode, "static_only");
  assert.equal(safety.staticRequired, true);
}

{
  const { plan, safety } = safetyFor([
    "css/pages/index.css",
    "playwright.carousel.config.js",
  ]);
  assert.equal(plan.impacts.static.required, true);
  assert.deepEqual(plan.impacts.validationOnlyFiles, ["playwright.carousel.config.js"]);
  assert.deepEqual(plan.impacts.uncategorizedFiles, []);
  assert.equal(safety.ok, true);
  assert.equal(safety.allowed, true);
  assert.equal(safety.mode, "static_only");
  assert.equal(safety.staticRequired, true);
  assert.equal(safety.acknowledgementAccepted, false);
  assert.equal(safety.bypassedByAcknowledgement, false);
}

{
  const { safety } = safetyFor(["workers/auth/src/index.js", "admin/index.html"]);
  assert.equal(safety.ok, false);
  assert.equal(safety.skipped, false);
  assert.equal(safety.decision, "blocked");
  assert(safety.reasons.some((reason) => reason.includes("Worker deploys are required")));
  assert(safety.reasons.some((reason) => reason.includes("Non-static deploy steps")));
}

{
  const { plan, safety } = safetyFor(
    ["workers/auth/migrations/0062_homepage_hero_external_ffmpeg_and_memvid_stream_previews.sql", "admin/index.html"],
    { eventName: "push" }
  );
  assert.equal(safety.ok, false);
  assert.equal(safety.skipped, true);
  assert.equal(safety.decision, "skipped");
  assert.equal(safety.mode, "push_skipped_non_static_dependencies");
  assert.deepEqual(
    plan.deploySteps.map((step) => step.id),
    ["auth-migrations", "auth-worker", "static-site"]
  );
}

{
  const { plan, safety } = safetyFor(
    [
      "services/homepage-ffmpeg-processor/Dockerfile",
      "services/homepage-ffmpeg-processor/README.md",
      "services/homepage-ffmpeg-processor/package.json",
      "services/homepage-ffmpeg-processor/processor.mjs",
      "admin/index.html",
    ],
    { eventName: "push" }
  );
  assert.equal(safety.ok, false);
  assert.equal(safety.skipped, true);
  assert(safety.serviceDeploys.some((step) => step.service === "homepage-ffmpeg-processor"));
  assert.deepEqual(plan.impacts.uncategorizedFiles, []);
  assert.deepEqual(
    plan.deploySteps.map((step) => step.id),
    ["homepage-ffmpeg-processor", "static-site"]
  );
}

{
  const outputPath = path.join(os.tmpdir(), `bitbi-static-deploy-output-${process.pid}.txt`);
  const summaryPath = path.join(os.tmpdir(), `bitbi-static-deploy-summary-${process.pid}.md`);
  const result = guard([
    "--event-name",
    "push",
    "--files",
    "workers/auth/migrations/0062_homepage_hero_external_ffmpeg_and_memvid_stream_previews.sql,workers/auth/src/routes/homepage-hero-videos.js,services/homepage-ffmpeg-processor/processor.mjs,admin/index.html",
    "--github-output",
  ], {
    env: {
      GITHUB_OUTPUT: outputPath,
      GITHUB_STEP_SUMMARY: summaryPath,
    },
  });
  assert.equal(result.status, 0);
  assert(result.stdout.includes("- Status: skipped"));
  const output = fs.readFileSync(outputPath, "utf8");
  const summary = fs.readFileSync(summaryPath, "utf8");
  fs.rmSync(outputPath, { force: true });
  fs.rmSync(summaryPath, { force: true });
  assert(output.includes("static_deploy_decision=skipped"));
  assert(output.includes("static_deploy_skipped=true"));
  assert(summary.includes("Static deploy skipped because release plan requires non-static deploy steps first."));
  assert(summary.includes("- auth-migrations"));
  assert(summary.includes("- auth-worker"));
  assert(summary.includes("- homepage-ffmpeg-processor"));
  assert(summary.includes("- static-site"));
}

{
  const { safety } = safetyFor(
    ["services/homepage-ffmpeg-processor/processor.mjs"],
    { eventName: "push" }
  );
  assert.equal(safety.ok, false);
  assert.equal(safety.skipped, true);
  assert.equal(safety.staticRequired, false);
  assert(safety.serviceDeploys.some((step) => step.service === "homepage-ffmpeg-processor"));
}

{
  const { safety } = safetyFor(["workers/contact/src/index.js"]);
  assert.equal(safety.ok, false);
  assert(safety.workerDeploys.some((step) => step.worker === "contact"));
}

{
  const { safety } = safetyFor(["workers/ai/src/index.js"]);
  assert.equal(safety.ok, false);
  assert(safety.workerDeploys.some((step) => step.worker === "ai"));
}

{
  const { safety } = safetyFor(["workers/ai/src/index.js", "workers/auth/src/index.js"]);
  assert.equal(safety.ok, false);
  assert.deepEqual(safety.workerDeploys.map((step) => step.worker), ["ai", "auth"]);
}

{
  const { safety } = safetyFor(["workers/auth/migrations/0060_add_app_settings.sql"]);
  assert.equal(safety.ok, false);
  assert(safety.schemaApplies.some((step) => step.checkpoint === "auth"));
  assert(safety.reasons.some((reason) => reason.includes("Schema applies are required")));
}

{
  const { safety } = safetyFor(["unclassified-runtime-coupled-file.example"]);
  assert.equal(safety.ok, false);
  assert(safety.reasons.some((reason) => reason.includes("uncategorized changed files")));
}

{
  const { plan } = safetyFor(["docs/production-readiness/README.md"]);
  const manualPlan = {
    ...plan,
    manualPrerequisites: {
      required: [
        {
          id: "operator-owned-live-prerequisite",
          kind: "operator_evidence",
          summary: "Operator-owned prerequisite for static deploy safety test.",
        },
      ],
      optional: [],
    },
  };
  const safety = evaluateStaticDeploySafety(manualPlan);
  assert.equal(safety.ok, false);
  assert(safety.reasons.some((reason) => reason.includes("Required manual prerequisites are present")));
  const acknowledged = evaluateStaticDeploySafety(manualPlan, {
    eventName: "workflow_dispatch",
    acknowledgement: STATIC_DEPLOY_DEPENDENCY_ACKNOWLEDGEMENT,
  });
  assert.equal(acknowledged.ok, true);
  assert.equal(acknowledged.mode, "workflow_dispatch_acknowledged");
}

{
  const { safety } = safetyFor(
    ["workers/auth/src/index.js", "admin/index.html"],
    {
      eventName: "workflow_dispatch",
      acknowledgement: STATIC_DEPLOY_DEPENDENCY_ACKNOWLEDGEMENT,
    }
  );
  assert.equal(safety.ok, true);
  assert.equal(safety.mode, "workflow_dispatch_acknowledged");
  assert.equal(safety.bypassedByAcknowledgement, true);
}

{
  const { safety } = safetyFor(
    ["workers/auth/src/index.js", "admin/index.html"],
    {
      eventName: "push",
      acknowledgement: STATIC_DEPLOY_DEPENDENCY_ACKNOWLEDGEMENT,
    }
  );
  assert.equal(safety.ok, false);
  assert.equal(safety.skipped, true);
  assert.equal(safety.bypassedByAcknowledgement, false);
}

{
  const { safety } = safetyFor(
    ["workers/auth/src/index.js", "admin/index.html"],
    {
      eventName: "workflow_dispatch",
      acknowledgement: "handled",
    }
  );
  assert.equal(safety.ok, false);
  assert.equal(safety.bypassedByAcknowledgement, false);
}

{
  const malformedPath = writeJsonFixture("malformed-release-plan", "{not-json");
  const result = guard(["--plan-json", malformedPath]);
  fs.rmSync(malformedPath, { force: true });
  assert.notEqual(result.status, 0);
  assert(result.stderr.includes("failed closed"));
}

{
  const incompletePath = writeJsonFixture("incomplete-release-plan", { changedFiles: [] });
  const result = guard(["--plan-json", incompletePath]);
  fs.rmSync(incompletePath, { force: true });
  assert.notEqual(result.status, 0);
  assert(result.stdout.includes("missing required deploy impact fields"));
}

{
  const result = guard(["--event-name", "push", "--head", "HEAD"]);
  assert.notEqual(result.status, 0);
  assert(result.stdout.includes("Missing or zero release-plan base ref"));
  assert(result.stdout.includes("Static Pages deploy blocked"));
}

{
  const result = guard(["--event-name", "push"], {
    env: {
      GITHUB_ACTIONS: "true",
    },
  });
  assert.notEqual(result.status, 0);
  assert(result.stdout.includes("Missing or zero release-plan base ref"));
  assert(result.stdout.includes("Static Pages deploy blocked"));
}

{
  const result = guard(["--event-name", "push", "--files", "docs/production-readiness/README.md"]);
  assert.equal(result.status, 0);
  assert(result.stdout.includes("- Event: push"));
  assert(result.stdout.includes("- Plan source: explicit files=1"));
  assert(result.stdout.includes("- Status: allowed"));
}

{
  const result = guard([
    "--event-name",
    "push",
    "--files",
    "workers/auth/migrations/0062_homepage_hero_external_ffmpeg_and_memvid_stream_previews.sql,admin/index.html",
  ]);
  assert.equal(result.status, 0);
  assert(result.stdout.includes("- Status: skipped"));
  assert(result.stdout.includes("Static deploy skipped because release plan requires non-static deploy steps first."));
  assert(result.stdout.includes("auth-migrations"));
  assert(result.stdout.includes("auth-worker"));
  assert(result.stdout.includes("static-site"));
}

{
  const result = guard(["--event-name", "push", "--base", "HEAD", "--head", "HEAD"]);
  assert.equal(result.status, 0);
  assert(result.stdout.includes("- Event: push"));
  assert(result.stdout.includes("- Plan source: git-diff base=HEAD head=HEAD"));
  assert(result.stdout.includes("- Status: allowed"));
}

{
  const result = guard(["--event-name", "push", "--base", "refs/heads/bitbi-missing-base", "--head", "HEAD"]);
  assert.notEqual(result.status, 0);
  assert(result.stdout.includes("base ref is unavailable"));
}

{
  const result = guard([
    "--event-name",
    "workflow_dispatch",
    "--base",
    "refs/heads/bitbi-missing-base",
    "--head",
    "HEAD",
    "--acknowledgement",
    STATIC_DEPLOY_DEPENDENCY_ACKNOWLEDGEMENT,
  ]);
  assert.equal(result.status, 0);
  assert(result.stdout.includes("workflow_dispatch_acknowledged"));
  assert(result.stdout.includes("Manual acknowledgement: accepted"));
}

{
  const result = guard([
    "--event-name",
    "workflow_dispatch",
    "--base",
    "refs/heads/bitbi-missing-base",
    "--head",
    "HEAD",
    "--acknowledgement",
    "I_CONFIRM_DEPENDENCIES",
  ]);
  assert.notEqual(result.status, 0);
  assert(result.stdout.includes("base ref is unavailable"));
  assert(result.stdout.includes("For workflow_dispatch only"));
}

{
  const result = guard([
    "--event-name",
    "workflow_dispatch",
    "--base",
    "refs/heads/bitbi-missing-base",
    "--head",
    "HEAD",
  ]);
  assert.notEqual(result.status, 0);
  assert(result.stdout.includes("base ref is unavailable"));
  assert(!result.stdout.includes("workflow_dispatch_acknowledged"));
}

{
  const result = guard([
    "--event-name",
    "push",
    "--base",
    "refs/heads/bitbi-missing-base",
    "--head",
    "HEAD",
    "--acknowledgement",
    STATIC_DEPLOY_DEPENDENCY_ACKNOWLEDGEMENT,
  ]);
  assert.notEqual(result.status, 0);
  assert(!result.stdout.includes("workflow_dispatch_acknowledged"));
}

{
  const result = guard(["--files", "docs/production-readiness/README.md"]);
  assert.equal(result.status, 0);
  assert(result.stdout.includes("- Event: local"));
  assert(result.stdout.includes("- Status: allowed"));
}

{
  const result = guard([], {
    env: {
      BITBI_STATIC_DEPLOY_GUARD_EVENT_NAME: "push",
      BITBI_STATIC_DEPLOY_GUARD_BASE_REF: "HEAD",
      BITBI_STATIC_DEPLOY_GUARD_HEAD_REF: "HEAD",
    },
  });
  assert.equal(result.status, 0);
  assert(result.stdout.includes("- Event: push"));
  assert(result.stdout.includes("- Plan source: git-diff base=HEAD head=HEAD"));
}

console.log("Static deploy safety tests passed.");
