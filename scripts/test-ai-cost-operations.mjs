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
  currentMissingMandatoryIdempotency: 1,
  currentMissingReservation: 1,
  currentNoReplay: 1,
  platformBudgetReviewOperations: 2,
  highRiskOperations: [
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
