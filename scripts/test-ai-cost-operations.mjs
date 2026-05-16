import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AI_COST_BUDGET_SCOPES,
  AI_COST_BUDGET_SCOPE_POLICIES,
  AI_COST_OPERATION_REGISTRY,
  getAiCostProviderCallSourceFiles,
  getAiCostRoutePolicyBaselines,
  summarizeAiCostOperationRegistry,
  validateAiCostOperationRegistry,
} from "../workers/auth/src/lib/ai-cost-operations.js";
import { normalizeAiCostOperationConfig } from "../workers/auth/src/lib/ai-cost-gateway.js";

const issues = validateAiCostOperationRegistry();
assert.deepEqual(issues, []);

const policyBaseline = JSON.parse(
  readFileSync(new URL("../config/ai-cost-policy-baseline.json", import.meta.url), "utf8")
);

for (const requiredScope of [
  "member_credit_account",
  "organization_credit_account",
  "admin_org_credit_account",
  "platform_admin_lab_budget",
  "platform_background_budget",
  "openclaw_news_pulse_budget",
  "internal_ai_worker_caller_enforced",
  "explicit_unmetered_admin",
  "external_provider_only",
]) {
  assert(Object.values(AI_COST_BUDGET_SCOPES).includes(requiredScope), `Expected budget scope ${requiredScope}`);
  assert(AI_COST_BUDGET_SCOPE_POLICIES[requiredScope], `Expected policy for budget scope ${requiredScope}`);
}

const operationIds = AI_COST_OPERATION_REGISTRY.map((entry) => entry.operationConfig.operationId);
assert.equal(new Set(operationIds).size, operationIds.length);

for (const entry of AI_COST_OPERATION_REGISTRY) {
  const config = normalizeAiCostOperationConfig(entry.operationConfig);
  assert.equal(config.operationId, entry.operationConfig.operationId);
}

for (const requiredId of [
  "member.image.generate",
  "member.music.generate",
  "member.music.lyrics.generate",
  "member.music.audio.generate",
  "member.music.cover.generate",
  "member.video.generate",
  "admin.text.test",
  "admin.image.test.charged",
  "admin.music.test",
  "internal.text.generate",
  "internal.image.generate",
  "internal.music.generate",
  "internal.video_task.create",
  "internal.live_agent",
  "platform.news_pulse.visual.ingest",
]) {
  assert(operationIds.includes(requiredId), `Expected registry operation ${requiredId}`);
}

const musicEntries = AI_COST_OPERATION_REGISTRY.filter((entry) =>
  entry.operationConfig.operationId.startsWith("member.music.")
);
assert.deepEqual(
  musicEntries.map((entry) => entry.operationConfig.operationId).sort(),
  [
    "member.music.audio.generate",
    "member.music.cover.generate",
    "member.music.generate",
    "member.music.lyrics.generate",
  ]
);
const musicParent = AI_COST_OPERATION_REGISTRY.find((entry) =>
  entry.operationConfig.operationId === "member.music.generate"
);
assert.deepEqual(
  [...musicParent.subOperationIds].sort(),
  [
    "member.music.audio.generate",
    "member.music.cover.generate",
    "member.music.lyrics.generate",
  ]
);
assert.equal(musicParent.billingRelationship, "parent_bundle");
assert.equal(
  AI_COST_OPERATION_REGISTRY.find((entry) =>
    entry.operationConfig.operationId === "member.music.audio.generate"
  ).billingRelationship,
  "included_in_parent_music_charge"
);
assert.equal(
  AI_COST_OPERATION_REGISTRY.find((entry) =>
    entry.operationConfig.operationId === "member.music.cover.generate"
  ).billingRelationship,
  "included_in_parent_music_charge"
);
assert.equal(musicParent.currentStatus, "implemented");
assert.equal(musicParent.currentEnforcement.idempotency, "implemented");

const summary = summarizeAiCostOperationRegistry();
assert.deepEqual(summary, {
  version: "ai-cost-operations-2026-05-15",
  totalOperations: 31,
  providerCostOperations: 30,
  memberOperations: 7,
  organizationOperations: 2,
  adminPlatformOperations: 22,
  currentMissingMandatoryIdempotency: 0,
  currentMissingReservation: 0,
  currentNoReplay: 0,
  platformBudgetReviewOperations: 2,
  budgetScopeCounts: {
    member_credit_account: 0,
    organization_credit_account: 0,
    admin_org_credit_account: 1,
    platform_admin_lab_budget: 8,
    platform_background_budget: 0,
    openclaw_news_pulse_budget: 2,
    internal_ai_worker_caller_enforced: 11,
    explicit_unmetered_admin: 0,
    external_provider_only: 0,
  },
  highRiskOperations: [],
});

for (const entry of AI_COST_OPERATION_REGISTRY.filter((candidate) =>
  candidate.operationConfig.actorType === "admin" ||
  candidate.operationConfig.actorType === "platform"
)) {
  if (entry.operationConfig.providerCost === false) continue;
  assert(entry.budgetPolicy, `Expected budget policy for ${entry.operationConfig.operationId}`);
  assert(entry.budgetPolicy.targetBudgetScope, `Expected target budget scope for ${entry.operationConfig.operationId}`);
  assert(entry.budgetPolicy.targetFuturePhase, `Expected target future phase for ${entry.operationConfig.operationId}`);
  assert(entry.budgetPolicy.targetEnforcement, `Expected target enforcement for ${entry.operationConfig.operationId}`);
}

const baselineGapOperationIds = new Set(policyBaseline.knownGaps.map((gap) => gap.operationId).filter(Boolean));
for (const migratedMemberOperationId of [
  "member.image.generate",
  "member.music.generate",
  "member.video.generate",
]) {
  assert(!baselineGapOperationIds.has(migratedMemberOperationId), `${migratedMemberOperationId} must not be a baseline gap`);
}

for (const gap of policyBaseline.knownGaps) {
  assert(gap.targetBudgetScope, `Expected target budget scope for baseline gap ${gap.id}`);
  assert(gap.targetFuturePhase, `Expected target future phase for baseline gap ${gap.id}`);
  assert(gap.temporaryAllowanceReason, `Expected temporary allowance reason for baseline gap ${gap.id}`);
  assert(gap.killSwitchTarget || gap.killSwitchExemptionReason, `Expected kill-switch target or exemption for baseline gap ${gap.id}`);
  assert(gap.futureEnforcementPath, `Expected future enforcement path for baseline gap ${gap.id}`);
}

assert.equal(
  AI_COST_OPERATION_REGISTRY.find((entry) => entry.operationConfig.operationId === "admin.text.test").budgetPolicy.targetBudgetScope,
  AI_COST_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET
);
assert.equal(
  AI_COST_OPERATION_REGISTRY.find((entry) => entry.operationConfig.operationId === "admin.image.test.charged").budgetPolicy.targetBudgetScope,
  AI_COST_BUDGET_SCOPES.ADMIN_ORG_CREDIT_ACCOUNT
);
assert.equal(
  AI_COST_OPERATION_REGISTRY.find((entry) => entry.operationConfig.operationId === "admin.image.test.charged").currentStatus,
  "implemented"
);
assert.equal(
  AI_COST_OPERATION_REGISTRY.find((entry) => entry.operationConfig.operationId === "admin.image.test.charged").budgetPolicy.targetEnforcementStatus,
  "implemented"
);
assert.equal(
  AI_COST_OPERATION_REGISTRY.find((entry) => entry.operationConfig.operationId === "platform.news_pulse.visual.ingest").budgetPolicy.targetBudgetScope,
  AI_COST_BUDGET_SCOPES.OPENCLAW_NEWS_PULSE_BUDGET
);
assert.equal(
  AI_COST_OPERATION_REGISTRY.find((entry) => entry.operationConfig.operationId === "platform.news_pulse.visual.ingest").currentStatus,
  "implemented"
);
assert.equal(
  AI_COST_OPERATION_REGISTRY.find((entry) => entry.operationConfig.operationId === "platform.news_pulse.visual.ingest").budgetPolicy.targetEnforcementStatus,
  "implemented"
);
assert.equal(
  AI_COST_OPERATION_REGISTRY.find((entry) => entry.operationConfig.operationId === "platform.news_pulse.visual.ingest").budgetPolicy.killSwitchTarget,
  "ENABLE_NEWS_PULSE_VISUAL_BUDGET"
);
assert.equal(
  AI_COST_OPERATION_REGISTRY.find((entry) => entry.operationConfig.operationId === "internal.text.generate").budgetPolicy.targetBudgetScope,
  AI_COST_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED
);
assert.equal(
  AI_COST_OPERATION_REGISTRY.find((entry) => entry.operationConfig.operationId === "internal.video_task.create").currentStatus,
  "implemented"
);
assert.equal(
  AI_COST_OPERATION_REGISTRY.find((entry) => entry.operationConfig.operationId === "internal.video_task.create").budgetPolicy.targetEnforcementStatus,
  "implemented"
);

const routePolicyBaselines = getAiCostRoutePolicyBaselines();
assert(routePolicyBaselines.some((entry) => entry.id === "ai.generate-image" && entry.expected === "required"));
assert(routePolicyBaselines.some((entry) => entry.id === "admin.ai.test-embeddings"));
assert(routePolicyBaselines.some((entry) => entry.id === "openclaw.news_pulse.ingest"));

const providerSourceFiles = getAiCostProviderCallSourceFiles();
assert(providerSourceFiles.includes("workers/auth/src/routes/ai/music-generate.js"));
assert(providerSourceFiles.includes("workers/auth/src/lib/member-music-cover.js"));
assert(providerSourceFiles.includes("workers/ai/src/routes/video-task.js"));

{
  const duplicate = [
    ...AI_COST_OPERATION_REGISTRY,
    AI_COST_OPERATION_REGISTRY[0],
  ];
  const duplicateIssues = validateAiCostOperationRegistry(duplicate);
  assert(duplicateIssues.some((issue) => issue.includes("Duplicate AI cost operation id")));
}

{
  const malformed = [{
    ...AI_COST_OPERATION_REGISTRY[0],
    operationConfig: {
      ...AI_COST_OPERATION_REGISTRY[0].operationConfig,
      idempotencyPolicy: "optional",
    },
  }];
  const malformedIssues = validateAiCostOperationRegistry(malformed);
  assert(malformedIssues.some((issue) => issue.includes("idempotencyPolicy=required")));
}

{
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error("unexpected fetch call");
  };
  try {
    validateAiCostOperationRegistry();
    summarizeAiCostOperationRegistry();
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0);
}

console.log("AI cost operation registry tests passed.");
