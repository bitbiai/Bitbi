import assert from "node:assert/strict";
import {
  AI_COST_OPERATION_REGISTRY,
  getAiCostProviderCallSourceFiles,
  getAiCostRoutePolicyBaselines,
  summarizeAiCostOperationRegistry,
  validateAiCostOperationRegistry,
} from "../workers/auth/src/lib/ai-cost-operations.js";
import { normalizeAiCostOperationConfig } from "../workers/auth/src/lib/ai-cost-gateway.js";

const issues = validateAiCostOperationRegistry();
assert.deepEqual(issues, []);

const operationIds = AI_COST_OPERATION_REGISTRY.map((entry) => entry.operationConfig.operationId);
assert.equal(new Set(operationIds).size, operationIds.length);

for (const entry of AI_COST_OPERATION_REGISTRY) {
  const config = normalizeAiCostOperationConfig(entry.operationConfig);
  assert.equal(config.operationId, entry.operationConfig.operationId);
}

for (const requiredId of [
  "member.image.generate",
  "member.music.generate",
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
  "member.music.cover.generate",
]) {
  assert(operationIds.includes(requiredId), `Expected registry operation ${requiredId}`);
}

const summary = summarizeAiCostOperationRegistry();
assert.deepEqual(summary, {
  version: "ai-cost-operations-2026-05-15",
  totalOperations: 30,
  providerCostOperations: 29,
  memberOperations: 6,
  organizationOperations: 2,
  adminPlatformOperations: 22,
  currentMissingMandatoryIdempotency: 4,
  currentMissingReservation: 4,
  currentNoReplay: 4,
  platformBudgetReviewOperations: 3,
  highRiskOperations: [
    "internal.music.generate",
    "member.image.generate",
    "member.music.cover.generate",
    "member.music.generate",
    "member.music.lyrics.generate",
    "member.video.generate",
  ],
});

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
