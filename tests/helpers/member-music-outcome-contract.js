const { test, expect } = require('@playwright/test');

function registerMemberMusicOutcomeContractTests({ createMemberMusicHarness, postGenerateMusic }) {
  test('REL-01 member music preserves parsed MiniMax failure without debit or same-key redispatch', async () => {
    const f = await createMemberMusicHarness({ aiRun: async () => ({ base_resp: { status_code: 40013, status_msg: 'provider rejected request' } }) });
    const request = () => postGenerateMusic({ worker: f.authWorker, env: f.env, token: f.token,
      body: { lyrics: '[Verse]\nLocal provider rejection fixture' }, idempotencyKey: 'member-known-music-failure' });
    const first = await request();
    expect(first.status).toBe(502);
    expect(await first.json()).toMatchObject({ code: 'upstream_error' });
    expect(first.headers.has('x-bitbi-provider-outcome')).toBe(false);
    expect(f.env.DB.state.memberAiUsageAttempts[0]).toMatchObject({ provider_outcome: 'failed', provider_status: 'failed', billing_status: 'released' });
    const second = await request();
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: 'ai_usage_confirmed_failed' });
    expect(f.calls).toHaveLength(1);
    expect(f.env.DB.state.memberCreditLedger.filter((row) => row.entry_type === 'consume')).toHaveLength(0);
    expect(f.env.DB.state.memberUsageEvents).toHaveLength(0);
    expect(f.env.DB.state.aiTextAssets).toHaveLength(0);
  });

  test('REL-01 member music retains confirmed invalid-output completion without charging or retrying', async () => {
    const f = await createMemberMusicHarness(); let calls = 0;
    // Explicit trusted-service fixture; actual AI completed-output parsing is
    // covered by the Admin ElevenLabs contract cases without model activation.
    f.env.AI_LAB = { fetch: async (request) => {
      expect(new URL(request.url).pathname).toBe('/internal/ai/test-music'); calls += 1;
      return Response.json({ ok: false, code: 'provider_output_validation_failed', error: 'The provider completed the generation, but BITBI could not validate the returned audio output.' },
        { status: 502, headers: { 'x-bitbi-provider-outcome': 'succeeded' } });
    } };
    const request = () => postGenerateMusic({ worker: f.authWorker, env: f.env, token: f.token,
      body: { lyrics: '[Verse]\nLocal completed-output fixture' }, idempotencyKey: 'member-known-music-invalid-output' });
    const first = await request();
    expect(first.status).toBe(502);
    expect(await first.json()).toMatchObject({ code: 'provider_output_validation_failed' });
    expect(first.headers.has('x-bitbi-provider-outcome')).toBe(false);
    expect(f.env.DB.state.memberAiUsageAttempts[0]).toMatchObject({ status: 'billing_failed', provider_outcome: 'succeeded', provider_status: 'succeeded', billing_status: 'failed', result_status: 'none' });
    const second = await request();
    expect(second.status).toBe(503);
    expect(calls).toBe(1);
    expect(f.env.DB.state.memberCreditLedger.filter((row) => row.entry_type === 'consume')).toHaveLength(0);
    expect(f.env.DB.state.memberUsageEvents).toHaveLength(0);
    expect(f.env.DB.state.aiTextAssets).toHaveLength(0);
  });
}
module.exports = { registerMemberMusicOutcomeContractTests };
