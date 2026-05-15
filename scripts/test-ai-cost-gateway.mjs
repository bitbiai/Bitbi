import assert from "node:assert/strict";
import {
  AI_COST_GATEWAY_PHASES,
  AI_COST_GATEWAY_SCOPES,
  AiCostGatewayError,
  buildAiCostRequestFingerprint,
  buildAiCostScopedIdempotencyKey,
  classifyAiCostGatewayState,
  createAiCostGatewayPlan,
  normalizeAiCostOperationConfig,
} from "../workers/auth/src/lib/ai-cost-gateway.js";

function memberOperation(overrides = {}) {
  return {
    operationId: "member.image.generate",
    featureKey: "ai.image.generate",
    actorType: "member",
    billingScope: AI_COST_GATEWAY_SCOPES.MEMBER_CREDIT_ACCOUNT,
    providerFamily: "workers_ai",
    modelId: "@cf/black-forest-labs/flux-1-schnell",
    creditCost: 1,
    quantity: 1,
    idempotencyPolicy: "required",
    reservationPolicy: "required",
    replayPolicy: "temp_object",
    failurePolicy: ["release_reservation", "no_charge", "terminal_billing_failure"],
    storagePolicy: "user_images",
    observabilityEventPrefix: "member.image.generate",
    routeId: "ai.generate-image",
    routePath: "/api/ai/generate-image",
    costVersion: "test-v1",
    notes: "Fixture only.",
    ...overrides,
  };
}

function orgOperation(overrides = {}) {
  return memberOperation({
    operationId: "member.text.generate",
    featureKey: "ai.text.generate",
    actorType: "organization",
    billingScope: AI_COST_GATEWAY_SCOPES.ORGANIZATION_CREDIT_ACCOUNT,
    providerFamily: "workers_ai",
    modelId: "@cf/meta/llama-3.1-8b-instruct",
    creditCost: 1,
    replayPolicy: "metadata_only",
    storagePolicy: "none",
    routeId: "ai.generate-text",
    routePath: "/api/ai/generate-text",
    ...overrides,
  });
}

function adminUnmeteredOperation(overrides = {}) {
  return {
    operationId: "admin.text.test",
    featureKey: "admin.ai.test_text",
    actorType: "admin",
    billingScope: AI_COST_GATEWAY_SCOPES.UNMETERED_ADMIN,
    providerFamily: "workers_ai",
    modelId: "@cf/meta/llama-3.1-8b-instruct",
    creditCost: 0,
    quantity: 1,
    idempotencyPolicy: "optional",
    reservationPolicy: "not_supported",
    replayPolicy: "disabled",
    failurePolicy: "manual_review",
    storagePolicy: "none",
    observabilityEventPrefix: "admin.text.test",
    routeId: "admin.ai.test-text",
    routePath: "/api/admin/ai/test-text",
    notes: "Explicit admin-unmetered fixture.",
    ...overrides,
  };
}

function platformBudgetOperation(overrides = {}) {
  return {
    operationId: "news_pulse.visual.generate",
    featureKey: "platform.news_pulse.visual",
    actorType: "platform",
    billingScope: AI_COST_GATEWAY_SCOPES.PLATFORM_BUDGET,
    providerFamily: "workers_ai",
    modelId: "@cf/black-forest-labs/flux-1-schnell",
    creditCost: 0,
    quantity: 1,
    costPolicy: "platform_budget",
    idempotencyPolicy: "inherited",
    reservationPolicy: "platform_budget_only",
    replayPolicy: "durable_result",
    failurePolicy: ["manual_review", "no_charge"],
    storagePolicy: "user_images",
    observabilityEventPrefix: "news_pulse.visual.generate",
    routeId: "openclaw.news_pulse.ingest",
    routePath: "/api/openclaw/news-pulse/ingest",
    ...overrides,
  };
}

{
  const config = normalizeAiCostOperationConfig(memberOperation());
  assert.equal(config.operationId, "member.image.generate");
  assert.equal(config.billingScope, AI_COST_GATEWAY_SCOPES.MEMBER_CREDIT_ACCOUNT);
  assert.equal(config.idempotencyPolicy, "required");
  assert.equal(config.creditCost, 1);
  assert.equal(config.providerCost, true);
}

{
  const config = normalizeAiCostOperationConfig(orgOperation());
  assert.equal(config.actorType, "organization");
  assert.equal(config.billingScope, AI_COST_GATEWAY_SCOPES.ORGANIZATION_CREDIT_ACCOUNT);
  assert.equal(config.replayPolicy, "metadata_only");
}

{
  const config = normalizeAiCostOperationConfig(adminUnmeteredOperation());
  assert.equal(config.billingScope, AI_COST_GATEWAY_SCOPES.UNMETERED_ADMIN);
  assert.equal(config.creditCost, 0);
  assert.throws(
    () => normalizeAiCostOperationConfig(adminUnmeteredOperation({ billingScope: AI_COST_GATEWAY_SCOPES.EXTERNAL })),
    /Uncharged admin provider-cost operations/
  );
}

assert.throws(
  () => normalizeAiCostOperationConfig(memberOperation({ operationId: "" })),
  /operationId is required/
);
assert.throws(
  () => normalizeAiCostOperationConfig(memberOperation({ creditCost: -1 })),
  /creditCost must be a non-negative integer/
);
assert.throws(
  () => normalizeAiCostOperationConfig(memberOperation({ featureKey: "AI image generate" })),
  /featureKey is invalid/
);
assert.throws(
  () => normalizeAiCostOperationConfig(memberOperation({ idempotencyPolicy: "optional" })),
  /idempotencyPolicy=required/
);
assert.throws(
  () => normalizeAiCostOperationConfig(memberOperation({ creditCost: 0, costPolicy: "model_catalog_dynamic", idempotencyPolicy: "optional" })),
  /idempotencyPolicy=required/
);
assert.throws(
  () => normalizeAiCostOperationConfig(memberOperation({ idempotencyPolicy: "sometimes" })),
  /idempotencyPolicy is invalid/
);
assert.throws(
  () => normalizeAiCostOperationConfig(memberOperation({ providerCost: true, creditCost: 0, costPolicy: null })),
  /explicit cost policy/
);

{
  const left = await buildAiCostRequestFingerprint({
    operationConfig: memberOperation(),
    actorId: "user_123",
    billingScopeId: "user_123",
    body: { size: "1024x1024", prompt: "a quiet mountain", style: { b: 2, a: 1 } },
    includePromptHash: true,
  });
  const right = await buildAiCostRequestFingerprint({
    operationConfig: memberOperation(),
    billingScopeId: "user_123",
    actorId: "user_123",
    body: { style: { a: 1, b: 2 }, prompt: "a quiet mountain", size: "1024x1024" },
    includePromptHash: true,
  });
  assert.equal(left, right);
  assert.match(left, /^[a-f0-9]{64}$/);
}

{
  const left = await buildAiCostRequestFingerprint({
    operationConfig: memberOperation(),
    actorId: "user_123",
    billingScopeId: "user_123",
    body: { prompt: "same", nonce: "one", organization_id: "org_a" },
    excludeFields: ["nonce"],
    excludeOrganizationContextAliases: true,
    includePromptHash: true,
  });
  const right = await buildAiCostRequestFingerprint({
    operationConfig: memberOperation(),
    actorId: "user_123",
    billingScopeId: "user_123",
    body: { prompt: "same", nonce: "two", organizationId: "org_b" },
    excludeFields: ["nonce"],
    excludeOrganizationContextAliases: true,
    includePromptHash: true,
  });
  assert.equal(left, right);
}

{
  const rawPrompt = "raw prompt that must not appear in plans";
  const secretValue = "sk_live_should_not_appear";
  const plan = await createAiCostGatewayPlan({
    operationConfig: memberOperation(),
    actorId: "user_123",
    billingScopeId: "user_123",
    clientIdempotencyKey: "member-key-123",
    body: {
      prompt: rawPrompt,
      authorization: "Bearer token_should_not_appear",
      cookie: "session_cookie_should_not_appear",
      providerSecret: secretValue,
    },
    includePromptHash: true,
  });
  const serialized = JSON.stringify(plan);
  assert.equal(plan.state, AI_COST_GATEWAY_PHASES.READY_TO_RESERVE);
  assert(!serialized.includes(rawPrompt));
  assert(!serialized.includes(secretValue));
  assert(!serialized.includes("token_should_not_appear"));
  assert(!serialized.includes("session_cookie_should_not_appear"));
}

{
  const left = await buildAiCostScopedIdempotencyKey({
    operationConfig: memberOperation(),
    actorId: "user_123",
    billingScopeId: "user_123",
    clientIdempotencyKey: "member-key-123",
  });
  const right = await buildAiCostScopedIdempotencyKey({
    operationConfig: memberOperation(),
    actorId: "user_123",
    billingScopeId: "user_123",
    clientIdempotencyKey: "member-key-123",
  });
  assert.equal(left, right);
  assert.match(left, /^ai-cost:[a-f0-9]{64}$/);
  assert(!left.includes("member-key-123"));
}

await assert.rejects(
  buildAiCostScopedIdempotencyKey({
    operationConfig: memberOperation(),
    clientIdempotencyKey: "bad key",
  }),
  (error) => error instanceof AiCostGatewayError && error.code === "invalid_idempotency_key"
);

await assert.rejects(
  buildAiCostScopedIdempotencyKey({
    operationConfig: memberOperation(),
  }),
  (error) => error instanceof AiCostGatewayError && error.code === "idempotency_key_required"
);

assert.equal(
  await buildAiCostScopedIdempotencyKey({
    operationConfig: memberOperation({ idempotencyPolicy: "optional", billingScope: AI_COST_GATEWAY_SCOPES.EXTERNAL, creditCost: 0, costPolicy: "external" }),
  }),
  null
);
assert.equal(
  await buildAiCostScopedIdempotencyKey({
    operationConfig: adminUnmeteredOperation({ idempotencyPolicy: "forbidden" }),
  }),
  null
);
assert.equal(
  await buildAiCostScopedIdempotencyKey({
    operationConfig: platformBudgetOperation({ idempotencyPolicy: "inherited" }),
  }),
  null
);

{
  const state = classifyAiCostGatewayState({
    operationConfig: memberOperation(),
  });
  assert.equal(state.state, AI_COST_GATEWAY_PHASES.REQUIRES_IDEMPOTENCY);
}

{
  const plan = await createAiCostGatewayPlan({
    operationConfig: memberOperation(),
    actorId: "user_123",
    billingScopeId: "user_123",
    clientIdempotencyKey: "member-key-123",
    body: { prompt: "hello" },
    includePromptHash: true,
  });
  assert.equal(plan.state, AI_COST_GATEWAY_PHASES.READY_TO_RESERVE);
  assert.equal(plan.nextRequiredAction, "create_durable_reservation_before_provider_call");
}

{
  const plan = await createAiCostGatewayPlan({
    operationConfig: platformBudgetOperation(),
    actorId: "openclaw",
    billingScopeId: "news_pulse",
    body: { itemId: "news_123", prompt: "thumbnail" },
    includePromptHash: true,
  });
  assert.equal(plan.state, AI_COST_GATEWAY_PHASES.PLATFORM_BUDGET_REVIEW);
}

{
  const plan = await createAiCostGatewayPlan({
    operationConfig: adminUnmeteredOperation(),
    actorId: "admin_1",
    billingScopeId: "platform_admin",
    body: { prompt: "admin test" },
    includePromptHash: true,
  });
  assert.equal(plan.state, AI_COST_GATEWAY_PHASES.UNMETERED_ADMIN);
}

{
  const plan = await createAiCostGatewayPlan({
    operationConfig: memberOperation({ operationId: "" }),
  });
  assert.equal(plan.state, AI_COST_GATEWAY_PHASES.BLOCKED_INVALID_CONFIG);
  assert.equal(plan.ok, false);
}

{
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error("unexpected fetch call");
  };
  try {
    await createAiCostGatewayPlan({
      operationConfig: memberOperation(),
      actorId: "user_123",
      billingScopeId: "user_123",
      clientIdempotencyKey: "member-key-123",
      body: { prompt: "no external calls" },
      includePromptHash: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0);
}

console.log("AI cost gateway tests passed.");
