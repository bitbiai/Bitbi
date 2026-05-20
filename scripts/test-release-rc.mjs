import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createReleaseCandidateManifest,
  renderReleaseCandidateMarkdown,
} from "./lib/release-candidate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const releaseCompat = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "config", "release-compat.json"), "utf8")
);
const expectedLatestAuthMigration = releaseCompat.release.schemaCheckpoints.auth.latest;

const manifest = createReleaseCandidateManifest({
  repoRoot,
  generatedAt: "2026-05-19T12:00:00.000Z",
  releasePlan: {
    source: { mode: "test" },
    changedFiles: ["admin/index.html", "workers/auth/src/routes/admin.js"],
    deploySteps: [{ id: "auth-worker" }, { id: "static-site" }],
    schemaApplies: [],
    workerDeploys: [{ id: "auth-worker", worker: "auth", workerName: "bitbi-auth" }],
    staticDeploy: { required: true },
    impacts: { static: { required: true }, validationOnlyFiles: [], uncategorizedFiles: [] },
    recommendedChecks: ["npm run rc:check"],
    consistencyIssues: [],
    isNoop: false,
  },
});

assert.equal(manifest.version, "current-baseline-release-candidate-v1");
assert.equal(manifest.localOnly, true);
assert.equal(manifest.nonMutating, true);
assert.equal(manifest.externalCallsMade, false);
assert.equal(manifest.cloudflareApiCallsMade, false);
assert.equal(manifest.stripeCallsMade, false);
assert.equal(manifest.providerCallsMade, false);
assert.equal(manifest.deployRun, false);
assert.equal(manifest.remoteMigrationsRun, false);
assert.equal(manifest.latestMigrationCheckpoint.auth, expectedLatestAuthMigration);
assert.equal(manifest.goNoGo.productionReadiness, "blocked");
assert.equal(manifest.goNoGo.liveBillingReadiness, "blocked");
assert.equal(manifest.goNoGo.productionGoNoGo, "NO_GO_for_production_readiness_claim");
assert.equal(manifest.rcValidationMatrix.command, "npm run rc:check");
assert.equal(manifest.rcValidationMatrix.runsByDefault, false);
assert.equal(manifest.rcValidationMatrix.liveUrlsRequired, false);
assert.equal(manifest.rcValidationMatrix.secretsRequired, false);
assert(manifest.blockedClaims.some((claim) => claim.id === "tenant_isolation" && claim.status === "not_claimed"));
assert(manifest.remainingEvidenceBlockers.includes("live billing canary evidence"));
assert(manifest.currentCapabilityMatrix.some((entry) => entry.id === "production-readiness-framework"));
assert(manifest.currentCapabilityMatrix.some((entry) => entry.id === "release-candidate-framework"));
assert.equal(manifest.redactionGuarantees.unsafeEvidenceMarkerValuesPrinted, false);

const markdown = renderReleaseCandidateMarkdown(manifest);
assert(markdown.includes("Release Candidate Go/No-Go Manifest"));
assert(markdown.includes("NO_GO_for_production_readiness_claim"));
assert(markdown.includes("Release Candidate and Go/No-Go framework"));
assert(markdown.includes("Current Capability Matrix"));
assert(markdown.includes("npm run rc:check"));
assert(markdown.includes("Unsafe Marker Review Summary"));
assert(!markdown.includes("Cookie:"));
assert(!markdown.includes("Authorization:"));
assert(!markdown.includes("super-secret-test-value"));

console.log("Release Candidate manifest tests passed.");
