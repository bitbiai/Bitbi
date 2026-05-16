import assert from "node:assert/strict";
import {
  ADMIN_PLATFORM_BUDGET_ACTIONS,
  ADMIN_PLATFORM_BUDGET_PLAN_STATUSES,
  ADMIN_PLATFORM_BUDGET_POLICY_VERSION,
  ADMIN_PLATFORM_BUDGET_SCOPES,
  AdminPlatformBudgetPolicyError,
  buildAdminPlatformBudgetAuditFields,
  buildAdminPlatformBudgetFingerprint,
  classifyAdminPlatformBudgetPlan,
  normalizeAdminPlatformBudgetOperation,
  validateAdminPlatformKillSwitchConfig,
} from "../workers/auth/src/lib/admin-platform-budget-policy.js";

function killSwitch(scope, overrides = {}) {
  return {
    flagName: "ENABLE_ADMIN_AI_BUDGETED_CALLS",
    defaultState: "disabled",
    requiredForProviderCall: true,
    disabledBehavior: "fail_closed",
    operatorCanOverride: false,
    scope,
    notes: "Future route migration target only.",
    ...overrides,
  };
}

function operation(overrides = {}) {
  return {
    operationId: "admin.text.test",
    featureKey: "admin.ai.test_text",
    actorType: "admin",
    budgetScope: ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET,
    ownerDomain: "admin-ai",
    providerFamily: "ai_worker",
    modelResolverKey: "admin.text.model_registry",
    providerCost: true,
    estimatedCostUnits: 1,
    estimatedCredits: 0,
    idempotencyPolicy: "required",
    killSwitchPolicy: killSwitch(ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET),
    routeId: "admin.ai.test-text",
    routePath: "/api/admin/ai/test-text",
    auditEventPrefix: "admin.text.test",
    notes: "Future admin text test budget contract.",
    ...overrides,
  };
}

{
  const normalized = normalizeAdminPlatformBudgetOperation(operation());
  assert.equal(normalized.policyVersion, ADMIN_PLATFORM_BUDGET_POLICY_VERSION);
  assert.equal(normalized.budgetScope, ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET);
  assert.equal(normalized.killSwitchPolicy.flagName, "ENABLE_ADMIN_AI_BUDGETED_CALLS");
}

{
  const normalized = normalizeAdminPlatformBudgetOperation(operation({
    operationId: "platform.backfill.visual",
    featureKey: "platform.background.visual",
    actorType: "background",
    budgetScope: ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_BACKGROUND_BUDGET,
    ownerDomain: "platform-background",
    providerFamily: "workers_ai",
    modelResolverKey: "platform.visual_model",
    killSwitchPolicy: killSwitch(ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_BACKGROUND_BUDGET, {
      flagName: "ENABLE_PLATFORM_BACKGROUND_AI_BUDGET",
    }),
  }));
  assert.equal(normalized.actorType, "background");
  assert.equal(normalized.budgetScope, ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_BACKGROUND_BUDGET);
}

{
  const normalized = normalizeAdminPlatformBudgetOperation(operation({
    operationId: "platform.news_pulse.visual.ingest",
    featureKey: "platform.news_pulse.visual",
    actorType: "platform",
    budgetScope: ADMIN_PLATFORM_BUDGET_SCOPES.OPENCLAW_NEWS_PULSE_BUDGET,
    ownerDomain: "openclaw-news-pulse",
    providerFamily: "workers_ai",
    modelResolverKey: "platform.news_pulse.visual_model",
    idempotencyPolicy: "inherited",
    killSwitchPolicy: killSwitch(ADMIN_PLATFORM_BUDGET_SCOPES.OPENCLAW_NEWS_PULSE_BUDGET, {
      flagName: "ENABLE_NEWS_PULSE_VISUAL_BUDGET",
      disabledBehavior: "skip_provider_call",
    }),
  }));
  assert.equal(normalized.budgetScope, ADMIN_PLATFORM_BUDGET_SCOPES.OPENCLAW_NEWS_PULSE_BUDGET);
  assert.equal(normalized.killSwitchPolicy.disabledBehavior, "skip_provider_call");
}

{
  const normalized = normalizeAdminPlatformBudgetOperation(operation({
    operationId: "internal.text.generate",
    featureKey: "internal.ai.text",
    actorType: "internal",
    budgetScope: ADMIN_PLATFORM_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED,
    ownerDomain: "ai-worker",
    providerFamily: "workers_ai",
    modelResolverKey: "internal.text.caller_selected",
    idempotencyPolicy: "caller_enforced",
    killSwitchPolicy: null,
    killSwitchExemptionReason: "Internal service route is caller-enforced; future runtime guard must require caller policy metadata.",
  }));
  assert.equal(normalized.killSwitchPolicy, null);
  assert.equal(normalized.budgetScope, ADMIN_PLATFORM_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED);
}

{
  assert.throws(
    () => normalizeAdminPlatformBudgetOperation(operation({
      operationId: "admin.unmetered.test",
      budgetScope: ADMIN_PLATFORM_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN,
      idempotencyPolicy: "optional",
      killSwitchPolicy: killSwitch(ADMIN_PLATFORM_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN, {
        flagName: "ENABLE_EXPLICIT_UNMETERED_ADMIN_AI",
      }),
      unmeteredJustification: undefined,
    })),
    AdminPlatformBudgetPolicyError
  );
  const normalized = normalizeAdminPlatformBudgetOperation(operation({
    operationId: "admin.unmetered.test",
    budgetScope: ADMIN_PLATFORM_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN,
    idempotencyPolicy: "optional",
    killSwitchPolicy: killSwitch(ADMIN_PLATFORM_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN, {
      flagName: "ENABLE_EXPLICIT_UNMETERED_ADMIN_AI",
    }),
    unmeteredJustification: "Emergency admin-only test path with separate operator review.",
  }));
  assert.equal(normalized.budgetScope, ADMIN_PLATFORM_BUDGET_SCOPES.EXPLICIT_UNMETERED_ADMIN);
}

assert.throws(
  () => normalizeAdminPlatformBudgetOperation(operation({ budgetScope: undefined })),
  /budgetScope/
);
assert.throws(
  () => normalizeAdminPlatformBudgetOperation(operation({
    killSwitchPolicy: null,
    killSwitchExemptionReason: null,
  })),
  /kill-switch policy/
);
assert.throws(
  () => normalizeAdminPlatformBudgetOperation(operation({ idempotencyPolicy: undefined })),
  /idempotencyPolicy/
);
assert.throws(
  () => validateAdminPlatformKillSwitchConfig(killSwitch(ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET, {
    defaultState: "enabled",
  })),
  /safe\/off kill switch defaults/
);

{
  const audit = buildAdminPlatformBudgetAuditFields({
    ...operation(),
    actorUserId: "admin-user-1",
    actorRole: "admin",
    correlationId: "corr-123",
    planStatus: ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.PLATFORM_BUDGET_REVIEW,
    reason: "future migration test",
    prompt: "raw prompt must not appear",
    cookie: "session-cookie-value",
    authorization: "Bearer secret-token",
    stripeSecret: "sk_live_secret",
    privateR2Key: "users/private/key",
  });
  const serialized = JSON.stringify(audit);
  assert.equal(audit.operation_id, "admin.text.test");
  assert.equal(audit.kill_switch_flag_name, "ENABLE_ADMIN_AI_BUDGETED_CALLS");
  assert(!serialized.includes("raw prompt"));
  assert(!serialized.includes("session-cookie-value"));
  assert(!serialized.includes("secret-token"));
  assert(!serialized.includes("sk_live_secret"));
  assert(!serialized.includes("users/private/key"));
}

{
  const first = await buildAdminPlatformBudgetFingerprint({
    operation: operation(),
    actorId: "admin-user-1",
    body: {
      z: 1,
      prompt: "paint a future office",
      nested: { b: 2, a: 1, token: "secret" },
    },
  });
  const second = await buildAdminPlatformBudgetFingerprint({
    operation: operation(),
    actorId: "admin-user-1",
    body: {
      nested: { token: "secret", a: 1, b: 2 },
      prompt: "paint a future office",
      z: 1,
    },
  });
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
}

{
  const plan = classifyAdminPlatformBudgetPlan(operation());
  assert.equal(plan.status, ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.PLATFORM_BUDGET_REVIEW);
  assert.equal(plan.requiredNextAction, ADMIN_PLATFORM_BUDGET_ACTIONS.CHECK_PLATFORM_BUDGET);
  assert.equal(plan.auditFields.budget_scope, ADMIN_PLATFORM_BUDGET_SCOPES.PLATFORM_ADMIN_LAB_BUDGET);
}

{
  const plan = classifyAdminPlatformBudgetPlan(operation({
    operationId: "admin.image.test.charged",
    budgetScope: ADMIN_PLATFORM_BUDGET_SCOPES.ADMIN_ORG_CREDIT_ACCOUNT,
    killSwitchPolicy: killSwitch(ADMIN_PLATFORM_BUDGET_SCOPES.ADMIN_ORG_CREDIT_ACCOUNT, {
      flagName: "ENABLE_ADMIN_ORG_AI_CREDIT_TESTS",
    }),
    estimatedCredits: 1,
  }));
  assert.equal(plan.status, ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.ADMIN_ORG_CREDIT_REQUIRED);
  assert.equal(plan.requiredNextAction, ADMIN_PLATFORM_BUDGET_ACTIONS.CHECK_ADMIN_ORG_CREDITS);
}

{
  const plan = classifyAdminPlatformBudgetPlan(operation({
    operationId: "internal.live_agent",
    featureKey: "internal.ai.live_agent",
    actorType: "internal",
    budgetScope: ADMIN_PLATFORM_BUDGET_SCOPES.INTERNAL_AI_WORKER_CALLER_ENFORCED,
    ownerDomain: "ai-worker",
    providerFamily: "workers_ai",
    modelResolverKey: "internal.live_agent.model",
    idempotencyPolicy: "caller_enforced",
    killSwitchPolicy: null,
    killSwitchExemptionReason: "Service route must be caller-enforced by a future route-policy guard.",
  }));
  assert.equal(plan.status, ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.CALLER_ENFORCED);
  assert.equal(plan.requiredNextAction, ADMIN_PLATFORM_BUDGET_ACTIONS.REQUIRE_CALLER_POLICY);
}

{
  const plan = classifyAdminPlatformBudgetPlan(operation({
    killSwitchPolicy: null,
    killSwitchExemptionReason: null,
  }));
  assert.equal(plan.status, ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.REQUIRES_KILL_SWITCH);
  assert.equal(plan.requiredNextAction, ADMIN_PLATFORM_BUDGET_ACTIONS.REQUIRE_KILL_SWITCH);
}

{
  const plan = classifyAdminPlatformBudgetPlan({ ...operation(), operationId: "" });
  assert.equal(plan.ok, false);
  assert.equal(plan.status, ADMIN_PLATFORM_BUDGET_PLAN_STATUSES.INVALID_CONFIG);
}

{
  const secretValue = "budget-policy-secret-value";
  process.env.ADMIN_PLATFORM_BUDGET_SECRET = secretValue;
  const output = JSON.stringify({
    normalized: normalizeAdminPlatformBudgetOperation(operation()),
    plan: classifyAdminPlatformBudgetPlan(operation()),
  });
  assert(!output.includes(secretValue));
  delete process.env.ADMIN_PLATFORM_BUDGET_SECRET;
}

{
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error("unexpected provider call");
  };
  try {
    normalizeAdminPlatformBudgetOperation(operation());
    classifyAdminPlatformBudgetPlan(operation());
    await buildAdminPlatformBudgetFingerprint({ operation: operation(), body: { prompt: "hash me" } });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0);
}

console.log("Admin/platform budget policy tests passed.");
