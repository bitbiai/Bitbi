import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRollbackDrill,
  renderRollbackDrillMarkdown,
} from "./lib/rollback-drill.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const drill = createRollbackDrill({
  repoRoot,
  generatedAt: "2026-05-19T12:00:00.000Z",
  releasePlan: {
    source: { mode: "test" },
    changedFiles: ["workers/auth/src/routes/admin.js", "admin/index.html"],
    deploySteps: [
      { id: "auth-worker" },
      { id: "static-site" },
    ],
  },
});

assert.equal(drill.version, "omega-p1-wave9-rollback-drill-v1");
assert.equal(drill.localOnly, true);
assert.equal(drill.nonMutating, true);
assert.equal(drill.rollbackExecuted, false);
assert.equal(drill.cloudflareApiCallsMade, false);
assert.equal(drill.githubApiCallsMade, false);
assert.deepEqual(drill.current.affectedDeployUnits, ["auth-worker", "static-site"]);
assert.equal(drill.placeholders.previousAuthWorkerVersion, "operator to fill");
assert(drill.rollbackChecklist.some((item) => /Do not execute rollback/.test(item)));
assert(drill.postRollbackSmokeChecks.some((item) => /GET \/api\/health/.test(item)));
assert(drill.blockedClaimsAfterRollback.some((claim) => claim.id === "production_readiness" && claim.status === "blocked"));

const markdown = renderRollbackDrillMarkdown(drill);
assert(markdown.includes("BITBI Rollback Drill"));
assert(markdown.includes("Previous Auth Worker version/deploy ID"));
assert(markdown.includes("Post-Rollback Smoke Checks"));
assert(markdown.includes("production_readiness"));

console.log("Rollback drill tests passed.");
