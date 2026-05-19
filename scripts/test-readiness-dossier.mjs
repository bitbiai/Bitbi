import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createProductionReadinessDossier,
  renderProductionReadinessDossierMarkdown,
} from "./lib/readiness-dossier.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const releaseCompat = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "config", "release-compat.json"), "utf8")
);
const expectedLatestAuthMigration = releaseCompat.release.schemaCheckpoints.auth.latest;

const dossier = createProductionReadinessDossier({
  repoRoot,
  generatedAt: "2026-05-19T12:00:00.000Z",
  releasePlan: {
    source: { mode: "test" },
    changedFiles: ["admin/index.html"],
    deploySteps: [{ id: "static-site" }],
    impacts: { static: { required: true } },
    manualPrerequisites: { required: [], optional: [] },
    compatibilityNotes: [],
    consistencyIssues: [],
    isNoop: false,
  },
});

assert.equal(dossier.version, "omega-p1-wave9-readiness-dossier-v1");
assert.equal(dossier.localOnly, true);
assert.equal(dossier.nonMutating, true);
assert.equal(dossier.externalCallsMade, false);
assert.equal(dossier.cloudflareApiCallsMade, false);
assert.equal(dossier.stripeCallsMade, false);
assert.equal(dossier.providerCallsMade, false);
assert.equal(dossier.deployRun, false);
assert.equal(dossier.remoteMigrationsRun, false);
assert.equal(dossier.productionReadiness, "blocked");
assert.equal(dossier.liveBillingReadiness, "blocked");
assert.equal(dossier.latestMigrationCheckpoint.auth, expectedLatestAuthMigration);
assert.equal(dossier.cloudflareResourceModel.mode, "repo_config_only");
assert.equal(dossier.cloudflareResourceModel.liveEvidenceRequired, true);
assert.equal(dossier.liveReadOnlyEvidence.status, "pending");
assert.equal(dossier.liveReadOnlyEvidence.getOnlyByDefault, true);
assert.equal(dossier.billingEvidence.checkoutGrantPolicy, "checkout_creation_does_not_grant_credits");
assert.equal(dossier.tenantEvidence.tenantIsolation, "not_claimed");
assert.equal(dossier.rollbackPlan.rollbackExecuted, false);
assert(dossier.localValidationChecklist.includes("npm run readiness:dossier"));
assert(dossier.localValidationChecklist.includes("npm run release:rc"));
assert(dossier.localValidationChecklist.includes("npm run rc:check"));
assert(dossier.finalVerdict.reasons.some((reason) => /Cloudflare resource/.test(reason)));

const markdown = renderProductionReadinessDossierMarkdown(dossier);
assert(markdown.includes("Production Readiness Execution Dossier"));
assert(markdown.includes("production readiness blocked"));
assert(markdown.includes("Cloudflare Resource Model"));
assert(markdown.includes("Rollback Drill"));
assert(markdown.includes("Live Read-Only Verification"));
assert(!markdown.includes("super-secret-test-value"));
assert(!markdown.includes("Cookie:"));

console.log("Readiness dossier tests passed.");
