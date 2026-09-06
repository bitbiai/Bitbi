const { test, expect } = require('@playwright/test');
const { createAuthTestEnv, loadWorker } = require('./helpers/auth-worker-harness.js');
const { isBillingSql, executeNativeBilling } = require('./helpers/q2-mock-billing.js');

const member = { id: 'q2-billing-mock-member', role: 'user', status: 'active', email_verified: 1 };
const makeEnv = extra => createAuthTestEnv({ users: [{ ...member }], ...extra });
const billing = () => loadWorker('workers/auth/src/lib/billing.js');
const grant = env => ({ env, userId: member.id, amount: 300, createdByUserId: member.id, idempotencyKey: 'q2-mock-grant' });
const pack = env => ({
  env, userId: member.id, amount: 5000, createdByUserId: member.id,
  idempotencyKey: 'q2-mock-pack', source: 'stripe_live_checkout', reason: 'credit_pack:live_credits_5000',
  checkoutGuard: { sql: "EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active')", bindings: [member.id] },
});
const total = env => env.DB.state.memberCreditBuckets.reduce((sum, row) => sum + row.balance, 0);

// These cases calibrate the mutable-fixture adapter, not D1 or signed HTTP.
// The separate q2-billing-pack suite supplies full-schema/native HTTP evidence.
test('B03 mock calibration actual generic grant preserves replay and bucket evidence', async () => {
  const env = makeEnv();
  const api = await billing();
  expect((await api.grantMemberCredits(grant(env))).creditBalance).toBe(300);
  expect((await api.grantMemberCredits(grant(env))).reused).toBe(true);
  expect(total(env)).toBe(300);
  expect(env.DB.state.memberCreditLedger).toHaveLength(1);
  expect(env.DB.state.memberCreditBucketEvents).toHaveLength(1);
  expect(env.DB.state.memberCreditBucketEvents[0].member_credit_ledger_id).toBe(env.DB.state.memberCreditLedger[0].id);
});

test('B03 mock calibration actual daily grant remains once per day beside generic grant', async () => {
  const env = makeEnv();
  const api = await billing();
  const request = { env, userId: member.id, now: '2026-09-06T12:00:00.000Z' };
  expect((await api.topUpMemberDailyCredits(request)).grantedCredits).toBe(10);
  expect((await api.topUpMemberDailyCredits(request)).reused).toBe(true);
  await api.grantMemberCredits(grant(env));
  expect(total(env)).toBe(310);
  expect(env.DB.state.memberCreditLedger).toHaveLength(2);
  expect(env.DB.state.memberCreditBucketEvents).toHaveLength(2);
});

test('B03 mock calibration bucket failure rolls back actual grant and seeds before retry', async () => {
  const env = makeEnv({ failQueries: ['INSERT INTO member_credit_bucket_events'] });
  const api = await billing();
  await expect(api.grantMemberCredits(grant(env))).rejects.toThrow('forced query failure');
  expect(env.DB.state.memberCreditLedger).toHaveLength(0);
  expect(env.DB.state.memberCreditBuckets).toHaveLength(0);
  expect(env.DB.state.memberCreditBucketEvents).toHaveLength(0);
  env.DB.failQueries = [];
  expect((await api.grantMemberCredits(grant(env))).creditBalance).toBe(300);
});

for (const guard of ['false', 'became-inactive']) {
  test(`B03 mock calibration actual pack ${guard} guard aborts the whole batch`, async () => {
    const env = makeEnv();
    const api = await billing();
    const request = pack(env);
    if (guard === 'false') request.checkoutGuard = { sql: '0', bindings: [] };
    const plan = await api.prepareAtomicCreditPackGrant(request);
    if (guard === 'became-inactive') env.DB.state.users[0].status = 'suspended';
    await expect(env.DB.batch(plan.statements)).rejects.toThrow(/NOT NULL/);
    expect(env.DB.state.memberCreditLedger).toHaveLength(0);
    expect(env.DB.state.memberCreditBuckets).toHaveLength(0);
    expect(env.DB.state.memberCreditBucketEvents).toHaveLength(0);
  });
}

test('B03 mock calibration two prepared same-identity packs serialize and expose reused result', async () => {
  const env = makeEnv();
  const api = await billing();
  const a = await api.prepareAtomicCreditPackGrant(pack(env));
  const b = await api.prepareAtomicCreditPackGrant(pack(env));
  await env.DB.batch(a.statements);
  await env.DB.batch(b.statements);
  expect((await a.result()).reused).toBe(false);
  expect((await b.result()).reused).toBe(true);
  expect(total(env)).toBe(5000);
  expect(env.DB.state.memberCreditLedger).toHaveLength(1);
  expect(env.DB.state.memberCreditBucketEvents).toHaveLength(1);
});

test('B03 mock calibration prepared conflicting pack hash rolls back without overwriting winner', async () => {
  const env = makeEnv();
  const api = await billing();
  const a = await api.prepareAtomicCreditPackGrant(pack(env));
  const b = await api.prepareAtomicCreditPackGrant({ ...pack(env), reason: 'different-pack-intent' });
  await env.DB.batch(a.statements);
  const before = JSON.stringify(env.DB.state.memberCreditLedger);
  await expect(env.DB.batch(b.statements)).rejects.toThrow(/NOT NULL/);
  expect(JSON.stringify(env.DB.state.memberCreditLedger)).toBe(before);
  expect(total(env)).toBe(5000);
  expect(env.DB.state.memberCreditBucketEvents).toHaveLength(1);
});

test('B03 mock calibration missing actor is not fabricated to satisfy actual ledger FK', async () => {
  const env = makeEnv();
  const api = await billing();
  await expect(api.grantMemberCredits({ ...grant(env), createdByUserId: 'q2-missing-actor' })).rejects.toThrow(/FOREIGN KEY/);
  expect(env.DB.state.users).toHaveLength(1);
  expect(env.DB.state.memberCreditLedger).toHaveLength(0);
  expect(env.DB.state.memberCreditBuckets).toHaveLength(0);
});

test('B03 mock calibration new SQL preserves missing-table policy and unsupported forms fail closed', async () => {
  const env = makeEnv({ missingTables: ['member_credit_ledger'] });
  await expect(env.DB.prepare('SELECT * FROM member_credit_ledger WHERE id = ?').bind('missing').first()).rejects.toThrow('no such table');
  expect(isBillingSql('UPDATE users SET status = ? WHERE id = ?')).toBe(false);
  expect(isBillingSql('INSERT INTO member_credit_ledger (id) VALUES (?)')).toBe(false);
  expect(() => executeNativeBilling(env.DB, [{ query: 'SELECT unknown_fixture_success', bindings: [], mode: 'first' }])).toThrow('unsupported SQL form');
});

test('B03 mock calibration SQL reconciliation reads current sum and preserves existing row handles', async () => {
  const env = makeEnv();
  const api = await billing();
  await api.grantMemberCredits(grant(env));
  const bonus = env.DB.state.memberCreditBuckets.find(row => row.bucket_type === 'legacy_or_bonus');
  const plan = await api.prepareAtomicCreditPackGrant(pack(env));
  await env.DB.batch(plan.statements);
  await api.getMemberCreditBalance(env, member.id);
  expect(env.DB.state.memberCreditBuckets.find(row => row.id === bonus.id)).toBe(bonus);
  expect(bonus.balance).toBe(300);
  expect(total(env)).toBe(5300);
});

for (const completed of [false, true]) {
  test(`B03 mock calibration actual late-failure write respects completed receipt ${completed}`, async () => {
    const id = 'bpe_0123456789abcdef0123456789abcdef';
    const now = '2026-09-06T12:00:00.000Z';
    const env = makeEnv({
      billingProviderEvents: [{
        id, provider: 'stripe', provider_event_id: 'evt_q2_mock_receipt', provider_mode: 'live',
        event_type: 'checkout.session.completed', received_at: now, processing_status: 'planned',
        verification_status: 'verified_live_signature', dedupe_key: 'q2-mock-receipt', payload_hash: 'synthetic-hash',
        payload_summary_json: '{}', created_at: now, updated_at: now,
      }],
      billingEventActions: [{
        id: 'bea_q2_mock_receipt', event_id: id, action_type: 'checkout.session.completed',
        status: 'planned', dry_run: 0,
        summary_json: JSON.stringify(completed ? { fulfillmentStatus: 'completed' } : {}),
        created_at: now, updated_at: now,
      }],
    });
    const api = await loadWorker('workers/auth/src/lib/billing-events.js');
    await api.updateBillingProviderEventProcessing(env, {
      eventId: id, processingStatus: 'failed', errorCode: 'q2-synthetic-late-error',
      actionType: 'checkout.session.completed', actionStatus: 'failed', actionSummary: { failed: true },
    });
    expect(env.DB.state.billingProviderEvents[0].processing_status).toBe(completed ? 'planned' : 'failed');
    expect(env.DB.state.billingEventActions[0].status).toBe(completed ? 'planned' : 'failed');
    expect(JSON.parse(env.DB.state.billingEventActions[0].summary_json)).toEqual(completed ? { fulfillmentStatus: 'completed' } : { failed: true });
  });
}

test('B03 mock calibration nonfailed receipt updates retain the original SQL and binding contract', async () => {
  const id = 'bpe_abcdef0123456789abcdef0123456789';
  const now = '2026-09-06T12:00:00.000Z';
  const env = makeEnv({
    billingProviderEvents: [{
      id, provider: 'stripe', provider_event_id: 'evt_q2_mock_nonfailed', provider_mode: 'live',
      event_type: 'checkout.session.completed', received_at: now, processing_status: 'planned',
      verification_status: 'verified_live_signature', dedupe_key: 'q2-mock-nonfailed', payload_hash: 'synthetic-hash',
      payload_summary_json: '{}', created_at: now, updated_at: now,
    }],
    billingEventActions: [{
      id: 'bea_q2_mock_nonfailed', event_id: id, action_type: 'checkout.session.completed', status: 'planned',
      dry_run: 0, summary_json: JSON.stringify({ fulfillmentStatus: 'completed' }), created_at: now, updated_at: now,
    }],
  });
  const api = await loadWorker('workers/auth/src/lib/billing-events.js');
  const summary = { fulfillmentStatus: 'completed', observed: true };
  await api.updateBillingProviderEventProcessing(env, {
    eventId: id, processingStatus: 'planned', userId: member.id,
    actionType: 'checkout.session.completed', actionStatus: 'planned', actionSummary: summary,
  });
  expect(env.DB.state.billingProviderEvents[0]).toMatchObject({ processing_status: 'planned', user_id: member.id });
  expect(JSON.parse(env.DB.state.billingEventActions[0].summary_json)).toEqual(summary);
  const updates = env.DB.runCalls.filter(row => /^UPDATE billing_(provider_events|event_actions) /.test(row.query));
  expect(updates).toHaveLength(2);
  expect(updates.map(row => row.bindings.length)).toEqual([9, 6]);
  expect(updates.every(row => !isBillingSql(row.query))).toBe(true);
});
