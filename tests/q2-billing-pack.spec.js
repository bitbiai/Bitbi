const { test, expect } = require('@playwright/test');
const { createHmac } = require('node:crypto');
const { startWorkerHttp } = require('./helpers/q2-http.js');
const { withMfaFixture, load } = require('./q2-mfa-fixtures.cjs');

// Actual signed HTTP bytes -> Auth Worker.fetch -> billing routes and real
// guards -> native migrated SQLite. No provider, live D1 or real TLS is used.
const MEMBER = 'q2-pack-member';
const ORG = 'org_' + 'e'.repeat(32);
const SECRET = 'whsec_q2_test-synthetic_pack_signing_only';
const REPAIR_PATH = '/api/admin/billing/live-credit-pack-repairs';
let worker;
let events;
let billing;
test.beforeAll(async () => {
  worker = (await load('workers/auth/src/index.js')).default;
  events = await load('workers/auth/src/lib/billing-events.js');
  billing = await load('workers/auth/src/lib/billing.js');
});

function checkoutDefinition(scope = 'member', suffix = 'first') {
  const mode = scope === 'test-organization' ? 'test' : 'live';
  return { scope, mode, member: scope === 'member', id: `q2-pack-${scope}-${suffix}`,
    session: `cs_${mode}_q2_pack_${scope.replaceAll('-', '_')}_${suffix}`,
    pack: mode === 'test' ? 'credits_5000' : 'live_credits_5000', credits: 5000,
    amount: mode === 'test' ? 4900 : 999, currency: 'eur' };
}

async function seedCheckout(f, c) {
  c.user = c.scope === 'test-organization' ? f.user.id : MEMBER;
  const table = c.member ? 'billing_member_checkout_sessions' : 'billing_checkout_sessions';
  await f.db.prepare(`INSERT INTO ${table}
    (id,provider,provider_mode,provider_checkout_session_id,${c.member ? '' : 'organization_id,'}
     user_id,credit_pack_id,credits,amount_cents,currency,status,idempotency_key_hash,
     request_fingerprint_hash,authorization_scope,metadata_json,created_at,updated_at)
    VALUES (?,'stripe',?,?,${c.member ? '' : '?,'}?,?,?,?,?,'created',?,?,?,'{}',?,?)`)
    .bind(c.id, c.mode, c.session, ...(!c.member ? [ORG] : []), c.user, c.pack, c.credits, c.amount, c.currency,
      createHmac('sha256', 'synthetic-idempotency').update(c.id).digest('hex'), 'b'.repeat(64),
      c.member ? 'member' : c.mode === 'test' ? 'platform_admin' : 'org_owner', new Date().toISOString(), new Date().toISOString()).run();
  return c;
}

async function withPack(run, scope = 'member') {
  return withMfaFixture(async (f) => {
    const originalFetch = globalThis.fetch;
    let denied = 0;
    const deny = async () => { denied += 1; throw new Error('Unexpected provider/network call in Q2 billing fixture'); };
    globalThis.fetch = deny;
    Object.assign(f.env, { STRIPE_LIVE_WEBHOOK_SECRET: SECRET, STRIPE_WEBHOOK_SECRET: SECRET,
      STRIPE_MODE: 'test', __TEST_FETCH: deny, AI: { run: deny }, AI_LAB: { fetch: deny } });
    let http;
    try {
      await f.db.prepare(`INSERT INTO users (id,email,password_hash,created_at,role,status,email_verified_at)
        VALUES (?,?,'synthetic-unused',?,'user','active',?)`)
        .bind(MEMBER, 'pack-member@example.invalid', new Date().toISOString(), new Date().toISOString()).run();
      await f.db.prepare(`INSERT INTO organizations (id,name,slug,status,created_by_user_id,created_at,updated_at)
        VALUES (?, 'Synthetic Q2 pack organization', 'q2-pack-org', 'active', ?, ?, ?)`)
        .bind(ORG, MEMBER, new Date().toISOString(), new Date().toISOString()).run();
      await f.db.prepare(`INSERT INTO organization_memberships (id,organization_id,user_id,role,status,created_at,updated_at)
        VALUES ('q2-pack-membership',?,?,'owner','active',?,?)`)
        .bind(ORG, MEMBER, new Date().toISOString(), new Date().toISOString()).run();
      // Real entitlement row: the paid organization fixture explicitly permits 5000.
      f.db.exec("UPDATE entitlements SET value_numeric = 100000 WHERE id = 'ent_free_credits_balance_max'");
      const proofCookies = f.enabled.response.headers.getSetCookie().map(value => value.split(';')[0]);
      f.adminCookie = [f.sessionCookie(), ...proofCookies].join('; ');
      const memberSession = await f.session.createSession(f.env, MEMBER);
      f.memberCookie = `${f.cookies.SECURE_SESSION_COOKIE_NAME}=${memberSession.sessionToken}`;
      f.checkout = await seedCheckout(f, checkoutDefinition(scope));
      http = await startWorkerHttp(worker, f.env);
      f.http = http;
      await run(f);
      expect(denied).toBe(0);
      expect(f.db.database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      if (http) await http.close();
      globalThis.fetch = originalFetch;
    }
  });
}

function payload(c, eventId = 'evt_q2_pack_first') {
  return { id: eventId, object: 'event', type: 'checkout.session.completed', livemode: c.mode === 'live',
    created: Math.floor(Date.now() / 1000), data: { object: {
      id: c.session, object: 'checkout.session', livemode: c.mode === 'live', mode: 'payment', payment_status: 'paid',
      amount_total: c.amount, currency: c.currency, customer: 'cus_q2_pack_fixture',
      payment_intent: `pi_${c.mode}_q2_pack_fixture`, metadata: {
        checkout_scope: c.member ? 'member' : 'organization', user_id: c.user, credit_pack_id: c.pack,
        credits: String(c.credits), internal_checkout_session_id: c.id, ...(!c.member ? { organization_id: ORG } : {}),
      },
    } } };
}

async function deliver(f, data = payload(f.checkout), { endpointMode = f.checkout.mode, invalidSignature = false, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(data);
  const digest = createHmac('sha256', SECRET).update(`${timestamp}.${raw}`).digest('hex');
  const response = await f.http.request(`/api/billing/webhooks/stripe${endpointMode === 'live' ? '/live' : ''}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.42',
      'Stripe-Signature': `t=${timestamp},v1=${invalidSignature ? '0'.repeat(64) : digest}` }, body: raw,
  });
  return { response, body: await response.json() };
}

function repairBody(c) {
  return { checkout_id: c.id, stripe_checkout_session_id: c.session,
    expected_credit_pack_id: c.pack, expected_credits: c.credits, expected_amount_cents: c.amount, expected_currency: c.currency,
    dry_run: false, confirm: true, confirmation: 'repair_paid_member_credit_pack_checkout',
    reason: 'Synthetic operator confirms paid checkout evidence.',
    evidence: { evidence_mode: 'operator_attested_paid_stripe_checkout', livemode: true, mode: 'payment', payment_status: 'paid',
      credit_pack_id: c.pack, credits: c.credits, amount_cents: c.amount, currency: c.currency, user_id: c.user,
      internal_checkout_session_id: c.id },
  };
}

async function repair(f, body = repairBody(f.checkout), { cookie = f.adminCookie, key = 'q2-pack-repair-first', origin = 'https://bitbi.ai' } = {}) {
  const response = await f.http.request(REPAIR_PATH, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.43',
    ...(cookie ? { Cookie: cookie } : {}), ...(key ? { 'Idempotency-Key': key } : {}), ...(origin ? { Origin: origin } : {}),
  }, body: JSON.stringify(body) });
  return { response, body: await response.json() };
}

function state(f, c = f.checkout) {
  const ledger = c.member ? 'member_credit_ledger' : 'credit_ledger';
  const owner = c.member ? 'user_id' : 'organization_id';
  const id = c.member ? c.user : ORG;
  const table = c.member ? 'billing_member_checkout_sessions' : 'billing_checkout_sessions';
  return {
    ledger: f.db.database.prepare(`SELECT id,amount,balance_after,idempotency_key FROM ${ledger} WHERE ${owner} = ? ORDER BY rowid`).all(id),
    buckets: c.member ? f.db.database.prepare('SELECT bucket_type,balance FROM member_credit_buckets WHERE user_id = ? ORDER BY bucket_type').all(id) : [],
    bucketEvents: c.member ? f.db.database.prepare('SELECT amount,member_credit_ledger_id FROM member_credit_bucket_events WHERE user_id = ? ORDER BY rowid').all(id) : [],
    checkout: f.db.database.prepare(`SELECT status,payment_status,${c.member ? 'member_credit_ledger_entry_id' : 'credit_ledger_entry_id'} AS ledger_id FROM ${table} WHERE id = ?`).get(c.id),
    events: f.db.database.prepare('SELECT processing_status,error_code,attempt_count FROM billing_provider_events ORDER BY rowid').all(),
    actions: f.db.database.prepare('SELECT status,dry_run,summary_json FROM billing_event_actions ORDER BY rowid').all().map(row => ({ ...row, summary: JSON.parse(row.summary_json) })),
  };
}

function assertUnfulfilled(f) {
  const s = state(f);
  expect(s.ledger).toEqual([]);
  expect(s.buckets).toEqual([]);
  expect(s.bucketEvents).toEqual([]);
  expect(s.checkout).toEqual({ status: 'created', payment_status: null, ledger_id: null });
}
function assertFulfilled(f, { grants = 1, allEventsCompleted = true } = {}) {
  const s = state(f);
  expect(s.ledger).toHaveLength(grants);
  expect(s.ledger.reduce((sum, row) => sum + row.amount, 0)).toBe(5000 * grants);
  expect(s.ledger.at(-1).balance_after).toBe(5000 * grants);
  expect(s.checkout).toEqual({ status: 'completed', payment_status: 'paid', ledger_id: s.ledger[0].id });
  if (f.checkout.member) {
    expect(s.buckets.find(row => row.bucket_type === 'purchased').balance).toBe(5000 * grants);
    expect(s.buckets.reduce((sum, row) => sum + row.balance, 0)).toBe(5000 * grants);
    expect(s.bucketEvents).toHaveLength(grants);
    expect(s.bucketEvents.reduce((sum, row) => sum + row.amount, 0)).toBe(5000 * grants);
  }
  if (allEventsCompleted) {
    expect(s.actions).toHaveLength(s.events.length);
    expect(s.events.every(row => row.processing_status === 'planned' && row.error_code === null)).toBe(true);
    expect(s.actions.every(row => row.status === 'planned' && row.dry_run === 0 && row.summary.fulfillmentStatus === 'completed')).toBe(true);
  }
  return s;
}

function packBatchBarrier(db, { count = 2, afterCommitError = false } = {}) {
  const original = db.batch.bind(db);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let arrivals = 0;
  db.batch = async statements => {
    if (!statements.some(statement => /INSERT INTO (?:member_)?credit_ledger/.test(statement.sql))) return original(statements);
    arrivals += 1;
    if (arrivals <= count) {
      if (arrivals === count) release();
      await gate;
    }
    const results = await original(statements);
    if (afterCommitError && arrivals === 1) throw new Error('Synthetic acknowledgement lost after committed pack batch');
    return results;
  };
  return { restore: () => { release(); db.batch = original; }, arrivals: () => arrivals };
}

function failureTrigger(f, stage) {
  const c = f.checkout;
  const ledger = c.member ? 'member_credit_ledger' : 'credit_ledger';
  const checkout = c.member ? 'billing_member_checkout_sessions' : 'billing_checkout_sessions';
  const statements = {
    ledger: `BEFORE INSERT ON ${ledger}`,
    bucket: "BEFORE UPDATE ON member_credit_buckets WHEN NEW.bucket_type = 'purchased' AND NEW.balance > OLD.balance",
    checkout: `BEFORE UPDATE ON ${checkout} WHEN NEW.status = 'completed'`,
    event: "BEFORE UPDATE ON billing_provider_events WHEN NEW.user_id IS NOT NULL AND NEW.error_code IS NULL",
    action: "BEFORE UPDATE ON billing_event_actions WHEN NEW.dry_run = 0 AND NEW.status = 'planned'",
  };
  f.db.exec(`CREATE TEMP TRIGGER q2_pack_failure ${statements[stage]} BEGIN SELECT RAISE(ABORT, 'synthetic pack stage failure'); END;`);
  return () => f.db.exec('DROP TRIGGER q2_pack_failure');
}

for (const scope of ['member', 'organization', 'test-organization']) {
  test(`Q2 B03 ${scope}: signed HTTP payment grants exactly 5000; same event and second event do not grant twice`, async () => withPack(async f => {
    const first = await deliver(f);
    expect(first.response.status).toBe(202);
    expect(first.body.creditGrant.creditsGranted).toBe(5000);
    assertFulfilled(f);
    const again = await deliver(f);
    expect(again.response.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.creditGrant.creditsGranted).toBe(0);
    const secondEvent = await deliver(f, payload(f.checkout, 'evt_q2_pack_second'));
    expect(secondEvent.response.status).toBe(202);
    expect(secondEvent.body.creditGrant.creditsGranted).toBe(0);
    assertFulfilled(f);
  }, scope));

  test(`Q2 B03 ${scope}: concurrent duplicate receipts and two event identities share one checkout fulfillment`, async () => withPack(async f => {
    const barrier = packBatchBarrier(f.db);
    try {
      const results = await Promise.all([deliver(f), deliver(f)]);
      expect(results.map(r => r.response.status).sort()).toEqual([200, 202]);
      expect(results.reduce((n, r) => n + r.body.creditGrant.creditsGranted, 0)).toBe(5000);
    } finally { barrier.restore(); }
    assertFulfilled(f);
  }, scope));
}

for (const stage of ['ledger', 'bucket', 'checkout', 'event', 'action']) {
  test(`Q2 B03 member: ${stage} failure rolls all fulfillment back; same signed event resumes to exactly 5000`, async () => withPack(async f => {
    const remove = failureTrigger(f, stage);
    const failed = await deliver(f);
    expect(failed.response.status).toBe(503);
    assertUnfulfilled(f);
    expect(state(f).events[0].processing_status).toBe('failed');
    remove();
    const resumed = await deliver(f);
    expect(resumed.response.status).toBe(200);
    expect(resumed.body.creditGrant.creditsGranted).toBe(5000);
    expect(state(f).events[0].attempt_count).toBe(2);
    assertFulfilled(f);
  }));
}

for (const scope of ['organization', 'test-organization']) {
  test(`Q2 B03 ${scope}: receipt survives grant failure and replay resumes`, async () => withPack(async f => {
    const remove = failureTrigger(f, 'checkout');
    expect((await deliver(f)).response.status).toBe(503);
    assertUnfulfilled(f);
    remove();
    expect((await deliver(f)).response.status).toBe(200);
    assertFulfilled(f);
  }, scope));
}

test('Q2 B03 stored receipt without grant resumes the identical signed event into one fulfilled pack', async () => withPack(async f => {
  const remove = failureTrigger(f, 'ledger');
  expect((await deliver(f)).response.status).toBe(503);
  const received = state(f);
  expect(received.events).toHaveLength(1);
  expect(received.events[0].processing_status).toBe('failed');
  expect(received.ledger).toEqual([]);
  expect(received.checkout.ledger_id).toBeNull();
  // Zero-valued legacy bucket initialization is not fulfillment. The oracle
  // deliberately reaches the retry on both old and new code.
  expect(received.buckets.reduce((total, row) => total + row.balance, 0)).toBe(0);
  remove();
  const replay = await deliver(f);
  expect(replay.response.status).toBe(200);
  expect(replay.body.creditGrant?.creditsGranted).toBe(5000);
  assertFulfilled(f);
}));

test('Q2 B03 missing receipt action is resumed; a receipt is not fulfillment evidence', async () => withPack(async f => {
  f.db.exec("CREATE TEMP TRIGGER q2_action_receipt_failure BEFORE INSERT ON billing_event_actions BEGIN SELECT RAISE(ABORT, 'synthetic receipt action failure'); END;");
  expect((await deliver(f)).response.status).toBe(500);
  assertUnfulfilled(f);
  expect(state(f).events).toHaveLength(1);
  expect(state(f).actions).toHaveLength(0);
  f.db.exec('DROP TRIGGER q2_action_receipt_failure');
  expect((await deliver(f)).response.status).toBe(200);
  assertFulfilled(f);
  expect(state(f).actions).toHaveLength(1);
}));

test('Q2 B03 acknowledgement failure after commit cannot downgrade completion or duplicate credits', async () => withPack(async f => {
  const barrier = packBatchBarrier(f.db, { count: 1, afterCommitError: true });
  try { expect((await deliver(f)).response.status).toBe(503); } finally { barrier.restore(); }
  assertFulfilled(f);
  const resumed = await deliver(f);
  expect(resumed.response.status).toBe(200);
  expect(resumed.body.creditGrant.creditsGranted).toBe(0);
  assertFulfilled(f);
}));

test('Q2 B03 historical failed receipt with no checkout binding resumes from its signed original payload', async () => withPack(async f => {
  const data = payload(f.checkout);
  await events.ingestVerifiedBillingProviderEvent({ env: f.env, provider: 'stripe', payload: data,
    rawBody: JSON.stringify(data), allowLive: true, verificationStatus: 'verified_live_signature' });
  f.db.exec("UPDATE billing_provider_events SET processing_status = 'failed', error_code = 'stripe_live_credit_grant_failed'");
  assertUnfulfilled(f);
  expect((await deliver(f, data)).response.status).toBe(200);
  assertFulfilled(f);
}));

test('Q2 B03 HTTP repair: dry-run is unchanged; confirmed repair closes a validated failed receipt and replay reuses 5000', async () => withPack(async f => {
  const remove = failureTrigger(f, 'ledger');
  expect((await deliver(f)).response.status).toBe(503);
  remove();
  expect((await repair(f, { ...repairBody(f.checkout), dry_run: true })).response.status).toBe(200);
  assertUnfulfilled(f);
  const applied = await repair(f);
  expect(applied.response.status).toBe(201);
  expect(applied.body.creditGrant.creditsGranted).toBe(5000);
  assertFulfilled(f);
  expect((await repair(f)).body.creditGrant.creditsGranted).toBe(0);
  expect((await deliver(f)).body.creditGrant.creditsGranted).toBe(0);
  assertFulfilled(f);
}));

for (const race of ['repair-repair', 'repair-webhook', 'webhook-webhook-new-event']) {
  test(`Q2 B03 ${race}: concurrent validated operations commit one ledger, one bucket grant and one checkout`, async () => withPack(async f => {
    const remove = failureTrigger(f, 'ledger');
    expect((await deliver(f)).response.status).toBe(503);
    remove();
    const barrier = packBatchBarrier(f.db);
    try {
      const calls = race === 'repair-repair' ? [repair(f), repair(f, repairBody(f.checkout), { key: 'q2-pack-repair-second' })]
        : race === 'repair-webhook' ? [repair(f), deliver(f)]
          : [deliver(f), deliver(f, payload(f.checkout, 'evt_q2_pack_new_parallel'))];
      const results = await Promise.all(calls);
      expect(results.every(result => result.response.status >= 200 && result.response.status < 300)).toBe(true);
      expect(results.reduce((sum, result) => sum + result.body.creditGrant.creditsGranted, 0)).toBe(5000);
    } finally { barrier.restore(); }
    assertFulfilled(f);
  }));
}

test('Q2 B03 failed HTTP repair rolls back bucket and checkout; repeating the same repair resumes', async () => withPack(async f => {
  const remove = failureTrigger(f, 'checkout');
  expect((await repair(f)).response.status).toBe(503);
  assertUnfulfilled(f);
  remove();
  expect((await repair(f)).response.status).toBe(201);
  assertFulfilled(f);
}));

for (const mutation of ['signature', 'stale-signature', 'amount', 'currency', 'credits', 'unpaid', 'user', 'unknown-session', 'inactive-user', 'mode']) {
  test(`Q2 B03 ${mutation}: signed HTTP validation fails closed without any credit grant`, async () => withPack(async f => {
    const data = payload(f.checkout);
    const options = {};
    if (mutation === 'signature') options.invalidSignature = true;
    if (mutation === 'stale-signature') options.timestamp = Math.floor(Date.now() / 1000) - 301;
    if (mutation === 'amount') data.data.object.amount_total += 1;
    if (mutation === 'currency') data.data.object.currency = 'usd';
    if (mutation === 'credits') data.data.object.metadata.credits = '10000';
    if (mutation === 'unpaid') data.data.object.payment_status = 'unpaid';
    if (mutation === 'user') data.data.object.metadata.user_id = f.user.id;
    if (mutation === 'unknown-session') data.data.object.id = 'cs_live_q2_unknown_session';
    if (mutation === 'inactive-user') f.db.database.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(MEMBER);
    if (mutation === 'mode') data.livemode = false;
    const result = await deliver(f, data, options);
    expect(result.response.status).toBeGreaterThanOrEqual(400);
    expect(result.response.status).toBeLessThan(500);
    assertUnfulfilled(f);
  }));
}

for (const boundary of ['guest', 'member', 'stale-mfa', 'origin', 'idempotency', 'confirmation', 'evidence', 'expected-price', 'wrong-target']) {
  test(`Q2 B03 repair ${boundary}: actual HTTP authorization and operator evidence remain required`, async () => withPack(async f => {
    const body = repairBody(f.checkout);
    const options = {};
    if (boundary === 'guest') options.cookie = '';
    if (boundary === 'member') options.cookie = f.memberCookie;
    if (boundary === 'stale-mfa') f.advance((f.mfa.ADMIN_MFA_PROOF_TTL_MINUTES + 1) * 60_000);
    if (boundary === 'origin') options.origin = '';
    if (boundary === 'idempotency') options.key = '';
    if (boundary === 'confirmation') body.confirm = false;
    if (boundary === 'evidence') body.evidence.payment_status = 'unpaid';
    if (boundary === 'expected-price') body.expected_amount_cents += 1;
    if (boundary === 'wrong-target') body.evidence.user_id = f.user.id;
    const result = await repair(f, body, options);
    expect(result.response.status).toBeGreaterThanOrEqual(400);
    expect(result.response.status).toBeLessThan(500);
    assertUnfulfilled(f);
  }));
}

test('Q2 B03 replay with a different checkout under the same event identity is rejected', async () => withPack(async f => {
  expect((await deliver(f)).response.status).toBe(202);
  const other = await seedCheckout(f, checkoutDefinition('member', 'second'));
  const result = await deliver(f, payload(other));
  expect(result.response.status).toBe(409);
  assertFulfilled(f);
  expect(state(f, other).checkout.status).toBe('created');
}));

test('Q2 B03 two independent checkouts for the same member add balances under concurrent completion', async () => withPack(async f => {
  const other = await seedCheckout(f, checkoutDefinition('member', 'second'));
  const barrier = packBatchBarrier(f.db);
  try {
    const results = await Promise.all([deliver(f), deliver(f, payload(other, 'evt_q2_pack_other_checkout'))]);
    expect(results.map(result => result.response.status)).toEqual([202, 202]);
  } finally { barrier.restore(); }
  const s = state(f);
  expect(s.ledger).toHaveLength(2);
  expect(s.ledger.map(row => row.balance_after)).toEqual([5000, 10000]);
  expect(s.buckets.find(row => row.bucket_type === 'purchased').balance).toBe(10000);
  expect(s.bucketEvents).toHaveLength(2);
  expect(state(f, other).checkout.status).toBe('completed');
}));

for (const boundary of ['owner-role', 'organization-status', 'test-admin-role', 'balance-cap']) {
  test(`Q2 B03 organization ${boundary}: current authorization and balance cap remain enforced`, async () => withPack(async f => {
    if (boundary === 'owner-role') f.db.exec("UPDATE organization_memberships SET role = 'member'");
    if (boundary === 'organization-status') f.db.exec("UPDATE organizations SET status = 'suspended'");
    if (boundary === 'test-admin-role') f.db.database.prepare("UPDATE users SET role = 'user' WHERE id = ?").run(f.user.id);
    if (boundary === 'balance-cap') f.db.exec("UPDATE entitlements SET value_numeric = 1000 WHERE id = 'ent_free_credits_balance_max'");
    const result = await deliver(f);
    expect(result.response.status).toBe(boundary === 'balance-cap' ? 503 : 403);
    assertUnfulfilled(f);
  }, boundary === 'test-admin-role' ? 'test-organization' : 'organization'));
}

test('Q2 B03 purged checkout tombstone suppresses first delivery and retries', async () => withPack(async f => {
  f.db.database.prepare(`INSERT INTO billing_operator_purge_tombstones
    (id,tombstone_type,provider,provider_mode,provider_checkout_session_id,purged_at,created_at,updated_at)
    VALUES ('q2-pack-tombstone','checkout_session','stripe','live',?,?,?,?)`)
    .run(f.checkout.session, new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await deliver(f);
    expect(result.response.status).toBe(attempt === 0 ? 202 : 200);
    expect(result.body.creditGrant).toBeNull();
    assertUnfulfilled(f);
    expect(state(f).events[0].error_code).toBe('operator_purge_tombstone_matched');
  }
}));

test('Q2 B03 repair never guesses an unrelated historical receipt into completed evidence', async () => withPack(async f => {
  const old = payload(f.checkout, 'evt_q2_unbound_historical');
  await events.ingestVerifiedBillingProviderEvent({ env: f.env, provider: 'stripe', payload: old,
    rawBody: JSON.stringify(old), allowLive: true, verificationStatus: 'verified_live_signature' });
  f.db.exec("UPDATE billing_provider_events SET processing_status = 'failed', error_code = 'stripe_live_credit_grant_failed'");
  expect((await repair(f)).response.status).toBe(201);
  assertFulfilled(f, { allEventsCompleted: false });
  expect(state(f).events[0].processing_status).toBe('failed');
  // Only the original signed retry can bind this legacy receipt safely.
  expect((await deliver(f, old)).response.status).toBe(200);
  assertFulfilled(f);
}));

function holdFirstBucketSnapshot(db) {
  const prepare = db.prepare.bind(db);
  let arrived;
  let release;
  const ready = new Promise(resolve => { arrived = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let used = false;
  db.prepare = sql => {
    const statement = prepare(sql);
    if (!sql.includes('FROM member_credit_buckets') || !sql.includes('ORDER BY')) return statement;
    const bind = statement.bind.bind(statement);
    statement.bind = (...bindings) => {
      const bound = bind(...bindings);
      const all = bound.all.bind(bound);
      bound.all = async () => {
        const rows = await all();
        if (!used) { used = true; arrived(); await gate; }
        return rows;
      };
      return bound;
    };
    return statement;
  };
  return { ready, release, restore: () => { release(); db.prepare = prepare; } };
}

// Pause after the first real durable grant write: old code's isolated ledger
// .run, or new code's complete atomic batch. No pause occurs inside a native
// transaction and no result, SQL statement or balance is fabricated.
function holdDurableGrant(db, source) {
  const prepare = db.prepare.bind(db);
  const batch = db.batch.bind(db);
  let arrived;
  let release;
  const ready = new Promise(resolve => { arrived = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let used = false;
  const isGrant = statement => /INSERT INTO member_credit_ledger/.test(statement.sql) && statement.bindings.includes(source);
  const hold = async () => { if (!used) { used = true; arrived(); await gate; } };
  db.prepare = sql => {
    const statement = prepare(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...bindings) => {
      const bound = bind(...bindings);
      if (isGrant(bound)) {
        const run = bound.run.bind(bound);
        bound.run = async () => { const result = await run(); await hold(); return result; };
      }
      return bound;
    };
    return statement;
  };
  db.batch = async statements => {
    const result = await batch(statements);
    if (statements.some(isGrant)) await hold();
    return result;
  };
  return { ready, release, restore: () => { release(); db.prepare = prepare; db.batch = batch; } };
}

for (const initial of ['empty', 'existing-zero-buckets']) {
  test(`Q2 B03 coexistence ${initial}: a paused real balance reader cannot duplicate a later signed pack`, async () => withPack(async f => {
    if (initial === 'existing-zero-buckets') expect(await billing.getMemberCreditBalance(f.env, MEMBER)).toBe(0);
    const held = holdFirstBucketSnapshot(f.db);
    const reading = billing.getMemberCreditBalance(f.env, MEMBER);
    try {
      await held.ready;
      expect((await deliver(f)).response.status).toBe(202);
      held.release();
      expect(await reading).toBe(5000);
      assertFulfilled(f);
    } finally { held.restore(); await reading; }
  }));
}

for (const neighbor of ['generic-grant', 'daily-top-up']) {
  test(`Q2 B03 coexistence ${neighbor}: a signed pack cannot reconcile a neighboring half-grant twice`, async () => withPack(async f => {
    const source = neighbor === 'generic-grant' ? 'q2_neighbor_generic_grant' : 'daily_member_top_up';
    const amount = neighbor === 'generic-grant' ? 300 : 10;
    const held = holdDurableGrant(f.db, source);
    const granting = neighbor === 'generic-grant'
      ? billing.grantMemberCredits({ env: f.env, userId: MEMBER, amount,
        idempotencyKey: 'q2-neighbor-generic-grant', source, reason: 'Synthetic adjacent grant' })
      : billing.topUpMemberDailyCredits({ env: f.env, userId: MEMBER });
    try {
      await held.ready;
      expect((await deliver(f)).response.status).toBe(202);
      held.release();
      await granting;
      const s = state(f);
      expect(s.ledger).toHaveLength(2);
      expect(s.ledger.reduce((sum, row) => sum + row.amount, 0)).toBe(5000 + amount);
      expect(s.ledger.at(-1).balance_after).toBe(5000 + amount);
      expect(s.buckets.find(row => row.bucket_type === 'purchased').balance).toBe(5000);
      expect(s.buckets.find(row => row.bucket_type === 'legacy_or_bonus').balance).toBe(amount);
      expect(s.bucketEvents).toHaveLength(2);
      expect(s.bucketEvents.reduce((sum, row) => sum + row.amount, 0)).toBe(5000 + amount);
      expect(await billing.getMemberCreditBalance(f.env, MEMBER)).toBe(5000 + amount);
      expect((await deliver(f)).body.creditGrant.creditsGranted).toBe(0);
      expect(await billing.getMemberCreditBalance(f.env, MEMBER)).toBe(5000 + amount);
    } finally { held.restore(); await granting; }
  }));
}

for (const neighbor of ['generic-grant', 'daily-top-up']) {
  test(`Q2 B03 coexistence ${neighbor}: bucket-event failure rolls back the neighboring ledger and balance`, async () => withPack(async f => {
    f.db.exec("CREATE TEMP TRIGGER q2_neighbor_bucket_failure BEFORE INSERT ON member_credit_bucket_events BEGIN SELECT RAISE(ABORT, 'synthetic adjacent bucket failure'); END;");
    const granting = neighbor === 'generic-grant'
      ? () => billing.grantMemberCredits({ env: f.env, userId: MEMBER, amount: 300,
        idempotencyKey: 'q2-neighbor-failing-grant', source: 'q2_neighbor_generic_grant' })
      : () => billing.topUpMemberDailyCredits({ env: f.env, userId: MEMBER });
    await expect(granting()).rejects.toThrow();
    assertUnfulfilled(f);
    f.db.exec('DROP TRIGGER q2_neighbor_bucket_failure');
    const successful = await granting();
    expect(successful.reused).toBe(false);
    const repeated = await granting();
    expect(repeated.reused).toBe(true);
    expect(state(f).ledger).toHaveLength(1);
    expect(state(f).bucketEvents).toHaveLength(1);
  }));
}

test('Q2 B03 neighboring subscription allowance and invoice replay keep their existing contract with atomic generic grants', async () => withPack(async f => {
  const input = { env: f.env, userId: MEMBER, subscriptionId: 'sub_q2_neighbor_subscription',
    periodStart: new Date(f.now()).toISOString(), periodEnd: new Date(f.now() + 30 * 86400_000).toISOString(),
    allowance: 300, providerEventId: 'evt_q2_neighbor_invoice', stripeInvoiceId: 'in_q2_neighbor_invoice' };
  const first = await billing.topUpMemberSubscriptionCredits(input);
  expect(first).toMatchObject({ grantedCredits: 300, allowance: 300, subscriptionCredits: 300, creditBalance: 300, reused: false });
  expect((await deliver(f)).response.status).toBe(202);
  const replay = await billing.topUpMemberSubscriptionCredits(input);
  expect(replay).toMatchObject({ grantedCredits: 0, allowance: 300, subscriptionCredits: 300, creditBalance: 5300, reused: true });
  const s = state(f);
  expect(s.buckets.find(row => row.bucket_type === 'purchased').balance).toBe(5000);
  expect(s.buckets.find(row => row.bucket_type === 'subscription').balance).toBe(300);
  expect(s.ledger).toHaveLength(2);
  expect(s.bucketEvents).toHaveLength(2);
}));


// The unchanged generic organization grant is a direct competing writer of the
// pack balance. Pause its actual INSERT, not a copied accounting helper.
for (const capped of [false, true]) {
  test(`Q2 B03 paused organization grant preserves intervening signed pack and cap ${capped}`, async () => {
    await withPack(async f => {
      if (capped) f.db.exec("UPDATE entitlements SET value_numeric = 5100 WHERE id = 'ent_free_credits_balance_max'");
      const prepare = f.db.prepare.bind(f.db);
      let arrived, release;
      const atInsert = new Promise(resolve => { arrived = resolve; });
      const resume = new Promise(resolve => { release = resolve; });
      let held = false;
      f.db.prepare = sql => {
        const statement = prepare(sql);
        if (/INSERT INTO credit_ledger/.test(sql)) {
          const bind = statement.bind.bind(statement);
          statement.bind = (...bindings) => {
            const bound = bind(...bindings);
            const run = bound.run.bind(bound);
            bound.run = async () => {
              if (!held) { held = true; arrived(); await resume; }
              return run();
            };
            return bound;
          };
        }
        return statement;
      };
      const args = { env: f.env, organizationId: ORG, amount: 300, createdByUserId: MEMBER,
        idempotencyKey: 'q2-org-grant-race', source: 'q2_org_manual', reason: 'Synthetic neighbor grant' };
      const grant = billing.grantOrganizationCredits(args).then(value => ({ value }), error => ({ error }));
      try {
        await atInsert;
        const paid = await deliver(f);
        expect(paid.response.status).toBe(202);
        expect(state(f).ledger.at(-1).balance_after).toBe(5000);
        release();
        const outcome = await grant;
        if (capped) {
          expect(outcome.error?.code).toBe('credit_balance_cap_exceeded');
          expect(state(f).ledger).toHaveLength(1);
          f.db.exec("UPDATE entitlements SET value_numeric = 100000 WHERE id = 'ent_free_credits_balance_max'");
          expect((await billing.grantOrganizationCredits(args)).creditBalance).toBe(5300);
        } else {
          expect(outcome.error).toBeUndefined();
          expect(outcome.value.creditBalance).toBe(5300);
        }
        const current = state(f);
        expect(current.ledger).toHaveLength(2);
        expect(current.ledger.at(-1).balance_after).toBe(5300);
        expect(current.ledger.reduce((sum, row) => sum + row.amount, 0)).toBe(5300);
        expect(current.checkout.ledger_id).toBe(current.ledger[0].id);
        expect((await billing.grantOrganizationCredits(args)).reused).toBe(true);
        expect((await deliver(f)).response.status).toBe(200);
        expect(state(f).ledger).toHaveLength(2);
      } finally { release(); await grant; f.db.prepare = prepare; }
    }, 'organization');
  });
}

test('Q2 B03 organization grant concurrent replay, conflict and nullable identity preserve actual ledger rows', async () => {
  await withPack(async f => {
    const args = { env: f.env, organizationId: ORG, amount: 300, createdByUserId: MEMBER,
      idempotencyKey: 'q2-org-grant-replay', source: 'q2_org_manual' };
    const values = await Promise.all([billing.grantOrganizationCredits(args), billing.grantOrganizationCredits(args)]);
    expect(values.map(value => value.reused).sort()).toEqual([false, true]);
    expect(state(f).ledger).toHaveLength(1);
    await expect(billing.grantOrganizationCredits({ ...args, amount: 301 })).rejects.toMatchObject({ code: 'idempotency_conflict' });
    expect((await billing.grantOrganizationCredits({ ...args, idempotencyKey: null })).creditBalance).toBe(600);
    expect((await billing.grantOrganizationCredits({ ...args, idempotencyKey: null })).creditBalance).toBe(900);
    expect(state(f).ledger).toHaveLength(3);
  }, 'organization');
});

test('Q2 B03 organization grant requires actual mutation metadata and recovers a committed lost acknowledgement', async () => {
  await withPack(async f => {
    const args = { env: f.env, organizationId: ORG, amount: 300, createdByUserId: MEMBER,
      idempotencyKey: 'q2-org-grant-metadata', source: 'q2_org_manual' };
    const prepare = f.db.prepare.bind(f.db);
    f.db.prepare = sql => {
      const statement = prepare(sql);
      if (/INSERT INTO credit_ledger/.test(sql)) {
        const bind = statement.bind.bind(statement);
        statement.bind = (...bindings) => {
          const bound = bind(...bindings);
          const run = bound.run.bind(bound);
          bound.run = async () => { const result = await run(); return { ...result, meta: { ...result.meta, changes: 0 } }; };
          return bound;
        };
      }
      return statement;
    };
    try {
      await expect(billing.grantOrganizationCredits(args)).rejects.toMatchObject({ code: 'credit_grant_incomplete' });
    } finally { f.db.prepare = prepare; }
    expect(state(f).ledger).toHaveLength(1);
    expect((await billing.grantOrganizationCredits(args)).reused).toBe(true);
    expect(state(f).ledger.at(-1).balance_after).toBe(300);
  }, 'organization');
});
