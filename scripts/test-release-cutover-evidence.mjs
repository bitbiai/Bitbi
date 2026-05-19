import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  collectReleaseCutoverEvidence,
  renderReleaseCutoverEvidenceMarkdown,
  writeReleaseCutoverEvidence,
} from "./lib/release-cutover-evidence.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;
const evidence = collectReleaseCutoverEvidence({ repoRoot });
const markdown = renderReleaseCutoverEvidenceMarkdown(evidence);
const json = JSON.stringify(evidence);

assert.equal(evidence.kind, "bitbi_release_cutover_expected_state");
assert.equal(evidence.localOnly, true);
assert.equal(evidence.nonMutating, true);
assert.equal(evidence.noDeployRun, true);
assert.equal(evidence.noRemoteMigrationsRun, true);
assert.equal(evidence.liveChecksRun, false);
assert.equal(evidence.releaseTruth.source, "config/release-compat.json");
assert.equal(evidence.releaseTruth.latestAuthMigration, "0059_add_data_lifecycle_completion_state.sql");
assert.equal(evidence.releaseTruth.authDatabaseName, "bitbi-auth-db");
assert(Array.isArray(evidence.releasePlan.deploySteps));
assert(Array.isArray(evidence.releasePlan.expectedDeployOrder));
assert(Array.isArray(evidence.releasePlan.recommendedChecks));
assert(evidence.blockedClaims.some((claim) => claim.id === "production_readiness" && claim.status === "BLOCKED"));
assert(evidence.blockedClaims.some((claim) => claim.id === "live_billing_readiness" && claim.status === "BLOCKED"));
assert(evidence.rolloutWarnings.some((warning) => /did not deploy/i.test(warning)));
assert.match(evidence.repo.worktreeClassification, /^(clean|dirty_blocked_for_actual_cutover_evidence|unknown_git_unavailable)$/);
if (!evidence.repo.status.clean && evidence.repo.status.available) {
  assert.equal(evidence.repo.actualCutoverEvidenceAllowed, false);
}

const planningEvidence = collectReleaseCutoverEvidence({
  repoRoot,
  allowDirtyPlanning: true,
  generatedAt: "2026-05-18T00:00:00.000Z",
});
if (!planningEvidence.repo.status.clean && planningEvidence.repo.status.available) {
  assert.equal(planningEvidence.repo.worktreeClassification, "dirty_allowed_for_local_planning");
  assert.equal(planningEvidence.repo.actualCutoverEvidenceAllowed, false);
}

assert(markdown.includes("Release Cutover Expected-State Manifest"));
assert(markdown.includes("Latest auth D1 migration"));
assert(markdown.includes("0059_add_data_lifecycle_completion_state.sql"));
assert(markdown.includes("Rollback Placeholders"));
assert(markdown.includes("Production readiness: **BLOCKED**"));
assert(markdown.includes("This manifest is local-only and non-mutating"));
assert(!markdown.includes("sk_live"));
assert(!markdown.includes("whsec_"));
assert(!json.includes("sk_live"));
assert(!json.includes("Bearer "));

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bitbi-cutover-output-"));
  assert.throws(
    () => writeReleaseCutoverEvidence(tmp, "outside.md", "blocked"),
    /docs\/production-readiness\/evidence/
  );
  const output = "docs/production-readiness/evidence/2026-05-18-cutover.md";
  const relativePath = writeReleaseCutoverEvidence(tmp, output, "first");
  assert.equal(relativePath, output);
  assert.equal(fs.readFileSync(path.join(tmp, output), "utf8"), "first");
  assert.throws(
    () => writeReleaseCutoverEvidence(tmp, output, "second"),
    /already exists/
  );
  writeReleaseCutoverEvidence(tmp, output, "second", { force: true });
  assert.equal(fs.readFileSync(path.join(tmp, output), "utf8"), "second");
}

console.log("Release cutover evidence tests passed.");
