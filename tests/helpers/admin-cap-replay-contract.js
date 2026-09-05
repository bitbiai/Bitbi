const { test, expect } = require('@playwright/test');

function registerAdminCapReplayContractTests({ createAdminAiContractHarness, authJsonRequest, createExecutionContext }) {
  test('REL-01 actual Admin route returns the unresolved receipt when its exposure fills the cap', async () => {
    let providerCalls = 0;
    const { authWorker, env, authHeaders, aiLabRequests } = await createAdminAiContractHarness({
      aiRun: async () => { providerCalls += 1; throw new Error('local provider response lost after possible dispatch'); },
    });
    const payload = { preset: 'balanced', prompt: 'Local unresolved cap fixture', maxTokens: 80 };
    const headers = { ...authHeaders, 'Idempotency-Key': 'admin-unresolved-cap-same-operation' };
    const invoke = () => authWorker.fetch(authJsonRequest('/api/admin/ai/test-text', 'POST', payload, headers), env, createExecutionContext().execCtx);
    const first = await invoke();
    expect(first.status).toBeGreaterThanOrEqual(500);
    expect(providerCalls).toBe(1);
    expect(env.DB.state.adminAiUsageAttempts).toHaveLength(1);
    const receipt = env.DB.state.adminAiUsageAttempts[0];
    expect(receipt.provider_outcome).toBe('unknown');
    expect(receipt.platform_exposure_units).toBeGreaterThan(0);
    // A local fixture sets exactly the already-admitted operation's exposure.
    for (const limit of env.DB.state.platformBudgetLimits) {
      if (limit.budget_scope === receipt.budget_scope) limit.limit_units = receipt.platform_exposure_units;
    }
    const second = await invoke();
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: 'admin_ai_outcome_unknown', idempotency: { attempt_id: receipt.id, provider_outcome: 'unknown' } });
    expect(providerCalls).toBe(1);
    expect(aiLabRequests).toHaveLength(1);
    expect(env.DB.state.adminAiUsageAttempts).toHaveLength(1);
    expect(env.DB.state.platformBudgetUsageEvents).toHaveLength(0);
  });
}
module.exports = { registerAdminCapReplayContractTests };
