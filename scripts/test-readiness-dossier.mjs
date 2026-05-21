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

assert.equal(dossier.version, "current-baseline-readiness-dossier-v1");
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
assert.equal(dossier.finalVerdict.productionReadiness, "blocked");
assert.equal(dossier.finalVerdict.liveBillingReadiness, "blocked");
assert(dossier.finalVerdict.reasons.includes("Repository configuration is not live Cloudflare proof."));
assert(dossier.finalVerdict.reasons.includes("Live billing canary evidence is pending."));
assert(dossier.finalVerdict.reasons.includes("Tenant isolation is not claimed; ownership backfill/access-switch readiness remain blocked."));
assert(dossier.finalVerdict.reasons.includes("Confirmed legacy media reset readiness remains blocked."));
assert.equal(dossier.latestMigrationCheckpoint.auth, expectedLatestAuthMigration);
assert.equal(dossier.cloudflareResourceModel.mode, "repo_config_only");
assert.equal(dossier.cloudflareResourceModel.liveEvidenceRequired, true);
assert.equal(dossier.liveReadOnlyEvidence.status, "pending");
assert.equal(dossier.liveReadOnlyEvidence.getOnlyByDefault, true);
assert.equal(dossier.billingEvidence.checkoutGrantPolicy, "checkout_creation_does_not_grant_credits");
assert.equal(dossier.tenantEvidence.tenantIsolation, "not_claimed");
assert.equal(dossier.tenantEvidence.ownershipBackfillReadiness, "blocked");
assert.equal(dossier.tenantEvidence.accessSwitchReadiness, "blocked");
assert.equal(dossier.rollbackPlan.rollbackExecuted, false);
assert.deepEqual(dossier.redactionGuarantees, {
  secretValuesPrinted: false,
  rawCookiesPrinted: false,
  rawStripePayloadsPrinted: false,
  rawR2KeysPrinted: false,
  unsafeEvidenceMarkerValuesPrinted: false,
});
assert(dossier.localValidationChecklist.includes("npm run readiness:dossier"));
assert(dossier.localValidationChecklist.includes("npm run release:rc"));
assert(dossier.localValidationChecklist.includes("npm run rc:check"));
assert(dossier.finalVerdict.reasons.some((reason) => /Cloudflare resource/.test(reason)));

const markdown = renderProductionReadinessDossierMarkdown(dossier);
assert(markdown.includes("Production Readiness Execution Dossier"));
assert(markdown.includes("This dossier is local-only and non-mutating."));
assert(markdown.includes("production readiness blocked"));
assert(markdown.includes("live billing readiness blocked"));
assert(markdown.includes("Cloudflare Resource Model"));
assert(markdown.includes("Rollback Drill"));
assert(markdown.includes("Live Read-Only Verification"));
assert(markdown.includes("Tenant isolation: `not_claimed`"));
assert(markdown.includes("Ownership backfill readiness: `blocked`"));
assert(markdown.includes("Access-switch readiness: `blocked`"));
assert(!markdown.includes("super-secret-test-value"));
assert(!markdown.includes("Cookie:"));

console.log("Readiness dossier tests passed.");
