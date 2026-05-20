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

function safetyFor(files, options = {}) {
  const plan = createReleasePlanFromRepo(repoRoot, { files });
  return {
    plan,
    safety: evaluateStaticDeploySafety(plan, options),
  };
}

function guard(args, options = {}) {
  return spawnSync(
    process.execPath,
    ["scripts/check-static-deploy-safety.mjs", ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ...options.env,
      },
    }
  );
}

function writeJsonFixture(name, value) {
  const fixturePath = path.join(os.tmpdir(), `bitbi-${name}-${process.pid}.json`);
  fs.writeFileSync(fixturePath, typeof value === "string" ? value : JSON.stringify(value), "utf8");
  return fixturePath;
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
  const { safety } = safetyFor(["workers/auth/src/index.js", "admin/index.html"]);
  assert.equal(safety.ok, false);
  assert(safety.reasons.some((reason) => reason.includes("Worker deploys are required")));
  assert(safety.reasons.some((reason) => reason.includes("Non-static deploy steps")));
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

console.log("Static deploy safety tests passed.");
