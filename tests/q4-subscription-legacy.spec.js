// Coherent subscription coverage moved intact from workers.spec.js for Q4.
// Mock-backed neighbor contracts remain separate from signed native FK cases.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createAuthTestEnv, createExecutionContext, loadWorker, nowIso, seedSession } = require('./helpers/auth-worker-harness');
const moduleAt = file => import(pathToFileURL(path.join(process.cwd(), file)).href);
const loadBillingModule = () => moduleAt('workers/auth/src/lib/billing.js');
const loadStripeBillingModule = () => moduleAt('workers/auth/src/lib/stripe-billing.js');
const loadAssetStorageQuotaModule = () => moduleAt('workers/auth/src/lib/asset-storage-quota.js');
const loadRoutePolicyModule = () => moduleAt('workers/auth/src/app/route-policy.js');
function createContractUser({ id='admin-ai-user', role='admin', email, created_at }={}) {
  return { id, email:email || `${id}@example.com`, password_hash:'unused', created_at:created_at || nowIso(), status:'active',role,email_verified_at:nowIso(),verification_method:'email_verified' };
}
const createAdminUser = id => createContractUser({ id, role:'admin' });
function expectCreditPackInvoiceForm(form, { email, packId, credits, description, checkoutScope, organizationId, customerId, locale = 'de' } = {}) {
  expect(form.mode).toBe('payment');
  expect(form['invoice_creation[enabled]']).toBe('true');
  expect(form.locale).toBe(locale);
  if (customerId) {
    expect(form.customer).toBe(customerId);
    expect(form.customer_creation).toBeUndefined();
    expect(form.customer_email).toBeUndefined();
  } else {
    expect(form.customer).toBeUndefined();
    expect(form.customer_creation).toBe('always');
    if (email) expect(form.customer_email).toBe(email);
    else expect(form.customer_email).toBeUndefined();
  }
  expect(form['invoice_creation[invoice_data][description]']).toBe(description);
  expect(form['invoice_creation[invoice_data][metadata][credit_pack_id]']).toBe(packId);
  expect(form['invoice_creation[invoice_data][metadata][pack_id]']).toBe(packId);
  expect(form['invoice_creation[invoice_data][metadata][credits]']).toBe(String(credits));
  expect(form['invoice_creation[invoice_data][metadata][user_id]']).toBe(form['metadata[user_id]']);
  expect(form['invoice_creation[invoice_data][metadata][internal_checkout_session_id]']).toBe(form['metadata[internal_checkout_session_id]']);
  if (checkoutScope) expect(form['invoice_creation[invoice_data][metadata][checkout_scope]']).toBe(checkoutScope);
  if (organizationId) expect(form['invoice_creation[invoice_data][metadata][organization_id]']).toBe(organizationId);
  expect(form['invoice_creation[invoice_data][footer]']).toBeUndefined();
  expect(form['invoice_creation[invoice_data][account_tax_ids][0]']).toBeUndefined();
  expect(Object.keys(form).filter((key) => key.startsWith('invoice_creation')).some((key) => /footer|account_tax|ustg/i.test(key))).toBe(false);
}
function authJsonRequest(pathname,method,body,headers={}) {
  const requestHeaders=new Headers(headers);if(body!==undefined)requestHeaders.set('Content-Type','application/json');
  return new Request(`https://bitbi.ai${pathname}`,{method,headers:requestHeaders,body:body!==undefined?JSON.stringify(body):undefined});
}

const { withSubscription, state: nativeState, invoiceEvent, lifecycleEvent, MEMBER, PRICE, START, END, checkout } = require('./helpers/q4-subscription-fixture.js');
async function seedNativeBuckets(f, subscriptionCredits) {
  const billing=await loadBillingModule();
  for(const [type,amount] of [['legacy_or_bonus',300],['purchased',4000],['subscription',subscriptionCredits]])
    if(amount>0) await billing.grantMemberCredits({env:f.env,userId:MEMBER,amount,createdByUserId:MEMBER,idempotencyKey:`q4-neighbor-${type}`,source:'synthetic_legacy_fixture',creditBucketType:type,
      bucketScope:type==='subscription'?{providerSubscriptionId:checkout.subscription,periodStart:new Date(START*1000).toISOString(),periodEnd:new Date(END*1000).toISOString()}:null});
}

test.describe('BITBI Pro member subscriptions', () => {
  // These neighbor cases deliberately exercise the admitted historical checkout
  // contract. Pin its rolling-release time; current/expired consent has separate controls.
  const NativeDate=globalThis.Date,legacyNow=NativeDate.parse('2026-10-23T12:00:00.000Z');
  test.beforeEach(()=>{globalThis.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[legacyNow]));}static now(){return legacyNow;}};});
  test.afterEach(()=>{globalThis.Date=NativeDate;});

  const PERIOD_START_DATE = new Date('2026-10-23T12:00:00.000Z');
  PERIOD_START_DATE.setUTCDate(1);
  PERIOD_START_DATE.setUTCHours(0, 0, 0, 0);
  const PERIOD_END_DATE = new Date(PERIOD_START_DATE);
  PERIOD_END_DATE.setUTCMonth(PERIOD_END_DATE.getUTCMonth() + 1);
  const PERIOD_START = PERIOD_START_DATE.toISOString();
  const PERIOD_END = PERIOD_END_DATE.toISOString();
  const PERIOD_START_SECONDS = Math.floor(PERIOD_START_DATE.getTime() / 1000);
  const PERIOD_END_SECONDS = Math.floor(PERIOD_END_DATE.getTime() / 1000);

  function seedBucketedMember({
    userId = 'member-subscription-user',
    subscriptionCredits = 0,
    legacyOrBonusCredits = 0,
    purchasedCredits = 0,
    subscriptionStatus = 'active',
    periodEnd = PERIOD_END,
    cancelAtPeriodEnd = 0,
  } = {}) {
    const user = createContractUser({ id: userId, role: 'user' });
    const total = subscriptionCredits + legacyOrBonusCredits + purchasedCredits;
    const buckets = [
      {
        id: `mcb_${userId}_legacy`,
        user_id: userId,
        bucket_type: 'legacy_or_bonus',
        balance: legacyOrBonusCredits,
        local_subscription_id: null,
        provider_subscription_id: null,
        period_start: null,
        period_end: null,
        source: 'test_seed',
        metadata_json: '{}',
        created_at: '2026-04-30T00:00:00.000Z',
        updated_at: '2026-04-30T00:00:00.000Z',
      },
      {
        id: `mcb_${userId}_purchased`,
        user_id: userId,
        bucket_type: 'purchased',
        balance: purchasedCredits,
        local_subscription_id: null,
        provider_subscription_id: null,
        period_start: null,
        period_end: null,
        source: 'stripe_live_checkout',
        metadata_json: '{}',
        created_at: '2026-04-30T00:00:00.000Z',
        updated_at: '2026-04-30T00:00:00.000Z',
      },
    ];
    if (subscriptionCredits > 0) {
      buckets.push({
        id: `mcb_${userId}_subscription`,
        user_id: userId,
        bucket_type: 'subscription',
        balance: subscriptionCredits,
        local_subscription_id: `msub_${userId}`,
        provider_subscription_id: 'sub_member_pro_123456',
        period_start: PERIOD_START,
        period_end: periodEnd,
        source: 'subscription_period_top_up',
        metadata_json: '{}',
        created_at: PERIOD_START,
        updated_at: PERIOD_START,
      });
    }
    return createAuthTestEnv({
      users: [user],
      billingMemberSubscriptions: [{
        id: `msub_${userId}`,
        user_id: userId,
        provider: 'stripe',
        provider_mode: 'live',
        provider_customer_id: 'cus_member_pro_123456',
        provider_subscription_id: 'sub_member_pro_123456',
        provider_price_id: 'price_member_pro_123456',
        status: subscriptionStatus,
        current_period_start: PERIOD_START,
        current_period_end: periodEnd,
        cancel_at_period_end: cancelAtPeriodEnd,
        canceled_at: null,
        metadata_json: '{}',
        created_at: PERIOD_START,
        updated_at: PERIOD_START,
      }],
      memberCreditLedger: total > 0 ? [{
        id: `mcl_${userId}_seed`,
        user_id: userId,
        amount: total,
        balance_after: total,
        entry_type: 'grant',
        feature_key: null,
        source: 'test_seed',
        idempotency_key: `seed-${userId}`,
        request_hash: 'seed',
        created_by_user_id: null,
        created_at: '2026-04-30T00:00:00.000Z',
        metadata_json: '{}',
      }] : [],
      memberCreditBuckets: buckets,
    });
  }

  test('storage limit is 50 MB for free users and 5 GB for active subscription periods', async () => {
    const {
      USER_ASSET_STORAGE_LIMIT_BYTES,
      SUBSCRIBED_USER_ASSET_STORAGE_LIMIT_BYTES,
      getUserAssetStorageUsageSnapshot,
    } = await loadAssetStorageQuotaModule();

    const freeUserId = 'storage-free-subscription-user';
    const freeEnv = createAuthTestEnv({
      users: [createContractUser({ id: freeUserId, role: 'user' })],
      userAssetStorageUsage: [{ user_id: freeUserId, used_bytes: 0, updated_at: nowIso() }],
    });
    await expect(getUserAssetStorageUsageSnapshot(freeEnv, freeUserId)).resolves.toMatchObject({
      limitBytes: USER_ASSET_STORAGE_LIMIT_BYTES,
      hasActiveSubscription: false,
      plan: 'free',
    });

    for (const [userId, cancelAtPeriodEnd] of [
      ['storage-active-subscription-user', 0],
      ['storage-cancel-period-subscription-user', 1],
    ]) {
      const env = createAuthTestEnv({
        users: [createContractUser({ id: userId, role: 'user' })],
        billingMemberSubscriptions: [{
          id: `msub_${userId}`,
          user_id: userId,
          provider: 'stripe',
          provider_mode: 'live',
          provider_customer_id: 'cus_storage_member',
          provider_subscription_id: `sub_storage_${userId}`,
          provider_price_id: 'price_member_pro_123456',
          status: 'active',
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_END,
          cancel_at_period_end: cancelAtPeriodEnd,
          canceled_at: cancelAtPeriodEnd ? '2026-05-15T00:00:00.000Z' : null,
          metadata_json: '{}',
          created_at: PERIOD_START,
          updated_at: PERIOD_START,
        }],
        userAssetStorageUsage: [{ user_id: userId, used_bytes: USER_ASSET_STORAGE_LIMIT_BYTES + 1, updated_at: nowIso() }],
      });
      await expect(getUserAssetStorageUsageSnapshot(env, userId)).resolves.toMatchObject({
        limitBytes: SUBSCRIBED_USER_ASSET_STORAGE_LIMIT_BYTES,
        hasActiveSubscription: true,
        plan: 'bitbi_pro',
      });
    }

    const expiredUserId = 'storage-expired-subscription-user';
    const expiredEnv = createAuthTestEnv({
      users: [createContractUser({ id: expiredUserId, role: 'user' })],
      billingMemberSubscriptions: [{
        id: `msub_${expiredUserId}`,
        user_id: expiredUserId,
        provider: 'stripe',
        provider_mode: 'live',
        provider_customer_id: 'cus_storage_expired',
        provider_subscription_id: 'sub_storage_expired',
        provider_price_id: 'price_member_pro_123456',
        status: 'canceled',
        current_period_start: '2026-04-01T00:00:00.000Z',
        current_period_end: '2026-05-01T00:00:00.000Z',
        cancel_at_period_end: 0,
        canceled_at: '2026-05-01T00:00:00.000Z',
        metadata_json: '{}',
        created_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-05-01T00:00:00.000Z',
      }],
      userAssetStorageUsage: [{ user_id: expiredUserId, used_bytes: USER_ASSET_STORAGE_LIMIT_BYTES + 1, updated_at: nowIso() }],
    });
    await expect(getUserAssetStorageUsageSnapshot(expiredEnv, expiredUserId)).resolves.toMatchObject({
      limitBytes: USER_ASSET_STORAGE_LIMIT_BYTES,
      hasActiveSubscription: false,
      plan: 'free',
    });
  });

  test('subscription top-up restores only the subscription bucket and leaves purchased and legacy credits unchanged', async () => {
    const {
      getMemberCreditBucketBalances,
      topUpMemberSubscriptionCredits,
    } = await loadBillingModule();
    const env = seedBucketedMember({
      subscriptionCredits: 2000,
      purchasedCredits: 4000,
      legacyOrBonusCredits: 300,
    });

    const result = await topUpMemberSubscriptionCredits({
      env,
      userId: 'member-subscription-user',
      providerSubscriptionId: 'sub_member_pro_123456',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      stripeInvoiceId: 'in_member_pro_renewal_01',
      providerEventId: 'evt_member_pro_renewal_01',
    });
    expect(result.grantedCredits).toBe(4000);
    await expect(getMemberCreditBucketBalances(env, 'member-subscription-user')).resolves.toMatchObject({
      subscriptionCredits: 6000,
      purchasedCredits: 4000,
      legacyOrBonusCredits: 300,
      totalCredits: 10300,
    });
    expect(env.DB.state.memberCreditLedger.at(-1)).toEqual(expect.objectContaining({
      source: 'subscription_period_top_up',
      amount: 4000,
      balance_after: 10300,
    }));
  });

  test('subscription top-up grants 6000 from zero, grants nothing when full, and is idempotent', async () => {
    const {
      getMemberCreditBucketBalances,
      topUpMemberSubscriptionCredits,
    } = await loadBillingModule();
    const zeroEnv = seedBucketedMember({
      userId: 'member-subscription-zero',
      subscriptionCredits: 0,
      purchasedCredits: 4000,
    });
    const zero = await topUpMemberSubscriptionCredits({
      env: zeroEnv,
      userId: 'member-subscription-zero',
      providerSubscriptionId: 'sub_member_pro_123456',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      stripeInvoiceId: 'in_member_pro_zero_01',
      providerEventId: 'evt_member_pro_zero_01',
    });
    expect(zero.grantedCredits).toBe(6000);
    await expect(getMemberCreditBucketBalances(zeroEnv, 'member-subscription-zero')).resolves.toMatchObject({
      subscriptionCredits: 6000,
      purchasedCredits: 4000,
      totalCredits: 10000,
    });

    const ledgerCount = zeroEnv.DB.state.memberCreditLedger.length;
    const duplicate = await topUpMemberSubscriptionCredits({
      env: zeroEnv,
      userId: 'member-subscription-zero',
      providerSubscriptionId: 'sub_member_pro_123456',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      stripeInvoiceId: 'in_member_pro_zero_01',
      providerEventId: 'evt_member_pro_zero_01',
    });
    expect(duplicate.reused).toBe(true);
    expect(zeroEnv.DB.state.memberCreditLedger).toHaveLength(ledgerCount);

    const fullEnv = seedBucketedMember({
      userId: 'member-subscription-full',
      subscriptionCredits: 6000,
      purchasedCredits: 1200,
      legacyOrBonusCredits: 100,
    });
    const full = await topUpMemberSubscriptionCredits({
      env: fullEnv,
      userId: 'member-subscription-full',
      providerSubscriptionId: 'sub_member_pro_123456',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      stripeInvoiceId: 'in_member_pro_full_01',
      providerEventId: 'evt_member_pro_full_01',
    });
    expect(full.grantedCredits).toBe(0);
    expect(fullEnv.DB.state.memberCreditLedger).toHaveLength(1);
    await expect(getMemberCreditBucketBalances(fullEnv, 'member-subscription-full')).resolves.toMatchObject({
      subscriptionCredits: 6000,
      purchasedCredits: 1200,
      legacyOrBonusCredits: 100,
      totalCredits: 7300,
    });
  });

  test('subscription checkout uses Stripe subscription mode and grants no credits before paid invoice', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const member = createContractUser({ id: 'member-subscription-checkout', role: 'user' });
    const calls = [];
    const env = createAuthTestEnv({
      ENABLE_LIVE_STRIPE_SUBSCRIPTIONS: 'true',
      STRIPE_LIVE_SECRET_KEY: 'sk_live_subscription_checkout_secret_123456',
      STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_subscription_checkout_secret_123456',
      STRIPE_LIVE_SUBSCRIPTION_PRICE_ID: 'price_member_pro_123456',
      STRIPE_LIVE_SUBSCRIPTION_SUCCESS_URL: 'https://bitbi.ai/pricing.html?checkout=success',
      STRIPE_LIVE_SUBSCRIPTION_CANCEL_URL: 'https://bitbi.ai/pricing.html?checkout=cancel',
      users: [member],
      fetch: async (url, init = {}) => {
        calls.push({ url, init, form: Object.fromEntries(new URLSearchParams(String(init.body || ''))) });
        return new Response(JSON.stringify({
          id: 'cs_live_member_subscription_checkout',
          object: 'checkout.session',
          livemode: true,
          mode: 'subscription',
          url: 'https://checkout.stripe.com/c/pay/cs_live_member_subscription_checkout',
          subscription: 'sub_member_subscription_checkout',
          customer: 'cus_member_subscription_checkout',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    const token = await seedSession(env, member.id);
    const missingIdempotency = await worker.fetch(
      authJsonRequest('/api/account/billing/checkout/subscription', 'POST', {
        terms_accepted: true,
        terms_version: '2026-10-22',
        immediate_delivery_accepted: true,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(missingIdempotency.status).toBe(428);
    await expect(missingIdempotency.json()).resolves.toMatchObject({
      code: 'idempotency_key_required',
    });
    expect(calls).toHaveLength(0);

    const response = await worker.fetch(
      authJsonRequest('/api/account/billing/checkout/subscription', 'POST', {
        terms_accepted: true,
        terms_version: '2026-10-22',
        immediate_delivery_accepted: true,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-subscription-checkout-1',
      }),
      env,
      createExecutionContext().execCtx
    );
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body).toEqual(expect.objectContaining({
      ok: true,
      checkout_scope: 'member_subscription',
      checkout_url: 'https://checkout.stripe.com/c/pay/cs_live_member_subscription_checkout',
    }));
    expect(calls[0].form.mode).toBe('subscription');
    expect(calls[0].form['line_items[0][price]']).toBe('price_member_pro_123456');
    expect(calls[0].form['metadata[checkout_scope]']).toBe('member_subscription');
    expect(calls[0].form['invoice_creation[enabled]']).toBeUndefined();
    expect(calls[0].form.customer_creation).toBeUndefined();
    expect(calls[0].form.customer_email).toBeUndefined();
    expect(Object.keys(calls[0].form).some((key) => key.startsWith('invoice_creation'))).toBe(false);
    expect(calls[0].form['subscription_data[metadata][user_id]']).toBe(member.id);
    expect(env.DB.state.memberCreditLedger).toHaveLength(0);
    expect(env.DB.state.memberCreditBuckets).toHaveLength(0);

    const replay = await worker.fetch(
      authJsonRequest('/api/account/billing/checkout/subscription', 'POST', {
        terms_accepted: true,
        terms_version: '2026-10-22',
        immediate_delivery_accepted: true,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-subscription-checkout-1',
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      ok: true,
      reused: true,
      checkout_scope: 'member_subscription',
      session_id: 'cs_live_member_subscription_checkout',
    });
    expect(calls).toHaveLength(1);

    env.STRIPE_LIVE_SUBSCRIPTION_PRICE_ID = 'price_member_pro_reconfigured';
    const conflict = await worker.fetch(
      authJsonRequest('/api/account/billing/checkout/subscription', 'POST', {
        terms_accepted: true,
        terms_version: '2026-10-22',
        immediate_delivery_accepted: true,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-subscription-checkout-1',
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      code: 'idempotency_conflict',
    });
    expect(calls).toHaveLength(1);
    expect(env.DB.state.memberCreditLedger).toHaveLength(0);
    expect(env.DB.state.memberCreditBuckets).toHaveLength(0);
  });

  test('credit-pack checkout sessions request a Stripe invoice and prefill the buyer email', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const orgId = 'org_22222222222222222222222222222222';
    const createdAt = '2026-04-26T10:00:00.000Z';
    const terms = { terms_accepted: true, terms_version: '2026-10-22', immediate_delivery_accepted: true };
    const checkoutFetch = (calls, { live }) => async (url, init = {}) => {
      const target = String(url);
      if (target.includes('/v1/customers/')) {
        const id = decodeURIComponent(target.split('/v1/customers/')[1] || 'cus_invoice');
        return new Response(JSON.stringify({ id, object: 'customer', preferred_locales: ['de'] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const form = Object.fromEntries(new URLSearchParams(String(init.body || '')));
      calls.push({ url, form });
      const id = `${live ? 'cs_live' : 'cs_test'}_invoice_${String(calls.length).padStart(2, '0')}`;
      return new Response(JSON.stringify({
        id,
        object: 'checkout.session',
        livemode: live,
        mode: form.mode || 'payment',
        url: `https://checkout.stripe.com/c/pay/${id}`,
        payment_intent: live ? `pi_live_invoice_${calls.length}` : `pi_test_invoice_${calls.length}`,
        customer: `cus_invoice_${calls.length}`,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const admin = createAdminUser('credit-pack-invoice-admin');
    const testCalls = [];
    const testEnv = createAuthTestEnv({
      ENABLE_ADMIN_STRIPE_TEST_CHECKOUT: 'true',
      STRIPE_MODE: 'test',
      STRIPE_SECRET_KEY: 'sk_test_credit_pack_invoice_1234567890',
      STRIPE_WEBHOOK_SECRET: 'whsec_credit_pack_invoice_1234567890',
      STRIPE_CHECKOUT_SUCCESS_URL: 'https://bitbi.ai/account/billing/success',
      STRIPE_CHECKOUT_CANCEL_URL: 'https://bitbi.ai/account/billing/cancel',
      ENABLE_STRIPE_INVOICE_CREATION: 'false',
      users: [admin],
      organizations: [{
        id: orgId, name: 'Invoice Org', slug: 'invoice-org', status: 'active',
        created_by_user_id: admin.id, created_at: createdAt, updated_at: createdAt,
      }],
      organizationMemberships: [{
        id: 'om_credit_pack_invoice_admin', organization_id: orgId, user_id: admin.id,
        role: 'admin', status: 'active', created_by_user_id: admin.id, created_at: createdAt, updated_at: createdAt,
      }],
      fetch: checkoutFetch(testCalls, { live: false }),
    });
    const adminToken = await seedSession(testEnv, admin.id);
    const testCheckout = await worker.fetch(
      authJsonRequest(`/api/orgs/${orgId}/billing/checkout/credit-pack`, 'POST', { pack_id: 'credits_5000' }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${adminToken}`,
        'Idempotency-Key': 'credit-pack-invoice-testmode',
      }),
      testEnv,
      createExecutionContext().execCtx
    );
    expect(testCheckout.status).toBe(201);
    expectCreditPackInvoiceForm(testCalls[0].form, {
      email: 'credit-pack-invoice-admin@example.com',
      packId: 'credits_5000',
      credits: 5000,
      description: 'One-time purchase: 5000 Credit Pack',
      organizationId: orgId,
    });
    expect(testEnv.DB.state.creditLedger).toHaveLength(0);

    const owner = createContractUser({ id: 'credit-pack-invoice-owner', role: 'user' });
    const liveCalls = [];
    const liveEnv = createAuthTestEnv({
      ENABLE_LIVE_STRIPE_CREDIT_PACKS: 'true',
      STRIPE_LIVE_SECRET_KEY: 'sk_live_credit_pack_invoice_1234567890',
      STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_credit_pack_invoice_live_1234567890',
      STRIPE_LIVE_CHECKOUT_SUCCESS_URL: 'https://bitbi.ai/pricing.html?checkout=success',
      STRIPE_LIVE_CHECKOUT_CANCEL_URL: 'https://bitbi.ai/pricing.html?checkout=cancel',
      users: [owner],
      organizations: [{
        id: orgId, name: 'Invoice Org', slug: 'invoice-org', status: 'active',
        created_by_user_id: owner.id, created_at: createdAt, updated_at: createdAt,
      }],
      organizationMemberships: [{
        id: 'om_credit_pack_invoice_owner', organization_id: orgId, user_id: owner.id,
        role: 'owner', status: 'active', created_by_user_id: owner.id, created_at: createdAt, updated_at: createdAt,
      }],
      fetch: checkoutFetch(liveCalls, { live: true }),
    });
    const ownerToken = await seedSession(liveEnv, owner.id);
    const orgCheckout = await worker.fetch(
      authJsonRequest(`/api/orgs/${orgId}/billing/checkout/live-credit-pack`, 'POST', { pack_id: 'live_credits_12000', ...terms }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${ownerToken}`,
        'Idempotency-Key': 'credit-pack-invoice-live-org',
      }),
      liveEnv,
      createExecutionContext().execCtx
    );
    expect(orgCheckout.status).toBe(201);
    expectCreditPackInvoiceForm(liveCalls[0].form, {
      email: 'credit-pack-invoice-owner@example.com',
      packId: 'live_credits_12000',
      credits: 12000,
      description: 'One-time purchase: 12000 Credit Pack',
      checkoutScope: 'organization',
      organizationId: orgId,
    });
    expect(liveCalls[0].form['payment_method_types[0]']).toBe('card');
    expect(liveEnv.DB.state.creditLedger).toHaveLength(0);

    const member = createContractUser({ id: 'credit-pack-invoice-member', role: 'user', email: 'Buyer.Member@example.com' });
    const memberCalls = [];
    const memberEnv = createAuthTestEnv({
      ENABLE_LIVE_STRIPE_CREDIT_PACKS: 'true',
      ENABLE_STRIPE_INVOICE_CREATION: 'false',
      STRIPE_LIVE_SECRET_KEY: 'sk_live_credit_pack_invoice_1234567890',
      STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_credit_pack_invoice_live_1234567890',
      STRIPE_LIVE_CHECKOUT_SUCCESS_URL: 'https://bitbi.ai/pricing.html?checkout=success',
      STRIPE_LIVE_CHECKOUT_CANCEL_URL: 'https://bitbi.ai/pricing.html?checkout=cancel',
      users: [member],
      fetch: checkoutFetch(memberCalls, { live: true }),
    });
    const memberToken = await seedSession(memberEnv, member.id);
    const memberCheckout = await worker.fetch(
      authJsonRequest('/api/account/billing/checkout/live-credit-pack', 'POST', { pack_id: 'live_credits_5000', ...terms }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${memberToken}`,
        'Idempotency-Key': 'credit-pack-invoice-live-member',
      }),
      memberEnv,
      createExecutionContext().execCtx
    );
    expect(memberCheckout.status).toBe(201);
    expectCreditPackInvoiceForm(memberCalls[0].form, {
      email: 'buyer.member@example.com',
      packId: 'live_credits_5000',
      credits: 5000,
      description: 'One-time purchase: 5000 Credit Pack',
      checkoutScope: 'member',
    });
    expect(memberCalls[0].form['metadata[organization_id]']).toBeUndefined();
    expect(memberEnv.DB.state.memberCreditLedger).toHaveLength(0);

    const invalid = createContractUser({ id: 'credit-pack-invoice-invalid-email', role: 'user', email: 'not an email' });
    const invalidCalls = [];
    const invalidEnv = createAuthTestEnv({
      ENABLE_LIVE_STRIPE_CREDIT_PACKS: 'true',
      STRIPE_LIVE_SECRET_KEY: 'sk_live_credit_pack_invoice_1234567890',
      STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_credit_pack_invoice_live_1234567890',
      STRIPE_LIVE_CHECKOUT_SUCCESS_URL: 'https://bitbi.ai/pricing.html?checkout=success',
      STRIPE_LIVE_CHECKOUT_CANCEL_URL: 'https://bitbi.ai/pricing.html?checkout=cancel',
      users: [invalid],
      fetch: checkoutFetch(invalidCalls, { live: true }),
    });
    const invalidToken = await seedSession(invalidEnv, invalid.id);
    const invalidCheckout = await worker.fetch(
      authJsonRequest('/api/account/billing/checkout/live-credit-pack', 'POST', { pack_id: 'live_credits_5000', ...terms }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${invalidToken}`,
        'Idempotency-Key': 'credit-pack-invoice-invalid-email',
      }),
      invalidEnv,
      createExecutionContext().execCtx
    );
    expect(invalidCheckout.status).toBe(201);
    expectCreditPackInvoiceForm(invalidCalls[0].form, {
      email: null,
      packId: 'live_credits_5000',
      credits: 5000,
      description: 'One-time purchase: 5000 Credit Pack',
      checkoutScope: 'member',
    });

    const evidence = await moduleAt('workers/auth/src/lib/billing-evidence.js');
    const status = evidence.buildBillingEvidenceStatus({ ENABLE_STRIPE_INVOICE_CREATION: 'false' });
    expect(status.taxInvoice.oneTimeInvoiceCreation).toEqual(expect.objectContaining({
      enabled: true,
      status: 'enabled_for_credit_pack_checkout',
      footerAndAccountTaxIds: 'stripe_account_defaults',
    }));
    expect(status.taxInvoice.automaticTax.enabled).toBe(false);
    expect(status.config.flags.invoiceCreation.enabled).toBe(false);
    expect(status.failClosedFacts).toEqual(expect.arrayContaining([
      'Stripe Tax and tax ID collection stay disabled unless explicit operator env flags are set. Credit-pack Checkout always requests a Stripe invoice and does not grant credits from invoice events.',
    ]));
  });

  test('credit-pack checkout reuses a linked customer, keeps invoice metadata, and follows locale', async () => {
    const { CREDIT_PACK_PERFORMANCE_CONSENT_TEXT } = await moduleAt('js/shared/consumer-contract.mjs');
    const worker = await loadWorker('workers/auth/src/index.js');
    const member = createContractUser({ id: 'credit-pack-customer-member', role: 'user', email: 'buyer.member@example.com' });
    const consent = (locale) => ({
      termsAccepted: true,
      termsVersion: '2026-10-25',
      consentVersion: 'consumer-v1',
      locale,
      earlyStartRequested: true,
      creditPackPerformanceConsent: true,
      creditPackConsentVersion: 'credit-pack-356-v1',
      creditPackConsentText: CREDIT_PACK_PERFORMANCE_CONSENT_TEXT[locale],
    });
    const calls = [];
    const env = createAuthTestEnv({
      ENABLE_LIVE_STRIPE_CREDIT_PACKS: 'true',
      ENABLE_STRIPE_AUTOMATIC_TAX: 'true',
      ENABLE_STRIPE_TAX_ID_COLLECTION: 'true',
      STRIPE_LIVE_SECRET_KEY: 'sk_live_credit_pack_customer_1234567890',
      STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_credit_pack_customer_1234567890',
      STRIPE_LIVE_CHECKOUT_SUCCESS_URL: 'https://bitbi.ai/pricing.html?checkout=success',
      STRIPE_LIVE_CHECKOUT_CANCEL_URL: 'https://bitbi.ai/pricing.html?checkout=cancel',
      users: [member],
      billingMemberCustomers: [{
        id: 'bmc_credit_pack_existing',
        user_id: member.id,
        provider: 'stripe',
        provider_mode: 'live',
        provider_customer_ref: 'cus_credit_pack_existing',
        created_at: '2026-10-01T00:00:00.000Z',
        retired_at: null,
      }],
      fetch: async (url, init = {}) => {
        const target = String(url);
        const form = Object.fromEntries(new URLSearchParams(String(init.body || '')));
        calls.push({ url: target, method: init.method || 'GET', form });
        if (target.includes('/v1/customers/')) {
          return Response.json({ id: 'cus_credit_pack_existing', object: 'customer', preferred_locales: ['de'] });
        }
        const sessionId = form.locale === 'en' ? 'cs_live_credit_pack_locale_en' : 'cs_live_credit_pack_locale_de';
        return Response.json({
          id: sessionId,
          object: 'checkout.session',
          livemode: true,
          mode: 'payment',
          url: `https://checkout.stripe.com/c/pay/${sessionId}`,
          customer: 'cus_credit_pack_existing',
        });
      },
    });
    const token = await seedSession(env, member.id);
    const checkoutFor = (locale, key) => worker.fetch(
      authJsonRequest('/api/account/billing/checkout/live-credit-pack', 'POST', {
        pack_id: 'live_credits_5000',
        ...consent(locale),
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': key,
      }),
      env,
      createExecutionContext().execCtx
    );
    expect((await checkoutFor('en', 'credit-pack-existing-en')).status).toBe(201);
    const english = calls.find((call) => call.url.endsWith('/v1/checkout/sessions') && call.form.locale === 'en');
    expectCreditPackInvoiceForm(english.form, {
      customerId: 'cus_credit_pack_existing',
      locale: 'en',
      packId: 'live_credits_5000',
      credits: 5000,
      description: 'One-time purchase: 5000 Credit Pack',
      checkoutScope: 'member',
    });
    expect(english.form['customer_update[address]']).toBe('auto');
    expect(english.form['customer_update[name]']).toBe('auto');
    expect(english.form['metadata[credit_pack_consent_version]']).toBe('credit-pack-356-v1');
    expect(english.form['metadata[credit_pack_consent_text]']).toBe(CREDIT_PACK_PERFORMANCE_CONSENT_TEXT.en);
    expect(english.form['automatic_tax[enabled]']).toBe('true');
    expect(english.form['billing_address_collection']).toBe('auto');
    expect(english.form['tax_id_collection[enabled]']).toBe('true');
    expect(calls.filter((call) => call.method === 'POST' && call.url.includes('/v1/customers/'))).toHaveLength(0);
    expect(env.DB.state.billingMemberCustomers).toHaveLength(1);

    calls.length = 0;
    expect((await checkoutFor('de', 'credit-pack-existing-de')).status).toBe(201);
    const german = calls.find((call) => call.url.endsWith('/v1/checkout/sessions'));
    expect(german.form.locale).toBe('de');
    expect(german.form.customer).toBe('cus_credit_pack_existing');
    expect(german.form.customer_creation).toBeUndefined();
    expect(german.form['metadata[credit_pack_consent_version]']).toBe('credit-pack-356-v1');
    expect(german.form['metadata[credit_pack_consent_text]']).toBe(CREDIT_PACK_PERFORMANCE_CONSENT_TEXT.de);
    expect(env.DB.state.billingMemberCustomers).toHaveLength(1);
  });

  test('credit-pack completion stores one Stripe customer and sets A4 without blocking credits', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const { handleVerifiedStripeLiveWebhookEvent } = await loadStripeBillingModule();
    const member = createContractUser({ id: 'credit-pack-new-customer', role: 'user' });
    const calls = [];
    let invoiceUpdates = 0;
    let invoicePageSize = 'letter';
    const env = createAuthTestEnv({
      ENABLE_LIVE_STRIPE_CREDIT_PACKS: 'true',
      STRIPE_LIVE_SECRET_KEY: 'sk_live_credit_pack_customer_1234567890',
      STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_credit_pack_customer_1234567890',
      STRIPE_LIVE_CHECKOUT_SUCCESS_URL: 'https://bitbi.ai/pricing.html?checkout=success',
      STRIPE_LIVE_CHECKOUT_CANCEL_URL: 'https://bitbi.ai/pricing.html?checkout=cancel',
      users: [member],
      fetch: async (url, init = {}) => {
        const target = String(url);
        const form = Object.fromEntries(new URLSearchParams(String(init.body || '')));
        calls.push({ url: target, method: init.method || 'GET', form });
        if (target.endsWith('/v1/checkout/sessions')) {
          return Response.json({
            id: 'cs_live_credit_pack_new_customer',
            object: 'checkout.session',
            livemode: true,
            mode: 'payment',
            url: 'https://checkout.stripe.com/c/pay/cs_live_credit_pack_new_customer',
          });
        }
        if (target.includes('/v1/customers/')) {
          if ((init.method || 'GET') === 'GET') {
            return Response.json({ id: 'cus_credit_pack_new', object: 'customer', preferred_locales: [] });
          }
          return Response.json({ id: 'cus_credit_pack_new', object: 'customer', preferred_locales: ['de'] });
        }
        if (target.includes('/v1/invoices/')) {
          if ((init.method || 'GET') === 'GET') {
            return Response.json({ id: 'in_credit_pack_new', object: 'invoice', rendering: { pdf: { page_size: invoicePageSize } } });
          }
          invoiceUpdates += 1;
          if (invoiceUpdates === 1) return Response.json({ error: { code: 'invoice_update_failed' } }, { status: 500 });
          invoicePageSize = 'a4';
          return Response.json({ id: 'in_credit_pack_new', object: 'invoice', rendering: { pdf: { page_size: 'a4' } } });
        }
        return Response.json({ error: { message: 'unexpected stripe call' } }, { status: 500 });
      },
    });
    const token = await seedSession(env, member.id);
    const created = await worker.fetch(
      authJsonRequest('/api/account/billing/checkout/live-credit-pack', 'POST', {
        pack_id: 'live_credits_5000',
        terms_accepted: true,
        terms_version: '2026-10-22',
        immediate_delivery_accepted: true,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'credit-pack-new-customer',
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(created.status).toBe(201);
    const checkoutForm = calls.find((call) => call.url.endsWith('/v1/checkout/sessions')).form;
    expectCreditPackInvoiceForm(checkoutForm, {
      email: 'credit-pack-new-customer@example.com',
      locale: 'de',
      packId: 'live_credits_5000',
      credits: 5000,
      description: 'One-time purchase: 5000 Credit Pack',
      checkoutScope: 'member',
    });
    expect(env.DB.state.billingMemberCustomers).toHaveLength(0);

    const checkoutId = env.DB.state.billingMemberCheckoutSessions[0].id;
    const payloadFor = (eventId, customerId) => ({
      id: eventId,
      object: 'event',
      type: 'checkout.session.completed',
      livemode: true,
      data: {
        object: {
          id: 'cs_live_credit_pack_new_customer',
          object: 'checkout.session',
          livemode: true,
          mode: 'payment',
          payment_status: 'paid',
          payment_intent: 'pi_live_credit_pack_new_customer',
          payment_method_details: { type: 'card' },
          customer: customerId,
          invoice: 'in_credit_pack_new',
          amount_total: 999,
          currency: 'eur',
          metadata: {
            user_id: member.id,
            credit_pack_id: 'live_credits_5000',
            credits: '5000',
            checkout_scope: 'member',
            authorization_scope: 'member',
            internal_checkout_session_id: checkoutId,
          },
        },
      },
    });
    const first = await handleVerifiedStripeLiveWebhookEvent({
      env,
      rawBody: JSON.stringify(payloadFor('evt_credit_pack_new_customer', 'cus_credit_pack_new')),
      payload: payloadFor('evt_credit_pack_new_customer', 'cus_credit_pack_new'),
      verificationStatus: 'verified_live_signature',
    });
    expect(first.creditGrant).toEqual(expect.objectContaining({ creditsGranted: 5000, userId: member.id }));
    expect(env.DB.state.billingMemberCustomers.map((row) => row.provider_customer_ref)).toEqual(['cus_credit_pack_new']);
    expect(calls.some((call) => call.method === 'POST' && call.form['preferred_locales[0]'] === 'de')).toBe(true);
    expect(invoiceUpdates).toBe(1);

    const repeated = await handleVerifiedStripeLiveWebhookEvent({
      env,
      rawBody: JSON.stringify(payloadFor('evt_credit_pack_new_customer_repeat', 'cus_credit_pack_new')),
      payload: payloadFor('evt_credit_pack_new_customer_repeat', 'cus_credit_pack_new'),
      verificationStatus: 'verified_live_signature',
    });
    expect(repeated.creditGrant.creditsGranted).toBe(0);
    expect(env.DB.state.billingMemberCustomers).toHaveLength(1);
    expect(invoiceUpdates).toBe(2);
    expect(invoicePageSize).toBe('a4');

    env.DB.state.billingMemberCustomers.push({
      id: 'bmc_credit_pack_kept',
      user_id: member.id,
      provider: 'stripe',
      provider_mode: 'live',
      provider_customer_ref: 'cus_credit_pack_kept',
      created_at: '2026-09-01T00:00:00.000Z',
      retired_at: null,
    });
    const conflicted = await handleVerifiedStripeLiveWebhookEvent({
      env,
      rawBody: JSON.stringify(payloadFor('evt_credit_pack_other_customer', 'cus_credit_pack_other')),
      payload: payloadFor('evt_credit_pack_other_customer', 'cus_credit_pack_other'),
      verificationStatus: 'verified_live_signature',
    });
    expect(conflicted.creditGrant.creditsGranted).toBe(0);
    expect(env.DB.state.billingMemberCustomers.map((row) => row.provider_customer_ref).sort()).toEqual([
      'cus_credit_pack_kept',
      'cus_credit_pack_new',
    ]);
  });

  test('missing linked Stripe customer falls back to customer creation', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const member = createContractUser({ id: 'credit-pack-stale-customer', role: 'user' });
    const calls = [];
    const env = createAuthTestEnv({
      ENABLE_LIVE_STRIPE_CREDIT_PACKS: 'true',
      STRIPE_LIVE_SECRET_KEY: 'sk_live_credit_pack_customer_1234567890',
      STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_credit_pack_customer_1234567890',
      STRIPE_LIVE_CHECKOUT_SUCCESS_URL: 'https://bitbi.ai/pricing.html?checkout=success',
      STRIPE_LIVE_CHECKOUT_CANCEL_URL: 'https://bitbi.ai/pricing.html?checkout=cancel',
      users: [member],
      billingMemberCustomers: [{
        id: 'bmc_credit_pack_stale',
        user_id: member.id,
        provider: 'stripe',
        provider_mode: 'live',
        provider_customer_ref: 'cus_credit_pack_stale',
        created_at: '2026-10-01T00:00:00.000Z',
        retired_at: null,
      }],
      fetch: async (url, init = {}) => {
        const target = String(url);
        const form = Object.fromEntries(new URLSearchParams(String(init.body || '')));
        calls.push({ url: target, method: init.method || 'GET', form, key: init.headers?.['Idempotency-Key'] || init.headers?.get?.('Idempotency-Key') });
        if (target.endsWith('/v1/customers/cus_credit_pack_stale')) {
          return Response.json({ id: 'cus_credit_pack_stale', object: 'customer', preferred_locales: ['de'] });
        }
        if (target.endsWith('/v1/checkout/sessions') && form.customer === 'cus_credit_pack_stale') {
          return Response.json({
            error: { code: 'resource_missing', param: 'customer', type: 'invalid_request_error' },
          }, { status: 404 });
        }
        if (target.includes('/v1/customers/')) {
          return Response.json({ id: 'cus_credit_pack_replacement', object: 'customer', preferred_locales: ['de'] });
        }
        return Response.json({
          id: 'cs_live_credit_pack_replacement',
          object: 'checkout.session',
          livemode: true,
          mode: 'payment',
          url: 'https://checkout.stripe.com/c/pay/cs_live_credit_pack_replacement',
          customer: 'cus_credit_pack_replacement',
        });
      },
    });
    const token = await seedSession(env, member.id);
    const response = await worker.fetch(
      authJsonRequest('/api/account/billing/checkout/live-credit-pack', 'POST', {
        pack_id: 'live_credits_5000',
        terms_accepted: true,
        terms_version: '2026-10-22',
        immediate_delivery_accepted: true,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'credit-pack-stale-customer',
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(response.status).toBe(201);
    const checkoutCalls = calls.filter((call) => call.url.endsWith('/v1/checkout/sessions'));
    expect(checkoutCalls.map((call) => call.form.customer || null)).toEqual(['cus_credit_pack_stale', null]);
    expect(checkoutCalls[1].form.customer_creation).toBe('always');
    expect(checkoutCalls[1].key.endsWith(':new-customer')).toBe(true);
    const stale = env.DB.state.billingMemberCustomers.find((row) => row.provider_customer_ref === 'cus_credit_pack_stale');
    const replacement = env.DB.state.billingMemberCustomers.find((row) => row.provider_customer_ref === 'cus_credit_pack_replacement');
    expect(stale.retired_at).toBeTruthy();
    expect(replacement).toEqual(expect.objectContaining({ user_id: member.id, retired_at: null }));
  });

  test('paid subscription invoice webhook is idempotent and tops up subscription credits only', async () => withSubscription(async f => {
    // Fresh period with retained 300/4000 other buckets. An ambiguous old 2000 bucket
    // requires reconciliation; the original pure top-up control remains above.
    await seedNativeBuckets(f,0);
    const first=await f.deliver(invoiceEvent());expect(first.status).toBe(202);
    expect(first.body.creditGrant).toMatchObject({userId:MEMBER,creditsGranted:6000,balanceAfter:10300,subscriptionCredits:6000});
    const ledgerCount=nativeState(f).ledger.length;
    const second=invoiceEvent('evt_q4_legacy_neighbor_second');second.type='invoice.payment_succeeded';
    const repeated=await f.deliver(second);expect(repeated.status).toBe(202);
    expect(repeated.body.creditGrant).toMatchObject({userId:MEMBER,creditsGranted:0,balanceAfter:10300,subscriptionCredits:6000,reused:true});
    const duplicate=await f.deliver(invoiceEvent());expect(duplicate.status).toBe(200);expect(duplicate.body.duplicate).toBe(true);
    expect(nativeState(f).ledger).toHaveLength(ledgerCount);
    expect(nativeState(f).buckets.find(row=>row.bucket_type==='purchased').balance).toBe(4000);
    expect(nativeState(f).buckets.find(row=>row.bucket_type==='legacy_or_bonus').balance).toBe(300);
  }));

  test('subscription invoice webhooks ignore one-off, wrong-price, and missing-price invoices without granting credits', async () => {
    const { handleVerifiedStripeLiveWebhookEvent } = await loadStripeBillingModule();
    const {
      getMemberCreditBucketBalances,
    } = await loadBillingModule();
    const env = seedBucketedMember({
      userId: 'member-subscription-ignored-invoices',
      subscriptionCredits: 2000,
      legacyOrBonusCredits: 300,
      purchasedCredits: 4000,
    });
    env.STRIPE_LIVE_SUBSCRIPTION_PRICE_ID = 'price_member_pro_123456';
    const ledgerCount = env.DB.state.memberCreditLedger.length;

    const oneOffPayload = {
      id: 'evt_member_subscription_one_off_invoice',
      object: 'event',
      type: 'invoice.paid',
      livemode: true,
      data: {
        object: {
          id: 'in_member_subscription_one_off',
          object: 'invoice',
          livemode: true,
          status: 'paid',
          customer: 'cus_member_pro_123456',
          lines: { data: [] },
          metadata: { user_id: 'member-subscription-ignored-invoices' },
        },
      },
    };
    const oneOff = await handleVerifiedStripeLiveWebhookEvent({
      env,
      rawBody: JSON.stringify(oneOffPayload),
      payload: oneOffPayload,
      verificationStatus: 'verified_test_signature',
    });
    expect(oneOff.actionPlanned).toBe(false);
    expect(env.DB.state.billingProviderEvents.at(-1).processing_status).toBe('ignored');

    const wrongPricePayload = {
      id: 'evt_member_subscription_wrong_price_invoice',
      object: 'event',
      type: 'invoice.paid',
      livemode: true,
      data: {
        object: {
          id: 'in_member_subscription_wrong_price',
          object: 'invoice',
          livemode: true,
          status: 'paid',
          customer: 'cus_member_pro_123456',
          lines: {
            data: [{
              pricing: {
                price_details: {
                  price: 'price_unrelated_123456',
                  product: 'prod_unrelated_123456',
                },
              },
              parent: {
                subscription_item_details: {
                  subscription: 'sub_member_pro_123456',
                },
              },
              period: { start: PERIOD_START_SECONDS, end: PERIOD_END_SECONDS },
              metadata: { user_id: 'member-subscription-ignored-invoices' },
            }],
          },
          parent: {
            subscription_details: {
              subscription: 'sub_member_pro_123456',
              metadata: { user_id: 'member-subscription-ignored-invoices' },
            },
          },
        },
      },
    };
    const wrongPrice = await handleVerifiedStripeLiveWebhookEvent({
      env,
      rawBody: JSON.stringify(wrongPricePayload),
      payload: wrongPricePayload,
      verificationStatus: 'verified_test_signature',
    });
    expect(wrongPrice.actionPlanned).toBe(false);
    expect(env.DB.state.billingProviderEvents.at(-1).processing_status).toBe('ignored');

    const missingPricePayload = {
      id: 'evt_member_subscription_missing_price_invoice',
      object: 'event',
      type: 'invoice.paid',
      livemode: true,
      data: {
        object: {
          id: 'in_member_subscription_missing_price',
          object: 'invoice',
          livemode: true,
          status: 'paid',
          customer: 'cus_member_pro_123456',
          lines: {
            data: [{
              parent: {
                subscription_item_details: {
                  subscription: 'sub_member_pro_123456',
                },
              },
              period: { start: PERIOD_START_SECONDS, end: PERIOD_END_SECONDS },
              metadata: { user_id: 'member-subscription-ignored-invoices' },
            }],
          },
          parent: {
            subscription_details: {
              subscription: 'sub_member_pro_123456',
              metadata: { user_id: 'member-subscription-ignored-invoices' },
            },
          },
        },
      },
    };
    const missingPrice = await handleVerifiedStripeLiveWebhookEvent({
      env,
      rawBody: JSON.stringify(missingPricePayload),
      payload: missingPricePayload,
      verificationStatus: 'verified_test_signature',
    });
    expect(missingPrice.actionPlanned).toBe(false);
    expect(env.DB.state.billingProviderEvents.at(-1).processing_status).toBe('ignored');
    expect(env.DB.state.memberCreditLedger).toHaveLength(ledgerCount);
    await expect(getMemberCreditBucketBalances(env, 'member-subscription-ignored-invoices')).resolves.toMatchObject({
      subscriptionCredits: 2000,
      legacyOrBonusCredits: 300,
      purchasedCredits: 4000,
      totalCredits: 6300,
    });
  });

  test('one-time credit-pack invoices do not grant credits even when they resemble a Pro invoice', async () => withSubscription(async f => {
    const packMetadata = {
      user_id: MEMBER,
      credit_pack_id: 'live_credits_5000',
      pack_id: 'live_credits_5000',
      credits: '5000',
      checkout_scope: 'member',
      authorization_scope: 'member',
      internal_checkout_session_id: 'bcs_q4_credit_pack_invoice',
    };
    const shaped = invoiceEvent('evt_q4_credit_pack_invoice_paid', { invoice: 'in_q4_credit_pack_invoice' });
    shaped.data.object.metadata = packMetadata;
    shaped.data.object.parent.subscription_details.metadata = packMetadata;
    shaped.data.object.lines.data[0].metadata = packMetadata;
    const paid = await f.deliver(shaped);
    expect(paid.status).toBe(202);
    expect(paid.body.creditGrant).toBeNull();
    expect(paid.body.subscription).toBeNull();
    expect(paid.body.actionPlanned).toBe(false);
    expect(nativeState(f).events.at(-1)).toMatchObject({
      event_type: 'invoice.paid',
      processing_status: 'ignored',
    });
    expect(JSON.parse(nativeState(f).actions.at(-1).summary_json).reason).toContain('one-time credit-pack invoice');

    const succeeded = invoiceEvent('evt_q4_credit_pack_invoice_succeeded', { invoice: 'in_q4_credit_pack_succeeded' });
    succeeded.type = 'invoice.payment_succeeded';
    succeeded.data.object.billing_reason = 'manual';
    succeeded.data.object.metadata = packMetadata;
    delete succeeded.data.object.parent;
    succeeded.data.object.lines = {
      has_more: false,
      data: [{
        id: 'il_q4_credit_pack_manual',
        amount: 999,
        currency: 'eur',
        quantity: 1,
        description: '5000 Credit Pack',
        metadata: packMetadata,
      }],
    };
    const manual = await f.deliver(succeeded);
    expect(manual.status).toBe(202);
    expect(manual.body.creditGrant).toBeNull();
    expect(manual.body.subscription).toBeNull();

    for (const type of ['invoice.created', 'invoice.finalized']) {
      const lifecycle = invoiceEvent(`evt_q4_credit_pack_${type.replaceAll('.', '_')}`, {
        invoice: `in_q4_${type.replaceAll('.', '_')}`,
      });
      lifecycle.type = type;
      lifecycle.data.object.status = type === 'invoice.created' ? 'draft' : 'open';
      lifecycle.data.object.metadata = packMetadata;
      const result = await f.deliver(lifecycle);
      expect(result.status).toBe(202);
      expect(result.body.creditGrant).toBeNull();
      expect(result.body.subscription).toBeNull();
      expect(result.body.actionPlanned).toBe(false);
      expect(nativeState(f).events.at(-1)).toMatchObject({
        event_type: type,
        processing_status: 'ignored',
        error_code: 'stripe_invoice_lifecycle_ignored',
      });
    }

    const duplicate = await f.deliver(shaped);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);
    expect(duplicate.body.creditGrant).toBeNull();
    expect(nativeState(f).ledger).toHaveLength(0);
    expect(nativeState(f).buckets).toHaveLength(0);
    expect(nativeState(f).subscriptions).toHaveLength(0);
  }));

  test('testmode credit-pack invoice events do not grant credits', async () => {
    const { handleVerifiedStripeWebhookEvent } = await loadStripeBillingModule();
    const env = createAuthTestEnv({
      users: [createContractUser({ id: 'testmode-credit-pack-invoice-user', role: 'user' })],
    });
    const ledgerCount = env.DB.state.memberCreditLedger.length;
    const packMetadata = {
      user_id: 'testmode-credit-pack-invoice-user',
      credit_pack_id: 'credits_5000',
      pack_id: 'credits_5000',
      credits: '5000',
      organization_id: 'org_22222222222222222222222222222222',
    };
    for (const [type, id] of [
      ['invoice.created', 'evt_testmode_credit_pack_invoice_created'],
      ['invoice.finalized', 'evt_testmode_credit_pack_invoice_finalized'],
      ['invoice.paid', 'evt_testmode_credit_pack_invoice_paid'],
      ['invoice.payment_succeeded', 'evt_testmode_credit_pack_invoice_succeeded'],
    ]) {
      const payload = {
        id,
        object: 'event',
        type,
        livemode: false,
        data: {
          object: {
            id: `in_testmode_${type.replaceAll('.', '_')}`,
            object: 'invoice',
            livemode: false,
            status: type === 'invoice.paid' || type === 'invoice.payment_succeeded' ? 'paid' : 'draft',
            billing_reason: 'manual',
            amount_paid: 4900,
            currency: 'eur',
            metadata: packMetadata,
            lines: { data: [{ amount: 4900, currency: 'eur', quantity: 1, metadata: packMetadata }] },
          },
        },
      };
      const result = await handleVerifiedStripeWebhookEvent({
        env,
        rawBody: JSON.stringify(payload),
        payload,
        verificationStatus: 'verified_test_signature',
      });
      expect(result.creditGrant).toBeNull();
      expect(result.subscription).toBeNull();
      expect(result.actionPlanned).toBe(false);
      expect(env.DB.state.billingProviderEvents.at(-1)).toMatchObject({
        event_type: type,
        processing_status: 'ignored',
        error_code: 'stripe_invoice_no_credit_side_effect',
      });
    }
    expect(env.DB.state.memberCreditLedger).toHaveLength(ledgerCount);
    expect(env.DB.state.memberCreditBuckets).toHaveLength(0);
  });

  test('paid subscription invoice can safely provision before a subscription lifecycle event', async () => withSubscription(async f => {
    const first=await f.deliver(invoiceEvent());expect(first.status).toBe(202);
    expect(first.body.creditGrant).toMatchObject({userId:MEMBER,creditsGranted:6000,balanceAfter:6000,subscriptionCredits:6000});
    expect(nativeState(f).subscriptions).toHaveLength(1);
    expect(nativeState(f).subscriptions[0]).toMatchObject({user_id:MEMBER,provider_subscription_id:checkout.subscription,provider_price_id:PRICE,status:'active',current_period_start:new Date(START*1000).toISOString(),current_period_end:new Date(END*1000).toISOString()});
    const {getMemberCreditBucketBalances}=await loadBillingModule();
    await expect(getMemberCreditBucketBalances(f.env,MEMBER)).resolves.toMatchObject({subscriptionCredits:6000,legacyOrBonusCredits:0,purchasedCredits:0,totalCredits:6000});
  }));

  test('subscription lifecycle events without the BITBI Pro price do not activate storage', async () => {
    const { handleVerifiedStripeLiveWebhookEvent } = await loadStripeBillingModule();
    const {
      USER_ASSET_STORAGE_LIMIT_BYTES,
      getUserAssetStorageUsageSnapshot,
    } = await loadAssetStorageQuotaModule();
    const user = createContractUser({ id: 'member-subscription-wrong-price-storage', role: 'user' });
    const env = createAuthTestEnv({
      users: [user],
      STRIPE_LIVE_SUBSCRIPTION_PRICE_ID: 'price_member_pro_123456',
      userAssetStorageUsage: [{ user_id: user.id, used_bytes: 0, updated_at: nowIso() }],
    });
    const payload = {
      id: 'evt_member_subscription_wrong_price_update',
      object: 'event',
      type: 'customer.subscription.updated',
      livemode: true,
      data: {
        object: {
          id: 'sub_wrong_price_storage_123456',
          object: 'subscription',
          livemode: true,
          customer: 'cus_wrong_price_storage_123456',
          status: 'active',
          current_period_start: 1777593600,
          current_period_end: 1780272000,
          cancel_at_period_end: false,
          items: {
            data: [{
              price: { id: 'price_unrelated_123456' },
              current_period_start: 1777593600,
              current_period_end: 1780272000,
            }],
          },
          metadata: { user_id: user.id },
        },
      },
    };
    const result = await handleVerifiedStripeLiveWebhookEvent({
      env,
      rawBody: JSON.stringify(payload),
      payload,
      verificationStatus: 'verified_test_signature',
    });
    expect(result.actionPlanned).toBe(false);
    expect(env.DB.state.billingMemberSubscriptions).toHaveLength(0);
    await expect(getUserAssetStorageUsageSnapshot(env, user.id)).resolves.toMatchObject({
      limitBytes: USER_ASSET_STORAGE_LIMIT_BYTES,
      hasActiveSubscription: false,
      plan: 'free',
    });
  });

  test('subscription cancellation does not touch purchased or legacy credits', async () => withSubscription(async f => {
    await seedNativeBuckets(f,6000);const count=nativeState(f).ledger.length;
    const cancelled=await f.deliver(lifecycleEvent('evt_q4_neighbor_cancel',{type:'customer.subscription.deleted',status:'canceled'}));
    expect(cancelled.status).toBe(202);expect(cancelled.body.creditGrant).toBeNull();
    expect(nativeState(f).ledger).toHaveLength(count);expect(nativeState(f).subscriptions[0].status).toBe('canceled');
    const {getMemberCreditBucketBalances}=await loadBillingModule();
    await expect(getMemberCreditBucketBalances(f.env,MEMBER)).resolves.toMatchObject({subscriptionCredits:6000,legacyOrBonusCredits:300,purchasedCredits:4000,totalCredits:10300});
  }));

  test('member can schedule active subscription cancellation at period end and keep access', async () => withSubscription(async f => {
    f.db.exec(fs.readFileSync(path.join(process.cwd(),'workers/auth/migrations/0117_consumer_contracts.sql'),'utf8'));
    await f.deliver(invoiceEvent('evt_q4_cancel_paid'));
    const {grantMemberCredits}=await loadBillingModule();
    await grantMemberCredits({env:f.env,userId:MEMBER,amount:1200,createdByUserId:MEMBER,idempotencyKey:'q4-cancel-purchased',source:'synthetic_legacy_fixture',creditBucketType:'purchased'});
    f.env.STRIPE_LIVE_SECRET_KEY='sk_live_subscription_manage_secret_123456';
    const calls=[];
    f.env.__TEST_FETCH=async(url,init={})=>{calls.push({url:String(url),form:Object.fromEntries(new URLSearchParams(String(init.body||'')))});
      return Response.json({id:checkout.subscription,livemode:true,customer:checkout.customer,status:'active',cancel_at_period_end:true,
        current_period_start:START,current_period_end:END,items:{data:[{price:{id:PRICE}}]}});};
    const session=await f.session.createSession(f.env,MEMBER),cookie=`${f.cookies.SECURE_SESSION_COOKIE_NAME}=${session.sessionToken}`;
    const response=await f.http.request('/api/account/billing/subscription/cancel',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://bitbi.ai',Cookie:cookie,'Idempotency-Key':'member-subscription-cancel-1'},body:JSON.stringify({confirmed:true,locale:'de'})});
    const body=await response.json();expect(response.status).toBe(200);
    expect(body.subscription).toMatchObject({userId:MEMBER,providerSubscriptionId:checkout.subscription,status:'active',cancelAtPeriodEnd:true});
    expect(calls).toHaveLength(1);expect(calls[0].url).toContain(`/v1/subscriptions/${checkout.subscription}`);expect(calls[0].form.cancel_at_period_end).toBe('true');
    expect(nativeState(f).subscriptions[0].cancel_at_period_end).toBe(1);
    const dashboard=await f.http.request('/api/account/credits-dashboard',{headers:{Cookie:cookie}});
    expect(dashboard.status).toBe(200);expect((await dashboard.json()).dashboard).toMatchObject({hasActiveSubscription:true,cancelAtPeriodEnd:true,canCancelSubscription:false,canReactivateSubscription:true,activeUntil:new Date(END*1000).toISOString()});
    expect(f.db.database.prepare("SELECT COUNT(*) AS n FROM transactional_messages WHERE kind='cancellation_confirmation'").get().n).toBe(1);
    expect(nativeState(f).buckets.find(row=>row.bucket_type==='purchased').balance).toBe(1200);
  }));

  test('member can reactivate a scheduled subscription without creating a duplicate subscription', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const env = seedBucketedMember({
      userId: 'member-subscription-manage-reactivate',
      subscriptionCredits: 6000,
      cancelAtPeriodEnd: 1,
    });
    env.STRIPE_LIVE_SECRET_KEY = 'sk_live_subscription_manage_secret_123456';
    env.STRIPE_LIVE_SUBSCRIPTION_PRICE_ID = 'price_member_pro_123456';
    const calls = [];
    env.__TEST_FETCH = async (url, init = {}) => {
      calls.push({ url: String(url), form: Object.fromEntries(new URLSearchParams(String(init.body || ''))) });
      return new Response(JSON.stringify({
        id: 'sub_member_pro_123456',
        object: 'subscription',
        livemode: true,
        customer: 'cus_member_pro_123456',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: PERIOD_START_SECONDS,
        current_period_end: PERIOD_END_SECONDS,
        items: { data: [{ price: { id: 'price_member_pro_123456' } }] },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const token = await seedSession(env, 'member-subscription-manage-reactivate');
    const response = await worker.fetch(
      authJsonRequest('/api/account/billing/subscription/reactivate', 'POST', { confirmed: true }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-subscription-reactivate-1',
      }),
      env,
      createExecutionContext().execCtx
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.subscription).toEqual(expect.objectContaining({
      userId: 'member-subscription-manage-reactivate',
      cancelAtPeriodEnd: false,
    }));
    expect(calls).toHaveLength(1);
    expect(calls[0].form.cancel_at_period_end).toBe('false');
    expect(env.DB.state.billingMemberSubscriptions).toHaveLength(1);
    expect(env.DB.state.billingMemberSubscriptions[0].cancel_at_period_end).toBe(0);
  });

  test('subscription management rejects missing, expired, or other-user subscriptions before Stripe calls', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const env = seedBucketedMember({
      userId: 'member-subscription-other-user',
      subscriptionCredits: 6000,
    });
    env.STRIPE_LIVE_SECRET_KEY = 'sk_live_subscription_manage_secret_123456';
    env.STRIPE_LIVE_SUBSCRIPTION_PRICE_ID = 'price_member_pro_123456';
    const calls = [];
    env.__TEST_FETCH = async () => {
      calls.push('called');
      return new Response('{}', { status: 500 });
    };

    const noSubscriptionUser = createContractUser({ id: 'member-subscription-no-sub', role: 'user' });
    env.DB.state.users.push(noSubscriptionUser);
    const noSubscriptionToken = await seedSession(env, noSubscriptionUser.id);
    const noSubscription = await worker.fetch(
      authJsonRequest('/api/account/billing/subscription/cancel', 'POST', { confirmed: true }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${noSubscriptionToken}`,
        'Idempotency-Key': 'member-subscription-no-sub-cancel',
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(noSubscription.status).toBe(404);

    const expiredUser = createContractUser({ id: 'member-subscription-expired-manage', role: 'user' });
    env.DB.state.users.push(expiredUser);
    env.DB.state.billingMemberSubscriptions.push({
      ...env.DB.state.billingMemberSubscriptions[0],
      id: 'msub_member_subscription_expired_manage',
      user_id: expiredUser.id,
      provider_subscription_id: 'sub_expired_manage_123456',
      current_period_start: '2026-03-01T00:00:00.000Z',
      current_period_end: '2026-04-01T00:00:00.000Z',
      cancel_at_period_end: 1,
      updated_at: '2026-04-01T00:00:00.000Z',
    });
    const expiredToken = await seedSession(env, expiredUser.id);
    const expired = await worker.fetch(
      authJsonRequest('/api/account/billing/subscription/reactivate', 'POST', { confirmed: true }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${expiredToken}`,
        'Idempotency-Key': 'member-subscription-expired-reactivate',
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(expired.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  test('legacy reconciliation is idempotent and keeps admin grants outside subscription top-up', async () => {
    const {
      getMemberCreditBucketBalances,
      topUpMemberSubscriptionCredits,
    } = await loadBillingModule();
    const userId = 'member-legacy-reconcile-idempotent';
    const env = createAuthTestEnv({
      users: [createContractUser({ id: userId, role: 'user' }), createAdminUser('admin-user')],
      billingMemberSubscriptions: [{
        id: `msub_${userId}`,
        user_id: userId,
        provider: 'stripe',
        provider_mode: 'live',
        provider_customer_id: 'cus_legacy_reconcile_123456',
        provider_subscription_id: 'sub_legacy_reconcile_123456',
        provider_price_id: 'price_member_pro_123456',
        status: 'active',
        current_period_start: PERIOD_START,
        current_period_end: PERIOD_END,
        cancel_at_period_end: 0,
        canceled_at: null,
        metadata_json: '{}',
        created_at: PERIOD_START,
        updated_at: PERIOD_START,
      }],
      memberCreditLedger: [
        {
          id: 'mcl_legacy_reconcile_admin_grant',
          user_id: userId,
          amount: 300,
          balance_after: 300,
          entry_type: 'grant',
          feature_key: null,
          source: 'manual_admin_grant',
          idempotency_key: 'legacy-reconcile-admin-grant',
          request_hash: 'legacy-reconcile-admin-grant',
          created_by_user_id: 'admin-user',
          created_at: '2026-04-01T00:00:00.000Z',
          metadata_json: '{}',
        },
        {
          id: 'mcl_legacy_reconcile_purchase',
          user_id: userId,
          amount: 5000,
          balance_after: 5300,
          entry_type: 'grant',
          feature_key: null,
          source: 'stripe_live_checkout',
          idempotency_key: 'legacy-reconcile-purchase',
          request_hash: 'legacy-reconcile-purchase',
          created_by_user_id: userId,
          created_at: '2026-04-02T00:00:00.000Z',
          metadata_json: '{}',
        },
      ],
    });

    await expect(getMemberCreditBucketBalances(env, userId)).resolves.toMatchObject({
      subscriptionCredits: 0,
      legacyOrBonusCredits: 300,
      purchasedCredits: 5000,
      totalCredits: 5300,
    });
    const bucketCount = env.DB.state.memberCreditBuckets.length;
    await expect(getMemberCreditBucketBalances(env, userId)).resolves.toMatchObject({
      subscriptionCredits: 0,
      legacyOrBonusCredits: 300,
      purchasedCredits: 5000,
      totalCredits: 5300,
    });
    expect(env.DB.state.memberCreditBuckets).toHaveLength(bucketCount);

    const topUp = await topUpMemberSubscriptionCredits({
      env,
      userId,
      providerSubscriptionId: 'sub_legacy_reconcile_123456',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      stripeInvoiceId: 'in_legacy_reconcile_renewal',
      providerEventId: 'evt_legacy_reconcile_renewal',
    });
    expect(topUp.grantedCredits).toBe(6000);
    await expect(getMemberCreditBucketBalances(env, userId)).resolves.toMatchObject({
      subscriptionCredits: 6000,
      legacyOrBonusCredits: 300,
      purchasedCredits: 5000,
      totalCredits: 11300,
    });
  });

  test('member credit consumption uses subscription first, legacy second, and purchased last', async () => {
    const {
      consumeMemberCredits,
      getMemberCreditBucketBalances,
    } = await loadBillingModule();
    const env = seedBucketedMember({
      userId: 'member-consumption-order',
      subscriptionCredits: 2000,
      legacyOrBonusCredits: 300,
      purchasedCredits: 4000,
    });
    const result = await consumeMemberCredits({
      env,
      userId: 'member-consumption-order',
      featureKey: 'ai.image.generate',
      credits: 2500,
      quantity: 1,
      idempotencyKey: 'member-consumption-order-1',
    });
    expect(result.creditBalance).toBe(3800);
    await expect(getMemberCreditBucketBalances(env, 'member-consumption-order')).resolves.toMatchObject({
      subscriptionCredits: 0,
      legacyOrBonusCredits: 0,
      purchasedCredits: 3800,
      totalCredits: 3800,
    });
    const debitTypes = env.DB.state.memberCreditBucketEvents
      .filter((event) => event.amount < 0)
      .map((event) => [event.bucket_type, Math.abs(event.amount)]);
    expect(debitTypes).toEqual([
      ['subscription', 2000],
      ['legacy_or_bonus', 300],
      ['purchased', 200],
    ]);
  });

  test('live member credit-pack grant increments the purchased bucket without changing external checkout behavior', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const member = createContractUser({ id: 'member-pack-purchased-bucket', role: 'user' });
    const env = createAuthTestEnv({
      ENABLE_LIVE_STRIPE_CREDIT_PACKS: 'true',
      STRIPE_LIVE_SECRET_KEY: 'sk_live_subscription_test_secret_123456',
      STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_subscription_test_secret_123456',
      STRIPE_LIVE_CHECKOUT_SUCCESS_URL: 'https://bitbi.ai/pricing.html?checkout=success',
      STRIPE_LIVE_CHECKOUT_CANCEL_URL: 'https://bitbi.ai/pricing.html?checkout=cancel',
      users: [member],
      fetch: async () => new Response(JSON.stringify({
        id: 'cs_live_member_pack_bucket',
        object: 'checkout.session',
        livemode: true,
        mode: 'payment',
        url: 'https://checkout.stripe.com/c/pay/cs_live_member_pack_bucket',
        payment_intent: 'pi_live_member_pack_bucket',
        customer: 'cus_member_pack_bucket',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    const token = await seedSession(env, member.id);
    const checkout = await worker.fetch(
      authJsonRequest('/api/account/billing/checkout/live-credit-pack', 'POST', {
        pack_id: 'live_credits_5000',
        terms_accepted: true,
        terms_version: '2026-10-22',
        immediate_delivery_accepted: true,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-pack-purchased-bucket-checkout',
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(checkout.status).toBe(201);

    const { handleVerifiedStripeLiveWebhookEvent } = await loadStripeBillingModule();
    const payload = {
      id: 'evt_member_pack_bucket',
      object: 'event',
      type: 'checkout.session.completed',
      livemode: true,
      data: {
        object: {
          id: 'cs_live_member_pack_bucket',
          object: 'checkout.session',
          livemode: true,
          mode: 'payment',
          payment_status: 'paid',
          payment_intent: 'pi_live_member_pack_bucket',
          customer: 'cus_member_pack_bucket',
          amount_total: 999,
          currency: 'eur',
          metadata: {
            user_id: member.id,
            credit_pack_id: 'live_credits_5000',
            credits: '5000',
            checkout_scope: 'member',
            authorization_scope: 'member',
            internal_checkout_session_id: env.DB.state.billingMemberCheckoutSessions[0].id,
          },
        },
      },
    };
    const result = await handleVerifiedStripeLiveWebhookEvent({
      env,
      rawBody: JSON.stringify(payload),
      payload,
      verificationStatus: 'verified_live_signature',
    });
    expect(result.creditGrant).toEqual(expect.objectContaining({
      userId: member.id,
      creditsGranted: 5000,
      balanceAfter: 5000,
    }));
    expect(env.DB.state.memberCreditBuckets.find((row) => row.bucket_type === 'purchased')).toEqual(expect.objectContaining({
      user_id: member.id,
      balance: 5000,
    }));
  });

  test('live member 12000 credit-pack grant increments the purchased bucket exactly once', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const member = createContractUser({ id: 'member-pack-12000-purchased-bucket', role: 'user' });
    const env = createAuthTestEnv({
      ENABLE_LIVE_STRIPE_CREDIT_PACKS: 'true',
      STRIPE_LIVE_SECRET_KEY: 'sk_live_subscription_test_secret_123456',
      STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_subscription_test_secret_123456',
      STRIPE_LIVE_CHECKOUT_SUCCESS_URL: 'https://bitbi.ai/pricing.html?checkout=success',
      STRIPE_LIVE_CHECKOUT_CANCEL_URL: 'https://bitbi.ai/pricing.html?checkout=cancel',
      users: [member],
      fetch: async () => new Response(JSON.stringify({
        id: 'cs_live_member_pack_12000_bucket',
        object: 'checkout.session',
        livemode: true,
        mode: 'payment',
        url: 'https://checkout.stripe.com/c/pay/cs_live_member_pack_12000_bucket',
        payment_intent: 'pi_live_member_pack_12000_bucket',
        customer: 'cus_member_pack_12000_bucket',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    });
    const token = await seedSession(env, member.id);
    const checkout = await worker.fetch(
      authJsonRequest('/api/account/billing/checkout/live-credit-pack', 'POST', {
        pack_id: 'live_credits_12000',
        terms_accepted: true,
        terms_version: '2026-10-22',
        immediate_delivery_accepted: true,
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-pack-12000-purchased-bucket-checkout',
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(checkout.status).toBe(201);

    const { handleVerifiedStripeLiveWebhookEvent } = await loadStripeBillingModule();
    const payload = {
      id: 'evt_member_pack_12000_bucket',
      object: 'event',
      type: 'checkout.session.completed',
      livemode: true,
      data: {
        object: {
          id: 'cs_live_member_pack_12000_bucket',
          object: 'checkout.session',
          livemode: true,
          mode: 'payment',
          payment_status: 'paid',
          payment_intent: 'pi_live_member_pack_12000_bucket',
          customer: 'cus_member_pack_12000_bucket',
          amount_total: 1999,
          currency: 'eur',
          metadata: {
            user_id: member.id,
            credit_pack_id: 'live_credits_12000',
            credits: '12000',
            checkout_scope: 'member',
            authorization_scope: 'member',
            internal_checkout_session_id: env.DB.state.billingMemberCheckoutSessions[0].id,
          },
        },
      },
    };
    const result = await handleVerifiedStripeLiveWebhookEvent({
      env,
      rawBody: JSON.stringify(payload),
      payload,
      verificationStatus: 'verified_live_signature',
    });
    expect(result.creditGrant).toEqual(expect.objectContaining({
      userId: member.id,
      creditsGranted: 12000,
      balanceAfter: 12000,
    }));
    const ledgerCount = env.DB.state.memberCreditLedger.length;
    const duplicate = await handleVerifiedStripeLiveWebhookEvent({
      env,
      rawBody: JSON.stringify(payload),
      payload,
      verificationStatus: 'verified_live_signature',
    });
    expect(duplicate.duplicate).toBe(true);
    expect(env.DB.state.memberCreditLedger).toHaveLength(ledgerCount);
    expect(env.DB.state.memberCreditBuckets.find((row) => row.bucket_type === 'purchased')).toEqual(expect.objectContaining({
      user_id: member.id,
      balance: 12000,
    }));
  });

  test('member billing portal is authenticated, idempotent, and validates live Stripe portal responses', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const { upsertMemberSubscriptionFromProvider } = await loadBillingModule();
    const member = createContractUser({ id: 'member-billing-portal', role: 'user' });
    const calls = [];
    const stripePortalUrl = 'https://billing.stripe.com/p/session/live_YWNjdF8xTTJKVGtMa2RJd0h1N2l4LF9iaXRiaV9wb3J0YWxfMDE';
    const env = createAuthTestEnv({
      STRIPE_LIVE_SECRET_KEY: 'sk_live_member_portal_secret_123456',
      STRIPE_LIVE_SUBSCRIPTION_PRICE_ID: 'price_member_pro_portal_123456',
      STRIPE_LIVE_CUSTOMER_PORTAL_RETURN_URL: 'https://bitbi.ai/account/credits.html?scope=member',
      users: [member],
      fetch: async (url, init = {}) => {
        calls.push({ url, init, form: Object.fromEntries(new URLSearchParams(String(init.body || ''))) });
        return new Response(JSON.stringify({
          id: 'bps_member_portal_123456',
          object: 'billing_portal.session',
          livemode: true,
          url: stripePortalUrl,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    await upsertMemberSubscriptionFromProvider({
      env,
      userId: member.id,
      providerSubscriptionId: 'sub_member_portal_123456',
      providerCustomerId: 'cus_member_portal_123456',
      providerPriceId: 'price_member_pro_portal_123456',
      status: 'active',
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      metadata: { source: 'test' },
    });
    const token = await seedSession(env, member.id);

    const response = await worker.fetch(
      authJsonRequest('/api/account/billing/portal', 'POST', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-portal-1',
      }),
      env,
      createExecutionContext().execCtx
    );
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body).toEqual(expect.objectContaining({
      ok: true,
      portal_url: stripePortalUrl,
      mode: 'live',
    }));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.stripe.com/v1/billing_portal/sessions');
    expect(calls[0].init.headers.Authorization).toContain('Bearer ');
    expect(JSON.stringify(body)).not.toContain('cus_member_portal_123456');
    expect(JSON.stringify(body)).not.toContain('sk_live_member_portal_secret_123456');
    expect(body).not.toHaveProperty('customer');
    expect(body).not.toHaveProperty('session_id');
    expect(calls[0].form.customer).toBe('cus_member_portal_123456');
    expect(calls[0].form.return_url).toBe('https://bitbi.ai/account/credits.html?scope=member');

    env.__TEST_FETCH = async () => new Response(JSON.stringify({
      id: 'bps_member_portal_987654',
      object: 'billing_portal.session',
      livemode: true,
      url: 'https://billing.stripe.com/p/session/live_YWNjdF9iaXRiaV9wb3J0YWxfOTg3NjU0?prefilled_email=member%40bitbi.ai',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const documentedUrl = await worker.fetch(
      authJsonRequest('/api/account/billing/portal', 'POST', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-portal-documented-url',
      }),
      env,
      createExecutionContext().execCtx
    );
    await expect(documentedUrl.json()).resolves.toMatchObject({
      ok: true,
      portal_url: 'https://billing.stripe.com/p/session/live_YWNjdF9iaXRiaV9wb3J0YWxfOTg3NjU0?prefilled_email=member%40bitbi.ai',
    });
    expect(documentedUrl.status).toBe(201);

    env.__TEST_FETCH = async () => new Response(JSON.stringify({
      id: 'bps_member_portal_custom_domain',
      object: 'billing_portal.session',
      livemode: true,
      url: 'https://pay.bitbi.ai/p/session/live_YWNjdF9iaXRiaV9jdXN0b21fZG9tYWlu',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const customDomainUrl = await worker.fetch(
      authJsonRequest('/api/account/billing/portal', 'POST', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-portal-custom-domain-url',
      }),
      env,
      createExecutionContext().execCtx
    );
    await expect(customDomainUrl.json()).resolves.toMatchObject({
      ok: true,
      portal_url: 'https://pay.bitbi.ai/p/session/live_YWNjdF9iaXRiaV9jdXN0b21fZG9tYWlu',
    });
    expect(customDomainUrl.status).toBe(201);

    const expectInvalidPortalUrl = async (idempotencyKey, url) => {
      env.__TEST_FETCH = async () => new Response(JSON.stringify({
        id: 'bps_member_portal_invalid_url',
        object: 'billing_portal.session',
        livemode: true,
        url,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      const invalidUrl = await worker.fetch(
        authJsonRequest('/api/account/billing/portal', 'POST', undefined, {
          Origin: 'https://bitbi.ai',
          Cookie: `bitbi_session=${token}`,
          'Idempotency-Key': idempotencyKey,
        }),
        env,
        createExecutionContext().execCtx
      );
      await expect(invalidUrl.json()).resolves.toMatchObject({
        code: 'stripe_billing_portal_invalid_response',
        error: 'Stripe Billing Portal Session URL is invalid.',
      });
      expect(invalidUrl.status).toBe(502);
    };

    await expectInvalidPortalUrl(
      'member-portal-non-https-url',
      'http://billing.stripe.com/p/session/live_YWNjdF9iaXRiaV9wb3J0YWxfaHR0cA'
    );
    await expectInvalidPortalUrl(
      'member-portal-non-allowed-domain',
      'https://billing.example.com/p/session/live_YWNjdF9iaXRiaV9wb3J0YWxfZXZpbA'
    );
    await expectInvalidPortalUrl(
      'member-portal-credentialed-url',
      'https://member:secret@billing.stripe.com/p/session/live_YWNjdF9iaXRiaV9wb3J0YWxfY3JlZA'
    );
    await expectInvalidPortalUrl(
      'member-portal-malformed-path',
      'https://pay.bitbi.ai/customer/session/live_YWNjdF9iaXRiaV9wb3J0YWxfbWFsZm9ybWVk'
    );

    env.__TEST_FETCH = async () => new Response(JSON.stringify({
      id: 'bps_member_portal_testmode',
      object: 'billing_portal.session',
      livemode: false,
      url: 'https://billing.stripe.com/p/session/bps_member_portal_testmode',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const invalid = await worker.fetch(
      authJsonRequest('/api/account/billing/portal', 'POST', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
        'Idempotency-Key': 'member-portal-invalid',
      }),
      env,
      createExecutionContext().execCtx
    );
    await expect(invalid.json()).resolves.toMatchObject({
      code: 'stripe_billing_portal_invalid_response',
    });
    expect(invalid.status).toBe(502);
  });

  test('credits page redirects to Stripe Customer Portal without rendering the portal URL', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'js/pages/credits/main.js'), 'utf8');
    expect(source).toContain("'https://pay.bitbi.ai'");
    expect(source).toContain('const portalUrl = res.data?.portal_url;');
    expect(source).toContain('if (isSafePortalRedirect(portalUrl))');
    expect(source).toContain('window.location.assign(portalUrl);');
    expect(source).not.toMatch(/subscriptionFeedbackMessage\s*=\s*portalUrl/);
    expect(source).not.toMatch(/textContent\s*=\s*portalUrl/);
  });

  test('member billing portal requires an idempotency key before Stripe calls', async () => {
    const worker = await loadWorker('workers/auth/src/index.js');
    const member = createContractUser({ id: 'member-billing-portal-missing-key', role: 'user' });
    const calls = [];
    const env = createAuthTestEnv({
      users: [member],
      fetch: async () => {
        calls.push(true);
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    const token = await seedSession(env, member.id);
    const missingKey = await worker.fetch(
      authJsonRequest('/api/account/billing/portal', 'POST', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(missingKey.status).toBe(428);
    expect(calls).toHaveLength(0);
  });

  test('route policy includes the member subscription checkout route', async () => {
    const { ROUTE_POLICIES } = await loadRoutePolicyModule();
    expect(ROUTE_POLICIES).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'account.billing.checkout.subscription',
        method: 'POST',
        path: '/api/account/billing/checkout/subscription',
        auth: 'user',
      }),
      expect.objectContaining({
        id: 'account.billing.subscription.cancel',
        method: 'POST',
        path: '/api/account/billing/subscription/cancel',
        auth: 'user',
      }),
      expect.objectContaining({
        id: 'account.billing.subscription.reactivate',
        method: 'POST',
        path: '/api/account/billing/subscription/reactivate',
        auth: 'user',
      }),
      expect.objectContaining({
        id: 'account.billing.portal.create',
        method: 'POST',
        path: '/api/account/billing/portal',
        auth: 'user',
      }),
      expect.objectContaining({
        id: 'admin.billing.live-readiness.status',
        method: 'GET',
        path: '/api/admin/billing/live-readiness/status',
        auth: 'admin',
      }),
    ]));
  });
});
