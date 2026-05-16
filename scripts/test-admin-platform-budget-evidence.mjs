import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  AI_COST_OPERATION_REGISTRY,
} from "../workers/auth/src/lib/ai-cost-operations.js";
import {
  ADMIN_PLATFORM_BUDGET_EVIDENCE_ENDPOINT,
  buildAdminPlatformBudgetEvidenceReport,
} from "../workers/auth/src/lib/admin-platform-budget-evidence.js";

const generatedAt = "2026-05-16T12:00:00.000Z";

function operationIds(items = []) {
  return items.map((item) => item.operationId).filter(Boolean).sort();
}

function gapIds(items = []) {
  return items.map((item) => item.id).filter(Boolean).sort();
}

const report = buildAdminPlatformBudgetEvidenceReport({ generatedAt });

assert.equal(report.ok, true);
assert.equal(report.generatedAt, generatedAt);
assert.equal(report.verdict, "blocked");
assert.equal(report.runtimeMutation, false);
assert.equal(report.providerCalls, false);
assert.equal(report.billingMutation, false);
assert.equal(report.summary.memberGatewayMigrated, 3);
assert.equal(report.summary.adminPlatformImplemented, 4);
assert.equal(report.summary.blockedCriticalGaps, 0);
assert.equal(report.summary.routePolicyRegistered, true);

for (const scope of [
  "admin_org_credit_account",
  "platform_admin_lab_budget",
  "platform_background_budget",
  "openclaw_news_pulse_budget",
  "internal_ai_worker_caller_enforced",
  "explicit_unmetered_admin",
  "external_provider_only",
]) {
  assert(report.budgetScopes.some((entry) => entry.scope === scope), `Expected budget scope ${scope}`);
}

const adminOrgScope = report.budgetScopes.find((entry) => entry.scope === "admin_org_credit_account");
assert.equal(adminOrgScope.implementedCount, 1);
assert.equal(adminOrgScope.runtimeEnforcementExists, true);
assert.equal(adminOrgScope.runtimeEnforcementStatus, "implemented");
assert(adminOrgScope.killSwitchTargets.includes("ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET metadata target"));

const platformLabScope = report.budgetScopes.find((entry) => entry.scope === "platform_admin_lab_budget");
assert(platformLabScope.operationCount >= 8);
assert(platformLabScope.baselineGapCount >= 6);
assert.equal(platformLabScope.runtimeEnforcementExists, false);
assert(["missing", "partial"].includes(platformLabScope.runtimeEnforcementStatus));

const openClawScope = report.budgetScopes.find((entry) => entry.scope === "openclaw_news_pulse_budget");
assert.equal(openClawScope.operationCount, 2);
assert(openClawScope.baselineGapIds.includes("openclaw-news-pulse-visual-generation"));
assert.equal(openClawScope.runtimeEnforcementStatus, "partial");

const internalScope = report.budgetScopes.find((entry) => entry.scope === "internal_ai_worker_caller_enforced");
assert(internalScope.operationCount >= 9);
assert(internalScope.baselineGapIds.includes("internal-ai-worker-text-image-embeddings"));
assert(internalScope.baselineGapIds.includes("internal-ai-worker-music-video-compare-live-agent"));
assert.equal(internalScope.runtimeEnforcementExists, false);

const implementedIds = operationIds(report.implementedOperations);
assert(implementedIds.includes("member.image.generate"));
assert(implementedIds.includes("member.music.generate"));
assert(implementedIds.includes("member.video.generate"));
assert(implementedIds.includes("admin.image.test.charged"));
assert(implementedIds.includes("admin.video.job.create"));

const adminBfl = report.implementedOperations.find((entry) => entry.operationId === "admin.image.test.charged");
assert.equal(adminBfl.budgetScope, "admin_org_credit_account");
assert.equal(adminBfl.runtimeStatus, "implemented_hardened");
assert.equal(adminBfl.killSwitchTarget, "ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET");
assert.equal(adminBfl.modelClass, "priced Black Forest Labs admin image tests");
assert(adminBfl.metadataFieldsExpected.includes("budget_policy_version"));
assert(adminBfl.metadataFieldsExpected.includes("fingerprint"));
assert(adminBfl.remainingLimitations.some((entry) => entry.includes("metadata only")));

const memberImage = report.implementedOperations.find((entry) => entry.operationId === "member.image.generate");
assert.equal(memberImage.runtimeStatus, "gateway_migrated");
assert.equal(memberImage.coverage, "member_credit_gateway");

const adminVideoJob = report.implementedOperations.find((entry) => entry.operationId === "admin.video.job.create");
assert.equal(adminVideoJob.budgetScope, "platform_admin_lab_budget");
assert.equal(adminVideoJob.runtimeStatus, "implemented_job_budget_metadata");
assert.equal(adminVideoJob.killSwitchTarget, "ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET");
assert(adminVideoJob.metadataFieldsExpected.includes("provider_task_create"));
assert(adminVideoJob.remainingLimitations.some((entry) => entry.includes("kill-switch")));

const baselineIds = gapIds(report.baselinedGaps);
assert(!baselineIds.includes("admin-ai-video-job-create"));
assert(!baselineIds.includes("admin-ai-video-task-create-poll"));
assert(baselineIds.includes("openclaw-news-pulse-visual-generation"));
assert(baselineIds.includes("internal-ai-worker-text-image-embeddings"));
assert(baselineIds.includes("internal-ai-worker-music-video-compare-live-agent"));
assert.equal(
  report.baselinedGaps.find((entry) => entry.id === "openclaw-news-pulse-visual-generation").budgetScope,
  "openclaw_news_pulse_budget"
);

{
  const serialized = JSON.stringify(report);
  for (const forbidden of [
    "sk_live_",
    "sk_test_",
    "whsec_",
    "Bearer ",
    "bitbi_session=",
    "__Host-bitbi_session",
    "X-Amz-Signature=",
    `-----BEGIN PRIVATE ${"KEY"}-----`,
  ]) {
    assert(!serialized.includes(forbidden), `Report must not include ${forbidden}`);
  }
}

{
  const injectedBaseline = {
    version: "test-baseline",
    knownGaps: [
      {
        id: "secret-gap",
        route: "/api/admin/ai/test-text",
        routePolicyIds: ["admin.ai.test-text"],
        category: "admin",
        reason: "provider request body should not appear",
        temporaryAllowanceReason: "raw prompt: paint private launch plan",
        targetBudgetScope: "platform_admin_lab_budget",
        targetFuturePhase: "Phase test",
        severity: "P2",
        ownerDomain: "admin-ai",
        killSwitchTarget: "Bearer secret-token-value",
        futureEnforcementPath: "session cookie bitbi_session=secret",
        providerCostBearing: true,
        registryOperationIds: ["admin.text.test"],
        coveredByRegistryMetadata: true,
        allowedUnmigratedForNow: true,
      },
    ],
  };
  const injectedRegistry = AI_COST_OPERATION_REGISTRY.map((entry) =>
    entry.operationConfig?.operationId === "admin.text.test"
      ? {
        ...entry,
        operationConfig: {
          ...entry.operationConfig,
          providerFamily: "sk_live_secret_provider_value",
        },
      }
      : entry
  );
  const injected = buildAdminPlatformBudgetEvidenceReport({
    generatedAt,
    baseline: injectedBaseline,
    registryEntries: injectedRegistry,
  });
  const serialized = JSON.stringify(injected);
  assert(!serialized.includes("paint private launch plan"));
  assert(!serialized.includes("secret-token-value"));
  assert(!serialized.includes("bitbi_session=secret"));
  assert(!serialized.includes("sk_live_secret_provider_value"));
  assert(serialized.includes("[redacted]"));
}

{
  const bounded = buildAdminPlatformBudgetEvidenceReport({
    generatedAt,
    limits: {
      maxEvidenceItems: 2,
      maxBaselinedGaps: 3,
      maxImplementedOperations: 2,
      maxBudgetScopeOperationIds: 1,
      maxStringLength: 80,
    },
  });
  assert.equal(bounded.evidenceItems.length, 2);
  assert.equal(bounded.baselinedGaps.length, 3);
  assert.equal(bounded.implementedOperations.length, 2);
  assert(bounded.budgetScopes.some((scope) => scope.operationIds.length <= 1));
  assert(bounded.warnings.some((warning) => warning.includes("truncated")));
}

{
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error("unexpected provider call");
  };
  try {
    buildAdminPlatformBudgetEvidenceReport({ generatedAt });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0);
}

{
  const args = ["scripts/report-ai-budget-evidence.mjs", "--json", `--generated-at=${generatedAt}`];
  const first = spawnSync(process.execPath, args, { encoding: "utf8" });
  const second = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  const parsed = JSON.parse(first.stdout);
  assert.equal(parsed.generatedAt, generatedAt);
  assert.equal(parsed.verdict, "blocked");
  assert(!first.stdout.includes("secret-token-value"));
}

{
  const result = spawnSync(process.execPath, [
    "scripts/report-ai-budget-evidence.mjs",
    "--markdown",
    `--generated-at=${generatedAt}`,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert(result.stdout.includes("# Admin/Platform AI Budget Evidence"));
  assert(result.stdout.includes("Verdict: blocked"));
  assert(result.stdout.includes("admin.image.test.charged"));
  assert(result.stdout.includes("openclaw-news-pulse-visual-generation"));
}

assert.equal(ADMIN_PLATFORM_BUDGET_EVIDENCE_ENDPOINT, "/api/admin/ai/budget-evidence");

console.log("Admin/platform budget evidence tests passed.");
