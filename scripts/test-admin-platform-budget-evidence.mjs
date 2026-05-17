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
assert.equal(report.summary.adminPlatformImplemented, 9);
assert.equal(report.summary.adminTextEmbeddingsDurableIdempotency, 2);
assert.equal(report.summary.adminMusicDurableIdempotency, 1);
assert.equal(report.summary.adminCompareDurableIdempotency, 1);
assert.equal(report.summary.adminLiveAgentDurableIdempotency, 1);
assert.equal(report.summary.adminLabDurableIdempotency, 5);
assert.equal(report.summary.retiredDebugPaths, 1);
assert.equal(report.summary.adminTextEmbeddingsAttemptsOperable, true);
assert.equal(report.summary.adminLabAttemptsOperable, true);
assert.equal(report.summary.adminImageChargedBranches, 4);
assert.equal(report.summary.adminImageExplicitUnmeteredBranches, 1);
assert.equal(report.summary.adminImageBlockedUnsupportedGuards, 1);
assert.equal(report.summary.runtimeBudgetSwitchTargets, 10);
assert.equal(report.summary.runtimeBudgetSwitchesEnabled, null);
assert.equal(report.summary.runtimeBudgetSwitchesDisabled, null);
assert.equal(report.summary.runtimeBudgetSwitchesAppEnabled, null);
assert.equal(report.summary.runtimeBudgetSwitchesEffectiveEnabled, null);
assert.equal(report.summary.liveBudgetCapsStatus, "platform_admin_lab_budget_foundation");
assert.equal(report.summary.liveBudgetCapsEnforced, true);
assert.equal(report.summary.recommendedFirstCapScope, "platform_admin_lab_budget");
assert.equal(report.summary.platformBudgetReconciliationAvailable, false);
assert.equal(report.summary.platformBudgetReconciliationVerdict, "not_run");
assert.equal(report.summary.platformBudgetReconciliationRepairCandidates, 0);
assert(report.summary.switchEnforcedNotCapEnforcedOperations >= 4);
assert.equal(report.summary.blockedCriticalGaps, 0);
assert.equal(report.summary.routePolicyRegistered, true);
assert.equal(report.adminAiUsageAttempts.cleanup.registered, true);
assert.equal(report.adminAiUsageAttempts.cleanup.defaultDryRun, true);
assert.equal(report.adminAiUsageAttempts.cleanup.destructiveDelete, false);
assert.equal(report.adminAiUsageAttempts.cleanup.providerCalls, false);
assert.equal(report.adminAiUsageAttempts.inspection.listRegistered, true);
assert.equal(report.adminAiUsageAttempts.inspection.detailRegistered, true);
assert.equal(report.runtimeBudgetSwitches.defaultDisabled, true);
assert.equal(report.runtimeBudgetSwitches.phase, "Phase 4.15.1");
assert.equal(report.runtimeBudgetSwitches.effectiveRule, "cloudflare_master_enabled_and_admin_d1_switch_enabled");
assert.equal(report.runtimeBudgetSwitches.liveBudgetCapsEnforced, false);
assert.equal(report.runtimeBudgetSwitches.d1SwitchStateAvailable, false);
assert(report.runtimeBudgetSwitches.targets.some((entry) =>
  entry.flagName === "ENABLE_ADMIN_AI_TEXT_BUDGET"
  && entry.configured === null
  && entry.enabled === null
  && entry.appSwitchEnabled === null
  && entry.effectiveEnabled === null
  && entry.liveCapStatus === "cap_enforced"
));
assert(report.runtimeBudgetSwitches.targets.some((entry) =>
  entry.flagName === "ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET"
  && entry.routePath === "/api/admin/ai/test-image"
));
assert.equal(report.livePlatformBudgetCaps.liveBudgetCapsStatus, "platform_admin_lab_budget_foundation");
assert.equal(report.livePlatformBudgetCaps.liveBudgetCapsEnforced, true);
assert.equal(report.livePlatformBudgetCaps.runtimeRouteBehaviorChanged, true);
assert.equal(report.livePlatformBudgetCaps.recommendedFirstCapScope, "platform_admin_lab_budget");
assert.equal(report.livePlatformBudgetCaps.memberRoutesSeparate, true);
assert(report.livePlatformBudgetCaps.capEnforcedOperationIds.includes("admin.text.test"));
assert(report.livePlatformBudgetCaps.capEnforcedOperationIds.includes("admin.live_agent"));
assert(report.livePlatformBudgetCaps.pathsWithEstimatedCostUnits.includes("admin.video.job.create"));
assert(report.livePlatformBudgetCaps.pathsWithDurableCompletionTimestamps.includes("admin.compare"));
assert.equal(report.platformBudgetReconciliation.phase, "Phase 4.18");
assert.equal(report.platformBudgetReconciliation.readOnly, true);
assert.equal(report.platformBudgetReconciliation.repairExecutorExists, false);
assert.equal(report.platformBudgetReconciliation.runtimeRouteBehaviorChanged, false);

const platformCapScope = report.livePlatformBudgetCaps.countabilityByBudgetScope.find((entry) =>
  entry.scope === "platform_admin_lab_budget"
);
assert.equal(platformCapScope.status, "cap_enforced");
assert.equal(platformCapScope.countability, "countable_now");
assert.equal(platformCapScope.futurePhase, "Phase 4.17 implemented foundation");
assert(platformCapScope.currentDataSources.includes("admin_ai_usage_attempts"));
assert(platformCapScope.currentDataSources.includes("ai_video_jobs"));
assert(platformCapScope.currentDataSources.includes("platform_budget_usage_events"));

const unmeteredCapScope = report.livePlatformBudgetCaps.countabilityByBudgetScope.find((entry) =>
  entry.scope === "explicit_unmetered_admin"
);
assert.equal(unmeteredCapScope.countability, "metadata_only");
assert.equal(unmeteredCapScope.migrationLikelyRequired, true);

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
assert(adminOrgScope.killSwitchTargets.includes("model-specific charged image budget runtime_enforced"));

const platformLabScope = report.budgetScopes.find((entry) => entry.scope === "platform_admin_lab_budget");
assert(platformLabScope.operationCount >= 7);
assert.equal(platformLabScope.baselineGapCount, 0);
assert.equal(platformLabScope.runtimeEnforcementExists, false);
assert(["partial", "implemented"].includes(platformLabScope.runtimeEnforcementStatus));

const explicitUnmeteredScope = report.budgetScopes.find((entry) => entry.scope === "explicit_unmetered_admin");
assert(explicitUnmeteredScope.operationIds.includes("admin.image.test.unmetered"));
assert.equal(explicitUnmeteredScope.baselineGapCount, 0);
assert.equal(explicitUnmeteredScope.implementedCount, 1);

const openClawScope = report.budgetScopes.find((entry) => entry.scope === "openclaw_news_pulse_budget");
assert.equal(openClawScope.operationCount, 2);
assert.equal(openClawScope.implementedCount, 2);
assert.equal(openClawScope.baselineGapCount, 0);
assert.equal(openClawScope.runtimeEnforcementStatus, "implemented");
assert(openClawScope.killSwitchTargets.includes("ENABLE_NEWS_PULSE_VISUAL_BUDGET runtime_enforced"));

const internalScope = report.budgetScopes.find((entry) => entry.scope === "internal_ai_worker_caller_enforced");
assert(internalScope.operationCount >= 9);
assert(internalScope.baselineGapIds.includes("internal-ai-worker-text-image-embeddings"));
assert(internalScope.baselineGapIds.includes("internal-ai-worker-music-video-compare"));
assert.equal(internalScope.runtimeEnforcementExists, false);
assert(internalScope.implementedCount >= 4);

const implementedIds = operationIds(report.implementedOperations);
assert(implementedIds.includes("member.image.generate"));
assert(implementedIds.includes("member.music.generate"));
assert(implementedIds.includes("member.video.generate"));
assert(implementedIds.includes("admin.text.test"));
assert(implementedIds.includes("admin.embeddings.test"));
assert(implementedIds.includes("admin.music.test"));
assert(implementedIds.includes("admin.compare"));
assert(implementedIds.includes("admin.live_agent"));
assert(implementedIds.includes("admin.image.test.charged"));
assert(implementedIds.includes("admin.image.test.unmetered"));
assert(implementedIds.includes("admin.video.job.create"));
assert(implementedIds.includes("internal.video_task.create"));
assert(implementedIds.includes("internal.video_task.poll"));
assert(implementedIds.includes("platform.news_pulse.visual.ingest"));
assert(implementedIds.includes("platform.news_pulse.visual.scheduled"));

const adminBfl = report.implementedOperations.find((entry) => entry.operationId === "admin.image.test.charged");
assert.equal(adminBfl.budgetScope, "admin_org_credit_account");
assert.equal(adminBfl.runtimeStatus, "implemented_hardened");
assert.equal(adminBfl.killSwitchTarget, "ENABLE_ADMIN_AI_BFL_IMAGE_BUDGET / ENABLE_ADMIN_AI_GPT_IMAGE_BUDGET");
assert.equal(adminBfl.modelClass, "priced Admin image tests (BFL FLUX and GPT Image 2)");
assert(adminBfl.metadataFieldsExpected.includes("budget_policy_version"));
assert(adminBfl.metadataFieldsExpected.includes("fingerprint"));
assert(adminBfl.remainingLimitations.some((entry) => entry.includes("runtime budget switch")));

const adminImageUnmetered = report.implementedOperations.find((entry) => entry.operationId === "admin.image.test.unmetered");
assert.equal(adminImageUnmetered.budgetScope, "explicit_unmetered_admin");
assert.equal(adminImageUnmetered.runtimeStatus, "explicit_unmetered_admin_metadata");
assert.equal(adminImageUnmetered.counts.explicitUnmeteredAdmin, 1);
assert(adminImageUnmetered.explicitUnmeteredAdmin.some((entry) =>
  entry.modelId === "@cf/black-forest-labs/flux-2-dev"
  && entry.killSwitchTarget === "ENABLE_ADMIN_AI_UNMETERED_IMAGE_TESTS"
));
assert(adminImageUnmetered.blockedUnsupported.some((entry) => entry.providerCalls === false));
assert.equal(report.adminImageBranches.counts.chargedAdminOrgCredit, 4);
assert.equal(report.adminImageBranches.counts.explicitUnmeteredAdmin, 1);
assert.equal(report.adminImageBranches.counts.blockedUnsupportedGuard, 1);

const memberImage = report.implementedOperations.find((entry) => entry.operationId === "member.image.generate");
assert.equal(memberImage.runtimeStatus, "gateway_migrated");
assert.equal(memberImage.coverage, "member_credit_gateway");

const adminVideoJob = report.implementedOperations.find((entry) => entry.operationId === "admin.video.job.create");
assert.equal(adminVideoJob.budgetScope, "platform_admin_lab_budget");
assert.equal(adminVideoJob.runtimeStatus, "implemented_job_budget_metadata");
assert.equal(adminVideoJob.killSwitchTarget, "ENABLE_ADMIN_AI_VIDEO_JOB_BUDGET");
assert(adminVideoJob.metadataFieldsExpected.includes("provider_task_create"));
assert(adminVideoJob.remainingLimitations.some((entry) => entry.includes("Phase 4.15 enforces")));

const adminText = report.implementedOperations.find((entry) => entry.operationId === "admin.text.test");
assert.equal(adminText.budgetScope, "platform_admin_lab_budget");
assert.equal(adminText.runtimeStatus, "budget_metadata_with_durable_idempotency");
assert.equal(adminText.killSwitchTarget, "ENABLE_ADMIN_AI_TEXT_BUDGET");
assert(adminText.metadataFieldsExpected.includes("caller_policy"));
assert(adminText.metadataFieldsExpected.includes("idempotency_attempt_id"));
assert(adminText.remainingLimitations.some((entry) => entry.includes("Full result replay")));
assert(adminText.remainingLimitations.some((entry) => entry.includes("bounded non-destructive cleanup")));

const adminEmbeddings = report.implementedOperations.find((entry) => entry.operationId === "admin.embeddings.test");
assert.equal(adminEmbeddings.budgetScope, "platform_admin_lab_budget");
assert.equal(adminEmbeddings.runtimeStatus, "budget_metadata_with_durable_idempotency");
assert.equal(adminEmbeddings.killSwitchTarget, "ENABLE_ADMIN_AI_EMBEDDINGS_BUDGET");
assert(adminEmbeddings.metadataFieldsExpected.includes("idempotency_key_hash"));
assert(adminEmbeddings.metadataFieldsExpected.includes("durable_idempotency"));

const adminMusic = report.implementedOperations.find((entry) => entry.operationId === "admin.music.test");
assert.equal(adminMusic.budgetScope, "platform_admin_lab_budget");
assert.equal(adminMusic.runtimeStatus, "budget_metadata_with_durable_idempotency");
assert.equal(adminMusic.killSwitchTarget, "ENABLE_ADMIN_AI_MUSIC_BUDGET");
assert(adminMusic.metadataFieldsExpected.includes("caller_policy"));
assert(adminMusic.remainingLimitations.some((entry) => entry.includes("audio")));

const adminCompare = report.implementedOperations.find((entry) => entry.operationId === "admin.compare");
assert.equal(adminCompare.budgetScope, "platform_admin_lab_budget");
assert.equal(adminCompare.runtimeStatus, "budget_metadata_with_durable_idempotency");
assert.equal(adminCompare.killSwitchTarget, "ENABLE_ADMIN_AI_COMPARE_BUDGET");
assert.equal(adminCompare.modelClass, "admin compare multi-model text fanout");
assert(adminCompare.metadataFieldsExpected.includes("caller_policy"));
assert(adminCompare.remainingLimitations.some((entry) => entry.includes("compare results")));

const newsPulseVisual = report.implementedOperations.find((entry) => entry.operationId === "platform.news_pulse.visual.ingest");
assert.equal(newsPulseVisual.budgetScope, "openclaw_news_pulse_budget");
assert.equal(newsPulseVisual.runtimeStatus, "implemented_visual_budget_metadata");
assert.equal(newsPulseVisual.killSwitchTarget, "ENABLE_NEWS_PULSE_VISUAL_BUDGET");
assert(newsPulseVisual.metadataFieldsExpected.includes("visual_budget_policy_json"));
assert(newsPulseVisual.duplicateProviderSuppression.some((entry) => entry.includes("ready visual")));
assert(newsPulseVisual.remainingLimitations.some((entry) => entry.includes("Phase 4.15 enforces")));

const internalGuard = report.implementedOperations.find((entry) => entry.operationId === "internal.video_task.create");
assert.equal(internalGuard.budgetScope, "internal_ai_worker_caller_enforced");
assert.equal(internalGuard.runtimeStatus, "implemented_caller_policy_guard");
assert.equal(internalGuard.callerPolicyTransport, "reserved_signed_json_body_key");
assert.equal(internalGuard.reservedBodyKey, "__bitbi_ai_caller_policy");
assert(internalGuard.requiredForInternalRoutes.includes("/internal/ai/video-task/create"));
assert(internalGuard.coveredCallerPaths.includes("admin text test"));
assert(internalGuard.coveredCallerPaths.includes("admin embeddings test"));
assert(internalGuard.coveredCallerPaths.includes("admin music test"));
assert(internalGuard.coveredCallerPaths.includes("admin compare"));
assert(internalGuard.coveredCallerPaths.includes("admin live-agent"));
assert(internalGuard.requiredForInternalRoutes.includes("/internal/ai/live-agent"));
assert(internalGuard.baselineAllowedInternalRoutes.includes("/internal/ai/test-text"));
assert(!internalGuard.baselineAllowedInternalRoutes.includes("/internal/ai/live-agent"));
assert(internalGuard.remainingLimitations.some((entry) => entry.includes("baseline-allowed")));

const baselineIds = gapIds(report.baselinedGaps);
const liveAgent = report.implementedOperations.find((entry) => entry.operationId === "admin.live_agent");
assert.equal(liveAgent.budgetScope, "platform_admin_lab_budget");
assert.equal(liveAgent.runtimeStatus, "budget_metadata_with_stream_session_idempotency");
assert.equal(liveAgent.killSwitchTarget, "ENABLE_ADMIN_AI_LIVE_AGENT_BUDGET");
assert(liveAgent.metadataFieldsExpected.includes("stream_session_caps"));
assert(liveAgent.remainingLimitations.some((entry) => entry.includes("Full stream replay")));
assert(!baselineIds.includes("admin-ai-live-agent-unmetered"));
assert(!baselineIds.includes("admin-ai-sync-video-debug"));
assert(!baselineIds.includes("admin-ai-image-unmetered-branch"));
assert(!baselineIds.includes("admin-ai-video-job-create"));
assert(!baselineIds.includes("admin-ai-video-task-create-poll"));
assert(!baselineIds.includes("openclaw-news-pulse-visual-generation"));
assert(!baselineIds.includes("admin-ai-text-test-unmetered"));
assert(!baselineIds.includes("admin-ai-embeddings-test-unmetered"));
assert(!baselineIds.includes("admin-ai-music-test-unmetered"));
assert(!baselineIds.includes("admin-ai-compare-unmetered"));
assert(baselineIds.includes("internal-ai-worker-text-image-embeddings"));
assert(baselineIds.includes("internal-ai-worker-music-video-compare"));

const retiredDebug = report.retiredDebugPaths.find((entry) => entry.operationId === "admin.video.sync_debug");
assert.equal(retiredDebug.runtimeStatus, "retired_disabled_by_default");
assert.equal(retiredDebug.killSwitchTarget, "ALLOW_SYNC_VIDEO_DEBUG");
assert.equal(retiredDebug.supportedReplacement, "/api/admin/ai/video-jobs");
assert.equal(retiredDebug.normalProviderCostPath, false);
assert(retiredDebug.disabledBehavior.some((entry) => entry.includes("does not call AI_LAB")));
assert(retiredDebug.emergencyCompatibility.some((entry) => entry.includes("not treated as supported budgeted")));

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
  assert.equal(bounded.baselinedGaps.length, 2);
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
  const withAttemptSummary = buildAdminPlatformBudgetEvidenceReport({
    generatedAt,
    adminAiUsageAttemptSummary: {
      available: true,
      totalCount: 3,
      recentCount: 2,
      activeCount: 1,
      staleActiveCount: 1,
      expiredCount: 1,
      failedTerminalCount: 0,
      succeededCount: 1,
      latestUpdatedAt: "2026-05-16T10:00:00.000Z",
      recentWindowHours: 24,
    },
  });
  assert.equal(withAttemptSummary.adminAiUsageAttempts.available, true);
  assert.equal(withAttemptSummary.adminAiUsageAttempts.totalCount, 3);
  assert.equal(withAttemptSummary.adminAiUsageAttempts.staleActiveCount, 1);
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
  assert(result.stdout.includes("Admin Image Branches"));
  assert(result.stdout.includes("admin.video.sync_debug"));
  assert(result.stdout.includes("platform.news_pulse.visual.ingest"));
  assert(!result.stdout.includes("openclaw-news-pulse-visual-generation"));
}

assert.equal(ADMIN_PLATFORM_BUDGET_EVIDENCE_ENDPOINT, "/api/admin/ai/budget-evidence");

console.log("Admin/platform budget evidence tests passed.");
