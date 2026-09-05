const { test, expect } = require('@playwright/test');
const { createAuthTestEnv, createExecutionContext, loadWorker, nowIso, seedSession } = require('../../helpers/auth-worker-harness');
const { deferred, withDeadlineClock } = require('../../helpers/generation-timeout-contract');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jc1kAAAAASUVORK5CYII=';

async function fixture(aiRun) {
  const user = { id: 'rel01-route-user', email: 'rel01-route@example.invalid', password_hash: 'unused', created_at: nowIso(), status: 'active', role: 'user', email_verified_at: nowIso(), verification_method: 'email_verified' };
  const env = createAuthTestEnv({ users: [user], aiRun });
  const worker = await loadWorker('workers/auth/src/index.js');
  const session = await seedSession(env, user.id);
  const send = (key = 'rel01-same-operation') => worker.fetch(new Request('https://bitbi.ai/api/ai/generate-image', {
    method: 'POST', headers: { Origin: 'https://bitbi.ai', Cookie: `bitbi_session=${session}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ prompt: 'Local mocked image', steps: 4 }),
  }), env, createExecutionContext().execCtx);
  return { env, send };
}

for (const late of ['success', 'failure']) {
  test(`REL-01 actual member image route: unknown timeout blocks replay and records late ${late}`, async () => {
    const started = deferred(), provider = deferred();
    let calls = 0, signal;
    const { env, send } = await fixture(async (_model, _payload, options) => {
      calls += 1; signal = options.signal; started.resolve();
      if (calls > 1) return { image: PNG }; // Only an explicitly new operation may reach this.
      return provider.promise; // Deliberately ignores abort; no real provider call.
    });
    await withDeadlineClock(async (clock) => {
      const initial = send();
      await started.promise;
      expect((await send()).status).toBe(409);
      expect(calls).toBe(1);
      clock.expire();
      expect((await initial).status).toBe(504);
      const attempt = env.DB.state.memberAiUsageAttempts[0];
      const originalExpiry = attempt.expires_at;
      expect(attempt).toMatchObject({ provider_outcome: 'unknown', billing_status: 'reserved' });
      const duplicate = await send();
      expect(duplicate.status).toBe(409);
      expect((await duplicate.json()).code).toBe('ai_usage_outcome_unknown');
      expect(calls).toBe(1);
      expect(env.DB.state.memberAiUsageAttempts).toHaveLength(1);
      expect(attempt.expires_at).toBe(originalExpiry);
      expect(env.DB.state.memberUsageEvents).toHaveLength(0);
      expect(signal.aborted).toBe(true);
      if (late === 'success') provider.resolve({ image: PNG });
      else provider.reject(Object.assign(new Error('Local late failure'), { code: 'local_late_failure' }));
      await new Promise(resolve => setImmediate(resolve));
      expect(attempt.late_outcome).toBe(late === 'success' ? 'succeeded' : 'failed');
      expect(attempt).toMatchObject({ provider_outcome: 'unknown', billing_status: 'reserved' });
      expect(env.DB.state.memberCreditLedger.filter(row => row.amount < 0)).toHaveLength(0);
      expect(env.USER_IMAGES.objects.size).toBe(0);
      // Identical input is not deduplicated forever: the user can explicitly
      // request a separate operation under the existing rate/credit guards.
      const next = await send('rel01-explicit-new-operation');
      expect(next.status).toBe(200);
      expect(calls).toBe(2);
      expect(env.DB.state.memberAiUsageAttempts).toHaveLength(2);
      expect(env.DB.state.memberUsageEvents).toHaveLength(1);
      expect(env.DB.state.memberCreditLedger.filter(row => row.amount < 0)).toHaveLength(1);
      expect(attempt.provider_outcome).toBe('unknown');
      expect(clock.pending()).toBe(0);
    });
  });
}

test('REL-01 actual member image route: response body stall expires and cancels the owned reader', async () => {
  let calls = 0, cancellations = 0;
  const reading = deferred();
  const stream = new ReadableStream({ pull() { reading.resolve(); }, cancel() { cancellations += 1; } });
  const { env, send } = await fixture(async () => { calls += 1; return new Response(stream, { headers: { 'content-type': 'image/png' } }); });
  await withDeadlineClock(async (clock) => {
    const initial = send();
    await reading.promise;
    // Wait until actual extraction has acquired the stream, not merely its
    // eager constructor pull, before expiring the manually controlled deadline.
    for (let turn = 0; turn < 20 && !stream.locked; turn += 1) await new Promise(resolve => setImmediate(resolve));
    expect(stream.locked).toBe(true);
    clock.expire();
    expect((await initial).status).toBe(504);
    await new Promise(resolve => setImmediate(resolve));
    expect(cancellations).toBe(1);
    expect(stream.locked).toBe(false);
    expect((await send()).status).toBe(409);
    expect(calls).toBe(1);
    expect(env.DB.state.memberAiUsageAttempts[0].provider_outcome).toBe('unknown');
    expect(env.DB.state.memberUsageEvents).toHaveLength(0);
    expect(env.USER_IMAGES.objects.size).toBe(0);
    expect(clock.pending()).toBe(0);
  });
});
